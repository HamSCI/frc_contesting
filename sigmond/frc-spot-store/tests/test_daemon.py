"""Daemon ingest-loop tests with in-memory fakes for the sink and MongoDB."""

import copy

import pytest

from frc_spot_store.config import DEFAULTS, deep_merge
from frc_spot_store.daemon import Daemon
from frc_spot_store.sink import SinkRow

from test_translate import FT8, WSPR


class FakeSink:
    def __init__(self, rows):
        self.rows = rows

    def fetch(self, after_id, limit):
        return [r for r in self.rows if r.id > after_id][:limit]

    def id_bounds(self):
        ids = [r.id for r in self.rows]
        return (min(ids), max(ids)) if ids else (0, 0)

    def table_max_id(self):
        return max((r.id for r in self.rows), default=0)

    def min_ids(self):
        out = {}
        for r in self.rows:
            out[r.target_db] = min(out.get(r.target_db, r.id), r.id)
        return out

    def close(self):
        pass


class FakeStore:
    def __init__(self, fail=False):
        self.docs = {}
        self.fail = fail

    def write(self, docs):
        if self.fail:
            raise RuntimeError('mongo down')
        new = 0
        for d in docs:
            if d['spot_key'] not in self.docs:
                self.docs[d['spot_key']] = d
                new += 1
        return new


def make_daemon(tmp_path, rows, store, batch_size=2000):
    cfg = deep_merge(DEFAULTS, {'state': {'dir': str(tmp_path)},
                                'sink': {'batch_size': batch_size},
                                'station': {'rx_callsign': 'W3USR/06'}})
    d = Daemon(cfg)
    d.sink = FakeSink(rows)
    d.store = store
    d.mongo_health = 'ok'
    d.last_id = 0
    return d


def wspr(snr, call='N3FXU'):
    p = copy.deepcopy(WSPR)
    p.update(snr_db=snr, callsign=call)
    return p


def test_keeps_strongest_duplicate_and_advances_cursor(tmp_path):
    rows = [SinkRow(1, 'wspr', wspr(-25)), SinkRow(2, 'wspr', wspr(-12)),
            SinkRow(3, 'wspr', wspr(-20)), SinkRow(4, 'psk', FT8),
            SinkRow(5, 'psk', {**FT8, 'grid': 'RR73'}), SinkRow(6, 'wspr', None)]
    store = FakeStore()
    d = make_daemon(tmp_path, rows, store)
    d._drain()
    assert len(store.docs) == 2
    assert store.docs['wspr|20261008T044600|N3FXU|40m']['snr'] == -12
    assert d.last_id == 6 and d.cursor.load() == 6
    snap = d.snapshot()
    assert snap['counters']['inserted'] == 2
    assert snap['counters']['duplicate'] == 2
    assert snap['counters']['no_grid'] == 1
    assert snap['counters']['bad_json'] == 1


def test_batches_and_reingest_is_idempotent(tmp_path):
    rows = [SinkRow(i, 'wspr', wspr(-20, call=f'K{i}AA')) for i in range(1, 8)]
    store = FakeStore()
    d = make_daemon(tmp_path, rows, store, batch_size=3)
    d._drain()
    assert len(store.docs) == 7 and d.last_id == 7
    d.last_id = 0            # replay everything
    d._drain()
    assert len(store.docs) == 7


def test_cursor_does_not_advance_when_store_fails(tmp_path):
    rows = [SinkRow(10, 'wspr', wspr(-20))]
    d = make_daemon(tmp_path, rows, FakeStore(fail=True))
    d.cursor.save(0)
    with pytest.raises(RuntimeError):
        d._drain()
    assert d.last_id == 0 and d.cursor.load() == 0


def test_gap_detected_per_target(tmp_path):
    rows = [SinkRow(50, 'psk', FT8), SinkRow(20, 'wspr', wspr(-20))]
    d = make_daemon(tmp_path, rows, FakeStore())
    d.last_id = 30           # psk rows 31..49 were trimmed before we read them
    d._check_gap()
    assert d.counters['gap_psk'] == 1 and 'gap_wspr' not in d.counters
    d._check_gap()           # reported once per cursor position
    assert d.counters['gap_psk'] == 1


def test_malformed_row_is_skipped_not_wedged(tmp_path):
    rows = [SinkRow(1, 'wspr', ['not', 'a', 'dict']),
            SinkRow(2, 'wspr', {**wspr(-20), 'callsign': 12345, 'drift_hz_per_s': 'x'}),
            SinkRow(3, 'wspr', {**wspr(-20), 'snr_db': float('inf')}),
            SinkRow(4, 'psk', FT8)]
    store = FakeStore()
    d = make_daemon(tmp_path, rows, store)
    d._drain()
    assert d.last_id == 4
    assert d.counters['translate_error'] >= 2
    assert 'psk' not in d.counters and len(store.docs) >= 1


def test_rebuilt_sink_resets_cursor(tmp_path):
    rows = [SinkRow(1, 'wspr', wspr(-20)), SinkRow(2, 'psk', FT8)]
    store = FakeStore()
    d = make_daemon(tmp_path, rows, store)
    d.last_id = 900000        # cursor from the old, larger sink
    d._drain()
    assert d.counters['sink_reset'] == 1
    assert d.last_id == 2 and len(store.docs) == 2
