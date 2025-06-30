from flask import Flask, jsonify, render_template, request
from pymongo import MongoClient
import maidenhead

app = Flask(__name__,static_url_path='', static_folder='static', template_folder='templates')

# setup db connection / collection
# station w3usr client = MongoClient('mongodb://admin:***REDACTED***@localhost:5001')
client = MongoClient("mongodb://admin:***REDACTED***@10.5.0.19:27017")
#client = MongoClient('mongodb://admin:***REDACTED***@***REDACTED_HOST***:27017')
db = client['wspr_db']
collection = db['spots']

# fetch from db
def fetch_wspt_spots(numSpots=50, date=None, time=None):
    query = {}

    if date:
        query['date'] = date
    if time and isinstance(time, str) and len(time) >= 2:
        query['time'] = {"$regex": f"^{time[:2]}"}
    
    
    cursor = collection.find(query).sort("date", -1).limit(numSpots)
    results = []
    rxlat, rxlon = maidenhead.to_location("FN21ni")

    for doc in cursor:

        try:
            txlat, txlon = maidenhead.to_location(doc.get("grid"))
        except:
            txlat,txlon = 0,0
        results.append({
            "drift": doc.get("drift"),
            "frequency": doc.get("frequency"),
            "rx_lat": rxlat,
            "rx_lon": rxlon,
            "rx_sign": doc.get('rx_callsign'),
            "snr": doc.get("snr"),
            "time": doc.get("date") +  " " + doc.get('time'),
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

    spots = fetch_wspt_spots(numSpots=numSpots, date=date, time=time)
    return jsonify(spots)

if __name__ == '__main__':
    app.run(debug=True)
