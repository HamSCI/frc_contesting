"""
Waterfall tab: live spectrum waterfalls for the six contest bands.

The spectrum data comes from radiod (ka9q-radio) through the frc-dashboard
sigmond supervisor, which owns the radiod spectrum channels.  Gunicorn runs
several workers, so the channels cannot live in this Flask app; instead this
blueprint relays requests to the supervisor's control socket.  When the
dashboard runs without the supervisor (e.g. `python web-ft.py`), the API
answers 503 and the page explains why.
"""

import json
import os
import socket

from flask import Blueprint, jsonify, render_template, request

waterfall_bp = Blueprint('waterfall', __name__)

CONTROL_SOCKET = os.getenv('FRC_CONTROL_SOCKET', '/run/frc-dashboard/control.sock')


def _control_get(path, timeout=10.0):
    """GET `path` on the supervisor's unix-socket HTTP server -> (status, json)."""
    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as s:
        s.settimeout(timeout)
        s.connect(CONTROL_SOCKET)
        s.sendall(f'GET {path} HTTP/1.0\r\nHost: localhost\r\n\r\n'.encode())
        chunks = []
        while True:
            chunk = s.recv(262144)
            if not chunk:
                break
            chunks.append(chunk)
    head, _, body = b''.join(chunks).partition(b'\r\n\r\n')
    status = int(head.split(b' ', 2)[1])
    return status, json.loads(body)


@waterfall_bp.route('/waterfall')
def waterfall_view():
    """Waterfall view: one scrolling spectrum per contest band."""
    return render_template('waterfall.html')


@waterfall_bp.route('/api/waterfall')
def waterfall_data():
    """
    Spectrum rows newer than `since` for every contest band.

    Query Parameters:
        since (int): last row sequence number the browser already has (default 0)

    Returns:
        JSON: {"running", "seq", "db_min", "db_max", "bands": {name: {lo_hz,
        hi_hz, bins, rows: [[seq, epoch, base64 uint8 row], ...]}}}
    """
    try:
        since = max(0, int(request.args.get('since', '0')))
    except ValueError:
        since = 0
    try:
        status, payload = _control_get(f'/x/frc-dashboard/waterfall?since={since}')
    except (OSError, ValueError, IndexError) as e:
        return jsonify({'running': False,
                        'error': f'waterfall service unavailable ({e.__class__.__name__}); '
                                 'it runs inside the frc-dashboard sigmond service'}), 503
    return jsonify(payload), status

