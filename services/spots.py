"""
Spot data fetching and processing for the HamSCI Dashboard.

Handles MongoDB queries for WSPR/FT8/FT4 spots and transforms
raw database documents into structured data for the API responses.
"""

from datetime import datetime, timedelta

import maidenhead
from flask import current_app

from services.geo import get_cq_zone
from utils.bands import frequency_to_band


def _build_time_query(last_interval):
    """
    Build a MongoDB time-range query.

    Constructs a query filter that matches documents within the last N minutes,
    using the database's YYMMDD date and HHMM time string format.

    Args:
        last_interval: Number of minutes to look back (as int or string).

    Returns:
        dict: MongoDB query filter, or empty dict on error.
    """
    try:
        minutes = int(last_interval)
        threshold = datetime.utcnow() - timedelta(minutes=minutes)
        # Convert threshold to database format: YYMMDD and HHMM strings
        threshold_date = f"{threshold.year % 100:02d}{threshold.month:02d}{threshold.day:02d}"
        threshold_time = f"{threshold.hour:02d}{threshold.minute:02d}"
        # Query for documents with date > threshold OR (date == threshold AND time >= threshold)
        return {"$or": [
            {"date": {"$gt": threshold_date}},
            {"date": threshold_date, "time": {"$gte": threshold_time}}
        ]}
    except (ValueError, TypeError):
        return {}


def fetch_spots_for_table(last_interval=15):
    """
    Fetch WSPR/FT8/FT4 spots for table display with regional aggregation.

    Retrieves recent spots from MongoDB and returns simplified data optimized
    for the table view, which groups spots by geographic region and band.
    Includes CQ zone information for regional classification.

    Args:
        last_interval (int): Number of minutes to look back from current time (default: 15)

    Returns:
        list[dict]: List of spot dictionaries containing:
            - id: Document ID
            - band: Amateur radio band (e.g., "20m")
            - grid: Maidenhead grid square (6-character)
            - time: Timestamp in "YYMMDD HHMM" format
            - cq_zone: CQ zone number (1-40)
            - mode: Digital mode ("wspr", "ft8", or "ft4")
    """
    collection = current_app.config['SPOTS_COLLECTION']
    cq_zones = current_app.config['CQ_ZONES']
    query = _build_time_query(last_interval)

    # Fetch and sort spots (newest first), then reverse for chronological order
    docs = list(collection.find(query).sort([("date", -1), ("time", -1)]))
    docs.reverse()

    # Receiver location from configured grid square
    rxlat, rxlon = maidenhead.to_location(current_app.config['RECEIVER_GRID'])

    results = []
    for doc in docs:
        # Convert transmitter grid square to coordinates
        txlat, txlon = maidenhead.to_location(doc.get("grid"))
        # Lookup CQ zone for regional classification
        zone = get_cq_zone(txlat, txlon, cq_zones)
        # Convert frequency to band name
        band = frequency_to_band(doc.get('frequency'))

        results.append({
            "id": f"${doc.get('_id')}",
            "band": band,
            "grid": f"{doc.get('grid')}",
            "time": f"{doc.get('date')} {doc.get('time')}",
            "cq_zone": zone,
            "mode": f"{doc.get('mode')}",
        })

    return results


def fetch_spots_for_map(last_interval=15):
    """
    Fetch WSPR/FT8/FT4 spots for map display with full propagation details.

    Retrieves recent spots from MongoDB and returns complete data for map visualization,
    including both transmitter and receiver coordinates, signal quality metrics,
    and propagation path information.

    Args:
        last_interval (int): Number of minutes to look back from current time (default: 15)

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
        - Client-side filtering handles band/country/zone filtering
    """
    collection = current_app.config['SPOTS_COLLECTION']
    query = _build_time_query(last_interval)

    # Fetch and sort spots (newest first), then reverse for chronological order
    docs = list(collection.find(query).sort([("date", -1), ("time", -1)]))
    docs.reverse()

    # Receiver location from configured grid square
    rxlat, rxlon = maidenhead.to_location(current_app.config['RECEIVER_GRID'])

    results = []
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
            "band": frequency_to_band(doc.get("frequency")),
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
