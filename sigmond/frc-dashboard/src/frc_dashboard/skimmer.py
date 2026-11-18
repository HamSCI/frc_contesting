"""
CW and RTTY skimmers on every contest band, running all the time.

    radiod --RTP F32 IQ--> band worker process (one per band):
        RadiodStream (receive thread) -> CW engine (cwskim) + RTTY engine (rttyskim)
        --state and spots once a second--> supervisor (this process)
            -> /x/frc-dashboard/skimmer (the /cws page)
            -> MongoDB skimmer_db.spots (CW and RTTY spots only)
            -> optional telnet feed in RBN / CW Skimmer format (off by default)

Each band has one radiod IQ channel (preset ``iq``) wide enough for its CW
range (the bottom 70 kHz) and its RTTY segment: 96 kHz on 160 m (CW only),
128 kHz on 80/40 m and 192 kHz on 20/15/10 m.  These are ordinary channels
like the recorders' (one 96 kHz channel measured 0 radiod filter_drops over
45 channels on W3USR-06), not spectrum channels.

Each band's decoding runs in its own process, so the bands use separate
cores and a busy band can't slow the others or the supervisor.  The
receive thread shares its process with the decoders; RadiodStream's 64 MB
socket buffer absorbs their pauses.

``always_on`` runs the skimmers whether or not anyone watches.  It is off by
default: on W3USR-06 even one or two always-running bands made radiod drop
blocks in some minutes (it has almost no headroom), so they run only while
the /cws page is open.  The RBN-format
telnet feed (``telnet_port``) is off by default, and nothing here uploads.
"""

from __future__ import annotations

import dataclasses
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
from datetime import datetime, timezone
from pathlib import Path

log = logging.getLogger('frc-dashboard.skimmer')

_SINGLE_THREAD = ('OPENBLAS_NUM_THREADS', 'OMP_NUM_THREADS', 'MKL_NUM_THREADS', 'NUMEXPR_NUM_THREADS')
LIFETIME_FRAMES = 3000                 # 60 s of radiod frames; refreshed every 10 s
PACKET_SAMPLES = 180                   # complex samples (= RTP timestamp step) per IQ packet

# Per band: the CW range (the bottom 70 kHz, where the band plans put CW and
# RBN skimmers listen), the RTTY segment (CONFIG.bands[].segments.rtty), and
# an IQ sample rate whose usable +-47 % covers both.
BAND_PLAN = {
    '160m': {'cw': (1_800_000, 1_870_000), 'rtty': None,                   'rate': 96_000},
    '80m':  {'cw': (3_500_000, 3_570_000), 'rtty': (3_570_000, 3_600_000),   'rate': 128_000},
    '40m':  {'cw': (7_000_000, 7_070_000), 'rtty': (7_025_000, 7_100_000),   'rate': 128_000},
    '20m':  {'cw': (14_000_000, 14_070_000), 'rtty': (14_080_000, 14_150_000), 'rate': 192_000},
    '15m':  {'cw': (21_000_000, 21_070_000), 'rtty': (21_080_000, 21_150_000), 'rate': 192_000},
    '10m':  {'cw': (28_000_000, 28_070_000), 'rtty': (28_080_000, 28_130_000), 'rate': 192_000},
}
# Digital-mode dials (MHz); their audio passbands are masked so FT8/FT4/WSPR
# tones don't become "signals".
DIALS = {
    '160m': {'FT8': 1.840, 'WSPR': 1.8366},
    '80m':  {'FT8': 3.573, 'FT4': 3.575, 'WSPR': 3.5686},
    '40m':  {'FT8': 7.074, 'FT4': 7.0475, 'WSPR': 7.0386},
    '20m':  {'FT8': 14.074, 'FT4': 14.080, 'WSPR': 14.0956},
    '15m':  {'FT8': 21.074, 'FT4': 21.140, 'WSPR': 21.0946},
    '10m':  {'FT8': 28.074, 'FT4': 28.180, 'WSPR': 28.1246},
}


def band_setup(band: str) -> dict:
    p = BAND_PLAN[band]
    ranges = [r for r in (p['cw'], p['rtty']) if r]
    lo, hi = min(r[0] for r in ranges), max(r[1] for r in ranges)
    masks = []
    for mode, mhz in DIALS.get(band, {}).items():
        f = mhz * 1e6
        masks.append((f + 1350, f + 1650) if mode == 'WSPR' else (f - 100, f + 3200))
    return {'band': band, 'lo_hz': lo, 'hi_hz': hi, 'center_hz': (lo + hi) // 2, 'rate': p['rate'],
            'cw': p['cw'], 'rtty': p['rtty'],
            'masks': [m for m in masks if m[1] > lo and m[0] < hi]}


def spotter_call(call: str) -> str:
    """RBN skimmer IDs are plain calls: 'W3USR/06' -> 'W3USR'."""
    call = (call or '').upper().strip()
    parts = [p for p in call.split('/') if p]
    best = max(parts, key=lambda p: (bool(re.search(r'\d', p)) and bool(re.search(r'[A-Z]', p)), len(p)), default='')
    return best or 'NOCALL'


# ── band worker process ───────────────────────────────────────────────────
def _band_worker(conn, chinfo: dict, setup: dict, opts: dict) -> None:
    """Child process for one band: receive its IQ, run the CW and RTTY
    engines, report state and new spots to the supervisor once a second."""
    import os
    # Before numpy loads: one BLAS/OpenMP thread.  OpenBLAS otherwise starts a
    # spinning thread per core in every worker, which on W3USR-06 took CPU
    # from radiod's cores (measured: hundreds of radiod drops).
    for var in _SINGLE_THREAD:
        os.environ[var] = '1'
    try:
        os.nice(10)                                  # the station's own decoders come first
    except OSError:
        pass
    import numpy as np
    from ka9q import ChannelInfo, RadiodStream
    from .cwskim import SkimmerEngine
    from .rttyskim import RttySkimmerEngine

    logging.getLogger('ka9q').setLevel(logging.WARNING)
    known: set = set()
    new_spots: list = []
    rate, center = setup['rate'], setup['center_hz']
    cw = SkimmerEngine(rate, center, *setup['cw'], masks=setup['masks'], detect_db=opts['detect_db'],
                       max_signals=opts['max_signals'], known_calls=known, on_spot=new_spots.append)
    rt = None
    if setup['rtty']:
        rt = RttySkimmerEngine(rate, center, *setup['rtty'], masks=setup['masks'], detect_db=opts['detect_db'],
                               max_signals=opts['max_rtty'], known_calls=known, on_spot=new_spots.append)
    chunks: list = []
    lock = threading.Lock()
    got = [0]

    def on_samples(samples, quality=None):
        with lock:
            chunks.append(np.asarray(samples, np.complex64))
            got[0] += len(samples)

    stream = RadiodStream(channel=ChannelInfo(**chinfo), on_samples=on_samples,
                          samples_per_packet=PACKET_SAMPLES, deliver_interval_packets=16)
    stream.start()
    last = time.time()
    t_start, cpu0 = last, time.process_time()
    try:
        while True:
            if conn.poll(0.25):
                try:
                    kind, body = conn.recv()
                except (EOFError, OSError):
                    return
                if kind == 'known':
                    known.clear()
                    known.update(body)
                elif kind == 'quit':
                    return
            with lock:
                chunk, chunks[:] = chunks[:], []
            if chunk:
                iq = np.concatenate(chunk)
                cw.feed(iq, also=(rt,) if rt is not None else ())   # one filter bank for both
            now = time.time()
            if now - last >= 1.0:
                spots = [{'t': s.t, 'freq_hz': s.freq_hz, 'call': s.call, 'snr_db': s.snr_db, 'speed': s.wpm,
                          'kind': s.kind, 'confirmed': s.confirmed, 'reason': s.reason, 'mode': s.mode}
                         for s in new_spots]
                new_spots.clear()
                q = stream.quality
                state = {
                    'band': setup['band'],
                    'cw': {'signals': cw.signal_list(), 'spectrum': cw.spectrum(600),
                           'lo_hz': float(cw.freqs[0]), 'hi_hz': float(cw.freqs[-1])},
                    'rtty': ({'signals': rt.signal_list(), 'spectrum': rt.spectrum(600),
                              'lo_hz': float(rt.freqs[0]), 'hi_hz': float(rt.freqs[-1])} if rt else None),
                    'spots': spots, 'samples': got[0], 'known_calls': len(known),
                    'cpu_pct': round(100 * (time.process_time() - cpu0) / max(1e-6, now - t_start), 1),
                    'completeness': getattr(q, 'completeness_pct', None),
                }
                try:
                    conn.send(state)
                except (BrokenPipeError, OSError):
                    return
                last = now
    finally:
        try:
            stream.stop()
        except Exception:
            pass


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


# ── spot database ─────────────────────────────────────────────────────────
class SpotStore:
    """Writes skimmer spots (CW and RTTY only) to their own MongoDB database,
    separate from the WSPR/FT8 spots in wspr_db.  One document per spot:
    {ts, band, mode, freq_khz, call, snr_db, speed, speed_unit, type,
    confirmed, reason, spotter, rbn}.  Old spots expire after
    ``retention_days`` (TTL index on ts)."""

    def __init__(self, env: dict | None, database: str, retention_days: int):
        self.env, self.database, self.retention = env, database, retention_days
        self.q: queue.Queue = queue.Queue(maxsize=20000)
        self.coll = None
        self.written = self.dropped = self.failures = 0
        self.error: str | None = None
        self.enabled = bool(env and env.get('MONGODB_USERNAME') and database)
        if self.enabled:
            threading.Thread(target=self._run, name='skimmer-store', daemon=True).start()

    def put(self, doc: dict) -> None:
        if not self.enabled:
            return
        try:
            self.q.put_nowait(doc)
        except queue.Full:
            self.dropped += 1

    def _connect(self):
        from urllib.parse import quote_plus
        from pymongo import ASCENDING, DESCENDING, MongoClient
        e = self.env
        uri = (f"mongodb://{quote_plus(e['MONGODB_USERNAME'])}:{quote_plus(e.get('MONGODB_PASSWORD', ''))}"
               f"@{e.get('MONGODB_HOST', '127.0.0.1')}:{e.get('MONGODB_PORT', '27017')}/?authSource=admin")
        client = MongoClient(uri, serverSelectionTimeoutMS=3000, socketTimeoutMS=10000,
                             appname='frc-dashboard-skimmer')
        coll = client[self.database]['spots']
        coll.create_index([('ts', ASCENDING)], expireAfterSeconds=int(self.retention * 86400), name='ttl_ts')
        coll.create_index([('band', ASCENDING), ('mode', ASCENDING), ('ts', DESCENDING)], name='band_mode_ts')
        coll.create_index([('call', ASCENDING), ('ts', DESCENDING)], name='call_ts')
        return coll

    def _run(self) -> None:
        backoff = 5.0
        while True:
            batch = [self.q.get()]
            time.sleep(1.0)                              # gather a second's worth
            while len(batch) < 500:
                try:
                    batch.append(self.q.get_nowait())
                except queue.Empty:
                    break
            while True:
                try:
                    if self.coll is None:
                        self.coll = self._connect()
                    self.coll.insert_many(batch, ordered=False)
                    self.written += len(batch)
                    self.error, backoff = None, 5.0
                    break
                except Exception as e:
                    self.failures += 1
                    self.error = str(e).split(', Timeout:')[0][:300]
                    self.coll = None
                    log.warning('skimmer spot store: %s (retrying in %.0f s)', self.error, backoff)
                    time.sleep(backoff)
                    backoff = min(backoff * 2, 300.0)


# ── manager (lives in the supervisor) ─────────────────────────────────────
class BandRun:
    """One band's radiod channel and worker process."""

    def __init__(self, band: str):
        self.band = band
        self.setup = band_setup(band)
        self.channel = None
        self.proc = None
        self.conn = None
        self.latest: dict = {}
        self.started = 0.0
        self.last_state = 0.0
        self.rate: deque = deque(maxlen=30)
        self.restarts = 0
        self.error: str | None = None
        self.next_try = 0.0


class SkimmerManager:
    def __init__(self, cfg: dict, radiod_status: str | None, station_call: str = '', env: dict | None = None):
        c = cfg.get('skimmer', {})
        self.enabled = bool(c.get('enabled', True))
        self.radiod_status = (cfg.get('waterfall', {}).get('radiod_status') or c.get('radiod_status')
                              or radiod_status)
        names = [b.strip() for b in str(c.get('bands', '40m,20m')).split(',') if b.strip()]
        self.bands = {b: BandRun(b) for b in names if b in BAND_PLAN}
        self.default_band = str(c.get('band', '20m')) if str(c.get('band', '20m')) in self.bands else next(iter(self.bands), '20m')
        self.opts = {'detect_db': float(c.get('detect_db', 9.0)), 'max_signals': int(c.get('max_signals', 40)),
                     'max_rtty': int(c.get('max_rtty_signals', 30))}
        self.idle_timeout = float(c.get('idle_timeout_sec', 120))
        self.always_on = bool(c.get('always_on', False))
        self.spotter = (c.get('spotter') or spotter_call(station_call)).upper()
        self.telnet_port = int(c.get('telnet_port', 0))
        self.telnet_bind = str(c.get('telnet_bind', '127.0.0.1'))
        self.scp_file = str(c.get('scp_file', ''))
        self.env = env
        self.store = SpotStore(env if c.get('store', True) else None, str(c.get('database', 'skimmer_db')),
                               int(c.get('retention_days', 90)))
        self.lock = threading.Lock()
        self.life = threading.Lock()
        self.state = 'stopped'
        self.error: str | None = None
        self.last_demand = 0.0
        self.control = None
        self.spots: deque = deque(maxlen=2000)
        self.seq = 0
        self.known: set = set()
        self._known_at = 0.0
        self._refresh = 0.0
        self.started_at = 0.0
        self.feed = None
        if self.enabled and self.telnet_port:
            try:
                self.feed = SpotFeed(self.telnet_port, self.telnet_bind, self.spotter)
            except OSError as e:
                log.error('skimmer telnet %s:%d: %s', self.telnet_bind, self.telnet_port, e)

    # ------------------------------------------------------------ lifecycle
    def _start_all(self) -> None:
        """Background: open each band's channel and worker, a second apart."""
        try:
            from ka9q import RadiodControl
            self.control = RadiodControl(self.radiod_status, client_id='frc-dashboard')
            threading.Thread(target=self._refresh_known, name='skimmer-known', daemon=True).start()
            for br in self.bands.values():
                if self.state != 'starting':
                    return
                self._start_band(br)
                # Bands start 1 s + 1/6 of a 0.5 s block apart, so their
                # once-a-block bursts of DSP interleave instead of landing
                # together (bursts in step made radiod drop more on W3USR-06).
                time.sleep(1.0 + 0.5 / max(1, len(self.bands)))
            with self.life:
                if self.state == 'starting':
                    self.state, self.error, self.started_at = 'running', None, time.time()
            log.info('skimmers running on %s, spotter %s', ', '.join(self.bands), self.spotter)
        except Exception as e:
            with self.life:
                self.error = f'{type(e).__name__}: {e}'
                log.error('skimmer start failed: %s', self.error)
                self._stop_all()

    def _start_band(self, br: BandRun) -> None:
        from ka9q.types import Encoding
        from .listen import ListenManager
        su = br.setup
        try:
            half = int(su['rate'] * 0.48)
            kwargs = dict(frequency_hz=su['center_hz'], preset='iq', sample_rate=su['rate'],
                          low_edge=-half, high_edge=half, encoding=Encoding.F32LE)
            try:
                ch = self.control.ensure_channel(**kwargs, lifetime=LIFETIME_FRAMES)
            except TypeError:
                ch = self.control.ensure_channel(**kwargs)
            ch.encoding = ListenManager._granted_encoding(self.control, ch, Encoding.F32LE)
            br.channel = ch
            import os
            for var in _SINGLE_THREAD:                   # inherited by the worker from the start
                os.environ.setdefault(var, '1')
            ctx = mp.get_context('spawn')
            parent, child = ctx.Pipe()
            br.conn = parent
            br.proc = ctx.Process(target=_band_worker, args=(child, dataclasses.asdict(ch), su, self.opts),
                                  name=f'frc-skimmer-{br.band}', daemon=True)
            br.proc.start()
            child.close()
            br.started = br.last_state = time.time()
            br.error = None
            if self.known:
                br.conn.send(('known', self.known))
            threading.Thread(target=self._collect, args=(br,), name=f'skimmer-{br.band}', daemon=True).start()
        except Exception as e:
            br.error = f'{type(e).__name__}: {e}'
            br.next_try = time.time() + 60
            log.error('skimmer %s start failed: %s', br.band, br.error)
            self._stop_band(br)

    def _stop_band(self, br: BandRun) -> None:
        if br.conn is not None:
            try:
                br.conn.send(('quit', None))
            except Exception:
                pass
        if br.proc is not None:
            br.proc.join(3)
            if br.proc.is_alive():
                br.proc.kill()
            br.proc = None
        if br.conn is not None:
            try:
                br.conn.close()
            except Exception:
                pass
            br.conn = None
        if br.channel is not None and self.control is not None:
            try:
                self.control.remove_channel(br.channel.ssrc)
            except Exception as e:
                log.warning('skimmer %s remove_channel: %s', br.band, e)
        br.channel = None
        with self.lock:
            br.latest = {}

    def _stop_all(self) -> None:
        """Caller holds self.life."""
        was = self.state
        self.state = 'stopping'
        for br in self.bands.values():
            self._stop_band(br)
        if self.control is not None:
            try:
                self.control.close()
            except Exception:
                pass
            self.control = None
        if was == 'running':
            log.info('skimmers stopped')
        self.state = 'stopped'

    def _collect(self, br: BandRun) -> None:
        conn = br.conn
        while True:
            try:
                st = conn.recv()
            except (EOFError, OSError, AttributeError):
                return
            now = time.time()
            with self.lock:
                br.last_state = now
                br.rate.append((now, st.pop('samples')))
                for s in st.pop('spots'):
                    self.seq += 1
                    s.update(seq=self.seq, band=br.band)
                    self.spots.append(s)
                    rbn = self._rbn(s)
                    self.store.put({'ts': datetime.fromtimestamp(s['t'], timezone.utc), 'band': br.band,
                                    'mode': s['mode'].lower(), 'freq_khz': round(s['freq_hz'] / 1e3, 2),
                                    'call': s['call'], 'snr_db': s['snr_db'], 'speed': s['speed'],
                                    'speed_unit': 'bps' if s['mode'] == 'RTTY' else 'wpm', 'type': s['kind'],
                                    'confirmed': s['confirmed'], 'reason': s['reason'],
                                    'spotter': self.spotter, 'rbn': rbn})
                    if s['confirmed'] and self.feed:
                        self.feed.send(rbn)
                br.latest = st

    def _refresh_known(self) -> None:
        if time.time() - self._known_at < 3600 and self.known:
            return
        self._known_at = time.time()
        calls = load_known_calls(self.env, self.scp_file)
        if calls:
            self.known = calls
            for br in self.bands.values():
                if br.conn is not None:
                    try:
                        br.conn.send(('known', calls))
                    except Exception:
                        pass
            log.info('skimmer: %d known callsigns', len(calls))

    def tick(self) -> None:
        """Supervisor loop: start (always_on), keep channels alive, restart
        dead or stuck workers, stop when idle (not always_on)."""
        now = time.time()
        if not self.enabled or not self.radiod_status:
            return
        with self.life:
            if self.state == 'stopped':
                if (self.always_on or now - self.last_demand < self.idle_timeout) and now >= getattr(self, '_retry', 0):
                    self.state = 'starting'
                    self._retry = now + 60
                    threading.Thread(target=self._start_all, name='skimmer-start', daemon=True).start()
                return
            if self.state != 'running':
                return
            if not self.always_on and now - self.last_demand > self.idle_timeout:
                self._stop_all()
                return
            for br in self.bands.values():
                dead = br.proc is None or not br.proc.is_alive()
                stuck = br.proc is not None and now - br.last_state > 30
                if (dead or stuck) and now >= br.next_try:
                    if br.proc is not None:
                        log.warning('skimmer %s worker %s; restarting', br.band, 'exited' if dead else 'stuck')
                        br.restarts += 1
                    self._stop_band(br)
                    br.next_try = now + 60
                    self._start_band(br)
            if now - self._refresh > 10 and self.control is not None:
                self._refresh = now
                setter = getattr(self.control, 'set_channel_lifetime', None)
                for br in self.bands.values():
                    if setter and br.channel is not None:
                        try:
                            setter(br.channel.ssrc, LIFETIME_FRAMES)
                        except Exception as e:
                            log.debug('skimmer lifetime refresh %s: %s', br.band, e)
        if now - self._known_at > 3600:
            threading.Thread(target=self._refresh_known, name='skimmer-known', daemon=True).start()

    def shutdown(self) -> None:
        with self.life:
            self._stop_all()
        if self.feed:
            self.feed.close()

    # --------------------------------------------------------------- reads
    def _rbn(self, s: dict) -> str:
        from .cwskim import rbn_line
        return rbn_line(self.spotter, s['freq_hz'] / 1e3, s['call'], s['snr_db'], s['speed'], s['kind'], s['t'],
                        s['mode'])

    @staticmethod
    def _iq_rate(br: BandRun) -> float | None:
        if len(br.rate) < 2:
            return None
        (t0, n0), (t1, n1) = br.rate[0], br.rate[-1]
        return round((n1 - n0) / (t1 - t0)) if t1 > t0 else None

    def snapshot(self, band: str = '', since: int = 0) -> dict:
        if not self.enabled:
            return {'enabled': False, 'running': False, 'error': 'skimmer disabled in config'}
        if not self.radiod_status:
            return {'enabled': False, 'running': False, 'error': 'radiod status address unknown'}
        self.last_demand = time.time()
        band = band if band in self.bands else self.default_band
        meta = self._meta(band)
        if self.state != 'running':
            # 'stopped' here means the supervisor loop will start it within a second
            return {'enabled': True, 'running': False, 'starting': self.state in ('starting', 'stopped'),
                    'error': self.error, **meta}
        br = self.bands[band]
        with self.lock:
            st = dict(br.latest)
            spots = [{**s, 'freq_khz': round(s['freq_hz'] / 1e3, 1), 'rbn': self._rbn(s)}
                     for s in self.spots if s['seq'] > since]
            seq = self.seq
            summary = {b: {'cw_signals': len((r.latest.get('cw') or {}).get('signals', [])),
                           'rtty_signals': len((r.latest.get('rtty') or {}).get('signals', [])),
                           'cpu_pct': r.latest.get('cpu_pct'), 'iq_rate': self._iq_rate(r),
                           'rate': r.setup['rate'], 'restarts': r.restarts, 'error': r.error,
                           'running': bool(r.proc is not None and r.proc.is_alive())}
                       for b, r in self.bands.items()}
        return {'enabled': True, 'running': True, **meta, 'seq': seq, 'ready': bool(st),
                'cw': st.get('cw'), 'rtty': st.get('rtty'), 'spots': spots,
                'stats': {'iq_rate': self._iq_rate(br), 'cpu_pct': st.get('cpu_pct'),
                          'known_calls': st.get('known_calls', 0), 'completeness': st.get('completeness'),
                          'uptime_s': round(time.time() - self.started_at)},
                'bands_summary': summary,
                'store': {'enabled': self.store.enabled, 'database': self.store.database,
                          'written': self.store.written, 'error': self.store.error}}

    def _meta(self, band: str) -> dict:
        su = band_setup(band)
        return {'band': band, 'bands': list(self.bands), 'lo_hz': su['lo_hz'], 'hi_hz': su['hi_hz'],
                'cw_range': su['cw'], 'rtty_range': su['rtty'], 'masks': su['masks'],
                'spotter': self.spotter, 'always_on': self.always_on,
                'telnet': {'port': self.telnet_port, 'bind': self.telnet_bind,
                           'clients': len(self.feed.clients) if self.feed else 0} if self.telnet_port else None}

    def status(self) -> dict:
        with self.lock:
            return {'enabled': self.enabled, 'state': self.state, 'error': self.error, 'spots': self.seq,
                    'bands': {b: {'running': bool(r.proc is not None and r.proc.is_alive()),
                                  'cpu_pct': r.latest.get('cpu_pct'), 'iq_rate': self._iq_rate(r),
                                  'restarts': r.restarts, 'error': r.error} for b, r in self.bands.items()},
                    'store': {'database': self.store.database, 'written': self.store.written,
                              'failures': self.store.failures, 'error': self.store.error},
                    'telnet_port': self.telnet_port or None}


# ── CLI: try it against radiod without the dashboard ──────────────────────
def main(argv=None) -> int:
    """python -m frc_dashboard.skimmer live --bands 20m,40m --seconds 120 [--no-store]
    python -m frc_dashboard.skimmer serve --socket /tmp/x.sock   (dev: control socket for a dev Flask)"""
    import argparse
    from .config import app_environment, load_config, station, station_env
    p = argparse.ArgumentParser(prog='frc_dashboard.skimmer')
    p.add_argument('cmd', choices=['live', 'serve'])
    p.add_argument('--bands', default=','.join(BAND_PLAN))
    p.add_argument('--seconds', type=float, default=120)
    p.add_argument('--socket', default='/tmp/frc-dev-skim/skimmer.sock')
    p.add_argument('--radiod', default='')
    p.add_argument('--no-store', action='store_true', help='do not write spots to MongoDB')
    a = p.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format='%(asctime)s %(name)s %(message)s')
    logging.getLogger('ka9q').setLevel(logging.WARNING)
    cfg = load_config()
    sk = cfg.setdefault('skimmer', {})
    sk.update(bands=a.bands, always_on=True, telnet_port=0)
    if a.no_store:
        sk['store'] = False
    call, _ = station(cfg)
    m = SkimmerManager(cfg, a.radiod or station_env('SIGMOND_RADIOD_STATUS'), call, app_environment(cfg))
    if a.cmd == 'serve':
        from .control import start_control_server
        start_control_server(a.socket, lambda: {'state': 'running'}, lambda s: '',
                             extra={'/x/frc-dashboard/skimmer':
                                    lambda q: (200, m.snapshot(q.get('band', ''), int(q.get('since', 0) or 0)))})
    t0, since = time.time(), 0
    try:
        while time.time() - t0 < a.seconds or a.cmd == 'serve':
            m.tick()
            if a.cmd == 'live' and m.state == 'running':
                for s in m.snapshot('', since).get('spots', []):
                    since = s['seq']
                    print(('  ' if s['confirmed'] else '? ') + s['rbn'] + f"   [{s['band']}; {s['reason']}]", flush=True)
            time.sleep(2)
        if a.cmd == 'live':
            print(json.dumps(m.status(), indent=None))
            for b in m.bands:
                snap = m.snapshot(b)
                for mode in ('cw', 'rtty'):
                    for s in ((snap.get(mode) or {}).get('signals') or []):
                        if s['text']:
                            print(f"  {b:>4} {mode:4} {s['freq_khz']:9.2f} {s['snr_db']:5.1f} dB | {s['text'][-70:]}")
    finally:
        m.shutdown()
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
