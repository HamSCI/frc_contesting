"""
Page-rendering routes for the HamSCI Dashboard.

Serves HTML templates for the map view, table view, combined view,
and legacy display view.
"""

from flask import Blueprint, render_template

views_bp = Blueprint('views', __name__)


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
