// solar.js — sun position, day/night terminator and twilight regions (#72).
// Pure math, no data and no network (FR-OFF-01/07); usable by any map
// projection: everything is generated in lat/lon.
//
// Subsolar point: NOAA low-precision solar coordinates (declination and the
// equation of time from the mean longitude/anomaly), well under 0.1 deg.
// The region where the sun is below altitude h is a spherical cap centred on
// the antisolar point with angular radius 90 deg + h, so night (h = 0) and the
// civil/nautical/astronomical twilight limits (-6/-12/-18) are all small
// circles around one point.

const Solar = {
  RAD: Math.PI / 180,

  /** Subsolar point {lat, lon} in degrees for a Date (UTC). */
  subsolar(date = new Date()) {
    const R = this.RAD;
    const n = date.getTime() / 86400000 + 2440587.5 - 2451545.0;      // days since J2000
    const L = ((280.460 + 0.9856474 * n) % 360 + 360) % 360;          // mean longitude
    const g = ((357.528 + 0.9856003 * n) % 360 + 360) % 360 * R;      // mean anomaly
    const lambda = (L + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * R;  // ecliptic longitude
    const eps = (23.439 - 0.0000004 * n) * R;                         // obliquity
    const decl = Math.asin(Math.sin(eps) * Math.sin(lambda));
    const ra = Math.atan2(Math.cos(eps) * Math.sin(lambda), Math.cos(lambda)) / R;
    let eot = L - ((ra % 360) + 360) % 360;                            // equation of time, deg
    if (eot > 180) eot -= 360;
    if (eot < -180) eot += 360;
    const utcHours = (date.getTime() % 86400000) / 3600000;
    let lon = -15 * (utcHours - 12) - eot;
    lon = ((lon + 180) % 360 + 360) % 360 - 180;
    return { lat: decl / R, lon };
  },

  /** Point at angular distance d (deg) and bearing brg (deg) from (lat, lon). */
  destination(lat, lon, d, brg) {
    const R = this.RAD;
    const p1 = lat * R, l1 = lon * R, dd = d * R, th = brg * R;
    const p2 = Math.asin(Math.sin(p1) * Math.cos(dd) + Math.cos(p1) * Math.sin(dd) * Math.cos(th));
    const l2 = l1 + Math.atan2(Math.sin(th) * Math.sin(dd) * Math.cos(p1), Math.cos(dd) - Math.sin(p1) * Math.sin(p2));
    return [p2 / R, l2 / R];
  },

  /**
   * Boundary ring (closed, [[lat, lon], ...]) of the region where the sun is
   * below `alt` degrees: a circle of radius 90 + alt around the antisolar point.
   */
  ring(date = new Date(), alt = 0, steps = 360) {
    const s = this.subsolar(date);
    const cLat = -s.lat, cLon = s.lon + 180;
    const r = 90 + alt;
    const pts = [];
    for (let i = 0; i <= steps; i++) pts.push(this.destination(cLat, cLon, r, i * 360 / steps));
    return { pts, center: [cLat, cLon], radius: r };
  },

  /**
   * The same region as a polygon for an equirectangular/Mercator map: the
   * ring's longitudes are unwrapped, and a ring that circles a pole is closed
   * over that pole.  Returns copies shifted by -360/0/+360 so any visible
   * world copy is covered.
   */
  regionLatLngs(date = new Date(), alt = 0, steps = 360) {
    const { pts, center, radius } = this.ring(date, alt, steps);
    const ring = [pts[0].slice()];
    for (let i = 1; i < pts.length; i++) {
      let lon = pts[i][1];
      const prev = ring[i - 1][1];
      while (lon - prev > 180) lon -= 360;
      while (lon - prev < -180) lon += 360;
      ring.push([pts[i][0], lon]);
    }
    const span = ring[ring.length - 1][1] - ring[0][1];
    if (Math.abs(span) > 180) {
      // Circles a pole: the cap contains whichever pole is within its radius.
      const pole = 90 - center[0] < radius ? 90 : -90;
      ring.push([pole, ring[ring.length - 1][1]], [pole, ring[0][1]]);
    }
    const mid = ring.reduce((a, p) => a + p[1], 0) / ring.length;
    const base = -Math.round(mid / 360) * 360;           // centre the copy on 0
    return [-360, 0, 360].map(k => ring.map(([la, lo]) => [la, lo + base + k]));
  },

  /** Sun altitude (deg) at (lat, lon) for a Date. */
  altitude(lat, lon, date = new Date()) {
    const R = this.RAD, s = this.subsolar(date);
    const v = Math.sin(lat * R) * Math.sin(s.lat * R) +
              Math.cos(lat * R) * Math.cos(s.lat * R) * Math.cos((lon - s.lon) * R);
    return Math.asin(Math.max(-1, Math.min(1, v))) / R;
  },
};

if (typeof module !== "undefined") module.exports = Solar;
