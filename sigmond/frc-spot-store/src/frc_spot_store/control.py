"""
CLIENT-CONTRACT §13 control surface: HTTP/JSON over a unix socket.

    curl --unix-socket /run/frc-spot-store/control.sock http://./status

Handlers only read a snapshot callable; they never touch MongoDB or the sink.
"""

from __future__ import annotations

import grp
import json
import os
import socketserver
import threading
from http.server import BaseHTTPRequestHandler
from typing import Callable


class _Server(socketserver.ThreadingMixIn, socketserver.UnixStreamServer):
    daemon_threads = True
    allow_reuse_address = True


def _make_handler(snapshot: Callable[[], dict], metrics: Callable[[dict], str]):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):  # keep the journal quiet
            pass

        # BaseHTTPRequestHandler expects a (host, port) client_address.
        def address_string(self):
            return 'unix'

        def _send(self, code: int, body: str, ctype: str = 'application/json'):
            data = body.encode()
            self.send_response(code)
            self.send_header('Content-Type', ctype)
            self.send_header('Content-Length', str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def do_GET(self):
            snap = snapshot()
            if self.path == '/healthz':
                self._send(200, '{"ok": true}')
            elif self.path == '/readyz':
                ready = snap.get('state') == 'running'
                self._send(200 if ready else 503, json.dumps({'ready': ready}))
            elif self.path == '/status':
                self._send(200, json.dumps(snap, default=str))
            elif self.path == '/metrics':
                self._send(200, metrics(snap), 'text/plain; version=0.0.4')
            else:
                self._send(404, '{"error": "not found"}')

    return Handler


def start_control_server(path: str, snapshot: Callable[[], dict],
                         metrics: Callable[[dict], str]) -> _Server | None:
    """Bind the socket (mode 0660, group sigmond when possible) in a thread."""
    try:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        if os.path.exists(path):
            os.unlink(path)
        server = _Server(path, _make_handler(snapshot, metrics))
    except OSError:
        return None
    try:
        os.chmod(path, 0o660)
        os.chown(path, -1, grp.getgrnam('sigmond').gr_gid)
    except (KeyError, OSError):
        pass
    threading.Thread(target=server.serve_forever, name='control', daemon=True).start()
    return server
