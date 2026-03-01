"""
JSON API routes for the HamSCI Dashboard.

Provides REST endpoints for fetching spot data in JSON format,
consumed by the frontend JavaScript (map_ft.js, table_ft.js).
"""

from flask import Blueprint, current_app, jsonify, request

from services.spots import fetch_spots_for_map, fetch_spots_for_table

api_bp = Blueprint('api', __name__)


@api_bp.route('/config')
def config():
    return jsonify({
        'receiver_callsign': current_app.config.get('RECEIVER_CALLSIGN', 'Unknown'),
        'receiver_grid': current_app.config.get('RECEIVER_GRIDSQUARE', 'Unknown'),
    })


@api_bp.route('/spots')
def spots():
    """
    REST API endpoint: Fetch spots for map display.

    Query Parameters:
        lastInterval (str): Minutes to look back (default: "15")

    Returns:
        JSON: Array of spot objects with full TX/RX details

    Example:
        GET /spots?lastInterval=30
        Returns spots from the last 30 minutes
    """
    last_interval = request.args.get('lastInterval', '15')
    data = fetch_spots_for_map(last_interval=last_interval)
    return jsonify(data)


@api_bp.route('/tbspots')
def tbspots():
    """
    REST API endpoint: Fetch spots for table display.

    Optimized endpoint for table view with simplified data structure
    including CQ zone information for regional aggregation.

    Query Parameters:
        lastInterval (str): Minutes to look back (default: "15")

    Returns:
        JSON: Array of spot objects with band, grid, time, cq_zone, mode

    Example:
        GET /tbspots?lastInterval=15
        Returns spots from the last 15 minutes formatted for table view
    """
    last_interval = request.args.get('lastInterval', '15')
    data = fetch_spots_for_table(last_interval=last_interval)
    return jsonify(data)
