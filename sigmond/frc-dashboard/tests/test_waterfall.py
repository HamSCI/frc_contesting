"""WaterfallManager tests with a fake ka9q module (no radiod needed)."""

import base64
import sys
import time
import types

import numpy as np
import pytest

from frc_dashboard.config import DEFAULTS, deep_merge
from frc_dashboard.waterfall import BAND_EDGES, _is_5_smooth, plan_band

SAMPRATE = 129_600_000          # RX-888 on W3USR-06


class FakeSpectrumStream:
    instances = []

    def __init__(self, control, frequency_hz, bin_count, resolution_bw, **kw):
        self.frequency_hz, self.bin_count, self.rbw = frequency_hz, bin_count, resolution_bw
        self.on_spectrum = kw['on_spectrum']
        self.started = self.stopped = False
        FakeSpectrumStream.instances.append(self)

    def start(self):
        self.started = True

    def stop(self):
        self.stopped = True

    def emit(self, db):
        spec = types.SimpleNamespace(bin_power_db=np.asarray(db, dtype=np.float32))
        self.on_spectrum(types.SimpleNamespace(spectrum=spec))


class FakeControl:
    fail = False

    def __init__(self, status, **kw):
        if FakeControl.fail:
            raise OSError('radiod unreachable')

    def listen_status(self, callback, duration=None):
        callback(types.SimpleNamespace(frontend=types.SimpleNamespace(input_samprate=SAMPRATE)))

    def close(self):
        pass


@pytest.fixture
def manager(monkeypatch):
    fake = types.ModuleType('ka9q')
    fake.RadiodControl = FakeControl
    fake.SpectrumStream = FakeSpectrumStream
    monkeypatch.setitem(sys.modules, 'ka9q', fake)
    FakeSpectrumStream.instances = []
    FakeControl.fail = False
    from frc_dashboard.waterfall import WaterfallManager
    cfg = deep_merge(DEFAULTS, {'waterfall': {'bands': '20m,10m,bogus', 'bins': 800,
                                              'poll_sec': 0.01, 'idle_timeout_sec': 60}})
    return WaterfallManager(cfg, 'test-status.local')


def wait_state(m, state, timeout=2.0):
    end = time.time() + timeout
    while m.state != state and time.time() < end:
        time.sleep(0.01)
    assert m.state == state


def start(m):
    assert m.snapshot().get('starting')
    wait_state(m, 'running')


# ---------------------------------------------------------------- planning
@pytest.mark.parametrize('band', list(BAND_EDGES))
def test_plan_uses_cheap_fft_sizes(band):
    lo, hi = BAND_EDGES[band]
    rbw, bins = plan_band(lo, hi, 800, SAMPRATE)
    n = SAMPRATE / rbw
    assert abs(n - round(n)) < 1e-6 and _is_5_smooth(round(n))   # radiod's FFT size
    assert rbw > 200                                              # wideband (cheap) path
    assert bins <= 800 and bins * rbw >= hi - lo


def test_plan_avoids_the_20m_size_that_dropped_blocks():
    rbw, _ = plan_band(14_000_000, 14_350_000, 800, SAMPRATE)
    assert rbw != 437.5          # 296228.57-point FFT: ~7000 radiod drops/min


def test_plan_without_samprate_falls_back():
    assert plan_band(28_000_000, 28_800_000, 800, None) == (1000.0, 800)


# --------------------------------------------------------------- lifecycle
def test_starts_in_background_with_band_geometry(manager):
    assert manager.state == 'stopped' and FakeSpectrumStream.instances == []
    start(manager)
    snap = manager.snapshot()
    assert snap['running'] and set(snap['bands']) == {'20m', '10m'}       # bogus ignored
    s10 = next(s for s in FakeSpectrumStream.instances if s.frequency_hz == 28_400_000)
    assert s10.bin_count == 800 and s10.rbw == 1000.0
    assert manager.samprate == SAMPRATE


def test_rows_are_quantised_and_filtered_by_since(manager):
    start(manager)
    s = FakeSpectrumStream.instances[0]
    s.emit([-150, -105, -60, -200])
    s.emit([-120, -120, -120, -120])
    snap = manager.snapshot()
    band = next(b for b in snap['bands'].values() if b['rows'])
    assert list(base64.b64decode(band['rows'][0][2])) == [0, 127, 255, 0]
    later = manager.snapshot(since=band['rows'][0][0])
    assert len(next(b for b in later['bands'].values() if b['rows'])['rows']) == 1


def test_idle_timeout_removes_channels_and_restarts_on_demand(manager):
    start(manager)
    streams = list(FakeSpectrumStream.instances)
    manager.last_demand -= 61
    manager.tick()
    assert manager.state == 'stopped' and all(s.stopped for s in streams)
    start(manager)
    assert manager.starts == 2


def test_start_failure_reports_and_backs_off(manager):
    FakeControl.fail = True
    assert manager.snapshot().get('starting')
    wait_state(manager, 'stopped')
    snap = manager.snapshot()
    assert snap['running'] is False and 'radiod unreachable' in snap['error']
    FakeControl.fail = False
    assert 'error' in manager.snapshot()             # still inside the 30 s backoff
    manager._last_fail -= 31
    start(manager)
