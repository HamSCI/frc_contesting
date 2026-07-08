"""
Page-rendering routes for the HamSCI Dashboard.

Serves HTML templates for the map view, table view, combined view,
and legacy display view.
"""

from flask import Blueprint, render_template, Response

views_bp = Blueprint('views', __name__)


@views_bp.route('/favicon.ico')
def favicon():
    return Response(status=204)


@views_bp.route('/')
def home():
    """
    Root route: Combined view with map and table side-by-side using iframes.

    Returns:
        HTML: Rendered both.html template showing dual-pane view
    """
    return render_template("both.html")


@views_bp.route('/map')
def map_view():
    """
    Map view route: Interactive Leaflet map with spot visualization.

    Displays TX-RX propagation paths with colored markers indicating band,
    filtering controls, and real-time spot updates.

    Returns:
        HTML: Rendered index_ft.html template
    """
    return render_template('index_ft.html')


@views_bp.route('/display')
def display():
    """
    Alternative display route (legacy).

    Returns:
        HTML: Rendered index_wcount.html template
    """
    return render_template('index_wcount.html')


@views_bp.route('/table')
def table():
    """
    Table view route: Regional band activity aggregation table.

    Displays spot counts organized by geographic region (based on CQ zones)
    and band, useful for quick assessment of band openings.

    Returns:
        HTML: Rendered table_ft.html template
    """
    return render_template("table_ft.html")


@views_bp.route('/contestmap')
def contest_map():
    """
    Stripped, contest-band-only spot map (no filter UI). Embedded via iframe
    on the Assimilated-Predictions page. Served at a single-path segment so
    map_ft.js's relative asset/GeoJSON fetches resolve against the site root.

    Returns:
        HTML: Rendered map_contest.html template
    """
    return render_template('map_contest.html')


@views_bp.route('/prediction')
def prediction():
    return render_template("prediction.html")


@views_bp.route('/prediction/p2p')
def prediction_p2p():
    return render_template("prediction_p2p.html")


@views_bp.route('/prediction/area')
def prediction_area():
    return render_template("prediction_area.html")


@views_bp.route('/prediction/contest')
def prediction_contest():
    return render_template("prediction_contest.html")


@views_bp.route('/prediction/assimilated')
def prediction_assimilated():
    """Assimilated-Predictions [BETA]: P2P prediction + live contest spot map +
    baseline/assimilated ionosphere indicator."""
    return render_template("prediction_assimilated.html")
