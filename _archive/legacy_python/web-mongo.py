from flask import Flask, jsonify, render_template, request
from pymongo import MongoClient
import maidenhead
from geopy.geocoders import Nominatim
app = Flask(__name__,static_url_path='', static_folder='static', template_folder='templates')
import geopandas as gpd
from shapely.geometry import Point


# setup db connection / collection
# station w3usr client = MongoClient('mongodb://admin:***REDACTED***@localhost:5001')
client = MongoClient("mongodb://admin:***REDACTED***@***REDACTED_HOST***:27017")
#client = MongoClient('mongodb://admin:***REDACTED***@***REDACTED_HOST***:27017')
db = client['wspr_db']
collection = db['spots']

#world = gpd.read_file("https://raw.githubusercontent.com/johan/world.geo.json/master/countries.geo.json")

countries = gpd.read_file('static/js/world.geojson')

def grid_to_country(grid):
    # Convert Maidenhead grid square to lat/lon
    lat, lon = maidenhead.to_location(grid)  # returns (lat, lon)
    point = Point(lon, lat)
    #print(countries.columns)
    # Find which polygon contains this point
    for _, row in countries.iterrows():
        if row['geometry'].contains(point):
            return row['NAME']
    return "Unknown"


# def grid_to_country(grid):
#     try:

#         lat, lon = maidenhead.to_location(grid)  # Returns (lat, lon)

#         geolocator = Nominatim(user_agent="grid_to_country")
#         location = geolocator.reverse((lat, lon), language='en')
#         country = location.raw['address']['country']
#         return country
#     except Exception:
#         return "Unknown"
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
def fetch_wspr_spots_tb(numSpots=50, date=None, time=None):
    query = {}

    if date:
        query['date'] = date

    if time and isinstance(time, str):
        if len(time) in (2, 4):  # hour only ("14") or HHMM ("1400")
            hour = int(time[:2])   # just take the first two digits
            start = hour * 100     # 14 -> 1400
            end = start + 59       # 1459
            # Adjust depending on whether your DB stores time as str or int
            query['time'] = {"$gte": str(start).zfill(4), "$lte": str(end).zfill(4)}

    docs = list(collection.find(query).sort([("date", -1), ("time", -1)]).limit(numSpots))

    # reverse so they display earliest latest
    docs.reverse()
    results = []
    rxlat, rxlon = maidenhead.to_location("FN21ni")

    for doc in docs:
        txcountry = grid_to_country(doc.get("grid"))
        band = frequency_to_band(doc.get('frequency'))
        results.append({
            "id": f"${doc.get("_id")}",
            "band": band,
            "grid": f"{doc.get('grid')}",
            "time": f"{doc.get('date')} {doc.get('time')}",
            "txcountry": txcountry,
        })
    return results





def fetch_wspr_spots(numSpots=50, date=None, time=None):

    query = {}

    if date:
        query['date'] = date

    if time and isinstance(time, str):
        if len(time) in (2, 4):  # hour only ("14") or HHMM ("1400")
            hour = int(time[:2])   # just take the first two digits
            start = hour * 100     # 14 -> 1400
            end = start + 59       # 1459
            # Adjust depending on whether your DB stores time as str or int
            query['time'] = {"$gte": str(start).zfill(4), "$lte": str(end).zfill(4)}

    docs = list(collection.find(query).sort([("date", -1), ("time", -1)]).limit(numSpots))

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
    return render_template('index_wcount.html')
@app.route('/display')
def display():
    return render_template('index_wcount.html')
@app.route('/spots')
def spots():
    numSpots = request.args.get('numSpots', 50)
    try:
        numSpots = int(numSpots)
    except ValueError:
        numSpots = 50
    date = request.args.get('date')
    time = request.args.get('time')
    band = request.args.get('band')

    spots = fetch_wspr_spots(numSpots=numSpots, date=date, time=time)
    return jsonify(spots)

@app.route('/tbspots')
def tbspots():
    numSpots = request.args.get('numSpots', 50)
    try:
        numSpots = int(numSpots)
    except ValueError:
        numSpots = 50
    date = request.args.get('date')
    time = request.args.get('time')
    band = request.args.get('band')

    spots = fetch_wspr_spots_tb(numSpots=numSpots, date=date, time=time)
    return jsonify(spots)

@app.route('/table')
def table():
    return render_template("table.html")

if __name__ == '__main__':
    app.run(debug=True)
