"""
CW skimmer for one band, chosen from the dashboard's Skimmer tab.

    radiod --RTP F32 IQ, 96 kHz--> RadiodStream (receive thread, this process)
           --bytes over a pipe--> engine process (cwskim.SkimmerEngine)
           --state once a second--> this process --> /x/frc-dashboard/skimmer

One radiod IQ channel (preset ``iq``, 96 kHz, +-46 kHz) covers the bottom
70 kHz of the band, where CW lives.  It is an ordinary channel like the recorders'
(measured on W3USR-06: 0 radiod filter_drops over 45 channels with it
running), not a spectrum channel.  The DSP runs in its own process: in the
supervisor's process its Python work starved the receive thread and the
kernel dropped about 8 % of the packets.

Like the waterfall, the channel exists only while someone has the Skimmer
tab open (``idle_timeout_sec``), unless ``always_on`` is set (needed for a
spotter feed).

Spots are kept in the Reverse Beacon Network / CW Skimmer telnet layout.
With ``telnet_port`` set, confirmed spots are also served on a DX-cluster
style telnet port, the interface the RBN Aggregator reads from CW Skimmer.
That port is off by default, and nothing here sends spots anywhere.
"""

from __future__ import annotations

import json
import logging
import multiprocessing as mp
import queue
import re
import socket
import socketserver
import threading
import time
from collections import deque
from pathlib import Path

log = logging.getLogger('frc-dashboard.skimmer')

SAMPLE_RATE = 96_000
HALF_SPAN = 45_000                     # usable +- around the channel centre
LIFETIME_FRAMES = 3000                 # 60 s of radiod frames; refreshed every 10 s
PACKET_SAMPLES = 180                   # complex samples (= RTP timestamp step) per IQ packet

# What to skim on each band (Hz): the bottom 70 kHz, where the band plans
# put CW (and RBN skimmers listen).  Above it are PSK/JS8/RTTY/FT8, which only
# fill the signal slots with junk (seen on 40 m: clusters at 7.053/7.064/7.086).
BAND_PLAN = {
    '160m': (1_800_000, 1_870_000),
    '80m':  (3_500_000, 3_570_000),
    '40m':  (7_000_000, 7_070_000),
    '20m':  (14_000_000, 14_070_000),
    '15m':  (21_000_000, 21_070_000),
    '10m':  (28_000_000, 28_070_000),
}
# Digital-mode dials (MHz) inside those ranges; their audio passbands are
# masked so FT8/FT4 tones don't become "signals".
DIALS = {
    '160m': {'FT8': 1.840, 'WSPR': 1.8366},
    '80m':  {'FT8': 3.573, 'FT4': 3.575, 'WSPR': 3.5686},
    '40m':  {'FT8': 7.074, 'FT4': 7.0475, 'WSPR': 7.0386},
    '20m':  {'FT8': 14.074, 'FT4': 14.080, 'WSPR': 14.0956},
    '15m':  {'FT8': 21.074, 'FT4': 21.140, 'WSPR': 21.0946},
    '10m':  {'FT8': 28.074, 'FT4': 28.180, 'WSPR': 28.1246},
}


def band_setup(band: str) -> dict:
    lo, hi = BAND_PLAN[band]
    masks = []
    for mode, mhz in DIALS.get(band, {}).items():
        f = mhz * 1e6
        masks.append((f + 1350, f + 1650) if mode == 'WSPR' else (f - 100, f + 3200))
    return {'band': band, 'lo_hz': lo, 'hi_hz': hi, 'center_hz': (lo + hi) // 2,
            'masks': [m for m in masks if m[1] > lo and m[0] < hi]}


def spotter_call(call: str) -> str:
    """RBN skimmer IDs are plain calls: 'W3USR/06' -> 'W3USR'."""
    call = (call or '').upper().strip()
    parts = [p for p in call.split('/') if p]
    best = max(parts, key=lambda p: (bool(re.search(r'\d', p)) and bool(re.search(r'[A-Z]', p)), len(p)), default='')
    return best or 'NOCALL'


# ── engine process ────────────────────────────────────────────────────────
def _engine_main(rx, tx, setup: dict, opts: dict) -> None:
    """Child process: IQ bytes in, state dicts out (once a second)."""
    import numpy as np
    from .cwskim import SkimmerEngine

    known: set = set()
    new_spots: list = []

    def make(su):
        return SkimmerEngine(SAMPLE_RATE, su['center_hz'], su['lo_hz'], su['hi_hz'], masks=su['masks'],
                             detect_db=opts['detect_db'], max_signals=opts['max_signals'],
                             known_calls=known, on_spot=new_spots.append)

    eng, band = make(setup), setup['band']
    last = time.time()
    while True:
        if rx.poll(0.25):
            try:
                msg = rx.recv_bytes()
            except (EOFError, OSError):
                return
            kind, body = msg[:1], msg[1:]
            if kind == b'I':
                eng.feed(np.frombuffer(body, np.complex64))
            elif kind == b'K':
                known.clear()
                known.update(json.loads(body))
            elif kind == b'B':
                setup = json.loads(body)
                eng, band = make(setup), setup['band']
            elif kind == b'Q':
                return
        now = time.time()
        if now - last >= 1.0:
            spots = [{'t': s.t, 'freq_hz': s.freq_hz, 'call': s.call, 'snr_db': s.snr_db, 'wpm': s.wpm,
                      'kind': s.kind, 'confirmed': s.confirmed, 'reason': s.reason} for s in new_spots]
            new_spots.clear()
            try:
                tx.send({'band': band, 'signals': eng.signal_list(), 'spectrum': eng.spectrum(800),
                         'spec_lo_hz': float(eng.freqs[0]), 'spec_hi_hz': float(eng.freqs[-1]),
                         'spots': spots, 'cpu_s': eng.cpu_s, 'frames': eng.frames,
                         'known_calls': len(known)})
            except (BrokenPipeError, OSError):
                return
            last = now


# ── telnet spot feed (RBN Aggregator / logging programs) ──────────────────
class SpotFeed:
    """A minimal DX-cluster telnet server: asks for a callsign, then sends
    each confirmed spot as one line.  This is the interface CW Skimmer offers
    and the RBN Aggregator reads; it only sends when a client connects."""

    def __init__(self, port: int, bind: str, spotter: str):
        self.clients: list = []
        self.lock = threading.Lock()
        feed = self

        class Handler(socketserver.BaseRequestHandler):
            def handle(self):
                sock = self.request
                try:
                    sock.sendall(b'Please enter your callsign: ')
                    sock.settimeout(60)
                    sock.recv(64)
                    sock.sendall(f'\r\nHello, {spotter} CW skimmer (frc-dashboard).\r\n{spotter}-#>\r\n'.encode())
                    sock.settimeout(None)
                except OSError:
                    return
                with feed.lock:
                    feed.clients.append(sock)
                try:
                    while sock.recv(256):          # ignore input; return when the client leaves
                        pass
                except OSError:
                    pass
                finally:
                    with feed.lock:
                        if sock in feed.clients:
                            feed.clients.remove(sock)

        class Server(socketserver.ThreadingMixIn, socketserver.TCPServer):
            daemon_threads = True
            allow_reuse_address = True

        self.server = Server((bind, port), Handler)
        threading.Thread(target=self.server.serve_forever, name='skimmer-telnet', daemon=True).start()
        log.info('skimmer spot feed on %s:%d (telnet)', bind, port)

    def send(self, line: str) -> None:
        data = (line + '\r\n').encode()
        with self.lock:
            for sock in list(self.clients):
                try:
                    sock.sendall(data)
                except OSError:
                    self.clients.remove(sock)

    def close(self) -> None:
        self.server.shutdown()
        self.server.server_close()


# ── known callsigns ───────────────────────────────────────────────────────
def load_known_calls(env: dict | None, scp_file: str = '') -> set:
    """Calls this station has heard (MongoDB spots: WSPR/FT8/FT4 senders and
    receivers, last 30 days by TTL) plus an optional MASTER.SCP-style file
    (one call per line).  Used to confirm skimmed calls."""
    calls: set = set()
    if scp_file:
        try:
            for line in Path(scp_file).read_text(errors='ignore').splitlines():
                line = line.strip().upper()
                if line and not line.startswith('#'):
                    calls.add(line)
        except OSError as e:
            log.warning('skimmer scp_file %s: %s', scp_file, e)
    if env and env.get('MONGODB_USERNAME'):
        try:
            from urllib.parse import quote_plus
            from pymongo import MongoClient
            uri = (f"mongodb://{quote_plus(env['MONGODB_USERNAME'])}:{quote_plus(env.get('MONGODB_PASSWORD', ''))}"
                   f"@{env.get('MONGODB_HOST', '127.0.0.1')}:{env.get('MONGODB_PORT', '27017')}/?authSource=admin")
            with MongoClient(uri, serverSelectionTimeoutMS=3000, socketTimeoutMS=30000,
                             appname='frc-dashboard-skimmer') as client:
                coll = client[env.get('MONGODB_DATABASE', 'wspr_db')]['spots']
                for field in ('callsign', 'rx_callsign'):
                    calls.update(c.upper() for c in coll.distinct(field) if isinstance(c, str) and c)
        except Exception as e:
            log.warning('skimmer: could not load callsigns from MongoDB: %s', str(e).split(', Timeout:')[0])
    return calls


# ── manager (lives in the supervisor) ─────────────────────────────────────
class SkimmerManager:
    def __init__(self, cfg: dict, radiod_status: str | None, station_call: str = '', env: dict | None = None):
        c = cfg.get('skimmer', {})
        self.enabled = bool(c.get('enabled', True))
        self.radiod_status = (cfg.get('waterfall', {}).get('radiod_status') or c.get('radiod_status')
                              or radiod_status)
        band = str(c.get('band', '20m'))
        self.band = band if band in BAND_PLAN else '20m'
        self.opts = {'detect_db': float(c.get('detect_db', 8.0)), 'max_signals': int(c.get('max_signals', 60))}
        self.idle_timeout = float(c.get('idle_timeout_sec', 120))
        self.always_on = bool(c.get('always_on', False))
        self.spotter = (c.get('spotter') or spotter_call(station_call)).upper()
        self.telnet_port = int(c.get('telnet_port', 0))
        self.telnet_bind = str(c.get('telnet_bind', '127.0.0.1'))
        self.scp_file = str(c.get('scp_file', ''))
        self.env = env
        self.lock = threading.Lock()
        self.life = threading.Lock()
        self.tx_lock = threading.Lock()
        self.state = 'stopped'
        self.error: str | None = None
        self._last_fail = 0.0
        self.last_demand = 0.0
        self.control = self.channel = self.stream = None
        self.proc = self.tx = self.rx = None
        self.iq_q: queue.Queue = queue.Queue(maxsize=400)
        self.latest: dict = {}
        self.spots: deque = deque(maxlen=1000)
        self.seq = 0
        self.known: set = set()
        self._known_at = 0.0
        self.samples = 0
        self.rate: deque = deque(maxlen=30)               # (t, samples) for the IQ rate
        self.overruns = 0
        self.started_at = 0.0
        self._refresh = 0.0
        self._stop = threading.Event()
        self.feed = None
        if self.enabled and self.telnet_port:
            try:
                self.feed = SpotFeed(self.telnet_port, self.telnet_bind, self.spotter)
            except OSError as e:
                log.error('skimmer telnet %s:%d: %s', self.telnet_bind, self.telnet_port, e)

    # ------------------------------------------------------------ lifecycle
    def _start_worker(self) -> None:
        try:
            setup = band_setup(self.band)
            ctx = mp.get_context('spawn')
            a, self.tx = ctx.Pipe(duplex=False)            # parent -> engine
            self.rx, b = ctx.Pipe(duplex=False)            # engine -> parent
            self.proc = ctx.Process(target=_engine_main, args=(a, b, setup, self.opts),
                                    name='frc-skimmer-engine', daemon=True)
            self.proc.start()
            self._stop.clear()
            threading.Thread(target=self._pump, name='skimmer-pump', daemon=True).start()
            threading.Thread(target=self._collect, name='skimmer-collect', daemon=True).start()
            if self.known:
                self._send(b'K', json.dumps(sorted(self.known)).encode())
            threading.Thread(target=self._refresh_known, name='skimmer-known', daemon=True).start()
            self._open_channel(setup)
            with self.life:
                self.state, self.error, self.started_at = 'running', None, time.time()
            log.info('skimmer started on %s (%.3f-%.3f MHz), spotter %s',
                     self.band, setup['lo_hz'] / 1e6, setup['hi_hz'] / 1e6, self.spotter)
        except Exception as e:
            with self.life:
                self.error = f'{type(e).__name__}: {e}'
                self._last_fail = time.time()
                log.error('skimmer start failed: %s', self.error)
                self._stop_all()

    def _open_channel(self, setup: dict) -> None:
        from ka9q import RadiodControl, RadiodStream
        from ka9q.types import Encoding
        from .listen import ListenManager
        self.control = RadiodControl(self.radiod_status, client_id='frc-dashboard')
        kwargs = dict(frequency_hz=setup['center_hz'], preset='iq', sample_rate=SAMPLE_RATE,
                      low_edge=-HALF_SPAN - 1000, high_edge=HALF_SPAN + 1000, encoding=Encoding.F32LE)
        try:
            ch = self.control.ensure_channel(**kwargs, lifetime=LIFETIME_FRAMES)
        except TypeError:
            ch = self.control.ensure_channel(**kwargs)
        ch.encoding = ListenManager._granted_encoding(self.control, ch, Encoding.F32LE)
        self.channel = ch
        self.stream = RadiodStream(channel=ch, on_samples=self._on_samples,
                                   samples_per_packet=PACKET_SAMPLES, deliver_interval_packets=16)
        self.stream.start()

    def _on_samples(self, samples, quality=None) -> None:
        import numpy as np
        try:
            self.iq_q.put_nowait(np.asarray(samples, np.complex64).tobytes())
        except queue.Full:
            self.overruns += 1
            return
        self.samples += len(samples)

    def _send(self, kind: bytes, body: bytes) -> None:
        # Several threads send (IQ pump, known-call loader, band changes); a
        # Connection is not thread-safe and interleaved writes corrupt it.
        with self.tx_lock:
            try:
                self.tx.send_bytes(kind + body)
            except (OSError, AttributeError, ValueError):
                pass

    def _pump(self) -> None:
        while not self._stop.is_set():
            try:
                data = self.iq_q.get(timeout=0.5)
            except queue.Empty:
                continue
            self._send(b'I', data)

    def _collect(self) -> None:
        while not self._stop.is_set():
            try:
                if not self.rx.poll(0.5):
                    continue
                st = self.rx.recv()
            except (EOFError, OSError, AttributeError):
                break
            now = time.time()
            with self.lock:
                self.rate.append((now, self.samples))
                for s in st.pop('spots'):
                    self.seq += 1
                    s['seq'] = self.seq
                    self.spots.append(s)
                    if s['confirmed'] and self.feed:
                        self.feed.send(self._rbn(s))
                self.latest = st

    def _refresh_known(self) -> None:
        if time.time() - self._known_at < 3600 and self.known:
            return
        self._known_at = time.time()
        calls = load_known_calls(self.env, self.scp_file)
        if calls:
            self.known = calls
            self._send(b'K', json.dumps(sorted(calls)).encode())
            log.info('skimmer: %d known callsigns', len(calls))

    def _stop_all(self) -> None:
        """Remove the radiod channel and end the engine (caller holds self.life)."""
        self._stop.set()
        if self.stream is not None:
            try:
                self.stream.stop()
            except Exception as e:
                log.debug('skimmer stream stop: %s', e)
            self.stream = None
        if self.channel is not None and self.control is not None:
            try:
                self.control.remove_channel(self.channel.ssrc)
            except Exception as e:
                log.warning('skimmer remove_channel: %s', e)
        self.channel = None
        if self.control is not None:
            try:
                self.control.close()
            except Exception:
                pass
            self.control = None
        if self.proc is not None:
            self._send(b'Q', b'')
            self.proc.join(3)
            if self.proc.is_alive():
                self.proc.kill()
            self.proc = None
        if self.state == 'running':
            log.info('skimmer stopped')
        self.state = 'stopped'
        with self.lock:
            self.latest = {}

    def tick(self) -> None:
        """Supervisor loop: stop when nobody watches; keep the radiod channel alive."""
        now = time.time()
        with self.life:
            if self.state == 'running':
                if self.proc is not None and not self.proc.is_alive():
                    self.error = 'engine process exited'
                    self._last_fail = now
                    self._stop_all()
                elif not self.always_on and now - self.last_demand > self.idle_timeout:
                    self._stop_all()
                elif now - self._refresh > 10 and self.control is not None and self.channel is not None:
                    self._refresh = now
                    setter = getattr(self.control, 'set_channel_lifetime', None)
                    if setter:
                        try:
                            setter(self.channel.ssrc, LIFETIME_FRAMES)
                        except Exception as e:
                            log.debug('skimmer lifetime refresh: %s', e)
            elif self.state == 'stopped' and self.always_on and self.enabled and self.radiod_status \
                    and now - self._last_fail > 60:
                self._begin()

    def _begin(self) -> None:
        """Start in the background (caller holds self.life)."""
        self.state = 'starting'
        threading.Thread(target=self._start_worker, name='skimmer-start', daemon=True).start()

    def shutdown(self) -> None:
        with self.life:
            self._stop_all()
        if self.feed:
            self.feed.close()

    # ------------------------------------------------------------- control
    def set_band(self, band: str) -> tuple[int, dict]:
        if band not in BAND_PLAN:
            return 400, {'error': f'band must be one of {list(BAND_PLAN)}'}
        with self.life:
            self.band = band
            if self.state == 'running' and self.control is not None and self.channel is not None:
                setup = band_setup(band)
                try:
                    self.control.set_frequency(self.channel.ssrc, setup['center_hz'])
                except Exception as e:
                    return 502, {'error': f'retune failed: {e}'}
                self._send(b'B', json.dumps(setup).encode())
                with self.lock:
                    self.latest = {}
                log.info('skimmer moved to %s', band)
        return 200, {'band': band}

    # --------------------------------------------------------------- reads
    def _rbn(self, s: dict) -> str:
        from .cwskim import rbn_line
        return rbn_line(self.spotter, s['freq_hz'] / 1e3, s['call'], s['snr_db'], s['wpm'], s['kind'], s['t'])

    def iq_rate(self) -> float | None:
        if len(self.rate) < 2:
            return None
        (t0, n0), (t1, n1) = self.rate[0], self.rate[-1]
        return round((n1 - n0) / (t1 - t0)) if t1 > t0 else None

    def snapshot(self, since: int = 0) -> dict:
        if not self.enabled:
            return {'enabled': False, 'running': False, 'error': 'skimmer disabled in config'}
        if not self.radiod_status:
            return {'enabled': False, 'running': False, 'error': 'radiod status address unknown'}
        self.last_demand = time.time()
        with self.life:
            if self.state == 'stopped':
                if self.error and time.time() - self._last_fail < 30:
                    return {'enabled': True, 'running': False, 'error': self.error, **self._meta()}
                self._begin()
            if self.state == 'starting':
                return {'enabled': True, 'running': False, 'starting': True, **self._meta()}
        with self.lock:
            st = dict(self.latest)
            spots = [{**s, 'freq_khz': round(s['freq_hz'] / 1e3, 1), 'rbn': self._rbn(s)}
                     for s in self.spots if s['seq'] > since]
            seq = self.seq
        elapsed = time.time() - self.started_at
        return {'enabled': True, 'running': True, **self._meta(), 'seq': seq,
                'signals': st.get('signals', []), 'spots': spots,
                'spectrum': {'lo_hz': st.get('spec_lo_hz'), 'hi_hz': st.get('spec_hi_hz'),
                             'db': st.get('spectrum', [])},
                'stats': {'iq_rate': self.iq_rate(), 'overruns': self.overruns,
                          'cpu_pct': round(100 * st.get('cpu_s', 0) / elapsed, 1) if elapsed > 1 else None,
                          'known_calls': st.get('known_calls', 0), 'uptime_s': round(elapsed)},
                'ready': bool(st) and st.get('band') == self.band}

    def _meta(self) -> dict:
        su = band_setup(self.band)
        return {'band': self.band, 'bands': list(BAND_PLAN), 'lo_hz': su['lo_hz'], 'hi_hz': su['hi_hz'],
                'masks': su['masks'], 'spotter': self.spotter, 'always_on': self.always_on,
                'telnet': {'port': self.telnet_port, 'bind': self.telnet_bind,
                           'clients': len(self.feed.clients) if self.feed else 0} if self.telnet_port else None}

    def status(self) -> dict:
        return {'enabled': self.enabled, 'state': self.state, 'band': self.band, 'error': self.error,
                'spots': self.seq, 'iq_rate': self.iq_rate(), 'overruns': self.overruns,
                'telnet_port': self.telnet_port or None}


# ── CLI: try it against radiod without the dashboard ──────────────────────
def main(argv=None) -> int:
    """python -m frc_dashboard.skimmer live --band 20m --seconds 120
    python -m frc_dashboard.skimmer serve --socket /run/frc-dev/skimmer.sock (dev: a control
    socket with only the skimmer endpoints, for a dev copy of the Flask app)."""
    import argparse
    from .config import app_environment, load_config, station, station_env
    p = argparse.ArgumentParser(prog='frc_dashboard.skimmer')
    p.add_argument('cmd', choices=['live', 'serve'])
    p.add_argument('--band', default='20m', choices=list(BAND_PLAN))
    p.add_argument('--seconds', type=float, default=120)
    p.add_argument('--socket', default='/run/frc-dev/skimmer.sock')
    p.add_argument('--radiod', default='')
    a = p.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format='%(asctime)s %(name)s %(message)s')
    logging.getLogger('ka9q').setLevel(logging.WARNING)
    cfg = load_config()
    cfg.setdefault('skimmer', {})['band'] = a.band
    cfg['skimmer']['always_on'] = True
    call, _ = station(cfg)
    m = SkimmerManager(cfg, a.radiod or station_env('SIGMOND_RADIOD_STATUS'), call, app_environment(cfg))
    if a.cmd == 'serve':
        from .control import start_control_server
        start_control_server(a.socket, lambda: {'state': 'running'}, lambda s: '',
                             extra={'/x/frc-dashboard/skimmer': lambda q: (200, m.snapshot(int(q.get('since', 0) or 0))),
                                    '/x/frc-dashboard/skimmer/band': lambda q: m.set_band(q.get('band', ''))})
    t0, since = time.time(), 0
    try:
        while time.time() - t0 < a.seconds or a.cmd == 'serve':
            m.tick()
            snap = m.snapshot(since) if a.cmd == 'live' else {}
            for s in snap.get('spots', []):
                since = s['seq']
                print(('  ' if s['confirmed'] else '? ') + s['rbn'] + f"   [{s['reason']}]", flush=True)
            time.sleep(2)
        if a.cmd == 'live':
            snap = m.snapshot()
            print(json.dumps(snap.get('stats'), indent=None))
            for s in snap.get('signals', []):
                print(f"  {s['freq_khz']:9.2f} {s['snr_db']:5.1f} dB {s['wpm']} wpm | {s['text'][-90:]}")
    finally:
        m.shutdown()
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
