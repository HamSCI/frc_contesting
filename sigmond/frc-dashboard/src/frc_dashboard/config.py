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
