"""
frc-spot-store CLI — sigmond CLIENT-CONTRACT v0.8 surfaces.

    frc-spot-store version   --json
    frc-spot-store inventory --json        (always exits 0)
    frc-spot-store validate  --json        (exit 1 on fail-severity issues)
    frc-spot-store status    --json        (live snapshot via control socket)
    frc-spot-store config show --json [--defaults] | init | edit | apply --json -
    frc-spot-store daemon [--instance default]

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
from .config import (CLIENT, CONFIG_PATH, DEFAULTS, MONGODB_ENV_PATH, deep_merge,
                     load_config, mongodb_settings, rx_callsign, station_env,
                     to_toml)

CONTRACT_VERSION = '0.8'
REPO_DIR = Path(__file__).resolve().parents[2]          # sigmond/frc-spot-store
CONTROL_SOCKET = '/run/frc-spot-store/control.sock'


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
    """GET a JSON endpoint on the daemon's control socket; None if down."""
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


# ------------------------------------------------------------------ verbs
def cmd_version(args) -> int:
    _print({'client': CLIENT, 'version': __version__, 'contract_version': CONTRACT_VERSION,
            'git': _git_info()})
    return 0


def _instance_entry(cfg: dict, live: dict | None) -> dict:
    health = (live or {}).get('mongodb', {}).get('health', 'unknown')
    return {
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
                'description': ('tails sigmond sink.db (wspr.spots, psk.spots) written by '
                                'wspr-recorder / psk-recorder from ka9q-radio radiod'),
                'upstream_client': ['wspr-recorder', 'psk-recorder'],
                'path': cfg['sink']['path'],
            },
        },
        'data_sinks': [{
            'kind': 'service',
            'target': f"{mongodb_settings()['database']}.{cfg['mongodb']['collection']}",
            'schema_ref': 'wspr_db:1',
            'retention_days': cfg['mongodb']['retention_days'],
            'mb_per_day': 150,
            'health': health,
        }],
        'control_socket': CONTROL_SOCKET,
        'deploy_toml_path': str(REPO_DIR / 'deploy.toml'),
    }


def _inventory(args) -> int:
    issues = []
    try:
        cfg = load_config()
    except (PermissionError, tomllib.TOMLDecodeError, OSError) as e:
        issues.append({'severity': 'fail', 'instance': 'default',
                       'message': f'cannot read {CONFIG_PATH}: {e}'})
        cfg = DEFAULTS
    live = control_get('/status')
    _print({
        'client': CLIENT,
        'version': __version__,
        'contract_version': CONTRACT_VERSION,
        'config_path': str(CONFIG_PATH),
        'git': _git_info(),
        'instances': [_instance_entry(cfg, live)],
        'deps': {'git': [], 'pypi': [{'name': 'pymongo'}]},
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
    if cfg['sink']['start_at'] not in ('oldest', 'now'):
        issue('fail', 'sink.start_at must be "oldest" or "now"')
    modes = {m for m, on in cfg['modes'].items() if on}
    if not modes:
        issue('fail', 'no modes enabled under [modes]')
    if unknown := set(cfg['modes']) - {'wspr', 'ft8', 'ft4'}:
        issue('warn', f'unknown modes ignored: {sorted(unknown)}')

    sink = Path(cfg['sink']['path'])
    if not sink.exists():
        issue('fail', f'sigmond sink {sink} not found (are wspr-recorder/psk-recorder installed?)')
    elif not os.access(sink, os.R_OK):
        issue('fail', f'sigmond sink {sink} not readable by uid {os.getuid()}')
    else:
        try:
            from .sink import SinkReader
            r = SinkReader(str(sink))
            lo, hi = r.id_bounds()
            r.close()
            if hi == 0:
                issue('warn', 'sink has no wspr/psk spot rows yet')
        except Exception as e:
            issue('fail', f'sink query failed: {e}')

    s = mongodb_settings()
    if not s.get('password'):
        issue('fail', f'MongoDB credentials not found (env MONGODB_* or {MONGODB_ENV_PATH})')
    else:
        try:
            from .store import SpotStore
            st = SpotStore(s, cfg['mongodb']['collection'], cfg['mongodb']['retention_days'])
            st.ping()
            st.close()
        except Exception as e:
            issue('fail', f'MongoDB ping failed: {e}')

    if rx_callsign(cfg) == 'Unknown':
        issue('warn', 'receiver callsign unknown (set [station].rx_callsign or STATION_REPORTER_ID)')

    live = control_get('/status')
    if live and live.get('state') != 'running':
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
        editor = os.environ.get('EDITOR', 'nano')
        return subprocess.call([editor, str(CONFIG_PATH)])
    if args.config_cmd == 'apply':
        patch = json.load(sys.stdin)
        merged = deep_merge(load_config(), patch)
        merged = {k: merged[k] for k in DEFAULTS}       # drop unknown sections
        CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
        tmp = CONFIG_PATH.with_suffix('.tmp')
        tmp.write_text(to_toml(merged))
        os.replace(tmp, CONFIG_PATH)
        _print({'ok': True, 'applied': patch, 'restart_required': True})
        return 0
    return 2


def cmd_daemon(args) -> int:
    from .daemon import Daemon
    cfg = load_config()
    return Daemon(cfg, instance=args.instance).run()


def main(argv=None) -> int:
    # Contract §3: never let logging reach stdout.
    logging.basicConfig(stream=sys.stderr,
                        level=os.environ.get('FRC_LOG_LEVEL', 'INFO').upper(),
                        format='%(levelname)s %(name)s: %(message)s')
    p = argparse.ArgumentParser(prog=CLIENT, description=__doc__.split('\n\n')[0])
    sub = p.add_subparsers(dest='cmd', required=True)
    for name in ('version', 'inventory', 'validate', 'status'):
        sp = sub.add_parser(name)
        sp.add_argument('--json', action='store_true', help='JSON output (always JSON)')
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
    d = sub.add_parser('daemon')
    d.add_argument('--instance', default='default')

    args = p.parse_args(argv)
    return {
        'version': cmd_version, 'inventory': cmd_inventory, 'validate': cmd_validate,
        'status': cmd_status, 'config': cmd_config, 'daemon': cmd_daemon,
    }[args.cmd](args)


if __name__ == '__main__':
    sys.exit(main())
