"""
HamSCI Contesting and DXing Dashboard - Application Factory

Creates and configures the Flask application with all extensions,
database connections, and route registrations.

Author: Owen Ruzanski (KD3ALD)
Organization: University of Scranton (W3USR), Frankford Radio Club
Project: HamSCI Personal Space Weather Station Dashboard Development
"""

import glob
import os

from flask import Flask
from pymongo import MongoClient
from dotenv import load_dotenv


def _cleanup_tmp_files():
    """Delete any stale .in/.out files left in itu_r_hf/tmp from a prior crashed run."""
    tmp_dir = os.path.join(os.path.dirname(__file__), 'itu_r_hf', 'tmp')
    for pattern in ('*.in', '*.out'):
        for path in glob.glob(os.path.join(tmp_dir, pattern)):
            try:
                os.remove(path)
            except OSError:
                pass


def create_app():
    """
    Flask application factory.

    Creates and configures the Flask application with:
    - MongoDB database connection (from environment variables)
    - CQ zone geographic data (loaded from GeoJSON)
    - Route blueprints (views and API)

    Returns:
        Flask: Configured Flask application instance

    Raises:
        ValueError: If MONGODB_PASSWORD environment variable is not set
    """
    # Load environment variables from .env file
    load_dotenv()

    # Create Flask app
    app = Flask(__name__,
                static_url_path='',
                static_folder='static',
                template_folder='templates')

    # --- Database Configuration ---
    # Connect to MongoDB instance running WSPRDaemon database
    mongodb_host = os.getenv('MONGODB_HOST', 'localhost')
    mongodb_port = os.getenv('MONGODB_PORT', '27017')
    mongodb_username = os.getenv('MONGODB_USERNAME', 'admin')
    mongodb_password = os.getenv('MONGODB_PASSWORD')
    mongodb_database = os.getenv('MONGODB_DATABASE', 'wspr_db')

    if not mongodb_password:
        raise ValueError(
            "MONGODB_PASSWORD environment variable is not set. "
            "Please create a .env file (see .env.example)"
        )

    # Construct MongoDB connection URI
    mongodb_uri = f"mongodb://{mongodb_username}:{mongodb_password}@{mongodb_host}:{mongodb_port}"
    client = MongoClient(mongodb_uri)
    db = client[mongodb_database]

    # Store database references on app config for access via current_app
    app.config['MONGODB_CLIENT'] = client
    app.config['MONGODB_DB'] = db
    app.config['SPOTS_COLLECTION'] = db['spots']

    # --- Receiver Configuration ---
    # Loaded from .env (see .env.example for variable names)
    app.config['RECEIVER_GRIDSQUARE'] = os.getenv('RECEIVER_GRIDSQUARE', 'FN21ni')
    app.config['RECEIVER_CALLSIGN'] = os.getenv('RECEIVER_CALLSIGN', 'Unknown')

    # --- Load CQ Zone Data ---
    from services.geo import load_cq_zones
    app.config['CQ_ZONES'] = load_cq_zones(
        os.path.join(app.static_folder, 'js', 'cqzones.geojson')
    )

    # --- Register Blueprints ---
    from routes import register_blueprints
    register_blueprints(app)

    # --- Clean up stale ITU-R HF tmp files from any prior crashed runs ---
    _cleanup_tmp_files()

    return app
