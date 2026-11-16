"""
Waterfall tab: live spectrum waterfalls for the six contest bands.

The spectrum data comes from radiod (ka9q-radio) through the frc-dashboard
sigmond supervisor, which owns the radiod spectrum channels.  Gunicorn runs
several workers, so the channels cannot live in this Flask app; instead this
blueprint relays requests to the supervisor's control socket.  When the
dashboard runs without the supervisor (e.g. `python web-ft.py`), the API
answers 503 and the page explains why.

Click-to-listen audio (/api/listen/*) is relayed the same way: the
supervisor owns the radiod audio channel and streams raw s16le 12 kHz mono,
which this blueprint passes straight through to the browser.
"""

import json
import os
import socket
from urllib.parse import urlencode

from flask import Blueprint, Response, jsonify, render_template, request, stream_with_context

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
        span (float): seconds of history wanted; older rows are left out

    Returns:
        JSON: {"running", "seq", "db_min", "db_max", "bands": {name: {lo_hz,
        hi_hz, bins, rows: [[seq, epoch, base64 uint8 row], ...]}}}
    """
    try:
        since = max(0, int(request.args.get('since', '0')))
    except ValueError:
        since = 0
    try:
        span = max(0.0, float(request.args.get('span', '0')))
    except ValueError:
        span = 0.0
    query = f'since={since}' + (f'&span={span:g}' if span else '')
    try:
        status, payload = _control_get(f'/x/frc-dashboard/waterfall?{query}')
    except (OSError, ValueError, IndexError) as e:
        return jsonify({'running': False,
                        'error': f'waterfall service unavailable ({e.__class__.__name__}); '
                                 'it runs inside the frc-dashboard sigmond service'}), 503
    return jsonify(payload), status


# ── click-to-listen ─────────────────────────────────────────────────────────

LISTEN_BASE = '/x/frc-dashboard/listen'
CRLF = chr(13) + chr(10)
HEADER_END = (CRLF + CRLF).encode()
UNAVAILABLE = ('listening service unavailable; it runs inside the frc-dashboard '
               'sigmond service')


def _listen_call(action):
    """Relay a JSON listen action (open/tune/keepalive/close) to the supervisor."""
    # sendBeacon (used on page unload) posts text/plain, so parse leniently.
    body = request.get_json(silent=True, force=True) or {}
    params = {k: body[k] for k in ('sid', 'freq_hz', 'mode') if body.get(k) is not None}
    try:
        status, payload = _control_get(f'{LISTEN_BASE}/{action}?{urlencode(params)}')
    except (OSError, ValueError, IndexError) as e:
        return jsonify({'error': f'{UNAVAILABLE} ({e.__class__.__name__})'}), 503
    return jsonify(payload), status


@waterfall_bp.route('/api/listen/open', methods=['POST'])
def listen_open():
    """Start listening: body {"freq_hz", "mode": usb|lsb|cw|am} -> {"sid", ...}."""
    return _listen_call('open')


@waterfall_bp.route('/api/listen/tune', methods=['POST'])
def listen_tune():
    """Retune: body {"sid", "freq_hz", "mode"}."""
    return _listen_call('tune')


@waterfall_bp.route('/api/listen/keepalive', methods=['POST'])
def listen_keepalive():
    """Keep an idle listener alive (e.g. while audio is paused): body {"sid"}."""
    return _listen_call('keepalive')


@waterfall_bp.route('/api/listen/close', methods=['POST'])
def listen_close():
    """Stop listening and release the radiod channel: body {"sid"}."""
    return _listen_call('close')


@waterfall_bp.route('/api/listen/audio')
def listen_audio():
    """
    Raw audio for one listener: signed 16-bit little-endian mono PCM at 12 kHz,
    streamed until the browser disconnects or the listener is closed.

    Query Parameters:
        sid (str): listener id returned by /api/listen/open
    """
    sid = request.args.get('sid', '')
    s = None
    try:
        s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        s.settimeout(10.0)
        s.connect(CONTROL_SOCKET)
        req = f'GET {LISTEN_BASE}/audio?{urlencode({"sid": sid})} HTTP/1.0' + CRLF
        s.sendall((req + 'Host: localhost' + CRLF + CRLF).encode())
        head = b''
        while HEADER_END not in head:
            chunk = s.recv(4096)
            if not chunk:
                break
            head += chunk
        head, _, first = head.partition(HEADER_END)
        status = int(head.split(b' ', 2)[1])
    except (OSError, ValueError, IndexError) as e:
        if s is not None:
            s.close()
        return jsonify({'error': f'{UNAVAILABLE} ({e.__class__.__name__})'}), 503

    if status != 200:
        rest = first
        try:
            while chunk := s.recv(65536):
                rest += chunk
        finally:
            s.close()
        try:
            return jsonify(json.loads(rest)), status
        except ValueError:
            return jsonify({'error': 'listen relay failed'}), 502

    def relay():
        try:
            if first:
                yield first
            s.settimeout(30.0)
            while True:
                chunk = s.recv(16384)
                if not chunk:
                    return
                yield chunk
        except OSError:
            return
        finally:
            s.close()              # browser gone -> supervisor sees the drop

    return Response(stream_with_context(relay()), mimetype='application/octet-stream',
                    headers={'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no',
                             'X-Audio-Format': 's16le; rate=12000; channels=1'})
