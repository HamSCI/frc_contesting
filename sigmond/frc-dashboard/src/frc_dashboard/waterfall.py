"""
Contest-band waterfalls from radiod spectrum channels (ka9q-python).

One SpectrumStream per band asks radiod for a spectrum-only channel (no audio
demodulator) covering the whole band.  Each frame is quantised to one uint8
row and kept in a short per-band history that the Flask app reads through the
supervisor's control socket (GET /x/frc-dashboard/waterfall).

radiod cost — measured on W3USR-06 (RX-888 at 129.6 MS/s), see
sigmond/README.md.  With rbw above radiod's 200 Hz crossover, radiod computes
each frame as one FFT of ``samprate / rbw`` points over the raw front-end
samples.  Three things decide whether that makes radiod drop blocks on
EVERY channel (WSPR, FT8, hf-timestd...):

  * FFT size: ``samprate / rbw`` must be a 5-smooth integer.  20 m at
    437.5 Hz bins (296228.57 points) alone caused ~7000 drops/min; at 400 Hz
    (324000 points) it caused none.  ``plan_band`` picks such sizes.
  * Simultaneous polls: six bands polled in the same instant dropped blocks;
    the same six staggered across the poll interval did not.
  * Work per second: averaging x bands / poll_sec.  The defaults (2 FFTs per
    row, one row per 2 s) measured zero drops; 4 per 1 s still dropped a few.

Channels exist only while someone watches: the first request starts them
(in the background) and they are removed after ``idle_timeout_sec`` without
a viewer.  Bins arrive from radiod already in low-to-high frequency order
(verified against the WWV 10 MHz carrier), so no reordering is applied.
"""

from __future__ import annotations

import base64
import logging
import math
import threading
import time
from collections import deque
from dataclasses import dataclass, field

log = logging.getLogger('frc-dashboard.waterfall')
# ka9q-python logs every spectrum poll at INFO (several lines/s while watched).
logging.getLogger('ka9q').setLevel(logging.WARNING)

# Band edges shown for each contest band (Hz).  10 m is limited to the busy
# bottom 800 kHz; the whole 1.7 MHz would leave too little detail per bin.
BAND_EDGES = {
    '160m': (1_800_000, 2_000_000),
    '80m':  (3_500_000, 4_000_000),
    '40m':  (7_000_000, 7_300_000),
    '20m':  (14_000_000, 14_350_000),
    '15m':  (21_000_000, 21_450_000),
    '10m':  (28_000_000, 28_800_000),
}

# Fixed quantisation range for the uint8 rows; the browser applies its own
# contrast inside this window.
DB_MIN, DB_MAX = -150.0, -60.0

# radiod's DEFAULT_CROSSOVER (ka9q-radio defaults.h): rbw above this uses the
# cheap "wideband" path straight off the front-end samples.
RADIOD_CROSSOVER_HZ = 200.0


def _is_5_smooth(n: int) -> bool:
    for p in (2, 3, 5):
        while n % p == 0:
            n //= p
    return n == 1


def plan_band(lo_hz: float, hi_hz: float, max_bins: int,
              samprate: float | None) -> tuple[float, int]:
    """(rbw_hz, bins) covering [lo, hi] with an FFT size radiod handles cheaply.

    rbw = samprate / N with N the largest 5-smooth integer that keeps
    bins <= max_bins and rbw above the crossover.  Without a known sample
    rate, falls back to a plain span / max_bins split.
    """
    span = hi_hz - lo_hz
    if not samprate:
        return span / max_bins, max_bins
    n = min(int(samprate * max_bins / span), int(samprate / (RADIOD_CROSSOVER_HZ * 1.05)))
    while n > 1 and not _is_5_smooth(n):
        n -= 1
    rbw = samprate / n
    return rbw, math.ceil(span / rbw - 1e-9)


@dataclass
class Band:
    name: str
    lo_hz: int
    hi_hz: int
    bins: int = 0
    rbw: float = 0.0
    rows: deque = field(default_factory=deque)     # (seq, epoch, bytes)
    stream: object = None
    frames: int = 0
    last_frame: float = 0.0

    def meta(self) -> dict:
        # The plotted span is exactly bins x rbw starting at lo_hz.
        return {'name': self.name, 'lo_hz': self.lo_hz,
                'hi_hz': round(self.lo_hz + self.bins * self.rbw), 'bins': self.bins,
                'rbw_hz': round(self.rbw, 3)}


class WaterfallManager:
    def __init__(self, cfg: dict, radiod_status: str | None):
        w = cfg['waterfall']
        self.enabled = bool(w.get('enabled', True))
        self.radiod_status = w.get('radiod_status') or radiod_status
        self.max_bins = int(w.get('bins', 800))
        self.poll_sec = float(w.get('poll_sec', 2.0))
        self.averaging = int(w.get('averaging', 2)) or None
        self.idle_timeout = float(w.get('idle_timeout_sec', 60))
        self.history = int(w.get('history_rows', 300))
        names = [b.strip() for b in str(w.get('bands', ','.join(BAND_EDGES))).split(',') if b.strip()]
        self.bands = {n: Band(n, *BAND_EDGES[n], rows=deque(maxlen=self.history))
                      for n in names if n in BAND_EDGES}
        self.lock = threading.Lock()          # rows / counters
        self.life = threading.Lock()          # start/stop of radiod channels
        self.seq = 0
        self.state = 'stopped'                # stopped | starting | running
        self.last_demand = 0.0
        self.control = None
        self.samprate: float | None = None
        self.error: str | None = None
        self.starts = 0
        self._last_fail = 0.0
        self._stop_evt = threading.Event()

    @property
    def running(self) -> bool:
        return self.state == 'running'

    # --------------------------------------------------------- lifecycle
    def _learn_samprate(self) -> float | None:
        """Front-end sample rate from any status packet radiod broadcasts."""
        found: list[int] = []

        def grab(st):
            sr = getattr(getattr(st, 'frontend', None), 'input_samprate', None)
            if sr and not found:
                found.append(sr)

        try:
            self.control.listen_status(grab, duration=3.0)
        except Exception as e:
            log.warning('could not read radiod sample rate (%s); bins not FFT-optimised', e)
        return float(found[0]) if found else None

    def _start_worker(self) -> None:
        """Create one radiod spectrum channel per band, staggered across a poll."""
        try:
            from ka9q import RadiodControl, SpectrumStream   # optional dependency
            self.control = RadiodControl(self.radiod_status, client_id='frc-dashboard')
            if self.samprate is None:
                self.samprate = self._learn_samprate()
            stagger = self.poll_sec / max(1, len(self.bands))
            for b in self.bands.values():
                if self._stop_evt.is_set():
                    break
                b.rbw, b.bins = plan_band(b.lo_hz, b.hi_hz, self.max_bins, self.samprate)
                center = b.lo_hz + b.bins * b.rbw / 2
                b.stream = SpectrumStream(
                    self.control, frequency_hz=center, bin_count=b.bins,
                    resolution_bw=b.rbw, averaging=self.averaging,
                    poll_interval_sec=self.poll_sec, on_spectrum=self._callback(b))
                b.stream.start()
                # Spread the bands' polls over the interval: simultaneous
                # wideband FFTs are what tipped radiod into dropping blocks.
                self._stop_evt.wait(stagger)
            with self.life:
                if self._stop_evt.is_set():
                    self._stop()
                    return
                self.state = 'running'
                self.starts += 1
                self.error = None
            log.info('waterfall started: %s on %s (samprate %s), poll %.1fs, avg %s',
                     ', '.join(f'{b.name} {b.bins}x{b.rbw:.1f}Hz' for b in self.bands.values()),
                     self.radiod_status, self.samprate, self.poll_sec, self.averaging)
        except Exception as e:
            with self.life:
                self.error = f'{type(e).__name__}: {e}'
                self._last_fail = time.time()
                log.error('waterfall start failed: %s', self.error)
                self._stop()

    def _stop(self) -> None:
        """Remove every spectrum channel from radiod (caller holds self.life)."""
        for b in self.bands.values():
            if b.stream is not None:
                try:
                    b.stream.stop()          # removes the channel from radiod
                except Exception as e:
                    log.warning('stopping %s spectrum: %s', b.name, e)
                b.stream = None
        if self.control is not None:
            try:
                self.control.close()
            except Exception:
                pass
            self.control = None
        if self.state == 'running':
            log.info('waterfall stopped')
        self.state = 'stopped'

    def _callback(self, band: Band):
        def on_spectrum(st):
            db = st.spectrum.bin_power_db
            if db is None or len(db) == 0:
                return
            scaled = (db - DB_MIN) * (255.0 / (DB_MAX - DB_MIN))
            row = scaled.clip(0, 255).astype('uint8').tobytes()
            now = time.time()
            with self.lock:
                self.seq += 1
                band.rows.append((self.seq, now, row))
                band.frames += 1
                band.last_frame = now
        return on_spectrum

    def tick(self) -> None:
        """Called by the supervisor loop: stop channels once nobody watches."""
        with self.life:
            if self.state == 'running' and time.time() - self.last_demand > self.idle_timeout:
                self._stop()

    def shutdown(self) -> None:
        self._stop_evt.set()
        with self.life:
            self._stop()

    # ------------------------------------------------------------- reads
    def snapshot(self, since: int = 0) -> dict:
        """Rows newer than ``since`` for every band; starts channels on demand."""
        if not self.enabled:
            return {'enabled': False, 'running': False, 'error': 'waterfall disabled in config'}
        if not self.radiod_status:
            return {'enabled': False, 'running': False, 'error': 'radiod status address unknown'}
        self.last_demand = time.time()
        with self.life:
            if self.state == 'stopped':
                # Don't hammer radiod with retries if it keeps failing.
                if self.error and time.time() - self._last_fail < 30:
                    return {'enabled': True, 'running': False, 'error': self.error}
                self.state = 'starting'
                threading.Thread(target=self._start_worker, name='waterfall-start',
                                 daemon=True).start()
            if self.state == 'starting':
                return {'enabled': True, 'running': False, 'starting': True,
                        'poll_sec': self.poll_sec}
        with self.lock:
            out = {}
            for b in self.bands.values():
                rows = [[s, round(t, 2), base64.b64encode(r).decode()]
                        for s, t, r in b.rows if s > since]
                out[b.name] = {**b.meta(), 'rows': rows,
                               'last_frame_age_s': round(time.time() - b.last_frame, 1) if b.last_frame else None}
            return {'enabled': True, 'running': True, 'seq': self.seq,
                    'db_min': DB_MIN, 'db_max': DB_MAX, 'poll_sec': self.poll_sec,
                    'bands': out}

    def status(self) -> dict:
        with self.lock:
            return {
                'enabled': self.enabled,
                'state': self.state,
                'radiod_status': self.radiod_status,
                'samprate': self.samprate,
                'starts': self.starts,
                'idle_s': round(time.time() - self.last_demand, 1) if self.last_demand else None,
                'error': self.error,
                'frames': {b.name: b.frames for b in self.bands.values()},
                'plan': {b.name: {'bins': b.bins, 'rbw_hz': round(b.rbw, 3)}
                         for b in self.bands.values() if b.bins},
            }
