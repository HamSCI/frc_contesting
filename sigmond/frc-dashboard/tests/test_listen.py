"""ListenManager tests with a fake ka9q module (no radiod needed)."""

import sys
import threading
import time
import types

import numpy as np
import pytest

from frc_dashboard.config import DEFAULTS, deep_merge


class FakeStream:
    instances = []

    def __init__(self, channel, on_samples, **kw):
        self.channel, self.on_samples, self.kw = channel, on_samples, kw
        self.stopped = False
        FakeStream.instances.append(self)

    def start(self):
        pass

    def stop(self):
        self.stopped = True


class FakeControl:
    def __init__(self, status, **kw):
        self.calls, self.removed, self.next_ssrc = [], [], 1000

    def ensure_channel(self, **kw):
        self.calls.append(('ensure', kw))
        self.next_ssrc += 1
        # radiod applies the encoding after creation: the first report says S16
        return types.SimpleNamespace(ssrc=self.next_ssrc, encoding=2)

    def poll_channel(self, ssrc, **kw):
        return types.SimpleNamespace(encoding=4)

    def set_gain(self, ssrc, db):
        self.calls.append(('gain', ssrc, db))

    def set_agc(self, ssrc, enable):
        self.calls.append(('agc', ssrc, enable))

    def set_frequency(self, ssrc, f):
        self.calls.append(('freq', ssrc, f))

    def set_preset(self, ssrc, p):
        self.calls.append(('preset', ssrc, p))

    def set_channel_lifetime(self, ssrc, frames):
        self.calls.append(('lifetime', ssrc, frames))

    def remove_channel(self, ssrc):
        self.removed.append(ssrc)

    def close(self):
        pass


@pytest.fixture
def mgr(monkeypatch):
    fake = types.ModuleType('ka9q')
    fake.RadiodControl = FakeControl
    fake.RadiodStream = FakeStream
    fake_types = types.ModuleType('ka9q.types')
    fake_types.Encoding = types.SimpleNamespace(F32LE=4)
    monkeypatch.setitem(sys.modules, 'ka9q', fake)
    monkeypatch.setitem(sys.modules, 'ka9q.types', fake_types)
    FakeStream.instances = []
    from frc_dashboard.listen import ListenManager
    cfg = deep_merge(DEFAULTS, {'listen': {'max_listeners': 2, 'idle_timeout_sec': 15}})
    return ListenManager(cfg, 'test-status.local')


def test_open_creates_usb_channel_with_lifetime(mgr):
    code, r = mgr.open('14225000', 'usb')
    assert code == 200 and r['sample_rate'] == 12000 and r['mode'] == 'usb'
    kind, kw = mgr.control.calls[0]
    assert kind == 'ensure' and kw['preset'] == 'usb' and kw['frequency_hz'] == 14225000
    assert kw['sample_rate'] == 12000 and kw['agc_enable'] == 1 and kw['lifetime'] > 0
    assert FakeStream.instances[0].kw['samples_per_packet'] == 240


def test_open_turns_agc_back_on_and_uses_granted_encoding(mgr):
    _, r = mgr.open(14_074_000, 'usb')
    ssrc = mgr.listeners[r['sid']].ssrc
    kinds = [c[0] for c in mgr.control.calls]
    assert kinds.index('gain') < kinds.index('agc')     # AGC last: GAIN turns it off
    assert ('agc', ssrc, True) in mgr.control.calls
    assert FakeStream.instances[0].channel.encoding == 4  # not the stale S16 report


def test_tune_frequency_keeps_channel(mgr):
    _, r = mgr.open(14_074_000, 'usb')
    ssrc = mgr.listeners[r['sid']].ssrc
    assert mgr.tune(r['sid'], 7_074_000, 'usb')[0] == 200
    assert ('freq', ssrc, 7_074_000) in mgr.control.calls
    assert mgr.listeners[r['sid']].ssrc == ssrc and not mgr.control.removed


def test_tune_mode_swaps_channel_and_keeps_reader(mgr):
    _, r = mgr.open(7_150_000, 'lsb')
    old = mgr.listeners[r['sid']].ssrc
    gen = mgr.audio(r['sid'])
    code, r2 = mgr.tune(r['sid'], 7_074_000, 'usb')
    assert code == 200 and r2['mode'] == 'usb' and r2['sid'] == r['sid']
    lst = mgr.listeners[r['sid']]
    assert old in mgr.control.removed and lst.ssrc != old
    assert not any(c[0] == 'preset' for c in mgr.control.calls)
    kind, kw = [c for c in mgr.control.calls if c[0] == 'ensure'][-1]
    assert kw['preset'] == 'usb' and kw['frequency_hz'] == 7_074_000
    assert FakeStream.instances[0].stopped
    FakeStream.instances[1].on_samples(np.zeros(4, dtype=np.float32))
    assert len(next(gen)) == 8                          # same reader, new channel


def test_cw_maps_to_radiod_cwu_preset(mgr):
    _, r = mgr.open(14_030_000, 'cw')
    assert mgr.control.calls[0][1]['preset'] == 'cwu'


def test_validation(mgr):
    assert mgr.open('abc', 'usb')[0] == 400
    assert mgr.open(99_000_000, 'usb')[0] == 400
    assert mgr.open(14e6, 'fm')[0] == 400
    assert mgr.tune('nope', 14e6, 'usb')[0] == 404


def test_listener_cap_and_close_releases_channel(mgr):
    a = mgr.open(14e6, 'usb')[1]
    mgr.open(21e6, 'usb')
    code, r = mgr.open(28e6, 'usb')
    assert code == 503 and 'slots' in r['error']
    ssrc = mgr.listeners[a['sid']].ssrc
    assert mgr.close(a['sid'])[0] == 200
    assert ssrc in mgr.control.removed and FakeStream.instances[0].stopped
    assert mgr.open(28e6, 'usb')[0] == 200


def test_idle_listener_expires(mgr):
    _, r = mgr.open(14e6, 'usb')
    mgr.listeners[r['sid']].last_seen -= 16
    mgr.tick()
    assert r['sid'] not in mgr.listeners and mgr.control.removed


def test_waiting_reader_does_not_keep_listener_alive(mgr):
    _, r = mgr.open(14e6, 'usb')
    gen = mgr.audio(r['sid'])
    t = threading.Thread(target=lambda: list(gen))      # blocks: radiod sends nothing
    t.start()
    mgr.listeners[r['sid']].last_seen -= 16
    time.sleep(1.2)                                     # reader wakes at least once
    mgr.tick()
    t.join(3)
    assert r['sid'] not in mgr.listeners and not t.is_alive()


def test_audio_is_s16le_and_new_reader_replaces_old(mgr):
    _, r = mgr.open(14e6, 'usb')
    stream = FakeStream.instances[0]
    gen = mgr.audio(r['sid'])
    stream.on_samples(np.array([0.0, 0.5, -1.0, 2.0], dtype=np.float32))
    chunk = next(gen)
    assert np.frombuffer(chunk, dtype='<i2').tolist() == [0, 16383, -32767, 32767]
    gen2 = mgr.audio(r['sid'])                     # second reader takes over
    stream.on_samples(np.zeros(4, dtype=np.float32))
    assert len(next(gen2)) == 8
    with pytest.raises(StopIteration):
        next(gen)
    assert mgr.audio('unknown') is None
