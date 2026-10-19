"""
Native config for frc-spot-store (CLIENT-CONTRACT §1).

Config lives at /etc/frc-spot-store/frc-spot-store-config.toml.  Station identity and
MongoDB connection facts are NOT in this file: they come from the environment
(/etc/sigmond/coordination.env and /etc/frc-contesting/mongodb.env), which the
systemd unit loads.
"""

from __future__ import annotations

import copy
import os
import tomllib
from pathlib import Path
from urllib.parse import quote_plus

CLIENT = 'frc-spot-store'
CONFIG_PATH = Path(os.environ.get('FRC_SPOT_STORE_CONFIG', f'/etc/{CLIENT}/{CLIENT}-config.toml'))
MONGODB_ENV_PATH = Path('/etc/frc-contesting/mongodb.env')
COORDINATION_ENV_PATH = Path('/etc/sigmond/coordination.env')

DEFAULTS: dict = {
    'sink': {
        'path': '/var/lib/sigmond/sink.db',
        'poll_interval_sec': 5.0,
        'batch_size': 2000,
        # First start only (no cursor yet): "oldest" backfills everything
        # still in the sink (~24 h WSPR, ~1 h FT8/FT4); "now" skips history.
        'start_at': 'oldest',
    },
    'modes': {
        'wspr': True,
        'ft8': True,
        'ft4': True,
    },
    'mongodb': {
        'collection': 'spots',
        # TTL on the `ts` field; 0 disables expiry.
        'retention_days': 30,
    },
    'station': {
        # Blank → STATION_REPORTER_ID (then STATION_CALL) from coordination.env
        'rx_callsign': '',
    },
    'state': {
        'dir': '/var/lib/frc-spot-store',
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
    """Config file merged over defaults.  Missing file → defaults.

    Raises PermissionError / tomllib.TOMLDecodeError to the caller so
    inventory/validate can report them as issues.
    """
    try:
        with open(path, 'rb') as f:
            user = tomllib.load(f)
    except FileNotFoundError:
        user = {}
    return deep_merge(DEFAULTS, user)


def enabled_modes(cfg: dict) -> set[str]:
    return {m for m, on in cfg['modes'].items() if on}


def station_env(key: str) -> str | None:
    """STATION_* from the environment (systemd loads coordination.env), else
    read sigmond's coordination.env directly (CLI run from a shell)."""
    if os.environ.get(key):
        return os.environ[key]
    try:
        return read_env_file(COORDINATION_ENV_PATH).get(key) or None
    except OSError:
        return None


def rx_callsign(cfg: dict) -> str:
    return (cfg['station'].get('rx_callsign')
            or station_env('STATION_REPORTER_ID')
            or station_env('STATION_CALL')
            or 'Unknown')


def read_env_file(path: Path) -> dict:
    """Parse a KEY=VALUE env file (used when not launched by systemd)."""
    env = {}
    with open(path) as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith('#') or '=' not in line:
                continue
            k, v = line.split('=', 1)
            env[k.strip()] = v.strip().strip('"').strip("'")
    return env


def mongodb_settings() -> dict:
    """MONGODB_* from the environment, falling back to the shared env file."""
    keys = ('MONGODB_HOST', 'MONGODB_PORT', 'MONGODB_USERNAME',
            'MONGODB_PASSWORD', 'MONGODB_DATABASE')
    env = {k: os.environ[k] for k in keys if os.environ.get(k)}
    if 'MONGODB_PASSWORD' not in env:
        try:
            env = {**read_env_file(MONGODB_ENV_PATH), **env}
        except OSError:
            pass
    return {
        'host': env.get('MONGODB_HOST', '127.0.0.1'),
        'port': env.get('MONGODB_PORT', '27017'),
        'username': env.get('MONGODB_USERNAME'),
        'password': env.get('MONGODB_PASSWORD'),
        'database': env.get('MONGODB_DATABASE', 'wspr_db'),
    }


def mongodb_uri(s: dict) -> str:
    if s.get('username') and s.get('password'):
        return (f"mongodb://{quote_plus(s['username'])}:{quote_plus(s['password'])}"
                f"@{s['host']}:{s['port']}/?authSource=admin")
    return f"mongodb://{s['host']}:{s['port']}"


def to_toml(cfg: dict) -> str:
    """Minimal TOML writer for this config's shape (tables of scalars)."""
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
