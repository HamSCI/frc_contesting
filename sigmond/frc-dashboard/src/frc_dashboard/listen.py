"""
"Click to listen" audio for the Waterfall tab (ka9q-python).

Each browser that listens gets one ordinary radiod audio channel (USB, LSB,
CW or AM, 12 kHz, AGC on), the same kind of channel wspr-recorder and
psk-recorder run dozens of, so its radiod cost is small next to the
waterfall's spectrum channels.  Audio flows:

    radiod --RTP float32--> RadiodStream (this process) --s16le 12 kHz-->
    control socket /x/frc-dashboard/listen/audio --> Flask relay --> browser

Channels are capped at ``max_listeners`` and are removed when the browser
stops listening, disconnects (``idle_timeout_sec`` without an audio reader
or keepalive), or the supervisor shuts down.  Where radiod supports it, each
channel also carries a LIFETIME that this manager keeps refreshing, so a
crashed supervisor's channels self-destruct instead of leaking.
"""

from __future__ import annotations

import logging
import secrets
import threading
import time
from collections import deque
from dataclasses import dataclass, field

log = logging.getLogger('frc-dashboard.listen')

SAMPLE_RATE = 12_000
BLOCK_SEC = 0.02                 # radiod frame: 240 samples at 12 kHz
LIFETIME_FRAMES = 1500           # 30 s of radiod frames; refreshed every 10 s
MODES = {'usb': 'usb', 'lsb': 'lsb', 'cw': 'cwu', 'am': 'am'}
MAX_BUFFER_SEC = 2.0             # drop oldest audio beyond this (slow client)
FREQ_MIN, FREQ_MAX = 100_000, 60_000_000


@dataclass
class Listener:
    sid: str
    freq_hz: float
    mode: str
    ssrc: int | None = None
    channel: object = None
    stream: object = None
    chunks: deque = field(default_factory=deque)   # bytes, s16le mono
    buffered: int = 0                               # bytes in chunks
    cond: threading.Condition = field(default_factory=threading.Condition)
    reader: int = 0                                 # generation of the active reader
    last_seen: float = field(default_factory=time.time)
    started: float = field(default_factory=time.time)
    bytes_out: int = 0

    def public(self) -> dict:
        return {'sid': self.sid, 'freq_hz': self.freq_hz, 'mode': self.mode,
                'sample_rate': SAMPLE_RATE}


class ListenManager:
    def __init__(self, cfg: dict, radiod_status: str | None):
        c = cfg.get('listen', {})
        self.enabled = bool(c.get('enabled', True))
        self.radiod_status = (cfg.get('waterfall', {}).get('radiod_status')
                              or c.get('radiod_status') or radiod_status)
        self.max_listeners = int(c.get('max_listeners', 2))
        self.idle_timeout = float(c.get('idle_timeout_sec', 15))
        self.listeners: dict[str, Listener] = {}
        self.lock = threading.Lock()
        self.control = None
        self._last_refresh = 0.0
        self.opened = 0

    # ------------------------------------------------------------- helpers
    def _ctl(self):
        if self.control is None:
            from ka9q import RadiodControl                 # optional dependency
            self.control = RadiodControl(self.radiod_status, client_id='frc-dashboard')
        return self.control

    @staticmethod
    def _check(freq_hz, mode) -> tuple[float, str]:
        try:
            f = float(freq_hz)
        except (TypeError, ValueError):
            raise ValueError('freq_hz must be a number')
        if not FREQ_MIN <= f <= FREQ_MAX:
            raise ValueError(f'freq_hz out of range ({FREQ_MIN}-{FREQ_MAX})')
        m = str(mode or 'usb').lower()
        if m not in MODES:
            raise ValueError(f'mode must be one of {sorted(MODES)}')
        return round(f), m

    def _on_samples(self, lst: Listener):
        def cb(samples, quality=None):
            try:
                import numpy as np
                pcm = (np.clip(np.asarray(samples, dtype=np.float32), -1.0, 1.0) * 32767.0)
                data = pcm.astype('<i2').tobytes()
            except Exception as e:                          # never kill the RTP thread
                log.debug('audio convert failed: %s', e)
                return
            limit = int(MAX_BUFFER_SEC * SAMPLE_RATE * 2)
            with lst.cond:
                lst.chunks.append(data)
                lst.buffered += len(data)
                while lst.buffered > limit and len(lst.chunks) > 1:
                    lst.buffered -= len(lst.chunks.popleft())
                lst.cond.notify_all()
        return cb

    def _create_channel(self, lst: Listener) -> None:
        from ka9q import RadiodStream
        from ka9q.types import Encoding
        ctl = self._ctl()
        kwargs = dict(frequency_hz=lst.freq_hz, preset=MODES[lst.mode], sample_rate=SAMPLE_RATE,
                      agc_enable=1, encoding=Encoding.F32LE)
        try:
            ch = ctl.ensure_channel(**kwargs, lifetime=LIFETIME_FRAMES)
        except TypeError:                                   # older ka9q-python: no lifetime
            ch = ctl.ensure_channel(**kwargs)
        lst.channel, lst.ssrc = ch, ch.ssrc
        lst.stream = RadiodStream(channel=ch, on_samples=self._on_samples(lst),
                                  samples_per_packet=int(SAMPLE_RATE * BLOCK_SEC),
                                  deliver_interval_packets=5)
        lst.stream.start()

    def _destroy(self, lst: Listener) -> None:
        if lst.stream is not None:
            try:
                lst.stream.stop()
            except Exception as e:
                log.debug('stream stop: %s', e)
            lst.stream = None
        if lst.ssrc is not None and self.control is not None:
            try:
                self.control.remove_channel(lst.ssrc)
            except Exception as e:
                log.warning('remove_channel %s: %s', lst.ssrc, e)
        with lst.cond:
            lst.reader += 1                                 # end any streaming reader
            lst.cond.notify_all()
        log.info('listener %s closed (%.0f s, %d KB sent)', lst.sid,
                 time.time() - lst.started, lst.bytes_out // 1024)

    # -------------------------------------------------------------- actions
    def open(self, freq_hz, mode) -> tuple[int, dict]:
        if not self.enabled:
            return 403, {'error': 'listening disabled in config'}
        if not self.radiod_status:
            return 503, {'error': 'radiod status address unknown'}
        try:
            f, m = self._check(freq_hz, mode)
        except ValueError as e:
            return 400, {'error': str(e)}
        with self.lock:
            if len(self.listeners) >= self.max_listeners:
                return 503, {'error': f'all {self.max_listeners} listening slots are in use; try again later'}
            lst = Listener(secrets.token_urlsafe(12), f, m)
            self.listeners[lst.sid] = lst
        try:
            self._create_channel(lst)
        except Exception as e:
            with self.lock:
                self.listeners.pop(lst.sid, None)
            self._destroy(lst)
            log.error('open listener failed: %s', e)
            return 503, {'error': f'could not create radiod channel: {type(e).__name__}: {e}'}
        self.opened += 1
        log.info('listener %s: %.4f MHz %s (ssrc %s)', lst.sid, f / 1e6, m, lst.ssrc)
        return 200, lst.public()

    def tune(self, sid, freq_hz, mode) -> tuple[int, dict]:
        lst = self.listeners.get(sid or '')
        if lst is None:
            return 404, {'error': 'unknown or expired listener'}
        try:
            f, m = self._check(freq_hz, mode or lst.mode)
        except ValueError as e:
            return 400, {'error': str(e)}
        try:
            ctl = self._ctl()
            if m != lst.mode:
                ctl.set_preset(lst.ssrc, MODES[m])
            if f != lst.freq_hz:
                ctl.set_frequency(lst.ssrc, f)
        except Exception as e:
            return 503, {'error': f'retune failed: {type(e).__name__}: {e}'}
        lst.freq_hz, lst.mode, lst.last_seen = f, m, time.time()
        return 200, lst.public()

    def close(self, sid) -> tuple[int, dict]:
        with self.lock:
            lst = self.listeners.pop(sid or '', None)
        if lst is None:
            return 404, {'error': 'unknown or expired listener'}
        self._destroy(lst)
        return 200, {'closed': sid}

    def keepalive(self, sid) -> tuple[int, dict]:
        lst = self.listeners.get(sid or '')
        if lst is None:
            return 404, {'error': 'unknown or expired listener'}
        lst.last_seen = time.time()
        return 200, lst.public()

    def audio(self, sid):
        """Generator of s16le chunks for one listener; a new reader replaces the old."""
        lst = self.listeners.get(sid or '')
        if lst is None:
            return None
        with lst.cond:
            lst.reader += 1
            me = lst.reader
            lst.chunks.clear()
            lst.buffered = 0

        def gen():
            while True:
                with lst.cond:
                    while not lst.chunks and lst.reader == me:
                        lst.cond.wait(1.0)
                        lst.last_seen = time.time()
                    if lst.reader != me:
                        return
                    out = b''.join(lst.chunks)
                    lst.chunks.clear()
                    lst.buffered = 0
                lst.last_seen = time.time()
                lst.bytes_out += len(out)
                yield out
        return gen()

    # ------------------------------------------------------------ upkeep
    def tick(self) -> None:
        """Supervisor loop: expire idle listeners, refresh channel lifetimes."""
        now = time.time()
        with self.lock:
            stale = [s for s, l in self.listeners.items() if now - l.last_seen > self.idle_timeout]
            expired = [self.listeners.pop(s) for s in stale]
        for lst in expired:
            log.info('listener %s idle %.0f s; closing', lst.sid, now - lst.last_seen)
            self._destroy(lst)
        if self.listeners and now - self._last_refresh > 10 and self.control is not None:
            self._last_refresh = now
            setter = getattr(self.control, 'set_channel_lifetime', None)
            if setter:
                for lst in list(self.listeners.values()):
                    try:
                        setter(lst.ssrc, LIFETIME_FRAMES)
                    except Exception as e:
                        log.debug('lifetime refresh %s: %s', lst.ssrc, e)

    def shutdown(self) -> None:
        with self.lock:
            all_l = list(self.listeners.values())
            self.listeners.clear()
        for lst in all_l:
            self._destroy(lst)
        if self.control is not None:
            try:
                self.control.close()
            except Exception:
                pass
            self.control = None

    def status(self) -> dict:
        return {'enabled': self.enabled, 'max_listeners': self.max_listeners,
                'active': [{**l.public(), 'sid': l.sid[:4] + '…',
                            'age_s': round(time.time() - l.started)}
                           for l in list(self.listeners.values())],
                'opened_total': self.opened}
