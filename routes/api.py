"""
JSON API routes for the HamSCI Dashboard.

Provides REST endpoints for fetching spot data in JSON format,
consumed by the frontend JavaScript (map_ft.js, table_ft.js).
"""

import math
import os
import platform
import re
import subprocess
import uuid
from concurrent.futures import ThreadPoolExecutor, as_completed

from flask import Blueprint, current_app, jsonify, request

from services import assimilation
from services.spots import fetch_spots_for_map, fetch_spots_for_table

api_bp = Blueprint('api', __name__)

CONTEST_FREQS = [1.9, 3.6, 7.125, 14.15, 21.2, 28.3]

ALL_CONTEST_BANDS = [
    {'name': '160m', 'freq': 1.9},
    {'name': '80m',  'freq': 3.6},
    {'name': '40m',  'freq': 7.125},
    {'name': '20m',  'freq': 14.15},
    {'name': '15m',  'freq': 21.2},
    {'name': '10m',  'freq': 28.3},
]


def _to_wsl(win_path):
    """Convert a Windows absolute path to its WSL /mnt/... equivalent."""
    drive, rest = os.path.splitdrive(win_path)
    return '/mnt/' + drive[0].lower() + rest.replace('\\', '/')


def maidenhead_to_latlon(grid):
    """Convert a 4- or 6-character Maidenhead locator to (lat, lon) center."""
    grid = grid.strip().upper()
    if len(grid) < 4:
        raise ValueError(f'Grid square must be at least 4 characters: {grid}')
    lon = (ord(grid[0]) - ord('A')) * 20 - 180
    lat = (ord(grid[1]) - ord('A')) * 10 - 90
    lon += int(grid[2]) * 2
    lat += int(grid[3])
    if len(grid) >= 6:
        lon += (ord(grid[4]) - ord('A')) * (2.0 / 24) + (1.0 / 24)
        lat += (ord(grid[5]) - ord('A')) * (1.0 / 24) + (0.5 / 24)
    else:
        lon += 1.0
        lat += 0.5
    return round(lat, 4), round(lon, 4)


# Files ITURHFProp actually opens from DataFilePath at runtime:
#   ionosNN.bin  - monthly foF2/M(3000)F2 maps (P533 ReadIonParametersBin)
#   COEFFNNW.txt - atmospheric noise coefficients (P372 ReadFamDud)
#   P1239-3 Decile Factors.txt - MUF variability deciles (P533 ReadP1239)
REQUIRED_DATA_FILES = (
    [f'ionos{m:02d}.bin' for m in range(1, 13)]
    + [f'COEFF{m:02d}W.txt' for m in range(1, 13)]
    + ['P1239-3 Decile Factors.txt']
)


def _resolve_data_dir(project_root):
    """Return the ITURHFProp data directory, honoring ITURHF_DATA_PATH.

    ITURHF_DATA_PATH (from .env) may name a custom ionosphere data directory,
    absolute or relative to the project root. Falls back to the bundled
    reference Data/ (with a logged warning) if the variable points at a
    missing or incomplete directory.
    """
    default_dir = os.path.join(project_root, 'itu_r_hf', 'ITURHFProp', 'Data')
    custom = os.environ.get('ITURHF_DATA_PATH', '').strip()
    if not custom:
        return default_dir
    if platform.system() == 'Windows' and custom.startswith('/'):
        current_app.logger.warning(
            'ITURHF_DATA_PATH %r looks like a WSL/POSIX path; on Windows use '
            'a Windows-style or repo-relative path. Falling back to bundled '
            'reference data.', custom)
        return default_dir
    custom_dir = os.path.abspath(
        custom if os.path.isabs(custom) else os.path.join(project_root, custom))
    missing = [f for f in REQUIRED_DATA_FILES
               if not os.path.isfile(os.path.join(custom_dir, f))]
    if missing:
        current_app.logger.warning(
            'ITURHF_DATA_PATH=%s is missing %d required file(s) (e.g. %s); '
            'falling back to bundled reference data. Run '
            'scripts/seed_custom_ionosphere.py to seed the directory.',
            custom_dir, len(missing), ', '.join(missing[:3]))
        return default_dir
    return custom_dir


def _iturhfprop_paths(data_dir_override=None):
    """Return platform-specific path info needed to invoke ITURHFProp.

    data_dir_override: if given, use this directory for the ionosphere/noise
    data instead of the ITURHF_DATA_PATH-resolved default. Used by the
    assimilation page to run predictions against the baseline or assimilated
    working copy as selected by the indicator state.
    """
    project_root = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
    data_dir   = data_dir_override if data_dir_override else _resolve_data_dir(project_root)
    data_path  = data_dir.rstrip(os.sep) + os.sep
    tmp_dir    = os.path.join(project_root, 'itu_r_hf', 'tmp')
    linux_dir  = os.path.join(project_root, 'itu_r_hf', 'ITURHFProp', 'Linux')
    os.makedirs(tmp_dir, exist_ok=True)
    if platform.system() == 'Windows':
        return {
            'on_windows':        True,
            'tmp_dir':           tmp_dir,
            'wsl_exe':           _to_wsl(os.path.join(linux_dir, 'ITURHFProp')),
            'wsl_lib':           _to_wsl(linux_dir),
            'in_file_data_path': _to_wsl(data_path.rstrip(os.sep)) + '/',
            'in_file_rpt_path':  _to_wsl(tmp_dir) + '/',
        }
    return {
        'on_windows':        False,
        'tmp_dir':           tmp_dir,
        'exe_path':          os.path.join(linux_dir, 'ITURHFProp'),
        'lib_path':          linux_dir,
        'in_file_data_path': data_path,
        'in_file_rpt_path':  tmp_dir + '/',
    }


def _exec_iturhfprop(in_content, paths, timeout=120):
    """Write in_content to a temp .in file, run ITURHFProp, return output text."""
    tmp_dir  = paths['tmp_dir']
    run_id   = str(uuid.uuid4())
    in_path  = os.path.join(tmp_dir, f'{run_id}.in')
    out_path = os.path.join(tmp_dir, f'{run_id}.out')
    try:
        with open(in_path, 'w') as f:
            f.write(in_content)
        if paths['on_windows']:
            wsl_in  = _to_wsl(in_path)
            wsl_out = _to_wsl(out_path)
            cmd = f'LD_LIBRARY_PATH={paths["wsl_lib"]} {paths["wsl_exe"]} -s {wsl_in} {wsl_out}'
            proc = subprocess.run(['wsl', 'bash', '-c', cmd],
                                  capture_output=True, text=True, timeout=timeout)
        else:
            env = os.environ.copy()
            env['LD_LIBRARY_PATH'] = paths['lib_path'] + ':' + env.get('LD_LIBRARY_PATH', '')
            proc = subprocess.run([paths['exe_path'], '-s', in_path, out_path],
                                  capture_output=True, text=True, timeout=timeout, env=env)
        if proc.returncode != 0:
            stderr = proc.stderr.strip() or proc.stdout.strip()
            raise RuntimeError(f'ITURHFProp exited with code {proc.returncode}: {stderr}')
        if not os.path.exists(out_path):
            raise RuntimeError('Output file was not created. Check input parameters.')
        with open(out_path, 'r', errors='replace') as f:
            return f.read()
    finally:
        for path in (in_path, out_path):
            try:
                if os.path.exists(path):
                    os.remove(path)
            except OSError:
                pass


def parse_chart_data(text):
    """
    Parse ITURHFProp CSV output into chart_data dict.
    Returns {'bcr': 2D list [freq_idx 0-29][hour_idx 0-23],
             'bmuf': list[24], 'opmuf': list[24]}
    or None on parse failure.
    """
    # 1. Find column indices from Data Format section
    col_bcr = col_bmuf = col_opmuf = col_snr = col_pr = None
    in_fmt = False
    for line in text.splitlines():
        if 'Data Format' in line and 'End' not in line:
            in_fmt = True
            continue
        if in_fmt and 'End Data Format' in line:
            break
        if in_fmt:
            m = re.match(r'\s*Column\s+(\d+):\s*(.+)', line)
            if m:
                idx = int(m.group(1)) - 1   # 0-based
                desc = m.group(2).upper()
                if 'BCR' in desc and col_bcr is None:
                    col_bcr = idx
                if 'BMUF' in desc and col_bmuf is None:
                    col_bmuf = idx
                if 'OPMUF' in desc and col_opmuf is None:
                    col_opmuf = idx
                if 'SNR' in desc and col_snr is None:
                    col_snr = idx
                if 'RECEIVER' in desc and col_pr is None:
                    col_pr = idx

    if None in (col_bcr, col_bmuf, col_opmuf):
        return None

    # 2. Parse data rows
    # bcr[freq_idx][hour_idx]  freq_idx = round(freq)-1  hour_idx = hour-1
    bcr   = [[None] * 24 for _ in range(30)]
    bmuf  = [None] * 24
    opmuf = [None] * 24
    snr   = [[None] * 24 for _ in range(30)]
    pr    = [[None] * 24 for _ in range(30)]

    in_data = False
    for line in text.splitlines():
        if 'Calculated Parameters' in line and 'End' not in line:
            in_data = True
            continue
        if in_data and 'End Calculated Parameters' in line:
            break
        if not in_data:
            continue
        line = line.strip()
        if not line or not line[0].isdigit():
            continue
        parts = [p.strip() for p in line.split(',')]
        try:
            hour = int(parts[1])            # UTC hour 1-24
            freq = round(float(parts[2]))   # MHz, 1-30
            if hour < 1 or hour > 24 or freq < 1 or freq > 30:
                continue
            hi = hour - 1
            fi = freq - 1
            bcr[fi][hi]  = float(parts[col_bcr])
            bmuf[hi]     = float(parts[col_bmuf])
            opmuf[hi]    = float(parts[col_opmuf])
            if col_snr is not None:
                snr[fi][hi] = float(parts[col_snr])
            if col_pr is not None:
                pr[fi][hi]  = float(parts[col_pr])
        except (IndexError, ValueError):
            continue

    return {'bcr': bcr, 'bmuf': bmuf, 'opmuf': opmuf, 'snr': snr, 'pr': pr}


def parse_area_data(text, resolution):
    """
    Parse ITURHFProp area-mode CSV output into a structured dict.

    Area-mode rows vary by (hour, rx_lat, rx_lon) rather than (hour, freq).
    Returns:
        {
          'bcr':  [24][nLa][nLo],
          'snr':  [24][nLa][nLo],
          'pr':   [24][nLa][nLo],
          'lats': list of lat values (-90..90 step res),
          'lons': list of lon values (-180..180 step res),
        }
    or None on parse failure.
    """
    col_lat = col_lon = col_bcr = col_snr = col_pr = None
    in_fmt = False
    for line in text.splitlines():
        if 'Data Format' in line and 'End' not in line:
            in_fmt = True
            continue
        if in_fmt and 'End Data Format' in line:
            break
        if in_fmt:
            m = re.match(r'\s*Column\s+(\d+):\s*(.+)', line)
            if m:
                idx  = int(m.group(1)) - 1   # 0-based
                desc = m.group(2).upper()
                # RX lat/lon — exclude TX columns
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
    lats = list(range(-90,  91, res))   # e.g. [-90, -75, ..., 90]
    lons = list(range(-180, 181, res))  # e.g. [-180, -165, ..., 180]
    nla  = len(lats)
    nlo  = len(lons)

    bcr = [[[None] * nlo for _ in range(nla)] for _ in range(24)]
    snr = [[[None] * nlo for _ in range(nla)] for _ in range(24)]
    pr  = [[[None] * nlo for _ in range(nla)] for _ in range(24)]

    in_data = False
    for line in text.splitlines():
        if 'Calculated Parameters' in line and 'End' not in line:
            in_data = True
            continue
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
            if col_snr is not None:
                snr[hi][lai][loi] = float(parts[col_snr])
            if col_pr is not None:
                pr[hi][lai][loi]  = float(parts[col_pr])
        except (IndexError, ValueError):
            continue

    return {'bcr': bcr, 'snr': snr, 'pr': pr, 'lats': lats, 'lons': lons}


@api_bp.route('/config')
def config():
    return jsonify({
        'receiver_callsign': current_app.config.get('RECEIVER_CALLSIGN', 'Unknown'),
        'receiver_grid': current_app.config.get('RECEIVER_GRIDSQUARE', 'Unknown'),
    })


@api_bp.route('/spots')
def spots():
    """
    REST API endpoint: Fetch spots for map display.

    Query Parameters:
        lastInterval (str): Minutes to look back (default: "15")

    Returns:
        JSON: Array of spot objects with full TX/RX details

    Example:
        GET /spots?lastInterval=30
        Returns spots from the last 30 minutes
    """
    last_interval = request.args.get('lastInterval', '15')
    data = fetch_spots_for_map(last_interval=last_interval)
    return jsonify(data)


@api_bp.route('/tbspots')
def tbspots():
    """
    REST API endpoint: Fetch spots for table display.

    Optimized endpoint for table view with simplified data structure
    including CQ zone information for regional aggregation.

    Query Parameters:
        lastInterval (str): Minutes to look back (default: "15")

    Returns:
        JSON: Array of spot objects with band, grid, time, cq_zone, mode

    Example:
        GET /tbspots?lastInterval=15
        Returns spots from the last 15 minutes formatted for table view
    """
    last_interval = request.args.get('lastInterval', '15')
    data = fetch_spots_for_table(last_interval=last_interval)
    return jsonify(data)


@api_bp.route('/api/predict/p2p', methods=['POST'])
def predict_p2p():
    """
    Run a point-to-point HF propagation prediction via ITURHFProp.

    Accepts JSON with form parameters, builds a .in input file, runs the
    ITURHFProp binary as a subprocess, and returns the raw output text.

    Returns:
        JSON: {"output": "<text>"} on success, {"error": "<msg>"} on failure
    """
    return _predict_p2p_core(request.get_json(force=True))


def _predict_p2p_core(data, data_dir_override=None):
    """
    Core point-to-point prediction logic shared by /api/predict/p2p and the
    assimilation page. data_dir_override selects an alternate ionosphere data
    directory (baseline vs assimilated); None uses the ITURHF_DATA_PATH default.
    """
    # --- Validate required fields ---
    required = ['tx_lat', 'tx_lng', 'rx_lat', 'rx_lng',
                'year', 'month', 'ssn', 'tx_power_w',
                'bw', 'snr', 'path_type', 'noise_env',
                'freq_mode', 'rpt_options']
    missing = [f for f in required if data.get(f) is None]
    if missing:
        return jsonify({'error': 'Missing fields: ' + ', '.join(missing)}), 400

    freq_mode = data['freq_mode']
    if freq_mode == 'single' and not data.get('single_freq'):
        return jsonify({'error': 'Missing field: single_freq'}), 400
    if not data['rpt_options']:
        return jsonify({'error': 'At least one output option required'}), 400

    # --- Derive paths (WSL on Windows, direct on Linux) ---
    paths = _iturhfprop_paths(data_dir_override=data_dir_override)
    in_file_data_path = paths['in_file_data_path']
    in_file_rpt_path  = paths['in_file_rpt_path']

    # --- Convert TX power: Watts → dB(kW) ---
    watts = float(data['tx_power_w'])
    if watts <= 0:
        return jsonify({'error': 'TX Power must be greater than 0'}), 400
    tx_power_dbkw = round(10 * math.log10(watts / 1000.0), 3)

    # --- Merge chart-required metrics with user's selected options ---
    required_chart = ['RPT_BMUF', 'RPT_OPMUF', 'RPT_BCR', 'RPT_SNR', 'RPT_PR']
    merged_options = list(dict.fromkeys(required_chart + data['rpt_options']))
    rpt_format = ' | '.join(merged_options)

    rx_lat = float(data['rx_lat'])
    rx_lng = float(data['rx_lng'])

    def _execute(freq_string):
        """Run ITURHFProp with the given frequency string; return output text."""
        in_content = (
            f'PathName "P2P Prediction"\n'
            f'PathTXName "Transmitter"\n'
            f'Path.L_tx.lat {float(data["tx_lat"])}\n'
            f'Path.L_tx.lng {float(data["tx_lng"])}\n'
            f'TXAntFilePath "ISOTROPIC"\n'
            f'TXGOS {float(data.get("tx_gain", 0))}\n'
            f'PathRXName "Receiver"\n'
            f'Path.L_rx.lat {rx_lat}\n'
            f'Path.L_rx.lng {rx_lng}\n'
            f'RXAntFilePath "ISOTROPIC"\n'
            f'RXGOS {float(data.get("rx_gain", 0))}\n'
            f'AntennaOrientation "TX2RX"\n'
            f'Path.year {int(data["year"])}\n'
            f'Path.month {int(data["month"])}\n'
            f'Path.hour 1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24\n'
            f'Path.SSN {float(data["ssn"])}\n'
            f'Path.frequency {freq_string}\n'
            f'Path.txpower {tx_power_dbkw}\n'
            f'Path.BW {float(data["bw"])}\n'
            f'Path.SNRr {float(data["snr"])}\n'
            f'Path.SNRXXp 50\n'
            f'Path.ManMadeNoise "{data["noise_env"]}"\n'
            f'Path.Modulation "ANALOG"\n'
            f'Path.SIRr 0.0\n'
            f'Path.A 0.0\n'
            f'Path.TW 0.0\n'
            f'Path.FW 0.0\n'
            f'Path.T0 0.0\n'
            f'Path.F0 0.0\n'
            f'Path.SorL "{data["path_type"]}"\n'
            f'RptFileFormat "{rpt_format}"\n'
            f'LL.lat {rx_lat}\n'
            f'LL.lng {rx_lng}\n'
            f'LR.lat {rx_lat}\n'
            f'LR.lng {rx_lng}\n'
            f'UL.lat {rx_lat}\n'
            f'UL.lng {rx_lng}\n'
            f'UR.lat {rx_lat}\n'
            f'UR.lng {rx_lng}\n'
            f'latinc 1.0\n'
            f'lnginc 1.0\n'
            f'DataFilePath "{in_file_data_path}"\n'
            f'RptFilePath "{in_file_rpt_path}"\n'
        )
        return _exec_iturhfprop(in_content, paths)

    try:
        chart_freq_str = ','.join(str(f) for f in range(1, 31))

        # Chart always uses 1-30 integers for the full heatmap grid.
        # For contest/single, run a second pass with the exact frequencies
        # so the text output shows accurate per-frequency results.
        chart_output = _execute(chart_freq_str)
        chart_data   = parse_chart_data(chart_output)

        if freq_mode == 'contest':
            contest_freqs = data.get('contest_freqs') or CONTEST_FREQS
            output_text = _execute(','.join(str(f) for f in contest_freqs))
        elif freq_mode == 'single':
            output_text = _execute(str(float(data['single_freq'])))
        else:  # spectrum
            output_text = chart_output

        return jsonify({'output': output_text, 'chart_data': chart_data})

    except RuntimeError as e:
        return jsonify({'error': str(e)}), 500
    except subprocess.TimeoutExpired:
        return jsonify({'error': 'Prediction timed out after 120 seconds'}), 500
    except Exception as e:
        return jsonify({'error': str(e)}), 500


# ── Assimilated-Predictions [BETA] ───────────────────────────────────────────

@api_bp.route('/api/assimilation/status')
def assimilation_status():
    """Return the current ionosphere indicator state (baseline vs assimilated)."""
    return jsonify(assimilation.get_status())


@api_bp.route('/api/assimilation/done', methods=['POST'])
def assimilation_done():
    """Record 'Done Predicting': refresh the session timestamp. Returns status."""
    return jsonify(assimilation.mark_done())


@api_bp.route('/api/predict/assimilated/p2p', methods=['POST'])
def predict_assimilated_p2p():
    """
    Point-to-point prediction for the assimilation page. Runs against whichever
    ionosphere the current indicator state selects (pristine baseline when
    'baseline', the assimilated working copy when 'assimilated').
    """
    data_dir = assimilation.resolve_prediction_data_dir()
    return _predict_p2p_core(request.get_json(force=True), data_dir_override=data_dir)


@api_bp.route('/api/predict/area', methods=['POST'])
def predict_area():
    """
    Run an area HF propagation prediction via ITURHFProp.

    Accepts JSON with TX location, time, frequency and signal parameters,
    plus a resolution (degrees). Runs ITURHFProp over a global grid for all
    24 UTC hours and returns BCR/SNR/PR as 3-D arrays [hour][lat][lon].

    Returns:
        JSON: {"output": "<text>", "area_data": {...}} on success,
              {"error": "<msg>"} on failure
    """
    data = request.get_json(force=True)

    required = ['tx_lat', 'tx_lng', 'year', 'month', 'ssn',
                'tx_power_w', 'bw', 'snr', 'noise_env', 'freq', 'resolution']
    missing = [f for f in required if data.get(f) is None]
    if missing:
        return jsonify({'error': 'Missing fields: ' + ', '.join(missing)}), 400

    # --- Derive paths (same pattern as predict_p2p) ---
    paths = _iturhfprop_paths()
    in_file_data_path = paths['in_file_data_path']
    in_file_rpt_path  = paths['in_file_rpt_path']

    watts = float(data['tx_power_w'])
    if watts <= 0:
        return jsonify({'error': 'TX Power must be greater than 0'}), 400
    tx_power_dbkw = round(10 * math.log10(watts / 1000.0), 3)

    res = int(data['resolution'])
    rpt_format = 'RPT_RXLOCATION | RPT_BCR | RPT_SNR | RPT_PR'

    in_content = (
        f'PathName "Area Prediction"\n'
        f'PathTXName "Transmitter"\n'
        f'Path.L_tx.lat {float(data["tx_lat"])}\n'
        f'Path.L_tx.lng {float(data["tx_lng"])}\n'
        f'TXAntFilePath "ISOTROPIC"\n'
        f'TXGOS {float(data.get("tx_gain", 2.15))}\n'
        f'PathRXName "Receiver"\n'
        f'Path.L_rx.lat 0.0\n'
        f'Path.L_rx.lng 0.0\n'
        f'RXAntFilePath "ISOTROPIC"\n'
        f'RXGOS {float(data.get("rx_gain", 2.15))}\n'
        f'AntennaOrientation "TX2RX"\n'
        f'Path.year {int(data["year"])}\n'
        f'Path.month {int(data["month"])}\n'
        f'Path.hour 1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24\n'
        f'Path.SSN {float(data["ssn"])}\n'
        f'Path.frequency {float(data["freq"])}\n'
        f'Path.txpower {tx_power_dbkw}\n'
        f'Path.BW {float(data["bw"])}\n'
        f'Path.SNRr {float(data["snr"])}\n'
        f'Path.SNRXXp 50\n'
        f'Path.ManMadeNoise "{data["noise_env"]}"\n'
        f'Path.Modulation "ANALOG"\n'
        f'Path.SIRr 0.0\n'
        f'Path.A 0.0\n'
        f'Path.TW 0.0\n'
        f'Path.FW 0.0\n'
        f'Path.T0 0.0\n'
        f'Path.F0 0.0\n'
        f'Path.SorL "SHORTPATH"\n'
        f'RptFileFormat "{rpt_format}"\n'
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

    try:
        output_text = _exec_iturhfprop(in_content, paths, timeout=300)

        area_data = parse_area_data(output_text, res)
        if area_data is None:
            return jsonify({'error': 'Failed to parse ITURHFProp area output. Check Data Format section.'}), 500

        return jsonify({'output': output_text, 'area_data': area_data})

    except subprocess.TimeoutExpired:
        return jsonify({'error': 'Prediction timed out after 300 seconds'}), 500
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@api_bp.route('/api/predict/contest', methods=['POST'])
def predict_contest():
    """
    Run batch HF propagation predictions for multiple contest target regions.

    For each target region (defined by a Maidenhead grid square), runs
    ITURHFProp for both short and long paths at the 5 contest bands
    (80/40/20/15/10m) and returns BCR, SNR, and PR for all 24 UTC hours.

    Returns:
        JSON: {"short": {region: {band: {bcr,snr,pr}}}, "long": {...}}
    """
    data = request.get_json(force=True)

    required = ['tx_grid', 'targets', 'month', 'year', 'ssn', 'tx_power_w']
    missing = [f for f in required if data.get(f) is None]
    if missing:
        return jsonify({'error': 'Missing fields: ' + ', '.join(missing)}), 400

    targets = data['targets']
    if not targets:
        return jsonify({'error': 'At least one target required'}), 400

    try:
        tx_lat, tx_lng = maidenhead_to_latlon(data['tx_grid'])
    except ValueError as e:
        return jsonify({'error': str(e)}), 400

    watts = float(data['tx_power_w'])
    if watts <= 0:
        return jsonify({'error': 'TX Power must be greater than 0'}), 400
    tx_power_dbkw = round(10 * math.log10(watts / 1000.0), 3)

    year     = int(data['year'])
    month    = int(data['month'])
    ssn      = float(data['ssn'])
    bw       = float(data.get('bw', 3000))
    snr_req  = float(data.get('snr', 73))
    noise    = data.get('noise_env', 'RURAL')
    tx_gain  = float(data.get('tx_gain', 0))
    rx_gain  = float(data.get('rx_gain', 0))

    requested_bands = data.get('bands')
    active_bands = (
        [b for b in ALL_CONTEST_BANDS if b['name'] in requested_bands]
        if requested_bands else ALL_CONTEST_BANDS
    )
    if not active_bands:
        return jsonify({'error': 'No valid bands selected'}), 400

    freq_str   = ','.join(str(b['freq']) for b in active_bands)
    rpt_format = 'RPT_BMUF | RPT_OPMUF | RPT_BCR | RPT_SNR | RPT_PR'
    paths      = _iturhfprop_paths()

    def build_in(rx_lat, rx_lng, path_type):
        return (
            f'PathName "Contest Prediction"\n'
            f'PathTXName "Transmitter"\n'
            f'Path.L_tx.lat {tx_lat}\n'
            f'Path.L_tx.lng {tx_lng}\n'
            f'TXAntFilePath "ISOTROPIC"\n'
            f'TXGOS {tx_gain}\n'
            f'PathRXName "Receiver"\n'
            f'Path.L_rx.lat {rx_lat}\n'
            f'Path.L_rx.lng {rx_lng}\n'
            f'RXAntFilePath "ISOTROPIC"\n'
            f'RXGOS {rx_gain}\n'
            f'AntennaOrientation "TX2RX"\n'
            f'Path.year {year}\n'
            f'Path.month {month}\n'
            f'Path.hour 1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24\n'
            f'Path.SSN {ssn}\n'
            f'Path.frequency {freq_str}\n'
            f'Path.txpower {tx_power_dbkw}\n'
            f'Path.BW {bw}\n'
            f'Path.SNRr {snr_req}\n'
            f'Path.SNRXXp 50\n'
            f'Path.ManMadeNoise "{noise}"\n'
            f'Path.Modulation "ANALOG"\n'
            f'Path.SIRr 0.0\n'
            f'Path.A 0.0\n'
            f'Path.TW 0.0\n'
            f'Path.FW 0.0\n'
            f'Path.T0 0.0\n'
            f'Path.F0 0.0\n'
            f'Path.SorL "{path_type}"\n'
            f'RptFileFormat "{rpt_format}"\n'
            f'LL.lat {rx_lat}\n'
            f'LL.lng {rx_lng}\n'
            f'LR.lat {rx_lat}\n'
            f'LR.lng {rx_lng}\n'
            f'UL.lat {rx_lat}\n'
            f'UL.lng {rx_lng}\n'
            f'UR.lat {rx_lat}\n'
            f'UR.lng {rx_lng}\n'
            f'latinc 1.0\n'
            f'lnginc 1.0\n'
            f'DataFilePath "{paths["in_file_data_path"]}"\n'
            f'RptFilePath "{paths["in_file_rpt_path"]}"\n'
        )

    def extract_bands(chart_data):
        result = {}
        for band in active_bands:
            fi = round(band['freq']) - 1
            result[band['name']] = {
                'bcr': chart_data['bcr'][fi],
                'snr': chart_data['snr'][fi],
                'pr':  chart_data['pr'][fi],
            }
        return result

    def run_one(target, path_type):
        rx_lat, rx_lng = maidenhead_to_latlon(target['grid'])
        output = _exec_iturhfprop(build_in(rx_lat, rx_lng, path_type), paths)
        cd = parse_chart_data(output)
        return target['name'], path_type, (extract_bands(cd) if cd else None)

    short_results, long_results, warnings = {}, {}, []

    with ThreadPoolExecutor(max_workers=4) as executor:
        futures = {}
        for t in targets:
            futures[executor.submit(run_one, t, 'SHORTPATH')] = (t['name'], 'short')
            futures[executor.submit(run_one, t, 'LONGPATH')]  = (t['name'], 'long')
        for future in as_completed(futures):
            try:
                name, path_type, band_data = future.result()
                key = 'short' if path_type == 'SHORTPATH' else 'long'
                (short_results if key == 'short' else long_results)[name] = band_data
            except Exception as e:
                tname, ptype = futures[future]
                warnings.append(f'{tname} ({ptype.lower()}): {e}')

    resp = {'short': short_results, 'long': long_results}
    if warnings:
        resp['warnings'] = warnings
    return jsonify(resp)
