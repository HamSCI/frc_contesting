"""
Page-rendering routes for the HamSCI Dashboard.

Serves HTML templates for the map view, table view, and combined view.
"""

from flask import Blueprint, render_template, request, Response

views_bp = Blueprint('views', __name__)


@views_bp.route('/favicon.ico')
def favicon():
    return Response(status=204)


@views_bp.route('/')
def home():
    """
    Root route: the tabbed dashboard (Map / Table / Waterfall iframes).

    The query string carries every view setting (#62, e.g.
    ``/?view=table&last=60``); it is forwarded into each iframe's URL so a
    shared or bookmarked link restores the same tab and settings.

    Returns:
        HTML: Rendered both.html template
    """
    qs = request.query_string.decode("utf-8", "replace")
    return render_template("both.html", qs=f"?{qs}" if qs else "")


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
