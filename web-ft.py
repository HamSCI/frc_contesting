"""
HamSCI Contesting and DXing Dashboard - Backend API Server

This Flask application serves as the backend for the HamSCI Personal Space Weather Station (PSWS)
Contesting and DXing Dashboard. It provides real-time HF propagation data for amateur radio operators
by fetching WSPR, FT8, and FT4 digital mode spots from a MongoDB database.

The application supports multiple filtering options including:
- Time-based filtering (last N minutes)
- Band filtering (160m through 2m)
- Country/continent filtering
- CQ zone and ITU zone filtering
- Mode filtering (WSPR/FT8/FT4)

Author: Owen Ruzanski (KD3ALD)
Organization: University of Scranton (W3USR), Frankford Radio Club
Project: HamSCI Personal Space Weather Station Dashboard Development
"""

from flask import Flask, jsonify, render_template, request
from pymongo import MongoClient
import maidenhead
from geopy.geocoders import Nominatim
from datetime import datetime, timedelta
app = Flask(__name__,static_url_path='', static_folder='static', template_folder='templates')
import geopandas as gpd
from shapely.geometry import shape, Point
import json
import os
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

# Database Configuration
# Connect to MongoDB instance running WSPRDaemon database
# Database stores decoded WSPR, FT8, and FT4 spots from the PSWS receiver
MONGODB_HOST = os.getenv('MONGODB_HOST', 'localhost')
MONGODB_PORT = os.getenv('MONGODB_PORT', '27017')
MONGODB_USERNAME = os.getenv('MONGODB_USERNAME', 'admin')
MONGODB_PASSWORD = os.getenv('MONGODB_PASSWORD')
MONGODB_DATABASE = os.getenv('MONGODB_DATABASE', 'wspr_db')

if not MONGODB_PASSWORD:
    raise ValueError("MONGODB_PASSWORD environment variable is not set. Please create a .env file (see .env.example)")

# Construct MongoDB connection URI
MONGODB_URI = f"mongodb://{MONGODB_USERNAME}:{MONGODB_PASSWORD}@{MONGODB_HOST}:{MONGODB_PORT}"
client = MongoClient(MONGODB_URI)
db = client[MONGODB_DATABASE]
collection = db['spots']
#world = gpd.read_file("https://raw.githubusercontent.com/johan/world.geo.json/master/countries.geo.json")

# Load CQ Zone GeoJSON data for geographic lookups
# CQ zones are amateur radio operating zones used for contests and awards (40 zones globally)
with open("static/js/cqzones.geojson") as f:
    cq_data = json.load(f)

# Build list of (zone_number, shapely_geometry) tuples for point-in-polygon lookups
cq_zones = []
for feature in cq_data["features"]:
    zone_num = feature["properties"]["cq_zone_number"]
    geometry = shape(feature["geometry"])
    cq_zones.append((zone_num, geometry))



def get_cq_zone(lat, lon):
    """
    Determine which CQ zone contains a given geographic coordinate.

    CQ zones are geographical regions defined by CQ Magazine for amateur radio
    contesting and awards programs. There are 40 CQ zones worldwide.

    Args:
        lat (float): Latitude in decimal degrees (-90 to 90)
        lon (float): Longitude in decimal degrees (-180 to 180)

    Returns:
        int: CQ zone number (1-40) if found, None otherwise

    Example:
        >>> get_cq_zone(40.7128, -74.0060)  # New York City
        5
    """
    point = Point(lon, lat)  # Shapely uses (lon, lat) order, not (lat, lon)

    for zone_num, geometry in cq_zones:
        if geometry.contains(point):
            return zone_num

    return None  # Coordinate not inside any defined CQ zone



def frequency_to_band(freq):
    """
    Convert a frequency in MHz to an amateur radio band designation.

    Maps frequencies to standard amateur radio band names based on FCC amateur
    radio frequency allocations. Used to categorize spots by band for display
    and filtering purposes.

    Args:
        freq (float): Frequency in MHz (e.g., 14.097 for 20 meters)

    Returns:
        str: Band designation (e.g., "20m", "40m") or "Unknown" if not in an amateur band

    Example:
        >>> frequency_to_band(14.097)
        '20m'
        >>> frequency_to_band(7.074)
        '40m'
    """
    # Long wave bands
    if 0.136 <= freq < 0.137:
        return "2200m"
    if 0.472 <= freq < 0.479:
        return "630m"

    # HF bands (most commonly used for DX and contesting)
    if 1.8 <= freq < 2:
        return "160m"
    if 3.5 <= freq < 4:
        return "80m"
    if 5.2 <= freq < 5.5:
        return "60m"
    if 7.0 <= freq < 7.3:
        return "40m"
    if 10.1 <= freq < 10.15:
        return "30m"  # WARC band (no contests)
    if 14.0 <= freq < 14.35:
        return "20m"
    if 18.068 <= freq < 18.168:
        return "17m"  # WARC band (no contests)
    if 21.0 <= freq < 21.45:
        return "15m"
    if 24.89 <= freq < 24.99:
        return "12m"  # WARC band (no contests)
    if 28.0 <= freq < 29.7:
        return "10m"

    # VHF/UHF bands
    if 50.0 <= freq < 54.0:
        return "6m"
    if 144.0 <= freq < 148.0:
        return "2m"

    return "Unknown"




# Data Fetching Functions
def fetch_wspr_spots_tb(lastInterval=15):
    """
    Fetch WSPR/FT8/FT4 spots for table display with regional aggregation.

    Retrieves recent spots from MongoDB and returns simplified data optimized
    for the table view, which groups spots by geographic region and band.
    Includes CQ zone information for regional classification.

    Args:
        lastInterval (int): Number of minutes to look back from current time (default: 15)

    Returns:
        list[dict]: List of spot dictionaries containing:
            - id: Document ID
            - band: Amateur radio band (e.g., "20m")
            - grid: Maidenhead grid square (6-character)
            - time: Timestamp in "YYMMDD HHMM" format
            - cq_zone: CQ zone number (1-40)
            - mode: Digital mode ("wspr", "ft8", or "ft4")

    Database Schema:
        MongoDB documents contain:
        - date: String in YYMMDD format (e.g., "260107" for January 7, 2026)
        - time: String in HHMM format (e.g., "1430" for 14:30 UTC)
        - grid: Maidenhead grid square of transmitter
        - frequency: Frequency in MHz
        - mode: Mode type (wspr/ft8/ft4)
    """
    query = {}

    # Build time-based query using lastInterval parameter
    # Database stores timestamps as separate date and time strings (not datetime objects)
    if lastInterval:
        try:
            minutes = int(lastInterval)
            threshold = datetime.utcnow() - timedelta(minutes=minutes)
            # Convert threshold to database format: YYMMDD and HHMM strings
            threshold_date = f"{threshold.year % 100:02d}{threshold.month:02d}{threshold.day:02d}"
            threshold_time = f"{threshold.hour:02d}{threshold.minute:02d}"
            # Query for documents with date > threshold OR (date == threshold AND time >= threshold)
            query = {"$or": [
                {"date": {"$gt": threshold_date}},
                {"date": threshold_date, "time": {"$gte": threshold_time}}
            ]}
        except ValueError:
            query = {}  # Invalid interval, return all documents

    # Fetch and sort spots (newest first)
    docs = list(collection.find(query).sort([("date", -1), ("time", -1)]))

    # Reverse to display chronologically (earliest to latest)
    docs.reverse()
    results = []

    # Receiver location: FN21ni is KD3ALD station in New Jersey
    rxlat, rxlon = maidenhead.to_location("FN21ni")

    for doc in docs:
        # Convert transmitter grid square to coordinates
        txlat, txlon = maidenhead.to_location(doc.get("grid"))
        # Lookup CQ zone for regional classification
        zone = get_cq_zone(txlat, txlon)
        # Convert frequency to band name
        band = frequency_to_band(doc.get('frequency'))

        results.append({
            "id": f"${doc.get("_id")}",
            "band": band,
            "grid": f"{doc.get('grid')}",
            "time": f"{doc.get('date')} {doc.get('time')}",
            "cq_zone": zone,
            "mode": f"{doc.get('mode')}",
        })
    return results





def fetch_wspr_spots(lastInterval=15):
    """
    Fetch WSPR/FT8/FT4 spots for map display with full propagation details.

    Retrieves recent spots from MongoDB and returns complete data for map visualization,
    including both transmitter and receiver coordinates, signal quality metrics,
    and propagation path information.

    Args:
        lastInterval (int): Number of minutes to look back from current time (default: 15)

    Returns:
        list[dict]: List of spot dictionaries containing:
            - tx_sign: Transmitter callsign
            - tx_lat, tx_lon: Transmitter coordinates (decimal degrees)
            - rx_sign: Receiver callsign
            - rx_lat, rx_lon: Receiver coordinates (decimal degrees)
            - frequency: Frequency in MHz
            - band: Amateur radio band
            - mode: Digital mode (wspr/ft8/ft4)
            - snr: Signal-to-noise ratio in dB
            - drift: Frequency drift in Hz
            - time: Timestamp in "YYMMDD HHMM" format

    Notes:
        - Invalid grid squares default to 0,0 coordinates (equator/prime meridian)
        - Receiver location hardcoded to FN21ni (KD3ALD station)
        - Client-side filtering handles band/country/zone filtering
    """
    query = {}

    # Build time-based MongoDB query
    if lastInterval:
        try:
            minutes = int(lastInterval)
            threshold = datetime.utcnow() - timedelta(minutes=minutes)
            threshold_date = f"{threshold.year % 100:02d}{threshold.month:02d}{threshold.day:02d}"
            threshold_time = f"{threshold.hour:02d}{threshold.minute:02d}"
            query = {"$or": [
                {"date": {"$gt": threshold_date}},
                {"date": threshold_date, "time": {"$gte": threshold_time}}
            ]}
        except ValueError:
            query = {}

    # Fetch spots from database
    docs = list(collection.find(query).sort([("date", -1), ("time", -1)]))

    # Reverse to display chronologically (earliest to latest)
    docs.reverse()
    results = []

    # Receiver location: FN21ni grid square (northern New Jersey)
    rxlat, rxlon = maidenhead.to_location("FN21ni")

    for doc in docs:
        # Attempt to convert transmitter grid to coordinates
        try:
            txlat, txlon = maidenhead.to_location(doc.get("grid"))
        except Exception:
            # Invalid grid square, use default coordinates (ocean/null island)
            txlat, txlon = 0, 0

        results.append({
            "drift": doc.get("drift"),
            "frequency": doc.get("frequency"),
            "band": doc.get("band"),
            "mode": doc.get("mode"),
            "rx_lat": rxlat,
            "rx_lon": rxlon,
            "rx_sign": doc.get('rx_callsign'),
            "snr": doc.get("snr"),
            "time": f"{doc.get('date')} {doc.get('time')}",
            "tx_lat": txlat,
            "tx_lon": txlon,
            "tx_sign": doc.get('callsign'),
        })
    return results





# Flask Route Definitions
# ----------------------
# These routes define the web application's API endpoints and page views

@app.route('/')
def home():
    """
    Root route: Combined view with map and table side-by-side using iframes.

    Returns:
        HTML: Rendered both.html template showing dual-pane view
    """
    return render_template("both.html")

@app.route('/map')
def map():
    """
    Map view route: Interactive Leaflet map with spot visualization.

    Displays TX-RX propagation paths with colored markers indicating band,
    filtering controls, and real-time spot updates.

    Returns:
        HTML: Rendered index_ft.html template
    """
    return render_template('index_ft.html')

@app.route('/display')
def display():
    """
    Alternative display route (legacy).

    Returns:
        HTML: Rendered index_wcount.html template
    """
    return render_template('index_wcount.html')

@app.route('/spots')
def spots():
    """
    REST API endpoint: Fetch spots for map display.

    Query Parameters:
        lastInterval (str): Minutes to look back (default: "15")
        band (str): Band filter (optional, client-side filtering preferred)

    Returns:
        JSON: Array of spot objects with full TX/RX details

    Example:
        GET /spots?lastInterval=30
        Returns spots from the last 30 minutes
    """
    # Only lastInterval is used server-side; other filters are applied client-side
    lastInterval = request.args.get('lastInterval', '15')
    band = request.args.get('band')  # Currently unused but preserved for API compatibility
    spots = fetch_wspr_spots(lastInterval=lastInterval)
    return jsonify(spots)

@app.route('/tbspots')
def tbspots():
    """
    REST API endpoint: Fetch spots for table display.

    Optimized endpoint for table view with simplified data structure
    including CQ zone information for regional aggregation.

    Query Parameters:
        lastInterval (str): Minutes to look back (default: "15")
        band (str): Band filter (optional)

    Returns:
        JSON: Array of spot objects with band, grid, time, cq_zone, mode

    Example:
        GET /tbspots?lastInterval=15
        Returns spots from the last 15 minutes formatted for table view
    """
    lastInterval = request.args.get('lastInterval', '15')
    band = request.args.get('band')  # Currently unused
    spots = fetch_wspr_spots_tb(lastInterval=lastInterval)
    return jsonify(spots)

@app.route('/table')
def table():
    """
    Table view route: Regional band activity aggregation table.

    Displays spot counts organized by geographic region (based on CQ zones)
    and band, useful for quick assessment of band openings.

    Returns:
        HTML: Rendered table_ft.html template
    """
    return render_template("table_ft.html")

# Application Entry Point
if __name__ == '__main__':
    """
    Start Flask development server.

    Debug mode is enabled for development. For production deployment,
    use a production WSGI server like gunicorn or uwsgi.

    Example production command:
        gunicorn -w 4 -b 0.0.0.0:5000 web-ft:app
    """
    app.run(debug=True)