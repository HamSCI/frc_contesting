"""
HamSCI Contesting and DXing Dashboard - Application Factory

Creates and configures the Flask application with all extensions,
database connections, and route registrations.

Author: Owen Ruzanski (KD3ALD)
Organization: University of Scranton (W3USR), Frankford Radio Club
Project: HamSCI Personal Space Weather Station Dashboard Development
"""

import os

from flask import Flask
from pymongo import MongoClient
from dotenv import load_dotenv


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
    # Hardcoded default for now; Issue #38 will extract this to .env
    app.config['RECEIVER_GRID'] = os.getenv('RECEIVER_GRID', 'FN21ni')

    # --- Load CQ Zone Data ---
    from services.geo import load_cq_zones
    app.config['CQ_ZONES'] = load_cq_zones(
        os.path.join(app.static_folder, 'js', 'cqzones.geojson')
    )

    # --- Register Blueprints ---
    from routes import register_blueprints
    register_blueprints(app)

    return app
