"""
frc-dashboard CLI — sigmond CLIENT-CONTRACT v0.8 surfaces.

    frc-dashboard version   --json
    frc-dashboard inventory --json        (always exits 0)
    frc-dashboard validate  --json        (exit 1 on fail-severity issues)
    frc-dashboard status    --json        (live snapshot via control socket)
    frc-dashboard config show --json [--defaults] | init | edit | apply --json -
    frc-dashboard daemon [--instance default]

stdout carries only JSON for the --json verbs; logs go to stderr.
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import socket
import subprocess
import sys
import tomllib
from pathlib import Path

from . import __version__
from .config import (CLIENT, CONFIG_PATH, DEFAULTS, MONGODB_ENV_PATH, app_environment,
                     app_root, deep_merge, load_config, station, station_env,
                     to_toml)

CONTRACT_VERSION = '0.8'
REPO_DIR = Path(__file__).resolve().parents[2]          # sigmond/frc-dashboard
CONTROL_SOCKET = '/run/frc-dashboard/control.sock'


def _print(obj) -> None:
    sys.stdout.write(json.dumps(obj, indent=2, default=str) + '\n')


def _git_info() -> dict | None:
    try:
        def g(*a):
            return subprocess.run(['git', '-C', str(REPO_DIR), *a], capture_output=True,
                                  text=True, timeout=3, check=True).stdout.strip()
        sha = g('rev-parse', 'HEAD')
        return {'sha': sha, 'short': sha[:7], 'ref': g('rev-parse', '--abbrev-ref', 'HEAD'),
                'dirty': bool(g('status', '--porcelain'))}
    except Exception:
        return None


def control_get(path: str, timeout: float = 1.0) -> dict | None:
    try:
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as s:
            s.settimeout(timeout)
            s.connect(CONTROL_SOCKET)
            s.sendall(f'GET {path} HTTP/1.0\r\nHost: x\r\n\r\n'.encode())
            data = b''
            while chunk := s.recv(65536):
                data += chunk
        return json.loads(data.split(b'\r\n\r\n', 1)[1])
    except (OSError, ValueError, IndexError):
        return None


def cmd_version(args) -> int:
    _print({'client': CLIENT, 'version': __version__, 'contract_version': CONTRACT_VERSION,
            'git': _git_info()})
    return 0


def _inventory(args) -> int:
    issues = []
    try:
        cfg = load_config()
    except (PermissionError, tomllib.TOMLDecodeError, OSError) as e:
        issues.append({'severity': 'fail', 'instance': 'default',
                       'message': f'cannot read {CONFIG_PATH}: {e}'})
        cfg = DEFAULTS
    live = control_get('/status') or {}
    _print({
        'client': CLIENT,
        'version': __version__,
        'contract_version': CONTRACT_VERSION,
        'config_path': str(CONFIG_PATH),
        'git': _git_info(),
        'instances': [{
            'instance': 'default',
            'radiod_id': station_env('SIGMOND_RADIOD_STATUS'),
            'host': 'localhost',
            'required_cores': [],
            'preferred_cores': 'worker',
            'frequencies_hz': [],
            'ka9q_channels': 0,
            'data_destination': None,
            'radiod_status_dns': station_env('SIGMOND_RADIOD_STATUS'),
            'uses_timing_calibration': False,
            'provides_timing_calibration': False,
            'timing_authority_applied': None,
            'data_path': {
                'kind': 'other',
                'details': {
                    'description': 'reads wspr_db.spots (MongoDB) populated by frc-spot-store',
                    'upstream_client': ['frc-spot-store'],
                },
            },
            'data_sinks': [],
            'http_port': int(cfg['server']['port']),
            'http_health': live.get('state', 'stopped'),
            'control_socket': CONTROL_SOCKET,
            'deploy_toml_path': str(REPO_DIR / 'deploy.toml'),
        }],
        'deps': {'git': [], 'pypi': [{'name': n} for n in
                                     ('flask', 'gunicorn', 'pymongo', 'maidenhead', 'shapely')]},
        'issues': issues,
    })
    return 0


def cmd_inventory(args) -> int:
    """Contract §3: inventory MUST exit 0 with JSON, whatever goes wrong."""
    try:
        return _inventory(args)
    except Exception as e:
        _print({'client': CLIENT, 'version': __version__,
                'contract_version': CONTRACT_VERSION, 'config_path': str(CONFIG_PATH),
                'instances': [],
                'issues': [{'severity': 'fail', 'instance': 'default',
                            'message': f'inventory failed: {type(e).__name__}: {e}'}]})
        return 0


def cmd_validate(args) -> int:
    issues = []

    def issue(sev, msg):
        issues.append({'severity': sev, 'instance': 'default', 'message': msg})

    try:
        cfg = load_config()
    except (PermissionError, tomllib.TOMLDecodeError, OSError) as e:
        issue('fail', f'cannot read {CONFIG_PATH}: {e}')
        _print({'ok': False, 'issues': issues})
        return 1
    if not CONFIG_PATH.exists():
        issue('warn', f'{CONFIG_PATH} missing; running on defaults')

    root = app_root(cfg)
    for rel in ('web-ft.py', 'app.py', 'static/js/cqzones.geojson', 'templates/both.html',
                'static/vendor/leaflet/leaflet.js'):
        if not (root / rel).exists():
            issue('fail', f'dashboard file missing: {root / rel}')

    port = cfg['server']['port']
    if not isinstance(port, int) or not 1 <= port <= 65535:
        issue('fail', f'server.port {port!r} invalid')

    call, grid = station(cfg)
    if call == 'Unknown':
        issue('warn', 'receiver callsign unknown (set [station].callsign or STATION_REPORTER_ID)')
    if not grid:
        issue('fail', 'receiver grid unknown (set [station].grid_square or STATION_GRID)')
    else:
        try:
            import maidenhead
            maidenhead.to_location(grid)
        except Exception as e:
            issue('fail', f'receiver grid {grid!r} invalid: {e}')

    env = app_environment(cfg)
    if not env.get('MONGODB_PASSWORD'):
        issue('fail', f'MongoDB credentials not found (env MONGODB_* or {MONGODB_ENV_PATH})')
    else:
        try:
            from pymongo import MongoClient
            from urllib.parse import quote_plus
            uri = (f"mongodb://{quote_plus(env['MONGODB_USERNAME'])}:{quote_plus(env['MONGODB_PASSWORD'])}"
                   f"@{env.get('MONGODB_HOST', '127.0.0.1')}:{env.get('MONGODB_PORT', '27017')}/?authSource=admin")
            with MongoClient(uri, serverSelectionTimeoutMS=3000) as c:
                c.admin.command('ping')
                if c[env.get('MONGODB_DATABASE', 'wspr_db')]['spots'].estimated_document_count() == 0:
                    issue('warn', 'wspr_db.spots is empty (is frc-spot-store running?)')
        except Exception as e:
            issue('fail', f'MongoDB ping failed: {e}')

    w = cfg.get('waterfall', {})
    if w.get('enabled', True):
        from .waterfall import BAND_EDGES
        try:
            import ka9q  # noqa: F401
        except ImportError:
            issue('warn', 'waterfall enabled but ka9q-python is not installed in this venv')
        unknown = [b.strip() for b in str(w.get('bands', '')).split(',')
                   if b.strip() and b.strip() not in BAND_EDGES]
        if unknown:
            issue('warn', f'waterfall.bands has unknown bands {unknown}; known: {list(BAND_EDGES)}')
        if not (w.get('radiod_status') or station_env('SIGMOND_RADIOD_STATUS')):
            issue('warn', 'waterfall enabled but no radiod status address (SIGMOND_RADIOD_STATUS)')

    live = control_get('/status')
    if live and live.get('state') not in ('running', 'starting'):
        issue('warn', f"daemon state {live.get('state')}: {live.get('pipeline', {}).get('last_error')}")

    ok = not any(i['severity'] == 'fail' for i in issues)
    _print({'ok': ok, 'issues': issues})
    return 0 if ok else 1


def cmd_status(args) -> int:
    live = control_get('/status')
    if live is None:
        _print({'service': CLIENT, 'state': 'stopped'})
        return 1
    _print(live)
    return 0


def cmd_config(args) -> int:
    if args.config_cmd == 'show':
        if args.defaults:
            _print(DEFAULTS)
            return 0
        try:
            _print(load_config())
        except (PermissionError, tomllib.TOMLDecodeError, OSError) as e:
            _print({'error': str(e)})
            return 1
        return 0
    if args.config_cmd == 'init':
        if CONFIG_PATH.exists():
            print(f'{CONFIG_PATH} already exists; use `config edit`', file=sys.stderr)
            return 0
        CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
        CONFIG_PATH.write_text(to_toml(DEFAULTS))
        print(f'wrote {CONFIG_PATH}', file=sys.stderr)
        return 0
    if args.config_cmd == 'edit':
        return subprocess.call([os.environ.get('EDITOR', 'nano'), str(CONFIG_PATH)])
    if args.config_cmd == 'apply':
        patch = json.load(sys.stdin)
        merged = deep_merge(load_config(), patch)
        merged = {k: merged[k] for k in DEFAULTS}
        CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
        tmp = CONFIG_PATH.with_suffix('.tmp')
        tmp.write_text(to_toml(merged))
        os.replace(tmp, CONFIG_PATH)
        _print({'ok': True, 'applied': patch, 'restart_required': True})
        return 0
    return 2


def cmd_daemon(args) -> int:
    from .daemon import Daemon
    return Daemon(load_config(), instance=args.instance).run()


def main(argv=None) -> int:
    logging.basicConfig(stream=sys.stderr,
                        level=os.environ.get('FRC_LOG_LEVEL', 'INFO').upper(),
                        format='%(levelname)s %(name)s: %(message)s')
    p = argparse.ArgumentParser(prog=CLIENT, description=__doc__.split('\n\n')[0])
    sub = p.add_subparsers(dest='cmd', required=True)
    for name in ('version', 'inventory', 'validate', 'status'):
        sub.add_parser(name).add_argument('--json', action='store_true')
    c = sub.add_parser('config')
    csub = c.add_subparsers(dest='config_cmd', required=True)
    cs = csub.add_parser('show')
    cs.add_argument('--json', action='store_true')
    cs.add_argument('--defaults', action='store_true')
    csub.add_parser('init').add_argument('instance', nargs='?')
    csub.add_parser('edit').add_argument('instance', nargs='?')
    ca = csub.add_parser('apply')
    ca.add_argument('--json', action='store_true')
    ca.add_argument('stdin', nargs='?', default='-')
    sub.add_parser('daemon').add_argument('--instance', default='default')

    args = p.parse_args(argv)
    return {
        'version': cmd_version, 'inventory': cmd_inventory, 'validate': cmd_validate,
        'status': cmd_status, 'config': cmd_config, 'daemon': cmd_daemon,
    }[args.cmd](args)


if __name__ == '__main__':
    sys.exit(main())
