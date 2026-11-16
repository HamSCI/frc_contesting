"""
CW skimmer page (/cws; not a dashboard tab yet): a CW skimmer on one band (all CW signals decoded at once,
callsigns calling CQ spotted in Reverse Beacon Network format).

The radiod IQ channel and the decoder run in the frc-dashboard sigmond
supervisor (sigmond/frc-dashboard/src/frc_dashboard/skimmer.py); this
blueprint relays to its control socket like the Waterfall tab does.  Spots
are shown here only; they are not added to the map or table.
"""

from urllib.parse import quote

from flask import Blueprint, jsonify, render_template, request

from routes.waterfall import _control_get

skimmer_bp = Blueprint('skimmer', __name__)

BANDS = ('160m', '80m', '40m', '20m', '15m', '10m')


def _unavailable(e):
    return jsonify({'running': False,
                    'error': f'skimmer service unavailable ({e.__class__.__name__}); '
                             'it runs inside the frc-dashboard sigmond service'}), 503


@skimmer_bp.route('/cws')
@skimmer_bp.route('/skimmer')
def skimmer_view():
    """Skimmer view: band spectrum, every decoded signal, and spots.  Reached
    at /cws; deliberately not linked from the dashboard tabs yet."""
    return render_template('skimmer.html')


@skimmer_bp.route('/api/skimmer')
def skimmer_data():
    """
    Skimmer state; starts the skimmer on demand (it stops when nobody asks).

    Query Parameters:
        since (int): last spot sequence number the browser already has

    Returns:
        JSON: {"running", "band", "lo_hz", "hi_hz", "masks", "spotter",
        "signals": [{freq_khz, snr_db, wpm, text, call}], "spots": [{seq, t,
        freq_khz, call, snr_db, wpm, kind, confirmed, reason, rbn}],
        "spectrum": {lo_hz, hi_hz, db: [...]}, "stats": {...}}
    """
    try:
        since = max(0, int(request.args.get('since', '0')))
    except ValueError:
        since = 0
    try:
        status, payload = _control_get(f'/x/frc-dashboard/skimmer?since={since}')
    except (OSError, ValueError, IndexError) as e:
        return _unavailable(e)
    return jsonify(payload), status


@skimmer_bp.route('/api/skimmer/band', methods=['POST'])
def skimmer_band():
    """Move the skimmer to another band: body {"band": "40m"}."""
    band = str((request.get_json(silent=True) or {}).get('band', ''))
    if band not in BANDS:
        return jsonify({'error': f'band must be one of {list(BANDS)}'}), 400
    try:
        status, payload = _control_get(f'/x/frc-dashboard/skimmer/band?band={quote(band)}')
    except (OSError, ValueError, IndexError) as e:
        return _unavailable(e)
    return jsonify(payload), status
