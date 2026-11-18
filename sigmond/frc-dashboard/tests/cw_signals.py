"""Synthetic multi-signal CW IQ for the skimmer tests."""
import numpy as np

from frc_dashboard.cwskim import TO_MORSE


def keying(text: str, wpm: float, fs: float, lead: float = 0.5, tail: float = 0.5, rise_ms: float = 5.0,
           weight: float = 1.0) -> np.ndarray:
    """0..1 envelope for `text` (words split by spaces), raised-cosine edges."""
    u = 1.2 / wpm
    runs = [(False, lead)]
    for wi, w in enumerate(text.split()):
        if wi:
            runs.append((False, 7 * u))
        for ci, ch in enumerate(w):
            if ci:
                runs.append((False, 3 * u))
            for ei, el in enumerate(TO_MORSE[ch]):
                if ei:
                    runs.append((False, u))
                runs.append((True, (weight if el == '.' else 3 * weight) * u))
    runs.append((False, tail))
    env = np.concatenate([np.full(int(round(d * fs)), 1.0 if on else 0.0, np.float32) for on, d in runs])
    n = max(1, int(rise_ms * 1e-3 * fs))
    k = np.sin(np.linspace(0, np.pi, n)) ** 2
    return np.convolve(env, k / k.sum(), mode='same').astype(np.float32)


def cw_iq(signals, fs: float, seconds: float, snr_ref_db_noise: float = 0.0, seed: int = 1) -> np.ndarray:
    """Complex baseband with each signal = dict(offset_hz, text, wpm, snr_db, start_s[, weight]).
    snr_db is in 2500 Hz.  Unit noise PSD scaling: amplitude derived per signal."""
    n = int(seconds * fs)
    rng = np.random.default_rng(seed)
    sigma2 = 1.0                                  # total complex noise power per sample
    psd = sigma2 / fs                             # per Hz
    x = (rng.standard_normal(n) + 1j * rng.standard_normal(n)).astype(np.complex64) * np.sqrt(sigma2 / 2)
    t = np.arange(n) / fs
    for s in signals:
        amp = np.sqrt(psd * 2500 * 10 ** (s['snr_db'] / 10))
        env = keying(s['text'], s['wpm'], fs, lead=0.0, weight=s.get('weight', 1.0))
        i0 = int(s.get('start_s', 0.5) * fs)
        env = env[: max(0, n - i0)]
        ph = 2 * np.pi * s['offset_hz'] * t[i0:i0 + len(env)] + s.get('phase', 0.0)
        x[i0:i0 + len(env)] += (amp * env * np.exp(1j * ph)).astype(np.complex64)
    return x


# ── RTTY ──────────────────────────────────────────────────────────────────
def baudot_bits(text: str):
    """Baudot frames for text: lists of 5 data bits (LSB first), with LTRS/FIGS shifts."""
    from frc_dashboard.rttyskim import BAUDOT_FIGS, BAUDOT_LTRS, FIGS, LTRS
    ltrs = {c: i for i, c in enumerate(BAUDOT_LTRS) if c}
    figs = {c: i for i, c in enumerate(BAUDOT_FIGS) if c}
    codes, in_figs = [LTRS, LTRS], False
    for ch in text:
        if ch == ' ':
            codes.append(ltrs[' '])
            in_figs = False                      # receivers unshift on space
            continue
        if ch in ltrs and (not in_figs or ch not in figs):
            if in_figs:
                codes.append(LTRS)
                in_figs = False
            codes.append(ltrs[ch])
        else:
            if not in_figs:
                codes.append(FIGS)
                in_figs = True
            codes.append(figs[ch])
    codes.append(ltrs[' '])
    return [[(c >> k) & 1 for k in range(5)] for c in codes]


def rtty_iq(signals, fs: float, seconds: float, seed: int = 1, baud: float = 45.45, shift: float = 170.0):
    """Complex baseband with RTTY signals: dict(offset_hz=pair centre, text, snr_db, start_s).
    Mark (1) is the higher frequency, as on the air.  SNR in 2500 Hz."""
    n = int(seconds * fs)
    rng = np.random.default_rng(seed)
    x = (rng.standard_normal(n) + 1j * rng.standard_normal(n)).astype(np.complex64) * np.sqrt(0.5)
    psd = 1.0 / fs
    sym = fs / baud
    for s in signals:
        amp = np.sqrt(psd * 2500 * 10 ** (s['snr_db'] / 10))
        bits = [1] * int(sym * 0)                # placeholder
        seq = [(1, 0.3 * baud)]                  # 0.3 s of idle mark
        for frame in baudot_bits(s['text']):
            seq += [(0, 1)] + [(b, 1) for b in frame] + [(1, 1.5)]
        seq += [(1, 0.3 * baud)]
        tone = np.concatenate([np.full(int(round(d * sym)), (1 if b else -1) * shift / 2) for b, d in seq])
        i0 = int(s.get('start_s', 0.5) * fs)
        tone = tone[: max(0, n - i0)]
        ph = s.get('phase', 0.0) + 2 * np.pi * np.cumsum(s['offset_hz'] + tone) / fs
        x[i0:i0 + len(tone)] += (amp * np.exp(1j * ph)).astype(np.complex64)
    return x
