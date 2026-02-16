"""
Geographic data processing for the HamSCI Dashboard.

Handles CQ zone GeoJSON loading and point-in-polygon lookups
for determining which CQ zone contains a given coordinate.
"""

import json
from shapely.geometry import shape, Point


def load_cq_zones(geojson_path):
    """
    Load CQ zone boundaries from a GeoJSON file.

    Reads CQ zone polygons and builds a list of (zone_number, geometry) tuples
    for efficient point-in-polygon lookups.

    Args:
        geojson_path (str): Absolute path to cqzones.geojson file.

    Returns:
        list[tuple]: List of (zone_number, shapely_geometry) tuples.
    """
    with open(geojson_path) as f:
        cq_data = json.load(f)

    cq_zones = []
    for feature in cq_data["features"]:
        zone_num = feature["properties"]["cq_zone_number"]
        geometry = shape(feature["geometry"])
        cq_zones.append((zone_num, geometry))

    return cq_zones


def get_cq_zone(lat, lon, cq_zones):
    """
    Determine which CQ zone contains a given geographic coordinate.

    CQ zones are geographical regions defined by CQ Magazine for amateur radio
    contesting and awards programs. There are 40 CQ zones worldwide.

    Args:
        lat (float): Latitude in decimal degrees (-90 to 90)
        lon (float): Longitude in decimal degrees (-180 to 180)
        cq_zones (list[tuple]): List of (zone_number, geometry) tuples from load_cq_zones().

    Returns:
        int: CQ zone number (1-40) if found, None otherwise

    Example:
        >>> cq_zones = load_cq_zones("static/js/cqzones.geojson")
        >>> get_cq_zone(40.7128, -74.0060, cq_zones)  # New York City
        5
    """
    point = Point(lon, lat)  # Shapely uses (lon, lat) order, not (lat, lon)

    for zone_num, geometry in cq_zones:
        if geometry.contains(point):
            return zone_num

    return None  # Coordinate not inside any defined CQ zone
