#!/usr/bin/env python3
"""
Standalone heatmap viewer for WSPR prediction vs observed spot comparison.
Serves on port 5001, separate from the main dashboard (port 5000).
Reuses static assets from the parent project's static/ folder.
Fetches fresh spot data from wspr.live on startup, then serves from disk.
Calls ITURHFProp directly — the main dashboard does NOT need to be running.
"""

import csv
import json
import math
import os
import platform
import re
import statistics
import subprocess
import sys
import urllib.parse
import urllib.request
import uuid
# import xml.etree.ElementTree as ET  # PSK Reporter disabled (re-enable if reviving)
from datetime import datetime, timezone

from flask import Flask, jsonify, render_template, request

BASE_DIR     = os.path.dirname(os.path.abspath(__file__))
SPOTS_DIR    = os.path.join(BASE_DIR, 'Spot Files')
STATIC_DIR   = os.path.join(BASE_DIR, '..', 'static')
TEMPLATE_DIR = os.path.join(BASE_DIR, 'templates')
PROJECT_ROOT = os.path.abspath(os.path.join(BASE_DIR, '..'))

os.makedirs(SPOTS_DIR, exist_ok=True)

app = Flask(__name__,
    static_folder=STATIC_DIR,
    static_url_path='',
    template_folder=TEMPLATE_DIR)

# ── WSPR constants ────────────────────────────────────────────────
WSPR_FREQS = {1: 1.8366, 3: 3.5926, 7: 7.0386, 14: 14.0956, 21: 21.0946, 28: 28.1246}
BAND_NAMES = {1: '160m', 3: '80m', 7: '40m', 14: '20m', 21: '15m', 28: '10m'}
ALL_BANDS  = [1, 3, 7, 14, 21, 28]

# PSK Reporter disabled — returns one record per unique (TX, RX) pair, not
# individual decodes.  Over a 65-min window this yields only ~400 unique circuits
# vs WSPR's 16k raw decodes.  Extending the window misaligns PSK with the
# ITURHFProp UTC-hour prediction.  May revisit later.
# BAND_PSK_FRANGES = {
#     1:  (1_838_000, 1_845_000),
#     3:  (3_570_000, 3_580_000),
#     7:  (7_040_000, 7_080_000),
#     14: (14_070_000, 14_085_000),
#     21: (21_074_000, 21_145_000),
#     28: (28_074_000, 28_185_000),
# }
# PSK_API = 'https://retrieve.pskreporter.info/query'

WSPR_API = 'http://db1.wspr.live/'
WSPR_QUERY = """
SELECT
    id, time, band,
    rx_sign, rx_lat, rx_lon, rx_loc,
    tx_sign, tx_lat, tx_lon, tx_loc,
    distance, azimuth, rx_azimuth,
    frequency, power, snr, drift,
    version, code
FROM wspr.rx
WHERE time >= toStartOfInterval(now() - INTERVAL 19 MINUTE, INTERVAL 2 MINUTE)
  AND time <= toStartOfInterval(now() - INTERVAL 5 MINUTE, INTERVAL 2 MINUTE)
  AND band IN (1, 3, 7, 14, 21, 28)
  AND tx_lat BETWEEN 36.5 AND 46.5
  AND tx_lon BETWEEN -77.5 AND -72.5
ORDER BY band ASC
FORMAT JSONEachRow
""".strip()


# ── Spot fetching ─────────────────────────────────────────────────
def fetch_and_save_spots():
    print('Fetching fresh WSPR spots from wspr.live …')
    params = urllib.parse.urlencode({'query': WSPR_QUERY})
    url    = f'{WSPR_API}?{params}'
    with urllib.request.urlopen(url, timeout=30) as resp:
        body = resp.read().decode('utf-8')

    if body.startswith('Code.'):
        raise RuntimeError(f'ClickHouse error: {body[:300]}')

    spots = [json.loads(line) for line in body.strip().splitlines() if line]
    if not spots:
        raise RuntimeError('No spots returned — cycle may not be uploaded yet.')

    cycle_time_str = spots[0].get('time', '')
    try:
        cycle_dt = datetime.strptime(cycle_time_str, '%Y-%m-%d %H:%M:%S')
        file_tag = cycle_dt.strftime('%Y%m%d_%H%M')
    except (ValueError, TypeError):
        file_tag = datetime.now(timezone.utc).strftime('%Y%m%d_%H%M')

    json_path = os.path.join(SPOTS_DIR, f'spots_{file_tag}.json')
    csv_path  = os.path.join(SPOTS_DIR, f'spots_{file_tag}.csv')

    with open(json_path, 'w', encoding='utf-8') as f:
        json.dump(spots, f, indent=2, default=str)
    if spots:
        with open(csv_path, 'w', newline='', encoding='utf-8') as f:
            writer = csv.DictWriter(f, fieldnames=list(spots[0].keys()))
            writer.writeheader()
            writer.writerows(spots)

    print(f'  Saved {len(spots)} spots → {json_path}')
    return json_path


def find_latest_spots_file():
    files = sorted(f for f in os.listdir(SPOTS_DIR) if f.startswith('spots_') and f.endswith('.json'))
    return os.path.join(SPOTS_DIR, files[-1]) if files else None


def fetch_spots_for_band(band_code):
    """Fetch ~1 hour of WSPR spots for a single band, bidirectionally.

    Runs two ClickHouse queries:
      A. TX in FN21 area — the decoder (rx) is the remote end; no swap needed.
      B. RX in FN21 area — the beacon (tx) is the remote end; tx coords swapped
         into rx_lat/rx_lon so bin_spots_by_band plots the remote station.

    Returns a combined list where rx_lat/rx_lon always holds the location to plot.
    """
    time_filter = (
        "time >= toStartOfInterval(now() - INTERVAL 65 MINUTE, INTERVAL 2 MINUTE)\n"
        "  AND time <= toStartOfInterval(now() - INTERVAL 5 MINUTE, INTERVAL 2 MINUTE)\n"
        f"  AND band = {int(band_code)}"
    )
    cols = (
        "id, time, band,\n"
        "    rx_sign, rx_lat, rx_lon, rx_loc,\n"
        "    tx_sign, tx_lat, tx_lon, tx_loc,\n"
        "    distance, azimuth, rx_azimuth,\n"
        "    frequency, power, snr, drift,\n"
        "    version, code"
    )

    def _run(area_filter):
        q = (
            f"SELECT\n    {cols}\nFROM wspr.rx\n"
            f"WHERE {time_filter}\n  AND {area_filter}\n"
            "ORDER BY time ASC\nFORMAT JSONEachRow"
        )
        params = urllib.parse.urlencode({'query': q})
        with urllib.request.urlopen(f'{WSPR_API}?{params}', timeout=30) as resp:
            body = resp.read().decode('utf-8')
        if body.startswith('Code.'):
            raise RuntimeError(f'ClickHouse error: {body[:300]}')
        return [json.loads(line) for line in body.strip().splitlines() if line]

    tx_spots     = _run('tx_lat BETWEEN 36.5 AND 46.5 AND tx_lon BETWEEN -77.5 AND -72.5')
    rx_spots_raw = _run('rx_lat BETWEEN 36.5 AND 46.5 AND rx_lon BETWEEN -77.5 AND -72.5')

    # Swap tx coords into rx fields so the remote beacon location gets plotted.
    rx_spots = []
    for s in rx_spots_raw:
        ps = dict(s)
        ps['rx_lat'] = s['tx_lat']
        ps['rx_lon'] = s['tx_lon']
        rx_spots.append(ps)

    all_spots = tx_spots + rx_spots

    # Save raw (unswapped) data to disk in separate files per direction.
    ref_spots = tx_spots or rx_spots_raw
    if ref_spots:
        ref_time = ref_spots[0].get('time', '')
        try:
            file_tag = datetime.strptime(ref_time, '%Y-%m-%d %H:%M:%S').strftime('%Y%m%d_%H%M')
        except (ValueError, TypeError):
            file_tag = datetime.now(timezone.utc).strftime('%Y%m%d_%H%M')
        band_name = BAND_NAMES.get(int(band_code), f'band{band_code}')

        for label, data in (('tx', tx_spots), ('rx', rx_spots_raw)):
            if not data:
                continue
            jp = os.path.join(SPOTS_DIR, f'spots_{file_tag}_{band_name}_{label}.json')
            cp = os.path.join(SPOTS_DIR, f'spots_{file_tag}_{band_name}_{label}.csv')
            with open(jp, 'w', encoding='utf-8') as f:
                json.dump(data, f, indent=2, default=str)
            with open(cp, 'w', newline='', encoding='utf-8') as f:
                writer = csv.DictWriter(f, fieldnames=list(data[0].keys()))
                writer.writeheader()
                writer.writerows(data)
            print(f'  Saved {len(data)} WSPR spots ({band_name}, {label}-in-area) → {jp}')

    return all_spots


def cleanup_old_spots():
    """Delete spot files whose cycle timestamp is more than 15 minutes old.

    Handles all filename variants:
      spots_YYYYMMDD_HHMM.json
      spots_YYYYMMDD_HHMM_<band>_tx.json
      spots_YYYYMMDD_HHMM_<band>_rx.json
    """
    cutoff = datetime.now(timezone.utc).replace(tzinfo=None)
    deleted = 0
    for fname in os.listdir(SPOTS_DIR):
        if not (fname.startswith('spots_') and (fname.endswith('.json') or fname.endswith('.csv'))):
            continue
        stem = fname.replace('.json', '').replace('.csv', '')
        m = re.match(r'spots_(\d{8}_\d{4})', stem)
        if not m:
            continue
        try:
            file_dt = datetime.strptime(m.group(1), '%Y%m%d_%H%M')
        except ValueError:
            continue
        if (cutoff - file_dt).total_seconds() / 60 > 15:
            try:
                os.remove(os.path.join(SPOTS_DIR, fname))
                deleted += 1
            except OSError:
                pass
    if deleted:
        print(f'  Cleaned up {deleted} old spot file(s) from Spot Files/')


# ── PSK Reporter fetching — DISABLED ─────────────────────────────
# PSK Reporter returns one aggregated record per unique (TX, RX) pair, not
# individual decodes.  Over 65 min on 20m this yields ~400 unique circuits vs
# WSPR's 16k raw decodes.  Extending the window misaligns PSK with the
# ITURHFProp UTC-hour prediction.  May revisit later.
if False:  # noqa — preserved for future use
    import xml.etree.ElementTree as ET  # already imported at top level

    def maidenhead_to_latlon(loc):
        """Return (lat, lon) center of a 4- or 6-character Maidenhead grid square."""
        if not loc or len(loc) < 4:
            return None, None
        loc = loc.upper().strip()
        try:
            lon = (ord(loc[0]) - ord('A')) * 20 - 180
            lat = (ord(loc[1]) - ord('A')) * 10 - 90
            lon += int(loc[2]) * 2
            lat += int(loc[3]) * 1
            if len(loc) >= 6:
                lon += (ord(loc[4]) - ord('A')) * 5 / 60
                lat += (ord(loc[5]) - ord('A')) * 2.5 / 60
                lon += 2.5 / 60
                lat += 1.25 / 60
            else:
                lon += 1.0
                lat += 0.5
            return lat, lon
        except (IndexError, ValueError):
            return None, None

    def _fetch_psk_raw(fmin, fmax, locator_prefix, locator_type='receiver'):
        """Single PSK Reporter query for one locator prefix and direction.

        locator_type='receiver' → filter by receiverLocator (W3USR area is receiving)
        locator_type='sender'   → filter by senderLocator   (W3USR area is transmitting)
        """
        PSK_API = 'https://retrieve.pskreporter.info/query'
        loc_key = 'receiverLocator' if locator_type == 'receiver' else 'senderLocator'
        params = urllib.parse.urlencode({
            'frange':           f'{fmin}-{fmax}',
            loc_key:            locator_prefix,
            'flowStartSeconds': '-3900',
            'rronly':           '1',
            'rptlimit':         '5000',
            'appcontact':       'liam.miller@scranton.edu',
        })
        url = f'{PSK_API}?{params}'
        req = urllib.request.Request(url, headers={
            'User-Agent': 'HamSCI-Assimilation/1.0 (liam.miller@scranton.edu)',
            'Accept':     'application/xml, */*',
        })
        with urllib.request.urlopen(req, timeout=30) as resp:
            return resp.read().decode('utf-8')

    def fetch_psk_spots_for_band(band_code):
        """Fetch PSK Reporter FT8/FT4 spots to/from stations in the W3USR area, bidirectionally.

        Direction A (receiverLocator=FN/FM): W3USR area stations are receiving globally
          → the sender (TX) is the remote end; stored in rx_lat/rx_lon for plotting.
        Direction B (senderLocator=FN/FM): W3USR area stations are transmitting globally
          → the receiver (RX) is the remote end; stored in rx_lat/rx_lon for plotting.
        In both cases rx_lat/rx_lon holds the remote station's location.
        """
        BAND_PSK_FRANGES = {
            1: (1_838_000, 1_845_000), 3: (3_570_000, 3_580_000),
            7: (7_040_000, 7_080_000), 14: (14_070_000, 14_085_000),
            21: (21_074_000, 21_145_000), 28: (28_074_000, 28_185_000),
        }
        fmin, fmax = BAND_PSK_FRANGES.get(band_code, (0, 0))
        if fmin == 0:
            return []
        spots = []

        # Direction A: W3USR area is receiving — plot sender (global TX) locations
        raw_bodies_a = []
        for prefix in ('FN', 'FM'):
            try:
                raw_bodies_a.append(_fetch_psk_raw(fmin, fmax, prefix, locator_type='receiver'))
            except Exception as exc:
                print(f'  PSK Reporter recv-fetch ({prefix}) failed: {exc}')
        seen_a = set()
        for body in raw_bodies_a:
            try:
                root = ET.fromstring(body)
            except ET.ParseError:
                continue
            for rr in root.findall('.//receptionReport'):
                rx_loc = rr.get('receiverLocator', '')
                rx_lat, rx_lon = maidenhead_to_latlon(rx_loc)
                if rx_lat is None or not (36.5 <= rx_lat <= 46.5 and -77.5 <= rx_lon <= -72.5):
                    continue
                tx_loc = rr.get('senderLocator', '')
                tx_lat, tx_lon = maidenhead_to_latlon(tx_loc)
                if tx_lat is None:
                    continue
                try:
                    snr = float(rr.get('sNR', 0))
                    freq_hz = int(rr.get('frequency', 0))
                    ts = int(rr.get('flowStartSeconds', 0))
                except (ValueError, TypeError):
                    continue
                tx_sign = rr.get('senderCallsign', '')
                rx_sign = rr.get('receiverCallsign', '')
                key = (tx_sign, rx_sign, ts)
                if key in seen_a:
                    continue
                seen_a.add(key)
                spots.append({
                    'time': ts, 'band': band_code,
                    'rx_sign': tx_sign, 'rx_lat': tx_lat, 'rx_lon': tx_lon,
                    'tx_sign': rx_sign, 'tx_lat': rx_lat, 'tx_lon': rx_lon,
                    'snr': snr, 'frequency': freq_hz / 1e6, 'mode': rr.get('mode', ''),
                })

        # Direction B: W3USR area is transmitting — plot receiver (global RX) locations
        raw_bodies_b = []
        for prefix in ('FN', 'FM'):
            try:
                raw_bodies_b.append(_fetch_psk_raw(fmin, fmax, prefix, locator_type='sender'))
            except Exception as exc:
                print(f'  PSK Reporter send-fetch ({prefix}) failed: {exc}')
        seen_b = set()
        for body in raw_bodies_b:
            try:
                root = ET.fromstring(body)
            except ET.ParseError:
                continue
            for rr in root.findall('.//receptionReport'):
                tx_loc = rr.get('senderLocator', '')
                tx_lat, tx_lon = maidenhead_to_latlon(tx_loc)
                if tx_lat is None or not (36.5 <= tx_lat <= 46.5 and -77.5 <= tx_lon <= -72.5):
                    continue
                rx_loc = rr.get('receiverLocator', '')
                rx_lat, rx_lon = maidenhead_to_latlon(rx_loc)
                if rx_lat is None:
                    continue
                try:
                    snr = float(rr.get('sNR', 0))
                    freq_hz = int(rr.get('frequency', 0))
                    ts = int(rr.get('flowStartSeconds', 0))
                except (ValueError, TypeError):
                    continue
                tx_sign = rr.get('senderCallsign', '')
                rx_sign = rr.get('receiverCallsign', '')
                key = (tx_sign, rx_sign, ts)
                if key in seen_b:
                    continue
                seen_b.add(key)
                spots.append({
                    'time': ts, 'band': band_code,
                    'rx_sign': rx_sign, 'rx_lat': rx_lat, 'rx_lon': rx_lon,
                    'tx_sign': tx_sign, 'tx_lat': tx_lat, 'tx_lon': tx_lon,
                    'snr': snr, 'frequency': freq_hz / 1e6, 'mode': rr.get('mode', ''),
                })

        if spots:
            latest_ts = max(s['time'] for s in spots)
            cycle_dt = datetime.fromtimestamp(latest_ts, tz=timezone.utc)
            file_tag = cycle_dt.strftime('%Y%m%d_%H%M')
            band_name = BAND_NAMES.get(band_code, f'band{band_code}')
            json_path = os.path.join(SPOTS_DIR, f'psk_reporter_{file_tag}_{band_name}.json')
            csv_path = os.path.join(SPOTS_DIR, f'psk_reporter_{file_tag}_{band_name}.csv')
            with open(json_path, 'w', encoding='utf-8') as f:
                json.dump(spots, f, indent=2, default=str)
            with open(csv_path, 'w', newline='', encoding='utf-8') as f:
                writer = csv.DictWriter(f, fieldnames=list(spots[0].keys()))
                writer.writeheader()
                writer.writerows(spots)
            print(f'  Saved {len(spots)} PSK Reporter spots ({band_name}) → {json_path}')
        return spots


# ── Spot binning ──────────────────────────────────────────────────
def bin_spots_by_band(spots):
    """Bin RX spots into 5° cells, grouped by band code."""
    band_bins = {}  # (band, lat_bin, lon_bin) → {count, snrs}
    for spot in spots:
        try:
            band   = int(spot['band'])
            rx_lat = float(spot['rx_lat'])
            rx_lon = float(spot['rx_lon'])
            snr    = float(spot['snr'])
        except (KeyError, ValueError, TypeError):
            continue
        if band not in ALL_BANDS:
            continue
        key = (band, math.floor(rx_lat / 5) * 5, math.floor(rx_lon / 5) * 5)
        if key not in band_bins:
            band_bins[key] = {'count': 0, 'snrs': []}
        band_bins[key]['count'] += 1
        band_bins[key]['snrs'].append(snr)

    result = {}
    for band in ALL_BANDS:
        bcr_grid, snr_grid, all_snrs = [], [], []
        for (b, lat, lon), data in band_bins.items():
            if b != band:
                continue
            bcr_grid.append({'lat': lat, 'lon': lon, 'value': data['count']})
            med_snr = statistics.median(data['snrs'])
            snr_grid.append({'lat': lat, 'lon': lon, 'value': med_snr})
            all_snrs.append(med_snr)
        counts = [c['value'] for c in bcr_grid]
        result[band] = {
            'bcr': bcr_grid,
            'snr': snr_grid,
            'meta': {
                'bcr_max': max(counts)   if counts   else 1,
                'snr_min': min(all_snrs) if all_snrs else -30,
                'snr_max': max(all_snrs) if all_snrs else 0,
            },
        }
    return result


# ── ITURHFProp prediction (no main dashboard required) ────────────
def _to_wsl(win_path):
    drive, rest = os.path.splitdrive(win_path)
    return '/mnt/' + drive[0].lower() + rest.replace('\\', '/')


def parse_area_data(text, resolution):
    col_lat = col_lon = col_bcr = col_snr = col_pr = None
    in_fmt = False
    for line in text.splitlines():
        if 'Data Format' in line and 'End' not in line:
            in_fmt = True; continue
        if in_fmt and 'End Data Format' in line:
            break
        if in_fmt:
            m = re.match(r'\s*Column\s+(\d+):\s*(.+)', line)
            if m:
                idx  = int(m.group(1)) - 1
                desc = m.group(2).upper()
                if ('LAT' in desc or 'LATITUDE' in desc) and 'TX' not in desc and col_lat is None:
                    col_lat = idx
                if ('LON' in desc or 'LONGITUDE' in desc) and 'TX' not in desc and col_lon is None:
                    col_lon = idx
                if 'BCR'      in desc and col_bcr is None: col_bcr = idx
                if 'SNR'      in desc and col_snr is None: col_snr = idx
                if 'RECEIVER' in desc and 'POWER' in desc and col_pr is None: col_pr = idx

    if None in (col_lat, col_lon, col_bcr):
        return None

    res  = int(resolution)
    lats = list(range(-90,  91, res))
    lons = list(range(-180, 181, res))
    nla, nlo = len(lats), len(lons)

    bcr = [[[None] * nlo for _ in range(nla)] for _ in range(24)]
    snr = [[[None] * nlo for _ in range(nla)] for _ in range(24)]
    pr  = [[[None] * nlo for _ in range(nla)] for _ in range(24)]

    in_data = False
    for line in text.splitlines():
        if 'Calculated Parameters' in line and 'End' not in line:
            in_data = True; continue
        if in_data and 'End Calculated Parameters' in line:
            break
        if not in_data:
            continue
        line = line.strip()
        if not line or not line[0].isdigit():
            continue
        parts = [p.strip() for p in line.split(',')]
        try:
            hour = int(parts[1])
            lat  = float(parts[col_lat])
            lon  = float(parts[col_lon])
            if hour < 1 or hour > 24:
                continue
            hi  = hour - 1
            lai = round((lat  - (-90))  / res)
            loi = round((lon  - (-180)) / res)
            if not (0 <= lai < nla and 0 <= loi < nlo):
                continue
            bcr[hi][lai][loi] = float(parts[col_bcr])
            if col_snr is not None: snr[hi][lai][loi] = float(parts[col_snr])
            if col_pr  is not None: pr[hi][lai][loi]  = float(parts[col_pr])
        except (IndexError, ValueError):
            continue

    return {'bcr': bcr, 'snr': snr, 'pr': pr, 'lats': lats, 'lons': lons}


def run_area_prediction(params):
    data_path = os.path.join(PROJECT_ROOT, 'itu_r_hf', 'ITURHFProp', 'Data') + os.sep
    tmp_dir   = os.path.join(PROJECT_ROOT, 'itu_r_hf', 'tmp')
    os.makedirs(tmp_dir, exist_ok=True)

    on_windows = platform.system() == 'Windows'
    linux_dir  = os.path.join(PROJECT_ROOT, 'itu_r_hf', 'ITURHFProp', 'Linux')

    if on_windows:
        wsl_exe           = _to_wsl(os.path.join(linux_dir, 'ITURHFProp'))
        wsl_lib           = _to_wsl(linux_dir)
        in_file_data_path = _to_wsl(data_path.rstrip(os.sep)) + '/'
        in_file_rpt_path  = _to_wsl(tmp_dir) + '/'
    else:
        exe_path          = os.path.join(linux_dir, 'ITURHFProp')
        lib_path          = linux_dir
        in_file_data_path = data_path
        in_file_rpt_path  = tmp_dir + '/'

    tx_power_dbkw = round(10 * math.log10(params['tx_power_w'] / 1000.0), 3)
    res = params['resolution']

    in_content = (
        f'PathName "Area Prediction"\n'
        f'PathTXName "Transmitter"\n'
        f'Path.L_tx.lat {params["tx_lat"]}\n'
        f'Path.L_tx.lng {params["tx_lng"]}\n'
        f'TXAntFilePath "ISOTROPIC"\n'
        f'TXGOS {params["tx_gain"]}\n'
        f'PathRXName "Receiver"\n'
        f'Path.L_rx.lat 0.0\n'
        f'Path.L_rx.lng 0.0\n'
        f'RXAntFilePath "ISOTROPIC"\n'
        f'RXGOS {params["rx_gain"]}\n'
        f'AntennaOrientation "TX2RX"\n'
        f'Path.year {params["year"]}\n'
        f'Path.month {params["month"]}\n'
        f'Path.hour 1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24\n'
        f'Path.SSN {params["ssn"]}\n'
        f'Path.frequency {params["freq"]}\n'
        f'Path.txpower {tx_power_dbkw}\n'
        f'Path.BW {float(params["bw"])}\n'
        f'Path.SNRr {float(params["snr_req"])}\n'
        f'Path.SNRXXp 50\n'
        f'Path.ManMadeNoise "{params["noise_env"]}"\n'
        f'Path.Modulation "ANALOG"\n'
        f'Path.SIRr 0.0\n'
        f'Path.A 0.0\n'
        f'Path.TW 0.0\n'
        f'Path.FW 0.0\n'
        f'Path.T0 0.0\n'
        f'Path.F0 0.0\n'
        f'Path.SorL "SHORTPATH"\n'
        f'RptFileFormat "RPT_RXLOCATION | RPT_BCR | RPT_SNR | RPT_PR"\n'
        f'LL.lat -90\n'
        f'LL.lng -180\n'
        f'LR.lat -90\n'
        f'LR.lng 180\n'
        f'UL.lat 90\n'
        f'UL.lng -180\n'
        f'UR.lat 90\n'
        f'UR.lng 180\n'
        f'latinc {res}\n'
        f'lnginc {res}\n'
        f'DataFilePath "{in_file_data_path}"\n'
        f'RptFilePath "{in_file_rpt_path}"\n'
    )

    run_id   = str(uuid.uuid4())
    in_path  = os.path.join(tmp_dir, f'{run_id}.in')
    out_path = os.path.join(tmp_dir, f'{run_id}.out')

    try:
        with open(in_path, 'w') as f:
            f.write(in_content)

        if on_windows:
            wsl_in  = _to_wsl(in_path)
            wsl_out = _to_wsl(out_path)
            cmd = f'LD_LIBRARY_PATH={wsl_lib} {wsl_exe} -s {wsl_in} {wsl_out}'
            proc = subprocess.run(['wsl', 'bash', '-c', cmd],
                                  capture_output=True, text=True, timeout=300)
        else:
            env = os.environ.copy()
            env['LD_LIBRARY_PATH'] = lib_path + ':' + env.get('LD_LIBRARY_PATH', '')
            proc = subprocess.run([exe_path, '-s', in_path, out_path],
                                  capture_output=True, text=True, timeout=300, env=env)

        if proc.returncode != 0:
            print('--- ITURHFProp input file ---', flush=True)
            print(in_content, flush=True)
            print('--- ITURHFProp stderr ---', flush=True)
            print(proc.stderr, flush=True)
            print('--- ITURHFProp stdout ---', flush=True)
            print(proc.stdout, flush=True)
            raise RuntimeError(
                f'ITURHFProp error (code {proc.returncode}): '
                f'{proc.stderr.strip() or proc.stdout.strip()}'
            )
        if not os.path.exists(out_path):
            raise RuntimeError('Output file was not created.')

        with open(out_path, 'r', errors='replace') as f:
            output_text = f.read()

        result = parse_area_data(output_text, res)
        if result is None:
            raise RuntimeError('Failed to parse ITURHFProp output.')
        return result

    finally:
        for path in (in_path, out_path):
            try:
                if os.path.exists(path):
                    os.remove(path)
            except OSError:
                pass


# ── Flask routes ──────────────────────────────────────────────────
@app.route('/')
def index():
    return render_template('heatmap_viewer.html')


@app.route('/api/spots')
def api_spots():
    path = find_latest_spots_file()
    if path is None:
        return jsonify({'error': 'No spots files found — run fetch_spots.py first.'}), 404

    with open(path, encoding='utf-8') as f:
        spots = json.load(f)

    if not spots:
        return jsonify({'error': 'Spots file is empty.'}), 404

    cycle_time = spots[0].get('time', '')
    try:
        year  = int(cycle_time[0:4])
        month = int(cycle_time[5:7])
    except (ValueError, IndexError):
        now   = datetime.now(timezone.utc)
        year, month = now.year, now.month

    # Use the most common UTC hour across all spots
    hours = [int(s['time'][11:13]) for s in spots if 'time' in s and len(s.get('time', '')) >= 13]
    try:
        utc_hour = statistics.mode(hours)
    except statistics.StatisticsError:
        utc_hour = int(cycle_time[11:13]) if len(cycle_time) >= 13 else 0

    bands_present = set(int(s['band']) for s in spots if 'band' in s)

    freqs = [
        {'band': BAND_NAMES[b], 'band_code': b, 'mhz': WSPR_FREQS[b], 'has_spots': b in bands_present}
        for b in ALL_BANDS
    ]

    spot_grids = bin_spots_by_band(spots)

    return jsonify({
        'utc_hour':           utc_hour,
        'year':               year,
        'month':              month,
        'cycle_time':         cycle_time,
        'spot_count':         len(spots),
        'freqs':              freqs,
        'spot_grids_by_band': {str(b): data for b, data in spot_grids.items()},
    })


@app.route('/api/predict', methods=['POST'])
def api_predict():
    data = request.get_json()
    try:
        ssn        = float(data['ssn'])
        freq       = float(data['freq_mhz'])
        tx_power_w = float(data['tx_power_w'])
        utc_hour   = int(data['utc_hour'])
        year       = int(data['year'])
        month      = int(data['month'])
    except (KeyError, ValueError, TypeError) as e:
        return jsonify({'error': f'Invalid parameter: {e}'}), 400

    if not (0 <= ssn <= 400):
        return jsonify({'error': 'SSN must be between 0 and 400.'}), 400
    if not (0.1 <= freq <= 30):
        return jsonify({'error': 'Frequency must be between 0.1 and 30 MHz.'}), 400
    if tx_power_w < 1.0:
        return jsonify({'error': 'TX power must be at least 1 W (30 dBm).'}), 400

    try:
        area = run_area_prediction({
            'tx_lat': 41.5, 'tx_lng': -75.0,
            'tx_gain': 2.15, 'rx_gain': 2.15,
            'year': year, 'month': month,
            'ssn': ssn, 'tx_power_w': tx_power_w,
            'bw': 2500, 'snr_req': -29,
            'noise_env': 'RESIDENTIAL',
            'freq': freq,
            'resolution': 5,
        })
    except subprocess.TimeoutExpired:
        return jsonify({'error': 'Prediction timed out after 300 seconds.'}), 500
    except RuntimeError as e:
        return jsonify({'error': str(e)}), 500

    lats = area['lats']
    lons = area['lons']
    h    = max(utc_hour - 1, 0)

    bcr_slice = area['bcr'][h] if area.get('bcr') else None
    snr_slice = area['snr'][h] if area.get('snr') else None

    snr_vals = [v for row in snr_slice for v in row if v is not None] if snr_slice else []

    return jsonify({
        'lats': lats,
        'lons': lons,
        'pred_grid': {'bcr': bcr_slice, 'snr': snr_slice},
        'pred_grid_meta': {
            'snr_min': min(snr_vals) if snr_vals else -30,
            'snr_max': max(snr_vals) if snr_vals else 40,
        },
    })


@app.route('/api/compute', methods=['POST'])
def api_compute():
    data = request.get_json()
    try:
        ssn        = float(data['ssn'])
        freq       = float(data['freq_mhz'])
        tx_power_w = float(data['tx_power_w'])
        band_code  = int(data['band_code'])
    except (KeyError, ValueError, TypeError) as e:
        return jsonify({'error': f'Invalid parameter: {e}'}), 400

    if not (0 <= ssn <= 400):
        return jsonify({'error': 'SSN must be between 0 and 400.'}), 400
    if not (0.1 <= freq <= 30):
        return jsonify({'error': 'Frequency must be between 0.1 and 30 MHz.'}), 400
    if tx_power_w < 1.0:
        return jsonify({'error': 'TX power must be at least 1 W (30 dBm).'}), 400
    if band_code not in ALL_BANDS:
        return jsonify({'error': f'Invalid band code: {band_code}'}), 400

    cleanup_old_spots()

    try:
        spots = fetch_spots_for_band(band_code)
    except Exception as exc:
        return jsonify({'error': f'Failed to fetch spots: {exc}'}), 500

    if not spots:
        return jsonify({'error': 'No spots returned for this band in the last hour.'}), 404

    cycle_time = spots[0].get('time', '')
    try:
        year  = int(cycle_time[0:4])
        month = int(cycle_time[5:7])
    except (ValueError, IndexError):
        now   = datetime.now(timezone.utc)
        year, month = now.year, now.month

    hours = [int(s['time'][11:13]) for s in spots if 'time' in s and len(s.get('time', '')) >= 13]
    try:
        utc_hour = statistics.mode(hours)
    except statistics.StatisticsError:
        utc_hour = int(cycle_time[11:13]) if len(cycle_time) >= 13 else 0

    spot_grids = bin_spots_by_band(spots)

    # PSK Reporter disabled — see BAND_PSK_FRANGES comment above
    # psk_spots      = []
    # psk_spot_count = 0
    # psk_cycle_time = None
    # try:
    #     psk_spots = fetch_psk_spots_for_band(band_code)
    #     psk_spot_count = len(psk_spots)
    #     if psk_spots:
    #         latest_ts  = max(s['time'] for s in psk_spots)
    #         psk_cycle_time = datetime.fromtimestamp(latest_ts, tz=timezone.utc).strftime('%Y-%m-%d %H:%M:%S')
    # except Exception as exc:
    #     app.logger.warning(f'PSK Reporter fetch failed: {exc}')
    # psk_grids = bin_spots_by_band(psk_spots) if psk_spots else {}

    try:
        area = run_area_prediction({
            'tx_lat': 41.5, 'tx_lng': -75.0,
            'tx_gain': 2.15, 'rx_gain': 2.15,
            'year': year, 'month': month,
            'ssn': ssn, 'tx_power_w': tx_power_w,
            'bw': 2500, 'snr_req': -29,
            'noise_env': 'RESIDENTIAL',
            'freq': freq,
            'resolution': 5,
        })
    except subprocess.TimeoutExpired:
        return jsonify({'error': 'Prediction timed out after 300 seconds.'}), 500
    except RuntimeError as e:
        return jsonify({'error': str(e)}), 500

    lats = area['lats']
    lons = area['lons']
    h    = max(utc_hour - 1, 0)

    bcr_slice = area['bcr'][h] if area.get('bcr') else None
    snr_slice = area['snr'][h] if area.get('snr') else None
    snr_vals  = [v for row in snr_slice for v in row if v is not None] if snr_slice else []

    return jsonify({
        'utc_hour':               utc_hour,
        'year':                   year,
        'month':                  month,
        'cycle_time':             cycle_time,
        'spot_count':             len(spots),
        'spot_grids_by_band':     {str(b): gdata for b, gdata in spot_grids.items()},
        # 'psk_spot_count':         psk_spot_count,         # PSK Reporter disabled
        # 'psk_cycle_time':         psk_cycle_time,
        # 'psk_spot_grids_by_band': {str(b): gdata for b, gdata in psk_grids.items()},
        'lats':                   lats,
        'lons':                   lons,
        'pred_grid':              {'bcr': bcr_slice, 'snr': snr_slice},
        'pred_grid_meta': {
            'snr_min': min(snr_vals) if snr_vals else -30,
            'snr_max': max(snr_vals) if snr_vals else 40,
        },
    })


if __name__ == '__main__':
    cleanup_old_spots()
    app.run(debug=True, port=5001)
