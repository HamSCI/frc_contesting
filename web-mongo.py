from flask import Flask, jsonify, render_template, request
from pymongo import MongoClient
import maidenhead

app = Flask(__name__)
client = MongoClient('mongodb://admin:***REDACTED***@localhost:5001')

db = client['wspr_db']
collection = db['spots']
def fetch_wspt_spots(numSpots=0, date=None, time=0):
    query = {}
    if date != 'null':
        query['date'] = date
    if time != 'null':
        query['time'] = {"$regex": f"^{time[:2]}"}
    
    cursor = collection.find(query).sort("date", -1).limit(numSpots)
    results = []
    rxlat, rxlon = maidenhead.to_location("FN21ej")

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

@app.route('/')
def home():
    return render_template('index.html')
@app.route('/display')
def display():
    return render_template('index_wcount.html')
@app.route('/onload')
def onload():
    return render_template('onload.js')

@app.route('/spots')
# def spots():
#     rx_callsign = request.args.get('rx_callsign')  # expects receiver callsign only
#     numSpots = request.args.get('numSpots')
#     spots = fetch_wspt_spots(numSpots=numSpots)
#     return jsonify(spots)
def spots():
    numSpots = request.args.get('numSpots', 50)
    try:
        numSpots = int(numSpots)
    except ValueError:
        numSpots = 50
    date = request.args.get('date')
    time = request.args.get('time')
    spots = fetch_wspt_spots(numSpots=numSpots, date=date, time=time)
    return jsonify(spots)
@app.route('/mapjs')
def mapjs():
    return render_template('map.js')

if __name__ == '__main__':
    app.run(debug=True)
