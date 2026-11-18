"""
RTTY skimmer engine: decode every 45.45-baud, 170 Hz-shift RTTY signal in a
slice of a band at once (the amateur contest standard).

It shares the CW skimmer's filter bank (cwskim.SkimmerEngine: 16 ms Hann,
31.25 Hz bins, 4 ms hop) for the spectrum and to find signals, and decodes
each signal with the framing logic of the browser's RttyDecoder
(static/js/decoders.js), which was checked on the air:

  1. Detection.  An RTTY signal is two peaks 170 Hz apart (150-190 Hz) that
     take turns: their power over the last 0.5 s is anti-correlated.  On the
     air the mark is the higher RF frequency (LSB with 2125/2295 Hz tones).
  2. Per signal, the IQ is mixed so the pair is centred on 0 Hz and averaged
     down to 1500 samples/s.  Cumulative sums of that baseband turned to the
     mark (+85 Hz) and space (-85 Hz) tones give the tone energy over any
     window at once, so the discriminator (mark - space) / (mark + space)
     can be read over the same windows the browser decoder uses.
  3. Framing, exactly as the browser decoder: every 1/8 bit a quarter-bit
     reading looks for the mark-to-space start edge (placed at the zero
     crossing, accepting it when one of the last two readings was clearly
     mark); 6.9 bits later the five data bits are read over their middle
     60 %, and the frame counts only if the start bit is space and the stop
     bit mark.  ITA2 Baudot, US figures, LTRS/FIGS, unshift on space.
  4. Words and spots as for CW: a call after CQ / TEST / DE / TU (or before
     TEST) is a spot, confirmed if the station knows the call or copied it
     twice there.  Words are only used from a signal whose recent frames are
     mostly clean, so a noise pair can't spot anything.
"""

from __future__ import annotations

import math
import time
from collections import deque
from dataclasses import dataclass, field

import numpy as np

from .cwskim import CQ_WORDS, SkimmerEngine, Spot, is_call

BAUDOT_LTRS = ['', 'E', '\n', 'A', ' ', 'S', 'I', 'U', '\r', 'D', 'R', 'J', 'N', 'F', 'C', 'K',
               'T', 'Z', 'L', 'W', 'H', 'Y', 'P', 'Q', 'O', 'B', 'G', None, 'M', 'X', 'V', None]
BAUDOT_FIGS = ['', '3', '\n', '-', ' ', '', '8', '7', '\r', '$', '4', "'", ',', '!', ':', '(',
               '5', '"', ')', '2', '#', '6', '0', '1', '9', '?', '&', None, '.', '/', ';', None]
FIGS, LTRS = 27, 31

BAUD = 45.45
SHIFT = 170.0
BB_RATE = 1500.0                  # per-signal baseband sample rate


class RttyFramer:
    """The browser RttyDecoder's start-edge and frame logic on a complex
    baseband whose pair is centred on 0 Hz (mark at +SHIFT/2)."""

    KEEP = 6000                    # baseband samples kept (4 s)

    def __init__(self, on_char, rate: float = BB_RATE, baud: float = BAUD, shift: float = SHIFT):
        self.rate, self.on_char = rate, on_char
        self.sym = rate / baud
        self.tick_every = max(1, round(self.sym / 8))
        w = 2 * np.pi * (shift / 2) / rate
        self.wm, self.ws = -w, w   # mixing to bring the mark / space tone to 0 Hz
        self.base = 0              # absolute index of cm[0]
        self.cm = np.zeros(1, np.complex128)   # cumsum, cm[i] = sum of samples before base+i
        self.cs = np.zeros(1, np.complex128)
        self.total = 0             # samples seen
        self.next_tick = self.tick_every
        self.idle_mark = 0.0
        self.frame_start = None
        self.hist: list = []
        self.figs = False
        self.good = self.errors = 0
        self.recent: deque = deque(maxlen=30)   # 1 = clean frame, 0 = framing error

    def feed(self, b: np.ndarray) -> None:
        n0 = self.total
        n = n0 + np.arange(len(b))
        em = b * np.exp(1j * self.wm * n)
        es = b * np.exp(1j * self.ws * n)
        self.cm = np.concatenate([self.cm, self.cm[-1] + np.cumsum(em)])
        self.cs = np.concatenate([self.cs, self.cs[-1] + np.cumsum(es)])
        self.total += len(b)
        if len(self.cm) > self.KEEP * 2:
            cut = len(self.cm) - self.KEEP
            self.cm, self.cs = self.cm[cut:], self.cs[cut:]
            self.base += cut
        while self.next_tick <= self.total:
            self._tick(self.next_tick)
            self.next_tick += self.tick_every

    def resync(self) -> None:
        """After a gap in the input: forget any frame in progress."""
        self.frame_start = None
        self.hist = []
        self.idle_mark = 0.0

    def _disc(self, start: float, length: float) -> float:
        a = int(round(start)) - self.base
        z = a + max(1, int(round(length)))
        if a < 0 or z >= len(self.cm):
            return 0.0
        m = abs(self.cm[z] - self.cm[a]) ** 2
        s = abs(self.cs[z] - self.cs[a]) ** 2
        return float((m - s) / (m + s + 1e-30))

    def _tick(self, now: int) -> None:
        sym = self.sym
        if self.frame_start is None:
            q = round(sym / 4)
            d = self._disc(now - q, q)
            t = now - q / 2
            h = self.hist
            if d < -0.2 and self.idle_mark >= sym * 0.5:
                k = len(h) - 1
                while k >= 0 and len(h) - k <= 2 and not (h[k][1] > 0.2):
                    k -= 1
                if k >= 0 and len(h) - k <= 2:
                    pts = h[k:] + [(t, d)]
                    j = 1
                    while j < len(pts) - 1 and pts[j][1] > 0:
                        j += 1
                    (t1, d1), (t2, d2) = pts[j - 1], pts[j]
                    self.frame_start = t1 + (t2 - t1) * d1 / (d1 - d2) if d1 - d2 > 0 else t2
                    self.hist = []
                    return
            if d > 0.2:
                self.idle_mark += sym / 8
            if d < -0.2:
                self.idle_mark = 0.0
            h.append((t, d))
            if len(h) > 3:
                h.pop(0)
            return
        if now - self.frame_start < sym * 6.9:
            return
        bit = lambda k: self._disc(self.frame_start + (k + 0.2) * sym, sym * 0.6)
        start, stop = bit(0), bit(6)
        code = 0
        for k in range(5):
            if bit(k + 1) > 0:
                code |= 1 << k
        self.frame_start = None
        self.hist = [(now - sym * 0.1, stop)]
        self.idle_mark = sym if stop > 0.2 else 0.0
        if start > -0.1 or stop < 0.1:
            self.errors += 1
            self.recent.append(0)
            return
        self.good += 1
        self.recent.append(1)
        self._char(code)

    def _char(self, code: int) -> None:
        if code == FIGS:
            self.figs = True
            return
        if code == LTRS:
            self.figs = False
            return
        ch = (BAUDOT_FIGS if self.figs else BAUDOT_LTRS)[code]
        if ch == ' ':
            self.figs = False
        if ch in ('\r', '', None):
            return
        self.on_char(ch)

    @property
    def clean(self) -> float:
        return sum(self.recent) / len(self.recent) if self.recent else 0.0


@dataclass
class RttySignal:
    id: int
    k_mark: int                  # bins (within the engine's selected bins)
    k_space: int
    mark_hz: float               # RF
    space_hz: float
    created: float
    last_active: float
    level: float = 4.0
    framer: RttyFramer = None
    word: str = ''
    word_err: int = 0
    text: str = ''
    words: deque = field(default_factory=lambda: deque(maxlen=12))
    copies: dict = field(default_factory=dict)
    call: str | None = None
    idle: bool = False           # squelched (pair not on the air this block)

    @property
    def snr_db(self) -> float:
        return 10 * math.log10(max(self.level - 1.0, 0.05))

    @property
    def center_hz(self) -> float:
        return (self.mark_hz + self.space_hz) / 2


class RttySkimmerEngine(SkimmerEngine):
    """Feed complex IQ; read RTTY signals, spectrum and spots.  Same interface
    as the CW engine (signal_list(), spectrum(), spots, on_spot)."""

    MODE = 'RTTY'

    def __init__(self, *a, max_signals: int = 30, **kw):
        super().__init__(*a, max_signals=max_signals, **kw)
        self.decim = max(1, int(round(self.fs / BB_RATE)))
        self.bb_rate = self.fs / self.decim
        self.samples = 0                         # IQ samples consumed (for mixing phase)
        self.signals: dict[int, RttySignal] = {}

    # -- one 0.5 s block (overrides the CW engine's) --------------------------
    def _block(self, power: np.ndarray, spec: np.ndarray, iq: np.ndarray | None = None) -> None:
        now = self.now()
        self.frames += len(power)
        self._update_noise(power)
        x = power / self.noise
        q90 = np.percentile(x, 90, axis=0)
        self.spectrum_db = 10 * np.log10(np.maximum(x.mean(axis=0), 1e-3))
        self._detect_pairs(x, q90, now)
        if iq is not None and len(iq):
            for s in list(self.signals.values()):
                # Squelch: decode only while the pair is on the air, so the
                # framer doesn't turn the noise after an over into garbage.
                if max(q90[s.k_mark], q90[s.k_space]) > self.detect:
                    if s.idle:
                        s.framer.resync()
                        s.idle = False
                    self._feed_signal(s, iq)
                elif not s.idle:
                    self._end_word(s)
                    s.idle = True
            self.samples += len(iq)

    def _detect_pairs(self, x: np.ndarray, q90: np.ndarray, now: float) -> None:
        n = len(q90)
        peak = q90.copy()
        peak[~self.detectable] = 0
        peaks = [int(k) for k in np.flatnonzero(peak > self.detect)
                 if peak[k] >= peak[max(0, k - 2):min(n, k + 3)].max()]
        lo_b, hi_b = int(math.floor(150 / self.BIN_HZ)), int(math.ceil(190 / self.BIN_HZ))
        pset = set(peaks)
        found = []
        for ks in peaks:                                   # ks = space (lower), km = mark (higher)
            for km in range(ks + lo_b, ks + hi_b + 1):
                if km in pset:
                    a, b = x[:, ks] - x[:, ks].mean(), x[:, km] - x[:, km].mean()
                    den = math.sqrt(float((a * a).sum()) * float((b * b).sum()))
                    c = float((a * b).sum()) / den if den > 0 else 0.0   # (not np.corrcoef: no BLAS)
                    if c < -0.2:
                        found.append((ks, km, min(peak[ks], peak[km])))
                    break
        for ks, km, strength in sorted(found, key=lambda f: -f[2]):
            fs_, fm_ = self._freq(q90, ks), self._freq(q90, km)
            near = [s for s in self.signals.values() if abs(s.center_hz - (fs_ + fm_) / 2) < 60]
            if near:
                s = near[0]
                s.last_active = now
                s.k_space, s.k_mark = ks, km
                s.space_hz = 0.8 * s.space_hz + 0.2 * fs_
                s.mark_hz = 0.8 * s.mark_hz + 0.2 * fm_
                s.level = 0.7 * s.level + 0.3 * float(min(q90[ks], q90[km]))
            elif len(self.signals) < self.max_signals:
                s = RttySignal(self.next_id, km, ks, fm_, fs_, now, now, level=float(min(q90[ks], q90[km])))
                s.framer = RttyFramer(self._char_cb(s), self.bb_rate)
                self.signals[s.id] = s
                self.next_id += 1
        # quiet for 20 s, or a minute in and still mostly framing errors: drop
        bad = lambda s: now - s.created > 60 and len(s.framer.recent) >= 20 and s.framer.clean < 0.3
        for sid in [sid for sid, s in self.signals.items() if now - s.last_active > 20 or bad(s)]:
            self._end_word(self.signals[sid])
            del self.signals[sid]

    def _feed_signal(self, s: RttySignal, iq: np.ndarray) -> None:
        f = s.center_hz - self.center_hz
        n = self.samples + np.arange(len(iq))
        mixed = iq * np.exp(-2j * np.pi * ((f / self.fs) * n % 1.0))
        m = len(mixed) // self.decim * self.decim
        bb = mixed[:m].reshape(-1, self.decim).mean(axis=1)
        s.framer.feed(bb)

    # -- characters, words, spots -------------------------------------------
    def _char_cb(self, s: RttySignal):
        def on_char(ch: str):
            if ch in (' ', '\n'):
                self._end_word(s)
                return
            s.word += ch
            if len(s.word) > 20:                         # runaway garbage
                s.word = ''
        return on_char

    def _end_word(self, s: RttySignal) -> None:
        word, s.word = s.word.strip(), ''
        if not word:
            return
        now = self.now()
        s.text = (s.text + ' ' + word).strip()[-240:]
        if s.framer.clean < 0.6:                         # mostly errors: not trusted for spots
            return
        prev = list(s.words)
        s.words.append(word)
        calls = []
        ctx = next((w for w in reversed(prev[-3:]) if w in CQ_WORDS), None)
        if is_call(word) and ctx:
            calls.append((word, ctx))
        if word == 'TEST' and prev and is_call(prev[-1]):
            calls.append((prev[-1], 'TEST'))
        for call, c in calls:
            times = [t for t in s.copies.get(call, []) if now - t < 600] + [now]
            s.copies[call] = times
            self._rtty_spot(s, call, c, len(times), now)

    def _rtty_spot(self, s: RttySignal, call: str, ctx: str, copies: int, now: float) -> None:
        known = call in self.known
        confirmed = known or copies >= 2
        if confirmed:
            s.call = call
        last = self.recent.get(call)
        if last and now - last[0] < 600 and abs(last[1] - s.mark_hz) < 1000 and (last[2] or not confirmed):
            return
        self.seq += 1
        reason = 'known call' if known else (f'copied {copies}x' if copies >= 2 else 'copied once')
        sp = Spot(self.seq, now, s.mark_hz, call, int(round(s.snr_db)), 45, 'CQ', confirmed,
                  f'{ctx} {call}; {reason}', mode='RTTY')
        self.spots.append(sp)
        self.recent[call] = (now, s.mark_hz, confirmed)
        if self.on_spot:
            self.on_spot(sp)

    def signal_list(self) -> list:
        return sorted(({'id': s.id, 'freq_khz': round(s.mark_hz / 1e3, 2), 'snr_db': round(s.snr_db, 1),
                        'wpm': None, 'baud': 45.45, 'shift_hz': round(s.mark_hz - s.space_hz),
                        'text': (s.text + (' ' + s.word if s.word else ''))[-80:], 'call': s.call,
                        'clean_pct': round(100 * s.framer.clean), 'mode': 'RTTY',
                        'age_s': round(self.now() - s.created)}
                       for s in self.signals.values()), key=lambda d: d['freq_khz'])
