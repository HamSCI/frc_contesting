import os
from pymongo import MongoClient
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), '..', '.env'))

mongodb_host      = os.getenv('MONGODB_HOST', 'localhost')
mongodb_port      = os.getenv('MONGODB_PORT', '27017')
mongodb_username  = os.getenv('MONGODB_USERNAME')
mongodb_password  = os.getenv('MONGODB_PASSWORD')
mongodb_database  = os.getenv('MONGODB_DATABASE', 'wspr_db')
receiver_callsign = os.getenv('RECEIVER_CALLSIGN', 'Unknown')

if mongodb_username and mongodb_password:
    uri = f"mongodb://{mongodb_username}:{mongodb_password}@{mongodb_host}:{mongodb_port}"
else:
    uri = f"mongodb://{mongodb_host}:{mongodb_port}"

client = MongoClient(uri)
collection = client[mongodb_database]['spots']


def frequency_to_band(freq_mhz):
    if 0.136  <= freq_mhz < 0.137:  return "2200m"
    if 0.472  <= freq_mhz < 0.479:  return "630m"
    if 1.8    <= freq_mhz < 2.0:    return "160m"
    if 3.5    <= freq_mhz < 4.0:    return "80m"
    if 5.2    <= freq_mhz < 5.5:    return "60m"
    if 7.0    <= freq_mhz < 7.3:    return "40m"
    if 10.1   <= freq_mhz < 10.15:  return "30m"
    if 14.0   <= freq_mhz < 14.35:  return "20m"
    if 18.068 <= freq_mhz < 18.168: return "17m"
    if 21.0   <= freq_mhz < 21.45:  return "15m"
    if 24.89  <= freq_mhz < 24.99:  return "12m"
    if 28.0   <= freq_mhz < 29.7:   return "10m"
    if 50.0   <= freq_mhz < 54.0:   return "6m"
    if 144.0  <= freq_mhz < 148.0:  return "2m"
    return "Unknown"


SPOTS_FILE = '/dev/shm/wsprdaemon/uploads/wsprnet/spots.txt'

with open(SPOTS_FILE, 'r') as f:
    for line in f:
        parts = line.strip().split()
        if len(parts) < 8:
            continue

        freq_mhz = float(parts[5])
        callsign = parts[6].strip('<>')

        document = {
            "date":        parts[0],
            "time":        parts[1],
            "snr":         float(parts[2]),
            "db":          int(parts[3]),
            "drift":       float(parts[4]),
            "frequency":   freq_mhz,
            "callsign":    callsign,
            "grid":        parts[7],
            "rx_callsign": receiver_callsign,
            "mode":        "wspr",
            "band":        frequency_to_band(freq_mhz),
        }

        # Upsert on natural key to avoid duplicates if called multiple times
        key = {k: document[k] for k in ("date", "time", "callsign", "frequency")}
        collection.update_one(key, {"$set": document}, upsert=True)
