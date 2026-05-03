#!/usr/bin/env python3
"""
Fetch one WSPR cycle of HF contest band spots from wspr.live and save as JSON + CSV.
Targets the most recently completed 2-minute cycle (~5 minutes ago).
Writes spots_YYYYMMDD_HHMM.json and spots_YYYYMMDD_HHMM.csv to this directory.
"""

import csv
import json
import os
import sys
import urllib.parse
import urllib.request
from datetime import datetime, timezone

API_URL = "http://db1.wspr.live/"

QUERY = """
SELECT
    id, time, band,
    rx_sign, rx_lat, rx_lon, rx_loc,
    tx_sign, tx_lat, tx_lon, tx_loc,
    distance, azimuth, rx_azimuth,
    frequency, power, snr, drift,
    version, code
FROM wspr.rx
WHERE time >= toStartOfInterval(now() - INTERVAL 19 MINUTE, INTERVAL 2 MINUTE)
  AND time <= toStartOfInterval(now() - INTERVAL 5 MINUTE, INTERVAL 2 MINUTE)
  AND band IN (1, 3, 7, 14, 21, 28)
  AND tx_lat BETWEEN 36.5 AND 46.5
  AND tx_lon BETWEEN -77.5 AND -72.5
ORDER BY band ASC
FORMAT JSONEachRow
""".strip()


def fetch_spots():
    params = urllib.parse.urlencode({"query": QUERY})
    url = f"{API_URL}?{params}"

    with urllib.request.urlopen(url, timeout=30) as resp:
        body = resp.read().decode("utf-8")

    if body.startswith("Code."):
        raise RuntimeError(f"ClickHouse error: {body[:300]}")

    spots = []
    for line in body.strip().splitlines():
        if line:
            spots.append(json.loads(line))

    return spots


def save_json(spots, path):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(spots, f, indent=2, default=str)
    print(f"  JSON : {path}")


def save_csv(spots, path):
    if not spots:
        return
    with open(path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=list(spots[0].keys()))
        writer.writeheader()
        writer.writerows(spots)
    print(f"  CSV  : {path}")


def main():
    print("Fetching WSPR spots from wspr.live ...")

    try:
        spots = fetch_spots()
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        sys.exit(1)

    if not spots:
        print("No spots returned — cycle may not have fully uploaded yet.", file=sys.stderr)
        sys.exit(1)

    cycle_time_str = spots[0].get("time", "")
    try:
        cycle_dt = datetime.strptime(cycle_time_str, "%Y-%m-%d %H:%M:%S")
        file_tag = cycle_dt.strftime("%Y%m%d_%H%M")
    except (ValueError, TypeError):
        file_tag = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M")

    out_dir = os.path.dirname(os.path.abspath(__file__))
    json_path = os.path.join(out_dir, f"spots_{file_tag}.json")
    csv_path  = os.path.join(out_dir, f"spots_{file_tag}.csv")

    print(f"  Cycle : {cycle_time_str}")
    print(f"  Spots : {len(spots)}")
    save_json(spots, json_path)
    save_csv(spots, csv_path)


if __name__ == "__main__":
    main()
