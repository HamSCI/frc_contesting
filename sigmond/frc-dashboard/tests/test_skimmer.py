"""CW skimmer tests: the engine on synthetic multi-signal IQ, the Morse
decoder, the RBN spot format and the telnet feed (no radiod needed)."""

import calendar
import socket
import sys
import time
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).parent))
from cw_signals import cw_iq, keying, rtty_iq  # noqa: E402

from frc_dashboard import cwskim  # noqa: E402
from frc_dashboard.cwskim import MorseDecoder, SkimmerEngine, is_call, rbn_line  # noqa: E402
from frc_dashboard.rttyskim import RttySkimmerEngine  # noqa: E402
from frc_dashboard.skimmer import BAND_PLAN, SpotFeed, band_setup, spotter_call  # noqa: E402

FS = 96_000.0
CENTER = 14_045_000


def run_engine(signals, seconds, known=frozenset(), seed=3):
    spots = []
    eng = SkimmerEngine(FS, CENTER, 14_000_000, 14_090_000, masks=[(14_073_900, 14_077_200)],
                        known_calls=set(known), on_spot=spots.append)
    x = cw_iq(signals, FS, seconds, seed=seed)
    for i in range(0, len(x), 9600):
        eng.feed(x[i:i + 9600])
    eng.feed(np.zeros(int(FS * 2), np.complex64))       # let the last words settle
    return eng, spots


# ── words and format ──────────────────────────────────────────────────────
def test_is_call():
    for c in ('W3USR', 'K1ABC', 'VE3NEA', '2E0HDV', 'OH6BG', 'JA1ABC', '4X1AB', '9A1A', 'W1AW/4', 'PJ4/K1ABC'):
        assert is_call(c), c
    for w in ('CQ', 'TEST', '5NN', 'TU', '599', 'K1', 'R5', 'EEE', 'W3', 'W1AW/5W1AW/5', 'K1ABCK1ABC'):
        assert not is_call(w), w


def test_rbn_line_layout():
    t = calendar.timegm((2026, 11, 16, 19, 28, 0))
    line = rbn_line('W3USR', 14025.04, 'K1ABC', 23, 25, 'CQ', t)
    assert line == 'DX de W3USR-#:   14025.0  K1ABC        CW    23 dB  25 WPM  CQ      1928Z'
    assert line.index('14025.0') + len('14025.0') == 24       # frequency ends in column 24
    assert line.index('K1ABC') == 26                          # call starts in column 26
    assert line.split() == ['DX', 'de', 'W3USR-#:', '14025.0', 'K1ABC', 'CW', '23', 'dB', '25', 'WPM', 'CQ', '1928Z']


def test_spotter_call_and_band_setup():
    assert spotter_call('W3USR/06') == 'W3USR'
    assert spotter_call('VP2E/K1ABC') == 'K1ABC'
    assert spotter_call('') == 'NOCALL'
    su = band_setup('20m')
    assert su['cw'] == (14_000_000, 14_070_000) and su['rtty'] == (14_080_000, 14_150_000)
    assert (su['lo_hz'], su['hi_hz']) == (14_000_000, 14_150_000)
    assert any(a <= 14_075_000 <= b for a, b in su['masks'])          # FT8 sits between CW and RTTY
    assert any(a <= 14_081_000 <= b for a, b in su['masks'])          # FT4 inside the RTTY segment
    su = band_setup('40m')
    assert any(a <= 7_048_000 <= b for a, b in su['masks'])           # FT4 7.0475 sits inside 40 m CW
    assert band_setup('160m')['rtty'] is None
    for b in BAND_PLAN:                                              # the IQ channel covers both ranges
        su = band_setup(b)
        assert su['hi_hz'] - su['lo_hz'] <= 0.94 * su['rate']
        assert su['rate'] % 1500 == 0 or b in ('80m', '40m')         # (128 kHz: RTTY baseband 1505.9 Hz)


def test_morse_decoder_clean_runs():
    words = []
    dec = MorseDecoder(0.004, words.append)
    u = 12                                                  # 25 WPM at 4 ms frames
    for wi, w in enumerate('CQ TEST W3ABC W3ABC K'.split()):
        if wi:
            dec.run(False, 7 * u)
        for ci, ch in enumerate(w):
            if ci:
                dec.run(False, 3 * u)
            for ei, el in enumerate(cwskim.TO_MORSE[ch]):
                if ei:
                    dec.run(False, u)
                dec.run(True, u if el == '.' else 3 * u)
    dec.run(False, 30 * u)
    assert ' '.join(words) == 'CQ TEST W3ABC W3ABC K'
    assert abs(dec.wpm - 25) < 1.5


# ── the engine on synthetic IQ ────────────────────────────────────────────
SIGNALS = [
    dict(offset_hz=-30000, text='CQ TEST W3ABC W3ABC CQ TEST W3ABC', wpm=28, snr_db=0),
    dict(offset_hz=-12345, text='CQ CQ DE K1XYZ K1XYZ K', wpm=18, snr_db=-5),
    # 120 Hz away from the one above, faster, starting later
    dict(offset_hz=-12345 + 120, text='TU VE3NEA TEST VE3NEA TEST', wpm=32, snr_db=-3, start_s=2.0),
    dict(offset_hz=25000, text='5NN 14 TU N9XX TEST', wpm=35, snr_db=3, start_s=1.0),
    # inside the masked FT8 sub-band: must be ignored
    dict(offset_hz=29500, text='EEEEEEEEEEEEEEEEEEEE', wpm=25, snr_db=10),
]


@pytest.fixture(scope='module')
def skimmed():
    return run_engine(SIGNALS, 26.0, known={'W3ABC'})


def by_freq(eng, khz, tol=0.06):
    return [s for s in eng.signal_list() if abs(s['freq_khz'] - khz) <= tol]


def test_engine_decodes_close_signals(skimmed):
    eng, _ = skimmed
    a = by_freq(eng, 14032.655)
    b = by_freq(eng, 14032.775)
    assert a and b, eng.signal_list()
    assert 'K1XYZ K1XYZ' in a[0]['text']
    assert 'VE3NEA TEST VE3NEA TEST' in b[0]['text']
    assert abs(a[0]['wpm'] - 18) <= 3 and abs(b[0]['wpm'] - 32) <= 4


def test_engine_speed_and_text(skimmed):
    eng, _ = skimmed
    n9 = by_freq(eng, 14070.0)
    assert n9 and 'TU N9XX TEST' in n9[0]['text']
    w3 = by_freq(eng, 14015.0)
    assert w3 and 'W3ABC W3ABC' in w3[0]['text']
    assert abs(w3[0]['wpm'] - 28) <= 3


def test_engine_ignores_masked_subband(skimmed):
    eng, _ = skimmed
    assert not by_freq(eng, 14074.5, tol=0.5)


def test_spots_confirmation_and_format(skimmed):
    _, spots = skimmed
    got = {(s.call, s.confirmed) for s in spots}
    assert ('W3ABC', True) in got                          # known to the station: confirmed at once
    assert ('VE3NEA', True) in got and ('N9XX', True) in got   # copied twice after TEST / TU
    k1 = [s for s in spots if s.call == 'K1XYZ']
    assert k1 and not k1[0].confirmed                      # copied once, unknown: shown but not fed
    for s in spots:
        assert s.kind == 'CQ'
        line = s.public('W3USR')['rbn']
        assert line.startswith('DX de W3USR-#:') and f' {s.call} ' in line
    w3 = next(s for s in spots if s.call == 'W3ABC')
    assert abs(w3.freq_hz - 14_015_000) < 40


def test_spots_not_repeated_within_ten_minutes(skimmed):
    _, spots = skimmed
    confirmed = [s.call for s in spots if s.confirmed]
    assert len(confirmed) == len(set(confirmed))


def test_noise_only_makes_no_spots():
    eng, spots = run_engine([], 12.0, seed=11)
    assert not spots
    assert sum(len(s['text']) for s in eng.signal_list()) < 20


def test_qso_weaker_station_on_the_same_frequency():
    """Two stations take turns on one frequency, 12 dB apart."""
    plan = [('CQ TEST W3ABC W3ABC', 26, 8), ('K1XYZ K1XYZ', 24, -4), ('TU W3ABC TEST', 26, 8)]
    sigs, t = [], 0.5
    for text, wpm, snr in plan:
        sigs.append(dict(offset_hz=-20000, text=text, wpm=wpm, snr_db=snr, start_s=t))
        t += len(keying(text, wpm, FS, lead=0.0, tail=0.0)) / FS + 0.8
    eng, _ = run_engine(sigs, t + 1.0, seed=5)
    text = ' '.join(s['text'] for s in eng.signal_list())
    assert 'K1XYZ K1XYZ' in text, text


# ── telnet feed ───────────────────────────────────────────────────────────
def test_spot_feed_telnet():
    with socket.socket() as probe:
        probe.bind(('127.0.0.1', 0))
        port = probe.getsockname()[1]
    feed = SpotFeed(port, '127.0.0.1', 'W3USR')
    try:
        with socket.create_connection(('127.0.0.1', port), timeout=5) as c:
            assert b'callsign' in c.recv(256)
            c.sendall(b'N0CALL\r\n')
            assert b'W3USR' in c.recv(256)
            for _ in range(50):
                if feed.clients:
                    break
                time.sleep(0.05)
            line = rbn_line('W3USR', 14025.0, 'K1ABC', 20, 25, 'CQ', time.time())
            feed.send(line)
            got = b''
            while not got.endswith(b'\r\n'):
                got += c.recv(256)
            assert got.decode().strip() == line
    finally:
        feed.close()


# ── RTTY ──────────────────────────────────────────────────────────────────
def test_rbn_line_rtty():
    t = calendar.timegm((2026, 11, 16, 19, 28, 0))
    line = rbn_line('W3USR', 14085.44, 'K1ABC', 21, 45, 'CQ', t, 'RTTY')
    assert line == 'DX de W3USR-#:   14085.4  K1ABC        RTTY  21 dB  45 BPS  CQ      1928Z'


RTTY_SIGNALS = [
    dict(offset_hz=-30000, text='CQ TEST W3ABC W3ABC CQ TEST W3ABC', snr_db=0),
    dict(offset_hz=-12000, text='CQ CQ DE K1XYZ K1XYZ K1XYZ PSE K', snr_db=-3, start_s=1.0),
    dict(offset_hz=-11500, text='TU VE3NEA TEST VE3NEA TEST', snr_db=-3, start_s=2.0),
    dict(offset_hz=20000, text='599 PA PA TU N9XX TEST N9XX TEST', snr_db=5, start_s=0.7),
]


@pytest.fixture(scope='module')
def rtty_skimmed():
    spots = []
    eng = RttySkimmerEngine(FS, 14_100_000, 14_060_000, 14_140_000, known_calls={'W3ABC'}, on_spot=spots.append)
    x = rtty_iq(RTTY_SIGNALS, FS, 30.0, seed=4)
    for i in range(0, len(x), 9600):
        eng.feed(x[i:i + 9600])
    eng.feed(np.zeros(int(FS * 2), np.complex64))
    return eng, spots


def test_rtty_decodes_several_signals(rtty_skimmed):
    eng, _ = rtty_skimmed
    sigs = eng.signal_list()
    by = lambda khz: [s for s in sigs if abs(s['freq_khz'] - khz) < 0.2]
    # the mark (higher tone) is reported: pair centre + 85 Hz
    assert by(14070.085) and 'CQ TEST W3ABC' in by(14070.085)[0]['text']
    assert by(14120.085) and 'TU N9XX TEST N9XX TEST' in by(14120.085)[0]['text']
    assert by(14088.585) and 'VE3NEA TEST' in by(14088.585)[0]['text']   # 500 Hz from another signal
    for s in sigs:
        assert 150 <= s['shift_hz'] <= 190
        assert s['clean_pct'] >= 80


def test_rtty_spots(rtty_skimmed):
    _, spots = rtty_skimmed
    got = {(s.call, s.confirmed) for s in spots}
    assert ('W3ABC', True) in got and ('N9XX', True) in got and ('VE3NEA', True) in got
    assert all(s.mode == 'RTTY' and s.wpm == 45 for s in spots)
    assert all(s.public('W3USR')['rbn'].split()[5] == 'RTTY' for s in spots)


def test_rtty_noise_only_quiet():
    spots = []
    eng = RttySkimmerEngine(FS, 14_100_000, 14_060_000, 14_140_000, on_spot=spots.append)
    x = (np.random.default_rng(9).standard_normal(int(FS * 12)) +
         1j * np.random.default_rng(10).standard_normal(int(FS * 12))).astype(np.complex64)
    eng.feed(x)
    assert not spots
    assert sum(len(s['text']) for s in eng.signal_list()) < 10


def test_shared_filter_bank_matches_separate():
    """The worker feeds CW and RTTY engines from one filter bank (feed(also=...))."""
    x = rtty_iq(RTTY_SIGNALS[:1], FS, 8.0, seed=4) + cw_iq(SIGNALS[:1], FS, 8.0, seed=4)
    a = RttySkimmerEngine(FS, CENTER, 14_000_000, 14_090_000)
    b = RttySkimmerEngine(FS, CENTER, 14_000_000, 14_090_000)
    cw = SkimmerEngine(FS, CENTER, 14_000_000, 14_090_000)
    a.feed(x)
    cw.feed(x, also=(b,))
    assert [s['text'] for s in a.signal_list()] == [s['text'] for s in b.signal_list()]
    assert np.allclose(a.spectrum_db, b.spectrum_db)
