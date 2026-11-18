"""
CW and RTTY skimmer page (/cws; not a dashboard tab yet): every CW and RTTY
signal on the contest bands decoded all the time, callsigns calling CQ
spotted in Reverse Beacon Network format.

The radiod IQ channels and the decoders run in the frc-dashboard sigmond
supervisor (sigmond/frc-dashboard/src/frc_dashboard/skimmer.py); this
blueprint relays to its control socket like the Waterfall tab does.  Spots
are kept in their own MongoDB database (skimmer_db) and shown here only;
they are not added to the map or table.
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
    Skimmer state for one band, and new spots on every band.

    Query Parameters:
        band (str): band to show (default: the configured one)
        since (int): last spot sequence number the browser already has

    Returns:
        JSON: {"running", "band", "bands", "cw_range", "rtty_range", "masks",
        "spotter", "cw": {signals, spectrum, lo_hz, hi_hz}, "rtty": {...},
        "spots": [{seq, t, band, mode, freq_khz, call, snr_db, speed, kind,
        confirmed, reason, rbn}], "bands_summary": {...}, "stats": {...},
        "store": {...}}
    """
    try:
        since = max(0, int(request.args.get('since', '0')))
    except ValueError:
        since = 0
    band = request.args.get('band', '')
    if band and band not in BANDS:
        band = ''
    try:
        status, payload = _control_get(f'/x/frc-dashboard/skimmer?since={since}&band={quote(band)}')
    except (OSError, ValueError, IndexError) as e:
        return _unavailable(e)
    return jsonify(payload), status
