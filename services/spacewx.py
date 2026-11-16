"""
Space-weather context from NOAA SWPC (#73).

Optional context, not core functionality (FR-OFF-01/07): the dashboard
fetches a few small SWPC JSON products on the server, caches them, and
serves one compact summary at /api/spacewx (and the OVATION aurora grid at
/api/aurora).  Browsers never contact SWPC.  Without internet every value
simply goes stale and the UI says so; nothing else changes.  Set
SPACEWX_ENABLED=0 to turn the fetching off entirely.

gunicorn runs several workers, so the fetched data lives in one cache file
(in the temp dir: the unit's private /tmp under systemd) and an exclusive
file lock elects a single worker to refresh each product.

Product URLs are SWPC's current JSON services (checked 2026-11-16 from
W3USR-06).  SWPC renames products now and then; a 404 just leaves that value
stale and is reported in the summary's "errors".
"""

from __future__ import annotations

import json
import logging
import os
import re
import tempfile
import threading
import time
import urllib.request
from datetime import datetime, timezone

try:
    import fcntl                     # POSIX only; on Windows each worker fetches
except ImportError:                  # pragma: no cover
    fcntl = None

log = logging.getLogger(__name__)

BASE = os.getenv('SPACEWX_BASE', 'https://services.swpc.noaa.gov')
ENABLED = os.getenv('SPACEWX_ENABLED', '1') not in ('0', 'false', 'no', 'off')
CACHE = os.path.join(tempfile.gettempdir(), 'frc-spacewx.json')
TIMEOUT = 15

# name -> (path, refresh seconds).  The 1-minute solar-wind summaries are a
# few bytes; the full RTSW plasma file (~3 MB) is only read for density.
PRODUCTS = {
    'xray':     ('/json/goes/primary/xrays-6-hour.json', 120),
    'protons':  ('/json/goes/primary/integral-protons-6-hour.json', 300),
    'kp3h':     ('/products/noaa-planetary-k-index.json', 900),
    'kp1m':     ('/json/planetary_k_index_1m.json', 120),
    'speed':    ('/products/summary/solar-wind-speed.json', 60),
    'mag':      ('/products/summary/solar-wind-mag-field.json', 60),
    'plasma':   ('/json/rtsw/rtsw_wind_1m.json', 900),
    'f107':     ('/products/summary/10cm-flux.json', 3600),
    'scales':   ('/products/noaa-scales.json', 300),
    'alerts':   ('/products/alerts.json', 600),
    'aurora':   ('/json/ovation_aurora_latest.json', 900),
}
HISTORY_SEC = 24 * 3600


def _now() -> float:
    return time.time()


def _iso(t: str | None) -> float | None:
    """SWPC time tags ('2026-11-16T04:56:00Z', '2026-11-15 13:34:32.160') -> epoch."""
    if not t:
        return None
    t = t.strip().replace(' ', 'T').rstrip('Z')
    for fmt in ('%Y-%m-%dT%H:%M:%S.%f', '%Y-%m-%dT%H:%M:%S', '%Y-%m-%dT%H:%M'):
        try:
            return datetime.strptime(t, fmt).replace(tzinfo=timezone.utc).timestamp()
        except ValueError:
            continue
    return None


def xray_class(flux: float | None) -> str | None:
    """GOES 0.1-0.8 nm flux (W/m^2) -> flare class, e.g. 2.1e-5 -> 'M2.1'."""
    if not flux or flux <= 0:
        return None
    for letter, base in (('X', 1e-4), ('M', 1e-5), ('C', 1e-6), ('B', 1e-7), ('A', 1e-8)):
        if flux >= base:
            return f'{letter}{flux / base:.1f}'
    return f'A{flux / 1e-8:.1f}'


def g_scale(kp: float | None) -> int:
    """NOAA G scale from Kp: G1 at Kp 5 ... G5 at Kp 9."""
    return max(0, min(5, int((kp or 0) + 1e-9) - 4)) if kp is not None else 0


def s_scale(p10: float | None) -> int:
    """NOAA S scale from >=10 MeV proton flux (pfu): S1 at 10 ... S5 at 1e5."""
    if not p10 or p10 < 10:
        return 0
    s = 0
    while s < 5 and p10 >= 10 ** (s + 1):
        s += 1
    return s


class SpaceWeather:
    def __init__(self, base: str = BASE, cache: str = CACHE, enabled: bool = ENABLED):
        self.base, self.cache, self.enabled = base, cache, enabled
        self.lock = threading.Lock()
        self._refreshing = False

    # ---------------------------------------------------------- cache file
    def _read(self) -> dict:
        try:
            with open(self.cache, encoding='utf-8') as f:
                return json.load(f)
        except (OSError, ValueError):
            return {'raw': {}, 'fetched': {}, 'errors': {}, 'history': {}}

    def _write(self, data: dict) -> None:
        tmp = f'{self.cache}.{os.getpid()}'
        with open(tmp, 'w', encoding='utf-8') as f:
            json.dump(data, f)
        os.replace(tmp, self.cache)

    # ------------------------------------------------------------ fetching
    def _get(self, path: str):
        req = urllib.request.Request(self.base + path, headers={'User-Agent': 'frc-contesting-dashboard'})
        with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
            return json.load(r)

    def refresh(self, force: bool = False) -> None:
        """Fetch every product that is due.  One worker at a time (file lock)."""
        lock_f = None
        try:
            if fcntl is not None:
                lock_f = open(self.cache + '.lock', 'w')
                try:
                    fcntl.flock(lock_f, fcntl.LOCK_EX | fcntl.LOCK_NB)
                except OSError:
                    return                          # another worker is refreshing
            data = self._read()
            now = _now()
            for name, (path, every) in PRODUCTS.items():
                if not force and now - data['fetched'].get(name, 0) < every:
                    continue
                try:
                    raw = self._get(path)
                    data['raw'][name] = self._trim(name, raw)
                    data['errors'].pop(name, None)
                except Exception as e:                      # offline, 404, bad JSON...
                    data['errors'][name] = f'{type(e).__name__}: {e}'[:200]
                # retry failures at the normal cadence, so being offline costs nothing
                data['fetched'][name] = now
            self._record_history(data, now)
            self._write(data)
        except OSError as e:
            log.warning('space weather cache: %s', e)
        finally:
            if lock_f is not None:
                lock_f.close()

    @staticmethod
    def _trim(name: str, raw):
        """Keep only what the summary needs (the cache stays small)."""
        if name == 'xray':
            return [[r['time_tag'], r['flux']] for r in raw if r.get('energy') == '0.1-0.8nm']
        if name == 'protons':
            return [[r['time_tag'], r['flux']] for r in raw if r.get('energy') == '>=10 MeV']
        if name == 'kp1m':
            return [[r['time_tag'], r.get('estimated_kp')] for r in raw[-180:]]
        if name == 'kp3h':
            return [[r['time_tag'], r.get('Kp')] for r in raw[-8 * 3:]]
        if name == 'plasma':
            act = [r for r in raw if r.get('active') and r.get('proton_density') is not None] or \
                  [r for r in raw if r.get('proton_density') is not None]
            return [[r['time_tag'], r['proton_density']] for r in act[:1]]
        if name == 'alerts':
            out = []
            for r in raw[:40]:
                msg = r.get('message', '').replace('\r\n', '\n').replace('\r', '\n')
                head = re.search(r'^((?:CONTINUED |EXTENDED |CANCEL )?(?:ALERT|WARNING|WATCH|SUMMARY)):\s*(.+?)\s*$',
                                 msg, re.M)
                out.append([r.get('issue_datetime'), r.get('product_id'),
                            f'{head.group(1).title()}: {head.group(2)}' if head else msg.split('\n')[0].strip()[:120]])
            return out
        if name == 'aurora':
            # Only cells with a real chance (>= 5 %): ~10x smaller.
            return {'observation': raw.get('Observation Time'), 'forecast': raw.get('Forecast Time'),
                    'cells': [c for c in raw.get('coordinates', []) if c[2] >= 5]}
        return raw

    def _record_history(self, data: dict, now: float) -> None:
        """24 h of the 1-minute values, built from our own polls."""
        h = data.setdefault('history', {})
        raw = data['raw']
        for key, val, t in (
            ('speed', (raw.get('speed') or [{}])[0].get('proton_speed'), (raw.get('speed') or [{}])[0].get('time_tag')),
            ('bz', (raw.get('mag') or [{}])[0].get('bz_gsm'), (raw.get('mag') or [{}])[0].get('time_tag')),
        ):
            if val is None:
                continue
            series = h.setdefault(key, [])
            if not series or series[-1][0] != t:
                series.append([t, val])
            cutoff = now - HISTORY_SEC
            h[key] = [p for p in series if (_iso(p[0]) or now) >= cutoff]

    def _maybe_refresh(self) -> None:
        """Refresh in the background if anything is due; never block a request."""
        with self.lock:
            if self._refreshing:
                return
            data = self._read()
            now = _now()
            due = any(now - data['fetched'].get(n, 0) >= every for n, (_, every) in PRODUCTS.items())
            if not due:
                return
            self._refreshing = True

        def run():
            try:
                self.refresh()
            finally:
                self._refreshing = False
        threading.Thread(target=run, name='spacewx', daemon=True).start()

    # ------------------------------------------------------------- reading
    def summary(self) -> dict:
        if not self.enabled:
            return {'enabled': False}
        self._maybe_refresh()
        d = self._read()
        raw, now = d['raw'], _now()

        def last(name):
            rows = raw.get(name) or []
            return rows[-1] if rows else None

        out = {'enabled': True, 'now': now, 'errors': d.get('errors', {})}
        x = last('xray')
        if x:
            spark = raw['xray'][::5]                     # 5-min resolution, 6 h
            out['xray'] = {'flux': x[1], 'class': xray_class(x[1]), 'time': _iso(x[0]),
                           'peak6h': xray_class(max(r[1] for r in raw['xray'] if r[1] is not None)),
                           'spark': [[_iso(t), f] for t, f in spark]}
        p = last('protons')
        if p:
            out['protons'] = {'p10': p[1], 'time': _iso(p[0]), 's': s_scale(p[1])}
        k3, k1 = last('kp3h'), last('kp1m')
        if k3 or k1:
            kp = k1[1] if k1 and k1[1] is not None else (k3[1] if k3 else None)
            out['kp'] = {'kp3h': k3[1] if k3 else None, 'time3h': _iso(k3[0]) if k3 else None,
                         'est': k1[1] if k1 else None, 'time': _iso(k1[0]) if k1 else None,
                         'g': g_scale(kp), 'bars': [[_iso(t), v] for t, v in (raw.get('kp3h') or [])[-8:]]}
        sp, mg, pl = (raw.get('speed') or [None])[0], (raw.get('mag') or [None])[0], last('plasma')
        if sp or pl:
            out['wind'] = {'speed': sp.get('proton_speed') if sp else None, 'time': _iso(sp.get('time_tag')) if sp else None,
                           'density': pl[1] if pl else None, 'dtime': _iso(pl[0]) if pl else None}
        if mg:
            out['imf'] = {'bt': mg.get('bt'), 'bz': mg.get('bz_gsm'), 'time': _iso(mg.get('time_tag')),
                          'bz24h': [[_iso(t), v] for t, v in d.get('history', {}).get('bz', [])[::5]]}
        f = (raw.get('f107') or [None])[0]
        if f:
            out['f107'] = {'flux': f.get('flux'), 'time': _iso(f.get('time_tag'))}
        sc = (raw.get('scales') or {}).get('0')
        if sc:
            out['scales'] = {k: {'scale': int(sc[k]['Scale'] or 0), 'text': sc[k]['Text']} for k in ('R', 'S', 'G')}
            out['scales_time'] = _iso(f"{sc.get('DateStamp')}T{sc.get('TimeStamp')}")
        al = raw.get('alerts') or []
        out['alerts'] = [{'time': _iso(t), 'id': pid, 'headline': h} for t, pid, h in al
                         if _iso(t) and now - _iso(t) < 24 * 3600][:8]
        return out

    def aurora(self) -> dict:
        if not self.enabled:
            return {'enabled': False}
        self._maybe_refresh()
        a = self._read()['raw'].get('aurora')
        return {'enabled': True, **a} if a else {'enabled': True, 'cells': []}


spacewx = SpaceWeather()
