"""Route blueprint registration for the HamSCI Dashboard."""

from routes.views import views_bp
from routes.api import api_bp


def register_blueprints(app):
    """Register all route blueprints with the Flask app."""
    app.register_blueprint(views_bp)
    app.register_blueprint(api_bp)
