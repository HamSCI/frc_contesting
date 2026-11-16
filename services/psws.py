"""
Local PSWS measurements for the dashboard (#74): this station's own view of
the ionosphere, with no internet (the offline counterpart of spacewx.py).

* hf-timestd: Doppler shift and SNR of the WWV/WWVH/CHU carriers, read-only
  from hf-timestd's SQLite store (L1_metrology_measurements).  That table is
  hf-timestd's internal schema, not a published interface: everything here is
  optional and disappears if the file, table or columns are missing.  Reads
  are short, indexed (channel, timestamp_utc) and cached, so they never hold
  a long transaction on hf-timestd's (very large) database.
* Spot-derived indicators: per band, the spot count and the farthest
  transmitter per 15 minutes, from the spots already in MongoDB.  A crude
  "highest open band" / skip-distance view.
* Per-band noise floor: kept by the frc-dashboard supervisor while the
  waterfall channels run (see sigmond/frc-dashboard waterfall.py); relayed
  over its control socket when available.
"""

from __future__ import annotations

import math
import os
import sqlite3
import statistics
import threading
import time
from collections import defaultdict
from datetime import datetime, timedelta, timezone

TIMESTD_DB = os.getenv('TIMESTD_DB', '/var/lib/timestd/phase2/timestd.db')
CACHE_SEC = 60
DOPPLER_HOURS = 6
SPOT_HOURS = 6
BIN_SEC = 120            # Doppler series resolution
SPOT_BIN_SEC = 900       # spot indicators resolution

_cache: dict = {}
_lock = threading.Lock()


def _cached(key: str, ttl: float, fn):
    now = time.time()
    with _lock:
        hit = _cache.get(key)
        if hit and now - hit[0] < ttl:
            return hit[1]
    value = fn()
    with _lock:
        _cache[key] = (now, value)
    return value


def _iso_to_epoch(s: str) -> float | None:
    try:
        return datetime.fromisoformat(s.replace('Z', '+00:00')).timestamp()
    except (ValueError, AttributeError):
        return None


# ── hf-timestd Doppler ─────────────────────────────────────────────────────

def _timestd_query(path: str, hours: float) -> dict:
    if not os.path.exists(path):
        return {'available': False, 'reason': 'hf-timestd database not found'}
    try:
        con = sqlite3.connect(f'file:{path}?mode=ro', uri=True, timeout=2)
    except sqlite3.Error as e:
        return {'available': False, 'reason': f'cannot open hf-timestd database ({e})'}
    try:
        cols = {r[1] for r in con.execute('pragma table_info(L1_metrology_measurements)')}
        need = {'channel', 'timestamp_utc', 'station_id', 'frequency_mhz', 'snr_db', 'doppler_hz'}
        if not need <= cols:
            return {'available': False, 'reason': 'hf-timestd schema not recognised'}
        cut = (datetime.now(timezone.utc) - timedelta(hours=hours)).isoformat()
        channels = [r[0] for r in con.execute(
            'select distinct channel from (select channel from L1_metrology_measurements '
            'order by rowid desc limit 5000)')]
        rows = []
        for ch in channels:          # one indexed range scan per channel
            rows += con.execute(
                'select timestamp_utc, station_id, frequency_mhz, snr_db, doppler_hz '
                'from L1_metrology_measurements where channel = ? and timestamp_utc >= ? '
                'and doppler_hz is not null', (ch, cut)).fetchall()
    except sqlite3.Error as e:
        return {'available': False, 'reason': f'hf-timestd query failed ({e})'}
    finally:
        con.close()
    return {'available': True, 'rows': rows}


def _summarise_doppler(rows: list) -> dict:
    """Series per (frequency, station): 2-min means, latest value, disturbed flag."""
    groups = defaultdict(list)
    for ts, station, f, snr, dop in rows:
        t = _iso_to_epoch(ts)
        if t is not None:
            groups[(float(f), station)].append((t, dop, snr))
    now = time.time()
    series = []
    for (f, station), pts in sorted(groups.items()):
        pts.sort()
        bins = defaultdict(list)
        for t, d, s in pts:
            bins[int(t // BIN_SEC)].append((d, s))
        ser = [[(k + 0.5) * BIN_SEC, round(statistics.fmean(d for d, _ in v), 4)] for k, v in sorted(bins.items())]
        # Disturbed: the last 15 min scatter well above this series' typical
        # 15-min scatter over the window (sunrise/sunset, TIDs, flare onsets).
        def spread(a, b):
            v = [d for t, d, _ in pts if a <= t < b]
            return statistics.pstdev(v) if len(v) >= 4 else None
        recent = spread(now - 900, now + 60)
        typical = [s for s in (spread(t, t + 900) for t in range(int(now - DOPPLER_HOURS * 3600), int(now - 900), 900)) if s]
        base = statistics.median(typical) if typical else None
        last = pts[-1]
        series.append({
            'freq_mhz': f, 'station': station, 'series': ser,
            'doppler_hz': round(last[1], 4), 'snr_db': round(last[2], 1) if last[2] is not None else None,
            'time': last[0],
            'disturbed': bool(recent and base and recent > 3 * base and recent > 0.05),
        })
    return {'available': bool(series), 'series': series, 'hours': DOPPLER_HOURS}


def timestd_doppler(path: str = TIMESTD_DB) -> dict:
    def run():
        q = _timestd_query(path, DOPPLER_HOURS)
        return _summarise_doppler(q['rows']) if q.get('available') else q
    return _cached(f'timestd:{path}', CACHE_SEC, run)


# ── spot-derived indicators ───────────────────────────────────────────────

def _distance_km(a, b) -> float:
    p1, p2 = math.radians(a[0]), math.radians(b[0])
    dl = math.radians(b[1] - a[1])
    h = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * 6371.0088 * math.asin(min(1.0, math.sqrt(h)))


def spot_indicators(collection, rx_grid: str, to_location, band_of, time_query) -> dict:
    """Per band and 15-min bin over the last SPOT_HOURS: spot count and farthest TX (km)."""
    def run():
        try:
            rx = to_location(rx_grid)
        except Exception:
            return {'available': False}
        docs = collection.find(time_query(SPOT_HOURS * 60), {'grid': 1, 'frequency': 1, 'date': 1, 'time': 1, '_id': 0})
        grid_cache: dict = {}
        out = defaultdict(lambda: defaultdict(lambda: [0, 0.0]))
        for d in docs:
            g = d.get('grid')
            if g not in grid_cache:
                try:
                    grid_cache[g] = _distance_km(rx, to_location(g))
                except Exception:
                    grid_cache[g] = None
            km = grid_cache[g]
            band = band_of(d.get('frequency'))
            try:
                t = datetime.strptime(f"{d['date']}{d['time']}", '%y%m%d%H%M').replace(tzinfo=timezone.utc).timestamp()
            except (KeyError, ValueError):
                continue
            if km is None or band in (None, 'Unknown'):
                continue
            cell = out[band][int(t // SPOT_BIN_SEC)]
            cell[0] += 1
            cell[1] = max(cell[1], km)
        bands = {b: [[(k + 0.5) * SPOT_BIN_SEC, n, round(km)] for k, (n, km) in sorted(bins.items())]
                 for b, bins in out.items()}
        return {'available': bool(bands), 'bin_sec': SPOT_BIN_SEC, 'hours': SPOT_HOURS, 'bands': bands}
    return _cached('spots', 300, run)
