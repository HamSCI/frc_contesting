"""services/psws.py (#74): hf-timestd Doppler summary and spot indicators, no station needed."""
import os
import sqlite3
import sys
import time
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from services import psws  # noqa: E402


def make_db(path, rows):
    con = sqlite3.connect(path)
    con.execute('create table L1_metrology_measurements (channel, timestamp_utc, minute_boundary_utc, '
                'station_id, frequency_mhz, snr_db, doppler_hz, tone_detected)')
    con.executemany('insert into L1_metrology_measurements values (?,?,?,?,?,?,?,1)', rows)
    con.commit()
    con.close()


def iso(minutes_ago):
    return (datetime.now(timezone.utc) - timedelta(minutes=minutes_ago)).isoformat()


def test_missing_database_is_unavailable(tmp_path):
    psws._cache.clear()
    assert psws.timestd_doppler(str(tmp_path / 'nope.db'))['available'] is False


def test_unknown_schema_is_unavailable(tmp_path):
    psws._cache.clear()
    db = tmp_path / 't.db'
    sqlite3.connect(db).execute('create table L1_metrology_measurements (x)').connection.commit()
    out = psws.timestd_doppler(str(db))
    assert out['available'] is False and 'schema' in out['reason']


def test_doppler_series_latest_and_disturbed(tmp_path):
    psws._cache.clear()
    rows = []
    for m in range(360, 0, -1):                    # 6 h, one per minute
        quiet = 0.01 * (1 if m % 2 else -1)
        rows.append(('SHARED_10000', iso(m), None, 'WWV', 10.0, 12.0, quiet))
        wild = 0.5 * (1 if m % 2 else -1) if m <= 12 else quiet   # last 12 min swing hard
        rows.append(('SHARED_5000', iso(m), None, 'WWV', 5.0, 20.0, wild))
    rows.append(('SHARED_10000', iso(60 * 7), None, 'WWV', 10.0, 12.0, 9.0))   # outside the window
    db = tmp_path / 't.db'
    make_db(db, rows)
    out = psws.timestd_doppler(str(db))
    assert out['available']
    by = {(s['freq_mhz'], s['station']): s for s in out['series']}
    assert by[(5.0, 'WWV')]['disturbed'] and not by[(10.0, 'WWV')]['disturbed']
    assert abs(by[(10.0, 'WWV')]['doppler_hz']) == 0.01 and by[(10.0, 'WWV')]['snr_db'] == 12.0
    assert all(abs(v) < 1 for _, v in by[(10.0, 'WWV')]['series'])        # the 7-h-old 9 Hz row is excluded
    assert 150 <= len(by[(10.0, 'WWV')]['series']) <= 190                  # 2-min bins over 6 h


class FakeCollection:
    def __init__(self, docs):
        self.docs = docs

    def find(self, query, projection):
        return iter(self.docs)


def test_spot_indicators_count_and_farthest():
    psws._cache.clear()
    now = datetime.now(timezone.utc)
    stamp = now.strftime('%y%m%d'), now.strftime('%H%M')
    docs = [
        {'grid': 'IO91wm', 'frequency': 14.0956, 'date': stamp[0], 'time': stamp[1]},   # London ~5,600 km
        {'grid': 'FN31pr', 'frequency': 14.0956, 'date': stamp[0], 'time': stamp[1]},   # New England
        {'grid': 'bad', 'frequency': 14.0956, 'date': stamp[0], 'time': stamp[1]},
    ]
    import maidenhead

    def to_loc(g):
        if g == 'bad':
            raise ValueError('bad grid')
        return maidenhead.to_location(g)
    out = psws.spot_indicators(FakeCollection(docs), 'FN21ej', to_loc,
                               lambda f: '20m' if 14 <= f < 14.35 else 'Unknown', lambda mins: {})
    assert out['available']
    t, n, km = out['bands']['20m'][-1]
    assert n == 2 and 5400 < km < 5800 and abs(t - time.time()) < 900
