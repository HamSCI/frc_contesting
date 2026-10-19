"""
Translate sigmond sink rows into the dashboard's ``wspr_db.spots`` schema.

sigmond's decode clients (wspr-recorder, psk-recorder) write every decoded
spot as a JSON payload into ``/var/lib/sigmond/sink.db`` (table
``pending_uploads``, keyed by ``target_db``/``target_table``).  The dashboard
reads MongoDB documents in the WSPRDaemon-era schema documented in CLAUDE.md:

    callsign, rx_callsign, grid, frequency (MHz), band, mode,
    snr, drift (Hz/min), power, dt, sync, jobtype, date (YYMMDD), time (HHMM)

This module is pure (no I/O) so it can be unit-tested against captured rows.
"""

from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Optional

# Maidenhead field+square, optional subsquare.  Lowercase accepted on input.
_GRID_RE = re.compile(r'^[A-Ra-r]{2}[0-9]{2}([A-Xa-x]{2})?$')

# FT8/FT4 sign-off tokens that are lexically valid grids but are not
# locations (WSJT-X treats "RR73" as a roger, never as a grid square).
_NOT_GRIDS = {'RR73'}

# wspr-recorder mode codes.  W2 is classic 2-minute WSPR; F2/F5/F15/F30 are
# FST4W, which the dashboard has no mode filter for.
WSPR_MODE_MAP = {'W2': 'wspr'}

PSK_MODES = {'ft8', 'ft4'}


def frequency_to_band(freq_mhz: Optional[float]) -> str:
    """Band name for a frequency in MHz (mirrors utils/bands.py)."""
    if freq_mhz is None:
        return 'Unknown'
    f = freq_mhz
    if 0.136 <= f < 0.137:   return '2200m'
    if 0.472 <= f < 0.479:   return '630m'
    if 1.8 <= f < 2.0:       return '160m'
    if 3.5 <= f < 4.0:       return '80m'
    if 5.2 <= f < 5.5:       return '60m'
    if 7.0 <= f < 7.3:       return '40m'
    if 10.1 <= f < 10.15:    return '30m'
    if 14.0 <= f < 14.35:    return '20m'
    if 18.068 <= f < 18.168: return '17m'
    if 21.0 <= f < 21.45:    return '15m'
    if 24.89 <= f < 24.99:   return '12m'
    if 28.0 <= f < 29.7:     return '10m'
    if 50.0 <= f < 54.0:     return '6m'
    if 144.0 <= f < 148.0:   return '2m'
    return 'Unknown'


def normalize_grid(grid: Optional[str]) -> Optional[str]:
    """Return a canonical grid ("FN42" / "FN42hx") or None if not a location."""
    g = (grid or '').strip()
    if not _GRID_RE.match(g) or g.upper() in _NOT_GRIDS:
        return None
    return g[:2].upper() + g[2:4] + g[4:6].lower()


def normalize_callsign(call: Optional[str]) -> Optional[str]:
    """Strip WSPR hash brackets; reject unresolved hashes ("<...>") and blanks."""
    c = (call or '').strip().strip('<>').strip().upper()
    if not c or '.' in c or ' ' in c:
        return None
    return c


def parse_time(value: Optional[str]) -> Optional[datetime]:
    """Parse sink ISO-8601 timestamps ("...Z" or "...+00:00") to aware UTC."""
    if not value:
        return None
    try:
        dt = datetime.fromisoformat(value.replace('Z', '+00:00'))
    except (TypeError, ValueError):
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _round(value, ndigits):
    try:
        return None if value is None else round(float(value), ndigits)
    except (TypeError, ValueError, OverflowError):
        return None


def _int(value):
    try:
        return None if value is None else int(round(float(value)))
    except (TypeError, ValueError, OverflowError):
        return None


def _base_doc(ts: datetime, callsign: str, grid: str, freq_mhz: float,
              mode: str, rx_callsign: str) -> dict:
    return {
        # --- dashboard schema (CLAUDE.md "Database Schema Reference") ---
        'callsign':    callsign,
        'rx_callsign': rx_callsign,
        'grid':        grid,
        'frequency':   round(freq_mhz, 6),
        'band':        frequency_to_band(freq_mhz),
        'mode':        mode,
        'date':        ts.strftime('%y%m%d'),
        'time':        ts.strftime('%H%M'),
        # --- additive fields (ignored by the dashboard) ---
        'ts':          ts,
    }


def translate(target_db: str, payload: dict, *, rx_callsign: str,
              modes: set[str]) -> tuple[Optional[dict], str]:
    """
    Convert one sink payload to a spots document.

    Returns (document, reason).  ``document`` is None when the row is skipped;
    ``reason`` is then a short machine-friendly tag used for counters.
    """
    if target_db == 'wspr':
        mode = WSPR_MODE_MAP.get(str(payload.get('mode', '')))
        if mode is None:
            return None, 'mode_unsupported'
        freq_hz = payload.get('frequency_hz')
        callsign = normalize_callsign(payload.get('callsign'))
    elif target_db == 'psk':
        mode = str(payload.get('mode', '')).lower()
        if mode not in PSK_MODES:
            return None, 'mode_unsupported'
        freq_hz = payload.get('frequency')
        # psk-recorder's rx_call is the *addressee* inside the FT8 message,
        # not this receiver — the transmitter is tx_call.
        callsign = normalize_callsign(payload.get('tx_call'))
    else:
        return None, 'target_unsupported'

    if mode not in modes:
        return None, 'mode_disabled'
    if callsign is None:
        return None, 'no_callsign'
    grid = normalize_grid(payload.get('grid'))
    if grid is None:
        return None, 'no_grid'
    ts = parse_time(payload.get('time'))
    if ts is None:
        return None, 'bad_time'
    try:
        freq_mhz = float(freq_hz) / 1e6
    except (TypeError, ValueError):
        return None, 'bad_frequency'

    doc = _base_doc(ts, callsign, grid, freq_mhz, mode, rx_callsign)

    if target_db == 'wspr':
        drift_hz_s = payload.get('drift_hz_per_s')
        doc.update({
            'snr':     _int(payload.get('snr_db')),
            # wspr-recorder reports Hz/s; the dashboard schema is Hz/min.
            'drift':   _int(None if _round(drift_hz_s, 6) is None else _round(drift_hz_s, 6) * 60.0),
            'power':   _int(payload.get('pwr_dbm')),
            'dt':      _round(payload.get('dt'), 2),
            'sync':    _round(payload.get('sync_quality'), 2),
            # No sink equivalent of wsprd's spots.txt job-type column; keep
            # the decoder's own decodetype alongside for reference.
            'jobtype': None,
            'decodetype': _int(payload.get('decodetype')),
        })
    else:
        doc.update({
            # decode_ft8 emits an uncalibrated score, not dB → snr is None
            # unless psk-recorder runs the jt9 decoder.
            'snr':     _int(payload.get('snr_db')),
            'drift':   None,
            'power':   None,
            'dt':      _round(payload.get('dt'), 2),
            'sync':    None,
            'jobtype': None,
            'score':   _int(payload.get('score')),
            'message': payload.get('message'),
        })

    doc.update({
        'reporter_id': payload.get('reporter_id'),
        'radiod_id':   payload.get('radiod_id'),
        'decoder':     payload.get('decoder_kind'),
        'source':      f'sigmond:{target_db}.spots',
    })
    doc['spot_key'] = spot_key(doc)
    return doc, 'ok'


def spot_key(doc: dict) -> str:
    """Natural key: one spot per (mode, decode slot, transmitter, band)."""
    return f"{doc['mode']}|{doc['ts'].strftime('%Y%m%dT%H%M%S')}|{doc['callsign']}|{doc['band']}"
