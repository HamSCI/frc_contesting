"""
Native config for frc-dashboard (CLIENT-CONTRACT §1).

/etc/frc-dashboard/frc-dashboard-config.toml holds only the web-server knobs.
Station identity defaults to sigmond's coordination.env (STATION_*), and the
MongoDB connection comes from /etc/frc-contesting/mongodb.env — the same
credentials frc-spot-store writes with.
"""

from __future__ import annotations

import copy
import os
import tomllib
from pathlib import Path

CLIENT = 'frc-dashboard'
CONFIG_PATH = Path(os.environ.get('FRC_DASHBOARD_CONFIG', f'/etc/{CLIENT}/{CLIENT}-config.toml'))
MONGODB_ENV_PATH = Path('/etc/frc-contesting/mongodb.env')
COORDINATION_ENV_PATH = Path('/etc/sigmond/coordination.env')

# sigmond/frc-dashboard/src/frc_dashboard/config.py → repository root
DEFAULT_APP_ROOT = Path(__file__).resolve().parents[4]

DEFAULTS: dict = {
    'server': {
        'bind': '0.0.0.0',
        'port': 5000,
        'workers': 2,
        'threads': 4,
        'timeout_sec': 120,
    },
    'station': {
        # Blank → STATION_REPORTER_ID / STATION_CALL and STATION_GRID
        'callsign': '',
        'grid_square': '',
    },
    'app': {
        # Blank → the frc_contesting checkout that contains this client
        'root': '',
    },
    'waterfall': {
        # Contest-band waterfalls from radiod spectrum channels (ka9q-python).
        # Channels exist only while someone has the Waterfall tab open.
        'enabled': True,
        'radiod_status': '',        # blank → SIGMOND_RADIOD_STATUS
        'bands': '160m,80m,40m,20m,15m,10m',
        'bins': 800,                # max per band; actual is FFT-size optimised
        'poll_sec': 2.0,            # one waterfall row per poll
        'averaging': 2,             # FFTs per row; 2 x 6 bands / 2 s = 0 radiod drops
        'idle_timeout_sec': 60,     # remove radiod channels after this idle time
        'history_rows': 1800,       # 60 min at 2 s/row; memory only (~1.4 MB/band), no radiod cost
    },
    'listen': {
        # Click-to-listen on the Waterfall tab: one radiod audio channel
        # (USB/LSB/CW/AM, 12 kHz) per listening browser.
        'enabled': True,
        'max_listeners': 2,         # also bounds gunicorn threads held by audio streams
        'idle_timeout_sec': 15,     # remove the channel this long after the browser goes away
    },
    'skimmer': {
        # CW and RTTY skimmers (the /cws page): per band one radiod IQ
        # channel (96-192 kHz) over its CW range and RTTY segment, decoded
        # in its own process.  Spots go to their own MongoDB database.
        'enabled': True,
        # Bands skimmed.  Each costs about 1/4 of a CPU core and one 96-192 kHz
        # radiod IQ channel.  On W3USR-06 (Ryzen 7 5825U VM, radiod pinned to
        # 2 cores at 92-110 %) running them made radiod drop blocks on every
        # channel, the WSPR/FT8 recorders' included: 4-6 bands every minute,
        # 1-2 bands in some minutes.  Measure (sigmond/README.md) before
        # setting always_on or adding bands.
        'bands': '40m,20m',
        'band': '20m',              # band the /cws page shows first
        'always_on': False,         # True: run all the time; False: only while /cws is open
        'idle_timeout_sec': 120,    # with always_on off: stop this long after the last viewer
        'detect_db': 9.0,           # signal detection threshold over the noise, per ~94 Hz bin
        'max_signals': 40,          # CW signals per band
        'max_rtty_signals': 30,     # RTTY signals per band
        'store': True,              # write spots to MongoDB
        'database': 'skimmer_db',   # ...this database (collection "spots"), not wspr_db
        'retention_days': 90,       # spots expire after this (TTL index)
        'spotter': '',              # blank -> station callsign without /suffix (RBN style)
        'scp_file': '',             # optional MASTER.SCP-style call list to confirm calls
        'telnet_port': 0,           # >0: serve confirmed spots in RBN/CW Skimmer telnet format
        'telnet_bind': '127.0.0.1',
    },
}


def deep_merge(base: dict, over: dict) -> dict:
    out = copy.deepcopy(base)
    for k, v in (over or {}).items():
        if isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k] = deep_merge(out[k], v)
        else:
            out[k] = v
    return out


def load_config(path: Path = CONFIG_PATH) -> dict:
    try:
        with open(path, 'rb') as f:
            user = tomllib.load(f)
    except FileNotFoundError:
        user = {}
    return deep_merge(DEFAULTS, user)


def app_root(cfg: dict) -> Path:
    return Path(cfg['app'].get('root') or DEFAULT_APP_ROOT)


def station_env(key: str) -> str | None:
    """STATION_* from the environment (systemd loads coordination.env), else
    read sigmond's coordination.env directly (CLI run from a shell)."""
    if os.environ.get(key):
        return os.environ[key]
    try:
        return read_env_file(COORDINATION_ENV_PATH).get(key) or None
    except OSError:
        return None


def station(cfg: dict) -> tuple[str, str]:
    call = (cfg['station'].get('callsign') or station_env('STATION_REPORTER_ID')
            or station_env('STATION_CALL') or 'Unknown')
    grid = cfg['station'].get('grid_square') or station_env('STATION_GRID') or ''
    return call, grid


def read_env_file(path: Path) -> dict:
    env = {}
    with open(path) as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith('#') or '=' not in line:
                continue
            k, v = line.split('=', 1)
            env[k.strip()] = v.strip().strip('"').strip("'")
    return env


def app_environment(cfg: dict) -> dict:
    """Environment for the Flask app (see app.py / .env.example)."""
    env = dict(os.environ)
    if not env.get('MONGODB_PASSWORD'):
        try:
            env.update({k: v for k, v in read_env_file(MONGODB_ENV_PATH).items()
                        if k not in env})
        except OSError:
            pass
    call, grid = station(cfg)
    env['RECEIVER_CALLSIGN'] = call
    if grid:
        env['RECEIVER_GRIDSQUARE'] = grid
    env.setdefault('FLASK_ENV', 'production')
    env['FLASK_DEBUG'] = 'False'
    return env


def to_toml(cfg: dict) -> str:
    def fmt(v):
        if isinstance(v, bool):
            return 'true' if v else 'false'
        if isinstance(v, (int, float)):
            return repr(v)
        return '"' + str(v).replace('\\', '\\\\').replace('"', '\\"') + '"'

    lines = [f'# {CLIENT} configuration — see config/help.toml for field docs.', '']
    for section, table in cfg.items():
        lines.append(f'[{section}]')
        for k, v in table.items():
            lines.append(f'{k} = {fmt(v)}')
        lines.append('')
    return '\n'.join(lines)
