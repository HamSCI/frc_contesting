"""
CW skimmer engine: decode every CW signal in a slice of a band at once.

Pure numpy, no radiod: feed() it complex baseband IQ and it reports the
signals it is decoding, their text, and spots.  skimmer.py connects it to a
radiod IQ channel; tests/test_skimmer.py feeds it synthetic signals.

The design follows the advice VE3NEA (author of CW Skimmer) gave about his
decoder: "instead of making a hard decision at every input sample whether
the signal is present or not, compute the probability that the signal is
present ... combine that probability with other probabilities using the
Bayes formula and pass the new probabilities to the subsequent stages, all
the way to the word recognition unit."  So no stage below the word makes a
hard decision on its own:

  1. Channelizer.  An STFT turns the IQ into the power in each bin every
     4 ms: a 16 ms Hann window (about 94 Hz noise bandwidth, short enough
     for 40 WPM elements) zero-padded to 31.25 Hz bin spacing, so close
     signals still show as separate peaks.
  2. Noise floor and detection.  Per bin, a low percentile over time,
     median-filtered across frequency, is the noise; a bin whose 90th
     percentile stands well above it and is a local peak gets a decoder.
  3. Key down / key up.  Each signal's filter-bank output is derotated to
     the signal's own frequency and averaged coherently over about a third
     of a dit (a speed-matched filter; noise scaling exact from the window's
     overlap).  Then, per frame, the log likelihood ratio
     of "carrier on" (Rician envelope at the signal's level) against "noise
     only" (Rayleigh).  The level is re-estimated from the frames decided
     "on", and snaps to the block's 90th percentile when that is far from it:
     in a QSO two stations at very different strengths take turns on one
     frequency, and the weaker one's marks would otherwise look like noise.  A two-state Viterbi decoder with a switching
     penalty turns that into the most probable on/off sequence (decided
     0.3 s behind real time).  Vectorised across all signals.
     Until a signal's speed is known the averaging and the switching
     penalty are guesses, so once it is (after ~6 marks) the last 4 s are
     decoded again from the raw filter-bank output with the right settings.
  4. Elements and characters.  Each mark gets P(dit), P(dah) and each gap
     P(element gap), P(character gap), P(word gap) from log-normal duration
     models around the signal's own speed, with D. L. Mills' priors.  A beam
     search over the Morse tree keeps the competing readings alive.
  5. Words.  Readings are scored as whole words: common CW words, callsign
     shapes and callsigns known to the station (heard on WSPR/FT8, or a
     MASTER.SCP file) are more probable.  Only here is a reading chosen.
  6. Spots.  A callsign within three words after CQ / TEST / DE / TU (or
     just before TEST) on a frequency is a CQ spot.  It is "confirmed" (and goes to the RBN-format
     feed) when the call is known to the station or was copied twice there.
"""

from __future__ import annotations

import math
import re
import time
from collections import deque
from dataclasses import dataclass, field

import numpy as np

# ── Morse ─────────────────────────────────────────────────────────────────
MORSE = {
    '.-': 'A', '-...': 'B', '-.-.': 'C', '-..': 'D', '.': 'E', '..-.': 'F', '--.': 'G', '....': 'H',
    '..': 'I', '.---': 'J', '-.-': 'K', '.-..': 'L', '--': 'M', '-.': 'N', '---': 'O', '.--.': 'P',
    '--.-': 'Q', '.-.': 'R', '...': 'S', '-': 'T', '..-': 'U', '...-': 'V', '.--': 'W', '-..-': 'X',
    '-.--': 'Y', '--..': 'Z', '-----': '0', '.----': '1', '..---': '2', '...--': '3', '....-': '4',
    '.....': '5', '-....': '6', '--...': '7', '---..': '8', '----.': '9', '-..-.': '/', '..--..': '?',
    '-...-': '=', '--..--': ',', '.-.-.-': '.', '.-.-.': '+',
}
TO_MORSE = {v: k for k, v in MORSE.items()}
PREFIXES = {code[:i] for code in MORSE for i in range(len(code) + 1)}
PUNCT = set('/?=,.+')

# D. L. Mills' a-priori element statistics (as quoted by AG1LE): marks are
# dits ~57 %; gaps are element ~55 %, character ~37 %, word ~8 %.
LOG_PRIOR_MARK = {'.': math.log(0.57), '-': math.log(0.43)}
LOG_PRIOR_GAP = {'e': math.log(0.556), 'c': math.log(0.371), 'w': math.log(0.073)}
MARK_UNITS = {'.': 1.0, '-': 3.0}
GAP_UNITS = {'e': 1.0, 'c': 3.0, 'w': 7.0}
MARK_SIGMA, GAP_SIGMA = 0.28, 0.38            # log-normal spreads (hand keys, bugs)

CALL_RE = re.compile(r'^(?:[A-Z0-9]{1,4}/)?(?:[A-Z]{1,2}|[0-9][A-Z]{1,2}|[A-Z][0-9])[0-9][A-Z]{1,4}(?:/[A-Z0-9]{1,4})?$')
CQ_WORDS = {'CQ', 'TEST', 'DE', 'TU'}
COMMON_WORDS = {
    'CQ': 3.0, 'TEST': 3.0, 'DE': 2.5, 'TU': 2.5, '5NN': 3.0, '599': 2.5, 'K': 1.5, 'R': 1.0,
    'TNX': 1.5, 'UR': 1.5, 'RST': 1.5, 'NAME': 1.0, 'QTH': 1.5, '73': 1.5, 'GM': 1.0, 'GA': 1.0,
    'GE': 1.0, 'FB': 1.0, 'OP': 1.0, 'ES': 1.0, 'HR': 1.0, 'BK': 1.0, 'QRZ': 1.5, 'AGN': 1.0,
    'NR': 1.0, 'EE': 0.5, 'TEST?': 0.0, 'AR': 0.5, 'SK': 0.5, 'KN': 0.5, 'PSE': 1.0, 'RR': 0.5,
}


def is_call(word: str) -> bool:
    return 3 <= len(word) <= 12 and bool(CALL_RE.match(word))


def word_log_prior(word: str, known: set | frozenset = frozenset()) -> float:
    """Log-prior bonus of a whole word (the word-recognition stage)."""
    if word in COMMON_WORDS:
        return COMMON_WORDS[word]
    if is_call(word):
        return 3.5 if word in known else 1.5
    if len(word) == 1:
        return -1.0                 # stray E / T / I: usually a mis-split
    if word.isdigit():
        return 0.5                  # serial numbers, zones
    if any(c in PUNCT for c in word):
        return -1.0
    return 0.0


def _lognorm(d: float, mean: float, sigma: float) -> float:
    z = (math.log(d) - math.log(mean)) / sigma
    return -0.5 * z * z


# ── Element / character / word decoding for one signal ────────────────────
@dataclass
class _Hyp:
    logp: float
    code: str          # dits/dahs of the character in progress
    word: str          # text since the last settled word; words end in ' '

    @property
    def last(self) -> str:
        return self.word.rsplit(' ', 1)[-1]


class MorseDecoder:
    """Turns (key-down?, duration) runs into words, keeping alternatives open.

    Durations are in frames of ``frame_sec``.  ``on_word(word)`` is called
    for each word chosen.
    """

    BEAM = 24

    def __init__(self, frame_sec: float, on_word, known=frozenset()):
        self.frame_sec = frame_sec
        self.on_word = on_word
        self.known = known
        self.unit: float | None = None          # dit length, frames
        self.marks: deque = deque(maxlen=40)   # recent mark durations
        self.pending: list = []                # runs held until the speed is known
        self.beam = [_Hyp(0.0, '', '')]

    # -- speed -------------------------------------------------------------
    @property
    def wpm(self) -> float | None:
        return 1.2 / (self.unit * self.frame_sec) if self.unit else None

    def _estimate_unit(self) -> None:
        """Dit length from the recent marks: split them in two (Otsu on log
        duration); dahs are ~3 dits.  Needs both kinds present."""
        d = np.sort(np.log(np.asarray(self.marks, float)))
        if len(d) < 6:
            return
        best, split = -1.0, None
        for i in range(2, len(d) - 1):
            a, b = d[:i], d[i:]
            between = len(a) * len(b) * (a.mean() - b.mean()) ** 2
            if between > best:
                best, split = between, i
        short, long_ = np.exp(d[:split]), np.exp(d[split:])
        ratio = long_.mean() / short.mean()
        if 2.0 <= ratio <= 4.5:
            u = (short.sum() + long_.sum() / 3.0) / len(d)
        elif self.unit is None:
            return
        else:
            # one cluster: all dits or all dahs; take the nearer reading
            m = float(np.exp(d.mean()))
            u = m if abs(math.log(m / self.unit)) < abs(math.log(m / (3 * self.unit))) else m / 3
        self.unit = u if self.unit is None else 0.7 * self.unit + 0.3 * u

    # -- runs ----------------------------------------------------------------
    def run(self, mark: bool, frames: int) -> None:
        if frames <= 0:
            return
        if mark:
            # a carrier, a tune-up or a stuck key: ends whatever was in progress
            if self.unit and frames > 6 * self.unit:
                self.flush()
                return
            self.marks.append(frames)
            self._estimate_unit()
        if self.unit is None:
            if mark or self.pending:
                self.pending.append((mark, frames))
            if len(self.pending) > 80:
                self.pending = self.pending[-40:]
            return
        if self.pending:
            held, self.pending = self.pending, []
            for m, f in held:
                self._step(m, f)
        self._step(mark, frames)

    def _step(self, mark: bool, frames: int) -> None:
        u = self.unit
        if mark:
            if frames < 0.3 * u:                       # a click, not an element
                return
            lp = {k: LOG_PRIOR_MARK[k] + _lognorm(frames, MARK_UNITS[k] * u, MARK_SIGMA) for k in '.-'}
            z = max(lp.values())
            norm = z + math.log(sum(math.exp(v - z) for v in lp.values()))
            new = []
            for h in self.beam:
                for k, v in lp.items():
                    code = h.code + k
                    if code in PREFIXES:
                        new.append(_Hyp(h.logp + v - norm, code, h.word))
            self._keep(new)
            return
        if frames > 10 * u:                            # long silence: end of the over
            self.flush()
            return
        lp = {k: LOG_PRIOR_GAP[k] + _lognorm(frames, GAP_UNITS[k] * u, GAP_SIGMA) for k in 'ecw'}
        z = max(lp.values())
        norm = z + math.log(sum(math.exp(v - z) for v in lp.values()))
        post = {k: v - norm for k, v in lp.items()}
        new, ended = [], []
        for h in self.beam:
            if h.code:
                new.append(_Hyp(h.logp + post['e'], h.code, h.word))
                ch = MORSE.get(h.code)
                if ch:
                    cp = -1.0 if ch in PUNCT else 0.0
                    new.append(_Hyp(h.logp + post['c'] + cp, '', h.word + ch))
                    word = h.last + ch
                    ended.append(_Hyp(h.logp + post['w'] + cp + word_log_prior(word, self.known),
                                      '', h.word + ch + ' '))
            else:
                new.append(h)
        # A word gap is the likeliest reading of this gap: settle on the best
        # complete reading now (it may hold several words if an earlier gap
        # was ambiguous).
        if ended and post['w'] >= max(post['e'], post['c']):
            self._emit(max(ended, key=lambda h: h.logp).word)
            self.beam = [_Hyp(0.0, '', '')]
            return
        self._keep(new + ended)

    def _emit(self, text: str) -> None:
        for w in text.split():
            self.on_word(w)

    def _keep(self, hyps: list) -> None:
        if not hyps:
            self.beam = [_Hyp(0.0, '', '')]
            return
        hyps.sort(key=lambda h: h.logp, reverse=True)
        seen, out = set(), []
        for h in hyps:
            key = (h.code, h.word)
            if key not in seen:
                seen.add(key)
                out.append(h)
            if len(out) >= self.BEAM:
                break
        top = out[0].logp
        self.beam = [_Hyp(h.logp - top, h.code, h.word) for h in out]

    def flush(self) -> None:
        """End of transmission: settle the best complete reading."""
        best, best_lp = None, -1e9
        for h in self.beam:
            if h.code and h.code not in MORSE:
                continue
            text = h.word + (MORSE[h.code] if h.code else '')
            if text.strip():
                last = text.rstrip().rsplit(' ', 1)[-1]
                lp = h.logp + (word_log_prior(last, self.known) if not text.endswith(' ') else 0.0)
                if lp > best_lp:
                    best, best_lp = text, lp
        if best:
            self._emit(best)
        self.beam = [_Hyp(0.0, '', '')]


# ── One tracked signal ────────────────────────────────────────────────────
@dataclass
class Signal:
    id: int
    k: int                       # bin index within the selected bins
    freq_hz: float
    created: float
    last_active: float
    level: float = 4.0           # mark power / noise, in this signal's averaged units
    m: int = 1                   # frames averaged coherently (speed-matched)
    cm: float = 1.0              # noise power of that average, per unit frame noise
    zhist: np.ndarray = None     # last m-1 derotated frames (for the running average)
    held: np.ndarray = None      # LLRs not yet committed by the Viterbi
    held_x: np.ndarray = None    # ...and the power over noise of those frames
    s_on: float = -2.0
    s_off: float = 0.0
    cur_mark: bool = False
    cur_len: int = 0
    decoder: MorseDecoder = None
    text: str = ''
    words: deque = field(default_factory=lambda: deque(maxlen=12))
    copies: dict = field(default_factory=dict)  # call -> [times copied in CQ context]
    call: str | None = None      # last confirmed / likely call on this signal
    flushed: bool = True
    zlog: deque = field(default_factory=lambda: deque(maxlen=8))   # (base, raw bin output) per block
    replayed: bool = False       # decoded again once its speed was known

    @property
    def snr_db(self) -> float:
        """Mark power over the noise in one analysis bin (about 94 Hz)."""
        return 10 * math.log10(max((self.level - 1.0) * self.cm, 0.05))


# ── Spots and RBN format ──────────────────────────────────────────────────
@dataclass
class Spot:
    seq: int
    t: float
    freq_hz: float
    call: str
    snr_db: int
    wpm: int
    kind: str                    # 'CQ'
    confirmed: bool
    reason: str

    def public(self, spotter: str) -> dict:
        return {'seq': self.seq, 't': round(self.t, 1), 'freq_khz': round(self.freq_hz / 1e3, 1),
                'call': self.call, 'snr_db': self.snr_db, 'wpm': self.wpm, 'type': self.kind,
                'confirmed': self.confirmed, 'reason': self.reason,
                'rbn': rbn_line(spotter, self.freq_hz / 1e3, self.call, self.snr_db, self.wpm, self.kind, self.t)}


def rbn_line(spotter: str, freq_khz: float, call: str, snr_db: int, wpm: int, kind: str, t: float) -> str:
    """One spot in the DX-cluster layout that CW Skimmer's telnet server and
    the Reverse Beacon Network use, e.g.

        DX de W3USR-#:   14025.0  K1ABC        CW    23 dB  25 WPM  CQ      1928Z

    The frequency ends in column 24 and the call starts in column 26 when the
    spotter's call is short; long calls shift the fields, so consumers split
    on whitespace."""
    hhmm = time.strftime('%H%M', time.gmtime(t))
    head = f'DX de {spotter}-#:'
    return f'{head:<15}{freq_khz:>9.1f}  {call:<13}CW {snr_db:>5d} dB {wpm:>3d} WPM  {kind:<7} {hhmm}Z'


# ── The engine ────────────────────────────────────────────────────────────
class SkimmerEngine:
    """Feed complex IQ; read signals, spectrum and spots.

    ``center_hz`` is the RF frequency of the IQ's DC; ``lo_hz``/``hi_hz``
    the slice to skim; ``masks`` RF ranges to ignore (FT8/FT4 sub-bands).
    """

    BIN_HZ = 31.25              # FFT bin spacing
    WINDOW_SEC = 0.016          # analysis window (time resolution)
    HOP_SEC = 0.004
    BLOCK_FRAMES = 125          # 0.5 s of frames per processing block
    HOLD = 75                   # Viterbi decision lag, frames (0.3 s)

    def __init__(self, sample_rate: float, center_hz: float, lo_hz: float, hi_hz: float,
                 masks=(), detect_db: float = 8.0, max_signals: int = 60,
                 known_calls=frozenset(), on_spot=None):
        self.fs = float(sample_rate)
        self.N = int(round(self.fs / self.BIN_HZ))
        self.W = int(round(self.fs * self.WINDOW_SEC))
        self.hop = int(round(self.fs * self.HOP_SEC))
        self.frame_sec = self.hop / self.fs
        self.center_hz, self.lo_hz, self.hi_hz = float(center_hz), float(lo_hz), float(hi_hz)
        self.window = np.hanning(self.W).astype(np.float32)
        # Overlap correlation of the window at multiples of the hop: the noise
        # power of an average of m consecutive frames is cm(m) x one frame's.
        w = self.window.astype(np.float64)
        self._scales: dict = {}
        self.rho = np.array([float(np.dot(w[: self.W - l * self.hop], w[l * self.hop:])) / float(np.dot(w, w))
                             if l * self.hop < self.W else 0.0 for l in range(16)])
        f = self.center_hz + (np.arange(self.N) - self.N // 2) * (self.fs / self.N)
        keep = (f >= lo_hz) & (f <= hi_hz) & (np.abs(f - self.center_hz) < 0.47 * self.fs)
        self.masked = np.zeros(self.N, bool)
        for a, b in masks:
            self.masked |= (f >= a) & (f <= b)
        self.sel = np.flatnonzero(keep)                 # bins we look at (shifted order)
        self.freqs = f[self.sel]
        self.detectable = ~self.masked[self.sel]
        self.detect = 10 ** (detect_db / 10)
        self.max_signals = max_signals
        self.known = known_calls
        self.on_spot = on_spot
        self.buf = np.zeros(0, np.complex64)
        self.noise = None                               # per selected bin
        self.signals: dict[int, Signal] = {}
        self.next_id = 1
        self.spots: deque = deque(maxlen=500)
        self.seq = 0
        self.recent: dict = {}                          # call -> (t, freq) of last spot
        self.spectrum_db = np.zeros(0)
        self.frames = 0
        self.cpu_s = 0.0
        self.now = time.time

    # -- input -------------------------------------------------------------
    def feed(self, iq: np.ndarray) -> None:
        self.buf = np.concatenate([self.buf, np.asarray(iq, np.complex64)])
        need = (self.BLOCK_FRAMES - 1) * self.hop + self.W
        while len(self.buf) >= need:
            t0 = time.process_time()
            frames = np.lib.stride_tricks.sliding_window_view(self.buf[:need], self.W)[::self.hop]
            spec = np.fft.fftshift(np.fft.fft(frames * self.window, n=self.N, axis=1), axes=1)[:, self.sel]
            power = (spec.real ** 2 + spec.imag ** 2).astype(np.float32)
            self.buf = self.buf[self.BLOCK_FRAMES * self.hop:]
            self._block(power, spec)
            self.cpu_s += time.process_time() - t0

    # -- one 0.5 s block ---------------------------------------------------
    def cm(self, m: int) -> float:
        i = np.arange(m)
        return float(self.rho[np.abs(i[:, None] - i[None, :])].sum()) / (m * m)

    def llr_scale(self, m: int) -> float:
        """Independent samples per frame: frames overlap, so their noise is
        correlated.  For the average of m frames, the correlation at lag l is
        rho~(l); the power correlation is rho~(l)^2, and 1 / (1 + 2 sum
        rho~(l)^2) of each frame's evidence is new."""
        if m not in self._scales:
            i = np.arange(m)
            r = lambda l: float(self.rho[np.minimum(np.abs(l + i[:, None] - i[None, :]), 15)].sum()) / (m * m)
            r0 = r(0)
            tot = sum((r(l) / r0) ** 2 for l in range(1, 15))
            self._scales[m] = 1.0 / (1.0 + 2.0 * tot)
        return self._scales[m]

    def _block(self, power: np.ndarray, spec: np.ndarray) -> None:
        now = self.now()
        base = self.frames                              # absolute index of this block's first frame
        self.frames += len(power)
        self._update_noise(power)
        x = power / self.noise                          # power over noise, per bin
        q90 = np.percentile(x, 90, axis=0)
        self.spectrum_db = 10 * np.log10(np.maximum(x.mean(axis=0), 1e-3))
        self._detect(q90, now)
        if self.signals:
            self._decode(x, spec, base, q90, now)

    def _update_noise(self, power: np.ndarray) -> None:
        # 20th percentile of exponential power = 0.223 x mean; then a running
        # median across ~1 kHz so signals don't lift their own floor.
        q20 = np.percentile(power, 20, axis=0) / 0.223
        w = 31
        pad = np.pad(q20, w // 2, mode='edge')
        med = np.median(np.lib.stride_tricks.sliding_window_view(pad, w), axis=1)
        med = np.maximum(med, 1e-20)
        self.noise = med if self.noise is None else 0.8 * self.noise + 0.2 * med

    def _detect(self, q90: np.ndarray, now: float) -> None:
        n = len(q90)
        peak = q90.copy()
        peak[~self.detectable] = 0
        cand = []
        for k in np.flatnonzero(peak > self.detect):
            lo, hi = max(0, k - 2), min(n, k + 3)
            if peak[k] >= peak[lo:hi].max():
                cand.append(int(k))
        by_k = {s.k: s for s in self.signals.values()}
        for k in sorted(cand, key=lambda k: -peak[k]):
            near = [s for kk, s in by_k.items() if abs(kk - k) <= 2]
            if near:
                s = near[0]
                s.last_active = now
                if s.k != k and peak[k] > 1.5 * peak[s.k]:   # follow a drifting signal
                    by_k.pop(s.k, None)
                    s.k = k
                    by_k[k] = s
                s.freq_hz = self._freq(q90, s.k)
            elif any(abs(kk - k) <= 5 and q90[kk] > 16 * q90[k] for kk in by_k):
                continue                                 # key clicks / sidebands of a much stronger signal
            elif len(self.signals) < self.max_signals:
                # A new signal starts firmly key-up: its lead-in has no data
                # (held LLRs mildly negative), so it can't become one long mark.
                s = Signal(self.next_id, k, self._freq(q90, k), now, now, level=float(peak[k]),
                           held=np.full(self.HOLD, -1.0, np.float32), s_on=-10.0,
                           held_x=np.zeros(self.HOLD, np.float32))
                s.decoder = MorseDecoder(self.frame_sec, self._word_cb(s), self.known)
                self.signals[s.id] = s
                by_k[k] = s
                self.next_id += 1
        # Gone quiet for 20 s, decoded plenty and still below 4 dB, or 15 s
        # without a plausible speed: noise (or not CW); free the slot.
        def weak(s):
            if len(s.decoder.marks) >= 40 and s.snr_db < 4:
                return True
            wpm = s.decoder.wpm
            return now - s.created > 15 and not (wpm and 8 <= wpm <= 60)
        for sid in [sid for sid, s in self.signals.items() if now - s.last_active > 20 or weak(s)]:
            self.signals[sid].decoder.flush()
            del self.signals[sid]

    def _freq(self, q90: np.ndarray, k: int) -> float:
        if 0 < k < len(q90) - 1:
            a, b, c = (10 * np.log10(max(v, 1e-6)) for v in q90[k - 1:k + 2])
            den = a - 2 * b + c
            d = 0.5 * (a - c) / den if den < 0 else 0.0
            return float(self.freqs[k] + max(-0.5, min(0.5, d)) * self.BIN_HZ)
        return float(self.freqs[k])

    def _smoothed(self, s: Signal, z: np.ndarray, base: int) -> np.ndarray:
        """Power over noise of signal s after derotation to its frequency and
        a coherent running average of s.m frames."""
        u = s.decoder.unit
        m = int(min(6, max(1, round(u / 3)))) if u else 2
        if m != s.m:                                     # keep the level in the new units
            cm = self.cm(m)
            s.level = 1.0 + (s.level - 1.0) * s.cm / cm
            s.m, s.cm, s.zhist = m, cm, None
        f = s.freq_hz - self.center_hz
        n = base + np.arange(len(z))
        zr = z * np.exp(-2j * np.pi * ((f * self.hop / self.fs) * n % 1.0))
        if s.m > 1:
            hist = s.zhist if s.zhist is not None else np.zeros(s.m - 1, np.complex128)
            cat = np.concatenate([hist, zr])
            c = np.cumsum(np.concatenate([[0], cat]))
            avg = (c[s.m:] - c[:-s.m]) / s.m
            s.zhist = cat[-(s.m - 1):]
        else:
            avg = zr
        return (avg.real ** 2 + avg.imag ** 2) / (self.noise[s.k] * s.cm)

    def _decode(self, x: np.ndarray, spec: np.ndarray, base: int, q90: np.ndarray, now: float) -> None:
        sigs = list(self.signals.values())
        for s in sigs:                                   # seed a new signal's mark level
            if s.cur_len == 0 and q90[s.k] > self.detect:
                s.level = 1.0 + (float(q90[s.k]) - 1.0) / s.cm
        for s in sigs:
            s.zlog.append((base, spec[:, s.k].copy()))
        xs = np.stack([self._smoothed(s, spec[:, s.k], base) for s in sigs], axis=1).astype(np.float32)
        # A different station (or a deep fade) on the frequency: when this
        # block's 90th percentile is clearly a signal but far from the tracked
        # level, start from it instead of waiting for the decisions to adapt.
        qb = np.percentile(xs, 90, axis=0)
        for i, s in enumerate(sigs):
            if qb[i] > 4 and (qb[i] < 0.35 * s.level or qb[i] > 2.5 * s.level):
                s.level = float(qb[i])
        S = np.array([max(s.level - 1.0, 0.5) for s in sigs], np.float32)
        # Adjacent frames share most of their samples (more so when averaged).
        scale = np.array([self.llr_scale(s.m) for s in sigs], np.float32)
        llr = scale * rician_llr(xs, S)
        L = np.concatenate([np.stack([s.held for s in sigs], axis=1), llr.astype(np.float32)])
        X = np.concatenate([np.stack([s.held_x for s in sigs], axis=1), xs])
        # switching penalty from each signal's speed: ~2 dits per run
        T = np.array([math.log(1.0 / max(4.0, 2.0 * (s.decoder.unit or 0.06 / self.frame_sec)))
                      for s in sigs], np.float32)
        s_on = np.array([s.s_on for s in sigs], np.float32)
        s_off = np.array([s.s_off for s in sigs], np.float32)
        states, b_on, b_off = viterbi_onoff(L, T, s_on, s_off, self.HOLD)
        keep = len(states)
        for i, s in enumerate(sigs):
            s.held = L[-self.HOLD:, i].copy()
            s.held_x = X[-self.HOLD:, i].copy()
            s.s_on, s.s_off = float(b_on[i]), float(b_off[i])
            # EM-style level update: the mean power of the frames just decided
            # key-down (skipping each mark's edges, which the window smears).
            on = states[:, i]
            core = on & np.roll(on, 1) & np.roll(on, -1)
            core[0] = core[-1] = False
            if core.sum() >= 4:
                s.level = 0.7 * s.level + 0.3 * float(X[:keep, i][core].mean())
            self._runs(s, on)
            if s.decoder.unit and not s.replayed:
                self._replay(s)

    def _replay(self, s: Signal) -> None:
        """Decode the signal's recent history again now that its speed is
        known (words were held back until now)."""
        s.replayed = True
        old = s.decoder
        s.decoder = MorseDecoder(self.frame_sec, self._word_cb(s), self.known)
        s.decoder.unit, s.decoder.marks = old.unit, deque(old.marks, maxlen=old.marks.maxlen)
        s.zhist, s.cur_mark, s.cur_len, s.flushed = None, False, 0, True
        base0 = s.zlog[0][0]
        z = np.concatenate([zz for _, zz in s.zlog])
        xs = self._smoothed(s, z, base0).astype(np.float32)
        S = np.float32(max(s.level - 1.0, 0.5))
        llr = self.llr_scale(s.m) * rician_llr(xs, np.full(len(xs), S, np.float32))
        L = np.concatenate([np.full(self.HOLD, -1.0, np.float32), llr])[:, None]
        X = np.concatenate([np.zeros(self.HOLD, np.float32), xs])[:, None]
        T = np.array([math.log(1.0 / max(4.0, 2.0 * s.decoder.unit))], np.float32)
        states, b_on, b_off = viterbi_onoff(L, T, np.array([-10.0], np.float32), np.array([0.0], np.float32), self.HOLD)
        s.held, s.held_x = L[-self.HOLD:, 0].copy(), X[-self.HOLD:, 0].copy()
        s.s_on, s.s_off = float(b_on[0]), float(b_off[0])
        self._runs(s, states[:, 0])

    def _runs(self, s: Signal, st: np.ndarray) -> None:
        cuts = np.flatnonzero(st[1:] != st[:-1]) + 1
        bounds = [0, *cuts.tolist(), len(st)]
        for a, b in zip(bounds[:-1], bounds[1:]):
            mark = bool(st[a])
            if mark == s.cur_mark:
                s.cur_len += b - a
            else:
                if s.cur_len:
                    s.decoder.run(s.cur_mark, s.cur_len)
                    s.flushed = False
                s.cur_mark, s.cur_len = mark, b - a
        # A long silence in progress ends the over without waiting for a mark.
        u = s.decoder.unit or 0.06 / self.frame_sec
        if not s.cur_mark and not s.flushed and s.cur_len > 10 * u:
            s.decoder.flush()
            s.flushed = True

    # -- words and spots ---------------------------------------------------
    def _word_cb(self, s: Signal):
        def on_word(word: str):
            if not s.replayed:                           # held back until the speed is known
                return
            now = self.now()
            wpm = s.decoder.wpm
            if not wpm or not 8 <= wpm <= 60:           # implausible speed: noise, RTTY, carriers
                return
            s.text = (s.text + ' ' + word).strip()[-240:]
            prev = list(s.words)
            s.words.append(word)
            calls = []
            ctx = next((w for w in reversed(prev[-3:]) if w in CQ_WORDS), None)
            if is_call(word) and ctx:
                calls.append((word, ctx))
            if word == 'TEST' and prev and is_call(prev[-1]):
                calls.append((prev[-1], 'TEST'))
            for call, ctx in calls:
                times = [t for t in s.copies.get(call, []) if now - t < 600] + [now]
                s.copies[call] = times
                self._spot(s, call, ctx, len(times), now)
        return on_word

    def _spot(self, s: Signal, call: str, ctx: str, copies: int, now: float) -> None:
        known = call in self.known
        confirmed = known or copies >= 2
        if confirmed:
            s.call = call
        last = self.recent.get(call)
        if last and now - last[0] < 600 and abs(last[1] - s.freq_hz) < 1000 and (last[2] or not confirmed):
            return                                       # already spotted here recently
        self.seq += 1
        reason = 'known call' if known else (f'copied {copies}x' if copies >= 2 else 'copied once')
        sp = Spot(self.seq, now, s.freq_hz, call, int(round(s.snr_db)), int(round(s.decoder.wpm or 0)),
                  'CQ', confirmed, f'{ctx} {call}; {reason}')
        self.spots.append(sp)
        self.recent[call] = (now, s.freq_hz, confirmed)
        if self.on_spot:
            self.on_spot(sp)

    # -- reading -------------------------------------------------------------
    def signal_list(self) -> list:
        return sorted(({'id': s.id, 'freq_khz': round(s.freq_hz / 1e3, 2), 'snr_db': round(s.snr_db, 1),
                        'wpm': round(s.decoder.wpm) if s.decoder.wpm else None, 'text': s.text[-80:],
                        'call': s.call, 'age_s': round(self.now() - s.created)}
                       for s in self.signals.values()), key=lambda d: d['freq_khz'])

    def spectrum(self, points: int = 800) -> list:
        db = self.spectrum_db
        if not len(db):
            return []
        n = int(math.ceil(len(db) / points))
        m = len(db) // n * n
        return np.round(db[:m].reshape(-1, n).max(axis=1), 1).tolist()


def _log_i0(z: np.ndarray) -> np.ndarray:
    """log of the modified Bessel function I0, without overflow."""
    z = np.asarray(z, np.float64)
    small = z < 15
    out = np.empty_like(z)
    out[small] = np.log(np.i0(z[small]))
    zb = z[~small]
    out[~small] = zb - 0.5 * np.log(2 * np.pi * zb) + np.log1p(1 / (8 * zb))
    return out


def rician_llr(x: np.ndarray, S: np.ndarray) -> np.ndarray:
    """log p(x | carrier at power S over unit noise) / p(x | noise only).

    x is power over the noise floor.  The envelope r = sqrt(x) is Rician
    with a carrier, Rayleigh without: the ratio is exp(-S) I0(2 r sqrt(S)).
    A steady carrier has nearly constant power, so this is far sharper than
    an exponential model and short key-up gaps survive."""
    return (-S + _log_i0(2 * np.sqrt(np.maximum(x, 0) * S))).astype(np.float32)


def viterbi_onoff(L: np.ndarray, T: np.ndarray, s_on: np.ndarray, s_off: np.ndarray, hold: int):
    """Most probable key-down/key-up path for every signal at once.

    L: (frames, signals) log p(x|on)/p(x|off).  T: per-signal log switch
    probability.  The first ``frames - hold`` decisions are returned; the
    scores at that point seed the next call (fixed-lag Viterbi)."""
    F, C = L.shape
    keep = F - hold
    bp_on = np.empty((F, C), bool)
    bp_off = np.empty((F, C), bool)
    b_on, b_off = s_on.copy(), s_off.copy()
    for t in range(F):
        sw_on, sw_off = s_off + T, s_on + T
        bp_on[t] = sw_on > s_on
        bp_off[t] = sw_off > s_off
        n_on = np.maximum(s_on, sw_on) + 0.5 * L[t]
        n_off = np.maximum(s_off, sw_off) - 0.5 * L[t]
        m = np.maximum(n_on, n_off)
        s_on, s_off = n_on - m, n_off - m
        if t == keep - 1:
            b_on, b_off = s_on.copy(), s_off.copy()
    st = np.empty((F, C), bool)
    cur = s_on > s_off
    for t in range(F - 1, -1, -1):
        st[t] = cur
        cur = np.where(cur, ~bp_on[t], bp_off[t])
    return st[:keep], b_on, b_off
