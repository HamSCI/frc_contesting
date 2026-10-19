"""
frc-spot-store daemon: tail sigmond's sink and upsert spots into MongoDB.

Loop: read spot rows above our cursor → translate → bulk upsert → persist the
cursor.  The cursor advances only after MongoDB acknowledged the batch, so a
MongoDB outage pauses ingestion instead of losing rows (until sigmond's
storage trim ages them out of the sink — logged as a gap when detected).
"""

from __future__ import annotations

import json
import logging
import os
import signal
import threading
import time
from collections import Counter
from pathlib import Path

from . import __version__
from .config import enabled_modes, mongodb_settings, rx_callsign
from .control import start_control_server
from .sink import SinkReader
from .translate import translate

log = logging.getLogger('frc-spot-store')

CONTROL_SOCKET = '/run/frc-spot-store/control.sock'


def _short(e: Exception) -> str:
    """pymongo errors append a long topology dump; keep the first clause."""
    return str(e).split(', Timeout:')[0].split(' (configured timeouts')[0]


class Cursor:
    """Highest sink id already stored, persisted atomically as JSON."""

    def __init__(self, state_dir: str, instance: str):
        self.path = Path(state_dir) / f'{instance}.cursor.json'

    def load(self) -> int | None:
        try:
            return int(json.loads(self.path.read_text())['last_id'])
        except (OSError, ValueError, KeyError, TypeError):
            return None

    def save(self, last_id: int) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.path.with_suffix('.tmp')
        tmp.write_text(json.dumps({'last_id': last_id, 'saved_at': time.time()}))
        os.replace(tmp, self.path)


class Daemon:
    def __init__(self, cfg: dict, instance: str = 'default'):
        self.cfg = cfg
        self.instance = instance
        self.modes = enabled_modes(cfg)
        self.rx_call = rx_callsign(cfg)
        self.sink = SinkReader(cfg['sink']['path'])
        self.cursor = Cursor(cfg['state']['dir'], instance)
        self.stop = threading.Event()
        self.started = time.time()
        self.lock = threading.Lock()
        self.last_id: int | None = None
        self.store = None
        self.counters: Counter = Counter()
        self.by_mode: Counter = Counter()
        self.recent: list[tuple[float, int]] = []   # (time, inserted) for 15-min rate
        self.last_success: float | None = None
        self.last_row_time: float | None = None
        self.last_error: str | None = None
        self.mongo_health = 'unknown'
        self.lag_rows = 0
        self._gaps_reported: set[tuple[str, int]] = set()

    # ---------------------------------------------------------------- state
    def snapshot(self) -> dict:
        now = time.time()
        with self.lock:
            inserted_15m = sum(n for t, n in self.recent if now - t <= 900)
            stale = (self.last_success is None
                     or now - self.last_success > 10 * float(self.cfg['sink']['poll_interval_sec']) + 60)
            state = 'running' if self.mongo_health == 'ok' and not stale else 'degraded'
            return {
                'service': 'frc-spot-store',
                'instance': self.instance,
                'version': __version__,
                'contract': '0.8',
                'state': state,
                'uptime_s': round(now - self.started, 1),
                'pid': os.getpid(),
                'sink': {
                    'path': self.cfg['sink']['path'],
                    'cursor_id': self.last_id,
                    'lag_rows': self.lag_rows,
                },
                'mongodb': {
                    'database': mongodb_settings()['database'],
                    'collection': self.cfg['mongodb']['collection'],
                    'health': self.mongo_health,
                    'retention_days': self.cfg['mongodb']['retention_days'],
                },
                'pipeline': {
                    'lag_s': None if self.last_row_time is None else round(now - self.last_row_time, 1),
                    'queue_depth': self.lag_rows,
                    'last_success_age_s': None if self.last_success is None else round(now - self.last_success, 1),
                    'last_error': self.last_error,
                    'backpressure': self.lag_rows > int(self.cfg['sink']['batch_size']),
                },
                'spots_15m': inserted_15m,
                'counters': dict(self.counters),
                'accepted_by_mode': dict(self.by_mode),
                'modes': sorted(self.modes),
                'rx_callsign': self.rx_call,
                'log_paths': {'stderr': 'journal:frc-spot-store@%s.service' % self.instance,
                              'files': []},
            }

    @staticmethod
    def metrics(snap: dict) -> str:
        lines = [
            '# TYPE frc_spot_store_up gauge',
            f"frc_spot_store_up {1 if snap['state'] == 'running' else 0}",
            '# TYPE frc_spot_store_sink_lag_rows gauge',
            f"frc_spot_store_sink_lag_rows {snap['sink']['lag_rows']}",
            '# TYPE frc_spot_store_spots_15m gauge',
            f"frc_spot_store_spots_15m {snap['spots_15m']}",
            '# TYPE frc_spot_store_rows_total counter',
        ]
        for reason, n in sorted(snap['counters'].items()):
            lines.append(f'frc_spot_store_rows_total{{result="{reason}"}} {n}')
        lines.append('# TYPE frc_spot_store_accepted_total counter')
        for mode, n in sorted(snap['accepted_by_mode'].items()):
            lines.append(f'frc_spot_store_accepted_total{{mode="{mode}"}} {n}')
        return '\n'.join(lines) + '\n'

    # ----------------------------------------------------------------- work
    def _connect_store(self) -> bool:
        from .store import SpotStore   # pymongo import kept out of CLI fast paths
        try:
            if self.store is None:
                self.store = SpotStore(mongodb_settings(),
                                       self.cfg['mongodb']['collection'],
                                       self.cfg['mongodb']['retention_days'])
            self.store.ping()
            self.store.ensure_indexes()
            self.mongo_health = 'ok'
            return True
        except Exception as e:  # pymongo raises a wide family of errors
            msg = _short(e)
            if self.mongo_health != 'unreachable' or self.last_error != f'mongodb: {msg}':
                log.warning('MongoDB unavailable: %s', msg)
            self.mongo_health = 'unreachable'
            self.last_error = f'mongodb: {msg}'
            return False

    def _init_cursor(self) -> None:
        saved = self.cursor.load()
        if saved is None:
            start = self.cfg['sink']['start_at']
            saved = self.sink.id_bounds()[1] if start == 'now' else 0
            log.info('no cursor yet; start_at=%s → starting after sink id %d', start, saved)
            self.cursor.save(saved)
        self.last_id = saved

    def _check_gap(self) -> None:
        """Warn when storage trim removed rows we had not read yet.

        Trim is per target (psk ~1 h, wspr ~24 h on W3USR-06), so compare the
        cursor with each target's oldest surviving row.  Both producers write
        continuously, so a cursor below a target's oldest row almost surely
        means that target's rows in between were lost.
        """
        if not self.last_id:
            return
        hi = self.sink.table_max_id()
        if hi and hi < self.last_id:
            # sink.db was recreated (AUTOINCREMENT restarted): our cursor is
            # beyond every id and fetch() would return nothing forever.
            log.warning('sink max id %d is below cursor %d: sink.db was rebuilt; '
                        'restarting from its oldest row', hi, self.last_id)
            with self.lock:
                self.counters['sink_reset'] += 1
            self.last_id = 0
            self.cursor.save(0)
            return
        for tdb, lo in self.sink.min_ids().items():
            if self.last_id < lo - 1 and (tdb, self.last_id) not in self._gaps_reported:
                self._gaps_reported.add((tdb, self.last_id))
                with self.lock:
                    self.counters[f'gap_{tdb}'] += 1
                log.warning('%s.spots rows after id %d were trimmed from the sink before '
                            'ingest (oldest now %d): spots missing from MongoDB', tdb, self.last_id, lo)

    def _drain(self) -> None:
        batch_size = int(self.cfg['sink']['batch_size'])
        self._check_gap()
        while not self.stop.is_set():
            rows = self.sink.fetch(self.last_id, batch_size)
            if not rows:
                break
            # wsprd reports some transmitters more than once per cycle (extra
            # decoder passes); keep the strongest decode of each spot_key.
            # Counted locally and merged under the lock: the control-socket
            # thread copies self.counters for /status.
            best: dict[str, dict] = {}
            batch = Counter()
            for r in rows:
                if r.payload is None:
                    batch['bad_json'] += 1
                    continue
                try:
                    doc, reason = translate(r.target_db, r.payload,
                                            rx_callsign=self.rx_call, modes=self.modes)
                except Exception as e:
                    # One malformed row must never wedge the cursor (the
                    # batch would be retried until trim deleted it).
                    log.warning('sink row %d untranslatable (%s: %s); skipped',
                                r.id, type(e).__name__, e)
                    doc, reason = None, 'translate_error'
                batch[reason] += 1
                if doc is None:
                    continue
                prev = best.get(doc['spot_key'])
                if prev is not None:
                    batch['duplicate'] += 1
                    if (doc['snr'] if doc['snr'] is not None else -999) <= \
                       (prev['snr'] if prev['snr'] is not None else -999):
                        continue
                best[doc['spot_key']] = doc
            docs = list(best.values())
            inserted = self.store.write(docs)
            new_last = rows[-1].id
            self.cursor.save(new_last)
            now = time.time()
            with self.lock:
                self.last_id = new_last
                self.last_success = now
                self.last_error = None
                batch['inserted'] += inserted
                batch['duplicate'] += len(docs) - inserted
                self.counters.update(batch)
                for d in docs:
                    self.by_mode[d['mode']] += 1
                if inserted:
                    self.recent.append((now, inserted))
                if docs:
                    ts = max(d['ts'].timestamp() for d in docs)
                    self.last_row_time = ts if self.last_row_time is None else max(self.last_row_time, ts)
                self.recent = [(t, n) for t, n in self.recent if now - t <= 900]
            log.debug('stored %d new spots from %d sink rows (cursor %d)', inserted, len(rows), new_last)
            if len(rows) < batch_size:
                break
        _, hi = self.sink.id_bounds()
        with self.lock:
            self.lag_rows = max(0, hi - (self.last_id or 0))
            self.last_success = time.time()

    def run(self) -> int:
        for sig in (signal.SIGTERM, signal.SIGINT):
            signal.signal(sig, lambda *_: self.stop.set())
        control = start_control_server(CONTROL_SOCKET, self.snapshot, self.metrics)
        if control is None:
            log.warning('control socket %s unavailable; continuing without it', CONTROL_SOCKET)
        log.info('frc-spot-store %s starting: sink=%s modes=%s rx_callsign=%s',
                 __version__, self.cfg['sink']['path'], ','.join(sorted(self.modes)), self.rx_call)

        poll = float(self.cfg['sink']['poll_interval_sec'])
        backoff = poll
        while not self.stop.is_set():
            try:
                if self.mongo_health != 'ok' and not self._connect_store():
                    # _connect_store already logged; cursor stays put.
                    backoff = min(backoff * 2, 120.0)
                    self.stop.wait(backoff)
                    continue
                if self.last_id is None:
                    self._init_cursor()
                self._drain()
                backoff = poll
            except Exception as e:
                from pymongo.errors import PyMongoError
                with self.lock:
                    self.last_error = _short(e)
                if isinstance(e, PyMongoError):
                    self.mongo_health = 'unreachable'
                log.error('ingest cycle failed: %s', _short(e))
                backoff = min(backoff * 2, 120.0)
            self.stop.wait(backoff)

        log.info('stopping (cursor %s)', self.last_id)
        if control is not None:
            control.shutdown()
            try:
                os.unlink(CONTROL_SOCKET)
            except OSError:
                pass
        self.sink.close()
        if self.store is not None:
            self.store.close()
        return 0
