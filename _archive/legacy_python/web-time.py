from flask import Flask, jsonify, render_template, request
from pymongo import MongoClient
import maidenhead
from geopy.geocoders import Nominatim
from datetime import datetime, timedelta
app = Flask(__name__,static_url_path='', static_folder='static', template_folder='templates')
import geopandas as gpd
from shapely.geometry import shape, Point
import json


# setup db connection / collection
# DEPRECATED: This file is archived legacy code
# Credentials have been redacted for security
# See current web-ft.py for proper environment variable usage
client = MongoClient('mongodb://admin:REDACTED@REDACTED:27017')
db = client['wspr_db']
collection = db['spots_uacnj']
#world = gpd.read_file("https://raw.githubusercontent.com/johan/world.geo.json/master/countries.geo.json")

with open("static/js/cqzones.geojson") as f:
    cq_data = json.load(f)

cq_zones = []
for feature in cq_data["features"]:
    zone_num = feature["properties"]["cq_zone_number"]
    geometry = shape(feature["geometry"])
    cq_zones.append((zone_num, geometry))



def get_cq_zone(lat, lon):
    point = Point(lon, lat)  # Shapely uses (lon, lat)

    for zone_num, geometry in cq_zones:
        if geometry.contains(point):
            return zone_num

    return None  # Not inside any CQ zone



def frequency_to_band(freq):
    if 0.136 <= freq < 0.137:
        return "2200m"
    if 0.472 <= freq < 0.479:
        return "630m"
    if 1.8 <= freq < 2:
        return "160m"
    if 3.5 <= freq < 4:
        return "80m"
    if 5.2 <= freq < 5.5:
        return "60m"
    if 7.0 <= freq < 7.3:
        return "40m"
    if 10.1 <= freq < 10.15:
        return "30m"
    if 14.0 <= freq < 14.35:
        return "20m"
    if 18.068 <= freq < 18.168:
        return "17m"
    if 21.0 <= freq < 21.45:
        return "15m"
    if 24.89 <= freq < 24.99:
        return "12m"
    if 28.0 <= freq < 29.7:
        return "10m"
    if 50.0 <= freq < 54.0:
        return "6m"
    if 144.0 <= freq < 148.0:
        return "2m"
    return "Unknown"




# fetch from db
def fetch_wspr_spots_tb(lastInterval=15):
    query = {}

    # If lastInterval is provided, build a range query for date/time >= (now - lastInterval minutes)
    if lastInterval:
        try:
            minutes = int(lastInterval)
            threshold = datetime.utcnow() - timedelta(minutes=minutes)
            # DB stores date as YYMMDD and time as HHMM (strings)
            threshold_date = f"{threshold.year % 100:02d}{threshold.month:02d}{threshold.day:02d}"
            threshold_time = f"{threshold.hour:02d}{threshold.minute:02d}"
            # Match documents with date greater than threshold_date OR date == threshold_date and time >= threshold_time
            query = {"$or": [
                {"date": {"$gt": threshold_date}},
                {"date": threshold_date, "time": {"$gte": threshold_time}}
            ]}
        except ValueError:
            query = {}
    docs = list(collection.find(query).sort([("date", -1), ("time", -1)]))

    # reverse so they display earliest latest
    docs.reverse()
    results = []
    rxlat, rxlon = maidenhead.to_location("FN21ni")

    for doc in docs:
        txlat, txlon = maidenhead.to_location(doc.get("grid"))
        zone = get_cq_zone(txlat, txlon)
        band = frequency_to_band(doc.get('frequency'))
        results.append({
            "id": f"${doc.get("_id")}",
            "band": band,
            "grid": f"{doc.get('grid')}",
            "time": f"{doc.get('date')} {doc.get('time')}",
            "cq_zone": zone,
        })
    return results





def fetch_wspr_spots(lastInterval=15):
    query = {}

    # If lastInterval is provided, build a range query based on UTC now
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
    docs = list(collection.find(query).sort([("date", -1), ("time", -1)]))

    # reverse so they display earliest latest
    docs.reverse()
    results = []
    rxlat, rxlon = maidenhead.to_location("FN21ni")

    for doc in docs:
        try:
            txlat, txlon = maidenhead.to_location(doc.get("grid"))
        except Exception:
            txlat, txlon = 0, 0
        results.append({
            "drift": doc.get("drift"),
            "frequency": doc.get("frequency"),
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





# route paths
@app.route('/')
def home():
    return render_template("both.html")
@app.route('/map')
def map():
    return render_template('index_time.html')
@app.route('/display')
def display():
    return render_template('index_wcount.html')
@app.route('/spots')
def spots():
    # Only lastInterval is used server-side; other filters are applied client-side
    lastInterval = request.args.get('lastInterval', '15')
    band = request.args.get('band')
    spots = fetch_wspr_spots(lastInterval=lastInterval)
    return jsonify(spots)

@app.route('/tbspots')
def tbspots():
    lastInterval = request.args.get('lastInterval', '15')
    band = request.args.get('band')
    spots = fetch_wspr_spots_tb(lastInterval=lastInterval)
    return jsonify(spots)

@app.route('/table')
def table():
    return render_template("table_time.html")

if __name__ == '__main__':
    app.run(debug=True)