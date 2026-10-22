"""
frc-dashboard daemon: supervise gunicorn serving the unchanged Flask app.

The Flask app (app.py / web-ft.py at the repository root) is run exactly as
documented in README.md (`gunicorn web-ft:app`).  This wrapper only:
  * feeds it RECEIVER_* from sigmond's station identity and MONGODB_* from
    /etc/frc-contesting/mongodb.env,
  * exposes the CLIENT-CONTRACT §13 control socket, and
  * probes the app over HTTP and MongoDB so /status reflects real health.
"""

from __future__ import annotations

import logging
import os
import signal
import subprocess
import sys
import threading
import time
import urllib.request
from pathlib import Path

from . import __version__
from .config import app_environment, app_root, station, station_env
from .control import start_control_server

log = logging.getLogger('frc-dashboard')

CONTROL_SOCKET = '/run/frc-dashboard/control.sock'
PROBE_INTERVAL = 30.0


class Daemon:
    def __init__(self, cfg: dict, instance: str = 'default'):
        self.cfg = cfg
        self.instance = instance
        self.root = app_root(cfg)
        self.env = app_environment(cfg)
        self.stop = threading.Event()
        self.started = time.time()
        self.child: subprocess.Popen | None = None
        self.lock = threading.Lock()
        self.http_ok: bool | None = None
        self.mongo_ok: bool | None = None
        self.spot_count: int | None = None
        self.latest_spot: str | None = None
        self.last_probe: float | None = None
        self.last_error: str | None = None
        self.restarts = 0
        self._mongo = None
        from .waterfall import WaterfallManager
        self.waterfall = WaterfallManager(cfg, station_env('SIGMOND_RADIOD_STATUS'))

    @property
    def port(self) -> int:
        return int(self.cfg['server']['port'])

    # ---------------------------------------------------------------- state
    def snapshot(self) -> dict:
        now = time.time()
        with self.lock:
            alive = self.child is not None and self.child.poll() is None
            state = 'running' if alive and self.http_ok and self.mongo_ok else (
                'starting' if alive and self.http_ok is None else 'degraded')
            call, grid = station(self.cfg)
            return {
                'service': 'frc-dashboard',
                'instance': self.instance,
                'version': __version__,
                'contract': '0.8',
                'state': state,
                'uptime_s': round(now - self.started, 1),
                'pid': os.getpid(),
                'http': {
                    'url': f"http://{self.cfg['server']['bind']}:{self.port}/",
                    'gunicorn_pid': self.child.pid if alive else None,
                    'ok': self.http_ok,
                    'restarts': self.restarts,
                },
                'mongodb': {
                    'ok': self.mongo_ok,
                    'spots': self.spot_count,
                    'latest_spot': self.latest_spot,
                },
                'station': {'callsign': call, 'grid_square': grid},
                'waterfall': self.waterfall.status(),
                'app_root': str(self.root),
                'pipeline': {
                    'last_success_age_s': None if self.last_probe is None else round(now - self.last_probe, 1),
                    'last_error': self.last_error,
                    'backpressure': False,
                },
                'log_paths': {'stderr': f'journal:frc-dashboard@{self.instance}.service', 'files': []},
            }

    @staticmethod
    def metrics(snap: dict) -> str:
        return '\n'.join([
            '# TYPE frc_dashboard_up gauge',
            f"frc_dashboard_up {1 if snap['state'] == 'running' else 0}",
            '# TYPE frc_dashboard_http_ok gauge',
            f"frc_dashboard_http_ok {1 if snap['http']['ok'] else 0}",
            '# TYPE frc_dashboard_mongodb_ok gauge',
            f"frc_dashboard_mongodb_ok {1 if snap['mongodb']['ok'] else 0}",
            '# TYPE frc_dashboard_spots gauge',
            f"frc_dashboard_spots {snap['mongodb']['spots'] or 0}",
            '# TYPE frc_dashboard_gunicorn_restarts_total counter',
            f"frc_dashboard_gunicorn_restarts_total {snap['http']['restarts']}",
        ]) + '\n'

    # ----------------------------------------------------------------- work
    def _spawn(self) -> None:
        s = self.cfg['server']
        gunicorn = str(Path(sys.executable).with_name('gunicorn'))
        argv = [gunicorn,
                '--chdir', str(self.root),
                '--bind', f"{s['bind']}:{self.port}",
                '--workers', str(s['workers']),
                '--threads', str(s['threads']),
                '--worker-class', 'gthread',
                '--timeout', str(s['timeout_sec']),
                '--access-logfile', '-',
                '--error-logfile', '-']
        # gunicorn >= 24 opens its own control socket under $HOME by default;
        # ours (§13) is the one sigmond reads, and $HOME is read-only here.
        if self._gunicorn_has('--no-control-socket', gunicorn):
            argv.append('--no-control-socket')
        argv.append('web-ft:app')
        log.info('starting gunicorn: %s', ' '.join(argv))
        self.child = subprocess.Popen(argv, cwd=self.root, env=self.env)

    @staticmethod
    def _gunicorn_has(flag: str, gunicorn: str) -> bool:
        try:
            out = subprocess.run([gunicorn, '--help'], capture_output=True, text=True,
                                 timeout=20).stdout
        except (OSError, subprocess.SubprocessError):
            return False
        return flag in out

    def _probe(self) -> None:
        http_ok = mongo_ok = False
        err = None
        try:
            with urllib.request.urlopen(f'http://127.0.0.1:{self.port}/config', timeout=10) as r:
                http_ok = r.status == 200
        except Exception as e:
            err = f'http: {e}'
        count = latest = None
        try:
            if self._mongo is None:
                from pymongo import MongoClient
                from urllib.parse import quote_plus
                e = self.env
                uri = (f"mongodb://{quote_plus(e['MONGODB_USERNAME'])}:{quote_plus(e['MONGODB_PASSWORD'])}"
                       f"@{e.get('MONGODB_HOST', '127.0.0.1')}:{e.get('MONGODB_PORT', '27017')}/?authSource=admin")
                self._mongo = MongoClient(uri, serverSelectionTimeoutMS=3000,
                                          connectTimeoutMS=3000, socketTimeoutMS=5000,
                                          appname='frc-dashboard-probe')
            coll = self._mongo[self.env.get('MONGODB_DATABASE', 'wspr_db')]['spots']
            count = coll.estimated_document_count()
            doc = coll.find_one({}, sort=[('date', -1), ('time', -1)],
                                projection={'date': 1, 'time': 1})
            if doc:
                latest = f"{doc.get('date')} {doc.get('time')}"
            mongo_ok = True
        except Exception as e:
            msg = str(e).split(', Timeout:')[0]
            err = (err + '; ' if err else '') + f'mongodb: {msg}'
        with self.lock:
            self.http_ok, self.mongo_ok = http_ok, mongo_ok
            self.spot_count, self.latest_spot = count, latest
            self.last_probe = time.time()
            self.last_error = err

    def _waterfall_request(self, query: dict) -> tuple[int, dict]:
        try:
            since = int(query.get('since', 0))
        except ValueError:
            since = 0
        snap = self.waterfall.snapshot(since)
        return (200 if snap.get('running') or snap.get('starting') else 503), snap

    def _probe_loop(self) -> None:
        """Health probes on their own thread so a slow HTTP/MongoDB answer
        never delays gunicorn supervision or shutdown."""
        if self.stop.wait(5):
            return
        while not self.stop.is_set():
            try:
                self._probe()
            except Exception as e:      # never let the probe thread die
                log.warning('probe failed: %s', e)
            self.stop.wait(PROBE_INTERVAL)

    def run(self) -> int:
        for sig in (signal.SIGTERM, signal.SIGINT):
            signal.signal(sig, lambda *_: self.stop.set())
        if not (self.root / 'web-ft.py').exists():
            log.error('dashboard app not found under %s (set [app].root)', self.root)
            return 1
        control = start_control_server(CONTROL_SOCKET, self.snapshot, self.metrics,
                                       extra={'/x/frc-dashboard/waterfall': self._waterfall_request})
        if control is None:
            log.warning('control socket %s unavailable; continuing without it', CONTROL_SOCKET)

        self._spawn()
        threading.Thread(target=self._probe_loop, name='probe', daemon=True).start()
        backoff = 5.0
        healthy_since = time.time()
        while not self.stop.is_set():
            if self.child.poll() is not None:
                log.error('gunicorn exited with %s; restarting in %.0fs', self.child.returncode, backoff)
                with self.lock:
                    self.http_ok = False
                    self.restarts += 1
                if self.stop.wait(backoff):
                    break
                backoff = min(backoff * 2, 300.0)
                self._spawn()
                healthy_since = time.time()
            elif time.time() - healthy_since > 120:
                backoff = 5.0           # stayed up a while: reset restart backoff
            self.waterfall.tick()
            self.stop.wait(1.0)

        self.waterfall.shutdown()       # remove our spectrum channels from radiod
        log.info('stopping gunicorn')
        if self.child and self.child.poll() is None:
            self.child.terminate()
            try:
                self.child.wait(timeout=20)
            except subprocess.TimeoutExpired:
                self.child.kill()
        if control is not None:
            control.shutdown()
            try:
                os.unlink(CONTROL_SOCKET)
            except OSError:
                pass
        if self._mongo is not None:
            self._mongo.close()
        return 0
