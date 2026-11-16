// aeqd.js — great-circle (azimuthal equidistant) map centred on the station (#71).
// Must be loaded after leaflet.js and solar.js (Solar.destination).
//
// On this map a spot's direction from the centre is its true beam heading
// and its distance from the centre is its great-circle distance; great
// circles through the station are straight lines.  The rim of the disc is
// the antipode (~20,000 km).  Implemented as a plain Leaflet CRS (no extra
// libraries), so zoom/pan, popups and the canvas spot symbols just work.
// Projected units are metres from the station; the scale matches Web
// Mercator's, so zoom levels feel the same.

const AEQD = {
  R: 6378137,
  RAD: Math.PI / 180,

  /** Leaflet CRS for an azimuthal equidistant projection centred on (lat0, lon0). */
  crs(lat0, lon0) {
    const R = this.R, d2r = this.RAD;
    const p0 = lat0 * d2r, l0 = lon0 * d2r;
    const sp0 = Math.sin(p0), cp0 = Math.cos(p0);
    const projection = {
      project(ll) {
        const p = ll.lat * d2r, dl = ll.lng * d2r - l0;
        const sp = Math.sin(p), cp = Math.cos(p), cdl = Math.cos(dl);
        const cosc = Math.max(-1, Math.min(1, sp0 * sp + cp0 * cp * cdl));
        const c = Math.acos(cosc);
        const k = c < 1e-9 ? 1 : c / Math.sin(c);
        // At the antipode (c = pi) the direction is undefined: put it on the rim.
        if (!Number.isFinite(k)) return L.point(0, -Math.PI * R);
        return L.point(R * k * cp * Math.sin(dl), R * k * (cp0 * sp - sp0 * cp * cdl));
      },
      unproject(pt) {
        const x = pt.x / R, y = pt.y / R;
        const c = Math.min(Math.PI, Math.hypot(x, y));
        if (c < 1e-12) return L.latLng(lat0, lon0);
        const sc = Math.sin(c), cc = Math.cos(c);
        const lat = Math.asin(Math.max(-1, Math.min(1, cc * sp0 + y * sc * cp0 / c)));
        const lng = l0 + Math.atan2(x * sc, c * cp0 * cc - y * sp0 * sc);
        return L.latLng(lat / d2r, ((lng / d2r + 540) % 360) - 180);
      },
      bounds: L.bounds([-Math.PI * R, -Math.PI * R], [Math.PI * R, Math.PI * R]),
    };
    const s = 0.5 / (Math.PI * R);
    return L.extend({}, L.CRS.Earth, {
      code: "AEQD",
      projection,
      transformation: new L.Transformation(s, 0.5, -s, 0.5),
      wrapLng: null,            // longitudes are not periodic on this map
      center: [lat0, lon0],
    });
  },

  /** Great-circle bearing (deg from N) and distance (km) from a to b ([lat, lon]). */
  bearingDistance(a, b) {
    const d2r = this.RAD;
    const p1 = a[0] * d2r, p2 = b[0] * d2r, dl = (b[1] - a[1]) * d2r;
    const y = Math.sin(dl) * Math.cos(p2);
    const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
    const brg = (Math.atan2(y, x) / d2r + 360) % 360;
    const h = Math.sin((p2 - p1) / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
    const km = 2 * 6371.0088 * Math.asin(Math.min(1, Math.sqrt(h)));
    return { bearing: brg, km };
  },

  /**
   * Make GeoJSON safe to draw on this CRS: an edge that jumps across the disc
   * (it passes near the antipode, where every direction meets) is cut.  A
   * polygon with such an edge can't be filled correctly, so it is turned into
   * its outline (split at the cuts); everything else is unchanged.
   */
  cutSeams(geojson, crs) {
    const limit = Math.PI * this.R * 0.5;
    const proj = c => crs.projection.project(L.latLng(c[1], c[0]));
    const splitLine = coords => {
      const out = [];
      let cur = [], prev = null;
      for (const c of coords) {
        const p = proj(c);
        if (prev && p.distanceTo(prev) > limit) { if (cur.length > 1) out.push(cur); cur = []; }
        cur.push(c);
        prev = p;
      }
      if (cur.length > 1) out.push(cur);
      return out;
    };
    const fixGeom = g => {
      if (!g) return g;
      if (g.type === "Polygon" || g.type === "MultiPolygon") {
        const polys = g.type === "Polygon" ? [g.coordinates] : g.coordinates;
        let seam = false;
        const lines = [];
        polys.forEach(rings => rings.forEach(ring => {
          const parts = splitLine(ring);
          if (parts.length !== 1 || parts[0].length !== ring.length) seam = true;
          lines.push(...parts);
        }));
        return seam ? { type: "MultiLineString", coordinates: lines, seam: true } : g;
      }
      if (g.type === "LineString") return { type: "MultiLineString", coordinates: splitLine(g.coordinates) };
      if (g.type === "MultiLineString") return { type: "MultiLineString", coordinates: g.coordinates.flatMap(splitLine) };
      return g;
    };
    const fixFeature = f => ({ ...f, geometry: fixGeom(f.geometry) });
    if (Array.isArray(geojson)) return geojson.map(fixFeature);
    if (geojson.type === "FeatureCollection") return { ...geojson, features: geojson.features.map(fixFeature) };
    if (geojson.type === "Feature") return fixFeature(geojson);
    return fixGeom(geojson);
  },

  /** Points [lat, lon] of the circle at `km` from the centre. */
  circle(center, km, steps = 180) {
    const d = km / 6371.0088 / this.RAD;
    const pts = [];
    for (let i = 0; i <= steps; i++) pts.push(Solar.destination(center[0], center[1], d, i * 360 / steps));
    return pts;
  },

  /** Range rings, bearing spokes and rim labels as one layer group. */
  graticule(center, pane) {
    const g = L.layerGroup();
    const style = { pane, interactive: false, color: "#5b6b86", weight: 0.8, opacity: 0.55 };
    for (let km = 2500; km < 20000; km += 2500) {
      L.polyline(this.circle(center, km), { ...style, dashArray: km % 5000 ? "2 5" : null }).addTo(g);
      const at = Solar.destination(center[0], center[1], km / 6371.0088 / this.RAD, 45);
      L.marker(at, { pane, interactive: false, icon: L.divIcon({
        className: "aeqd-ring-label", html: `${km.toLocaleString()} km`, iconSize: [70, 14], iconAnchor: [0, 7] }) }).addTo(g);
    }
    for (let brg = 0; brg < 360; brg += 30) {
      const pts = [];
      for (let km = 0; km <= 19800; km += 300) pts.push(Solar.destination(center[0], center[1], km / 6371.0088 / this.RAD, brg));
      L.polyline(pts, { ...style, opacity: brg % 90 ? 0.35 : 0.6 }).addTo(g);
    }
    L.polyline(this.circle(center, 20015, 360), { ...style, color: "#8796b0", weight: 1.5, opacity: 0.9 }).addTo(g);
    [["N", 0], ["E", 90], ["S", 180], ["W", 270]].forEach(([name, brg]) => {
      const at = Solar.destination(center[0], center[1], 172, brg);
      L.marker(at, { pane, interactive: false, icon: L.divIcon({
        className: "aeqd-rim-label", html: name, iconSize: [18, 18], iconAnchor: [9, 9] }) }).addTo(g);
    });
    return g;
  },

  /**
   * Leaflet polygon latlngs for the region where the sun is below `alt` (see
   * Solar.ring).  When that cap contains the antipode it surrounds the whole
   * rim, so it is drawn as the disc with the ring as a hole.
   */
  solarRegion(center, date, alt) {
    const { pts, center: cap, radius } = Solar.ring(date, alt, 360);
    const anti = [-center[0], center[1] + 180];
    const dAnti = this.bearingDistance(cap, anti).km / 6371.0088 / this.RAD;
    if (dAnti < radius) return [this.circle(center, 20000, 360), pts];
    return [pts];
  },
};
