// utils.js — Shared utility functions for the FRC Contesting web frontend.
// Must be loaded after config.js and turf.min.js.

// ── GeoJSON feature arrays ────────────────────────────────────────────────
// Populated by the loader functions below. Used by the lookup functions and
// by loadCqZones() in map_ft.js (which also handles Leaflet rendering).
let countryFeat   = [];
let continentFeat = [];
let cqZoneFeat    = [];
let ITUZoneFeat   = [];


// ── GeoJSON data loaders ──────────────────────────────────────────────────

/**
 * Give every feature a [minLon, minLat, maxLon, maxLat] bbox, once, so the
 * point-in-polygon lookups below can skip features that cannot contain the
 * point (#68).  The country file alone has ~550k vertices.
 */
function withBBoxes(features) {
  for (const f of features) {
    if (!f.bbox) f.bbox = turf.bbox(f);
  }
  return features;
}

function inBBox(lon, lat, b) {
  return !b || (lon >= b[0] && lon <= b[2] && lat >= b[1] && lat <= b[3]);
}

/**
 * Load country boundary polygons from GeoJSON file.
 *
 * Fetches the countries.geojson file (~14MB) containing boundary polygons
 * for all world countries. Used for country-based filtering.
 *
 * @async
 * @returns {Promise<void>}
 */
async function loadCountryPolygons() {
  try {
    const res = await fetch("js/countries.geojson");
    const data = await res.json();
    countryFeat = withBBoxes(data.features);
    console.log("Loaded", countryFeat.length, "country polygons");
  } catch (err) {
    console.error("Failed to load countries.geojson", err);
  }
}

/**
 * Load continent boundary polygons from GeoJSON file.
 *
 * Fetches the continents.geojson file containing polygons for
 * the 7 continents. Used for continent-based filtering.
 *
 * @async
 * @returns {Promise<void>}
 */
async function loadContinentPolygons() {
  try {
    const res = await fetch("js/continents.geojson");
    const data = await res.json();
    continentFeat = withBBoxes(data.features);
    console.log("Loaded", continentFeat.length, "continent polygons");
  } catch (e) {
    console.error("Failed to load continent GeoJSON", e);
  }
}

/**
 * Load ITU zone polygons from GeoJSON file.
 *
 * ITU zones are numbered 1-90 and defined by the International
 * Telecommunication Union for amateur radio purposes.
 *
 * @async
 * @returns {Promise<void>}
 */
async function loadITUZones() {
  try {
    const res = await fetch("js/ituzones.geojson");
    const data = await res.json();
    ITUZoneFeat = withBBoxes(data.features);
    console.log("Loaded", ITUZoneFeat.length, "ITU Zones");
  } catch (e) {
    console.error("Failed to load ITU Zones", e);
  }
}


// ── Geographic lookups (Turf.js point-in-polygon) ─────────────────────────

/**
 * Lookup country name from geographic coordinates.
 *
 * @param {number} lat - Latitude in decimal degrees
 * @param {number} lon - Longitude in decimal degrees
 * @returns {string} Country name or "Unknown" if not found
 *
 * @example
 * lookupCountry(40.7128, -74.0060) // "United States of America"
 */
function lookupCountry(lat, lon) {
  const pt = turf.point([lon, lat]);
  for (const feature of countryFeat) {
    if (inBBox(lon, lat, feature.bbox) && turf.booleanPointInPolygon(pt, feature)) {
      return feature.properties.name || "Unknown";
    }
  }
  return "Unknown";
}

/**
 * Lookup continent name from geographic coordinates.
 *
 * @param {number} lat - Latitude in decimal degrees
 * @param {number} lon - Longitude in decimal degrees
 * @returns {string|null} Continent name or null if not found
 *
 * @example
 * lookupContinent(40.7128, -74.0060) // "North America"
 */
function lookupContinent(lat, lon) {
  const pt = turf.point([lon, lat]);
  for (const feature of continentFeat) {
    if (inBBox(lon, lat, feature.bbox) && turf.booleanPointInPolygon(pt, feature)) {
      return feature.properties.continent || "Unknown";
    }
  }
  return null;
}

/**
 * Lookup CQ zone number from geographic coordinates.
 *
 * CQ zones are numbered 1-40 and used for amateur radio contests
 * and awards (e.g., Worked All Zones - WAZ).
 *
 * @param {number} lat - Latitude in decimal degrees
 * @param {number} lon - Longitude in decimal degrees
 * @returns {string} CQ zone number (1-40) or "Unknown"
 *
 * @example
 * lookupCqZone(40.7128, -74.0060) // "5" (New York is in CQ zone 5)
 */
function lookupCqZone(lat, lon) {
  const pt = turf.point([lon, lat]);
  for (const feature of cqZoneFeat) {
    if (inBBox(lon, lat, feature.bbox) && turf.booleanPointInPolygon(pt, feature)) {
      return String(feature.properties.cq_zone_number);
    }
  }
  return "Unknown";
}

/**
 * Lookup ITU zone number from geographic coordinates.
 *
 * @param {number} lat - Latitude in decimal degrees
 * @param {number} lon - Longitude in decimal degrees
 * @returns {string} ITU zone number (1-90) or "Unknown"
 *
 * @example
 * lookupITUZone(40.7128, -74.0060) // "8" (New York is in ITU zone 8)
 */
function lookupITUZone(lat, lon) {
  const pt = turf.point([lon, lat]);
  for (const feature of ITUZoneFeat) {
    if (inBBox(lon, lat, feature.bbox) && turf.booleanPointInPolygon(pt, feature)) {
      return String(feature.properties.itu_zone_number);
    }
  }
  return "Unknown";
}

// All four lookups for one TX location, cached by position (#68).  Spots come
// from Maidenhead grid squares, so a refresh mostly repeats locations already
// seen; the cache lives for the page, across refreshes.
const _geoCache = new Map();

function lookupGeo(lat, lon) {
  const key = `${lat.toFixed(4)},${lon.toFixed(4)}`;
  let geo = _geoCache.get(key);
  if (!geo) {
    geo = {
      country: lookupCountry(lat, lon),
      continent: lookupContinent(lat, lon),
      cqZone: lookupCqZone(lat, lon),
      ituZone: lookupITUZone(lat, lon),
    };
    _geoCache.set(key, geo);
  }
  return geo;
}


// ── Date / time helpers ───────────────────────────────────────────────────

/**
 * Parse a WSPR spot timestamp to an ISO-formatted string.
 *
 * The database stores timestamps as "YYMMDD HHMM" strings in UTC.
 * Example: "260107 1430" → "2026-01-07 14:30:00"
 *
 * @param {string} wsprTimeStr - Timestamp in "YYMMDD HHMM" format
 * @returns {string} ISO datetime string "YYYY-MM-DD HH:MM:SS"
 */
function parseWsprTime(wsprTimeStr) {
  const [datePart, timePart] = wsprTimeStr.split(' ');
  const year  = 2000 + parseInt(datePart.slice(0, 2), 10);
  const month = parseInt(datePart.slice(2, 4), 10) - 1; // JS months: 0–11
  const day   = parseInt(datePart.slice(4, 6), 10);
  const hour  = parseInt(timePart.slice(0, 2), 10);
  const minute = parseInt(timePart.slice(2, 4), 10);

  const dt = new Date(Date.UTC(year, month, day, hour, minute));
  return dt.toISOString().replace('T', ' ').slice(0, 19); // "YYYY-MM-DD HH:MM:SS"
}

/**
 * Parse a spot timestamp from database format to a JavaScript Date object.
 *
 * The database stores timestamps as "YYMMDD HHMM" strings in UTC.
 * Example: "260107 1430" → Date object at 2026-01-07 14:30:00 UTC
 *
 * @param {string} t - Timestamp in "YYMMDD HHMM" format
 * @returns {Date} JavaScript Date object in UTC
 */
function parseTableTime(t) {
  const yy = Number(t.slice(0, 2)) + 2000;  // YY → YYYY
  const mm = Number(t.slice(2, 4)) - 1;     // Month (0-11 for JS Date)
  const dd = Number(t.slice(4, 6));         // Day
  const HH = Number(t.slice(7, 9));         // Hour
  const MM = Number(t.slice(9, 11));        // Minute
  return new Date(Date.UTC(yy, mm, dd, HH, MM));
}

/**
 * Convert a 6-character WSPR date string to a readable "YYYY-MM-DD" string.
 *
 * @param {string} dateStr - Date in "YYMMDD" format
 * @returns {string} Date string "YYYY-MM-DD" or "Unknown date" if invalid
 */
function reverseWsprDate(dateStr) {
  if (!dateStr || dateStr.length !== 6) return "Unknown date";
  const year  = 2000 + parseInt(dateStr.slice(0, 2), 10);
  const month = dateStr.slice(2, 4);
  const day   = dateStr.slice(4, 6);
  return `${year}-${month}-${day}`;
}


// ── URL helper ────────────────────────────────────────────────────────────

/**
 * Read a single query parameter from the current page URL.
 *
 * @param {string} name - Parameter name
 * @returns {string|null} Parameter value or null if not present
 */
function getQueryParam(name) {
  const urlParams = new URLSearchParams(window.location.search);
  return urlParams.get(name);
}


// ── Band / zone helpers ───────────────────────────────────────────────────

/**
 * Convert a frequency in MHz to its amateur radio band name.
 * Delegates to CONFIG.freqToBand for the actual lookup table.
 *
 * @param {number} freq - Frequency in MHz
 * @returns {string} Band name (e.g. "20m") or "unknown"
 */
function frequencyToBand(freq) {
  return CONFIG.freqToBand(freq);
}

/**
 * Map a CQ zone number to every geographic region that claims it.
 *
 * Regions are user-editable (see the table view's Region Groupings modal)
 * and are not required to be mutually exclusive — e.g. a cloned region
 * covering the same zones as an existing one is valid and should count
 * spots into both, not just whichever region happened to be defined first.
 *
 * @param {number|string} cqZone - CQ zone number (1-40)
 * @returns {string[]} Names of every region whose zone list includes cqZone,
 *   or ["Unknown"] if the zone is invalid or unmapped by any region
 *
 * @example
 * getRegionsFromCQ(5)  // ["North America"]
 * getRegionsFromCQ(14) // ["Europe"]
 */
function getRegionsFromCQ(cqZone) {
  const num = Number(cqZone);
  if (!num || num < 1 || num > 40) return ["Unknown"];

  const matches = Object.entries(CONFIG.regionZones)
    .filter(([, zones]) => zones.includes(num))
    .map(([region]) => region);

  return matches.length ? matches : ["Unknown"];
}


// ── Mode pills (#67) ──────────────────────────────────────────────────────

/**
 * Add a checkbox pill for every mode in CONFIG.modes marked `pill`, plus any
 * extra mode ids seen in the data, to `container`.  Safe to call again with
 * new ids: existing pills (and their checked state) are kept.  A new pill
 * starts checked so a newly seen mode is visible, not silently filtered.
 *
 * @param {HTMLElement} container - element that holds the pills
 * @param {string[]} extraIds - mode ids present in the data
 * @param {Function} onChange - called when a pill is toggled
 */
function renderModePills(container, extraIds = [], onChange = () => {}) {
  if (!container) return;
  const have = new Set([...container.querySelectorAll("input[data-mode]")].map(i => i.dataset.mode));
  const ids = CONFIG.modes.filter(m => m.pill).map(m => m.id);
  extraIds.forEach(id => { if (id && !ids.includes(id)) ids.push(id); });
  for (const id of ids) {
    if (have.has(id)) continue;
    const m = CONFIG.mode(id);
    const label = document.createElement("label");
    label.className = "mode-pill";
    label.title = m.about ? `${m.label}: ${m.about}` : m.label;
    label.innerHTML = `<input type="checkbox" id="mode-${m.id}" data-mode="${m.id}" checked> ` +
      `${typeof spotShapeSvg === "function" ? spotShapeSvg(m.shape, "#cfd6e6", 12, "#0b0e14") : ""} ${m.label}`;
    label.querySelector("input").addEventListener("change", onChange);
    container.appendChild(label);
  }
}

/** Checked mode ids as a Set, or null when none are checked (= all modes). */
function selectedModes(container) {
  const on = [...container.querySelectorAll("input[data-mode]")].filter(i => i.checked).map(i => i.dataset.mode);
  return on.length ? new Set(on) : null;
}

/** URL form of the mode selection: "" when all (or none) are checked. */
function modesParam(container) {
  const inputs = [...container.querySelectorAll("input[data-mode]")];
  const on = inputs.filter(i => i.checked).map(i => i.dataset.mode);
  return on.length && on.length < inputs.length ? on.join(",") : "";
}

/** Check exactly the given mode ids (unknown ids are ignored). */
function setSelectedModes(container, ids) {
  const want = new Set(ids);
  container.querySelectorAll("input[data-mode]").forEach(i => { i.checked = want.has(i.dataset.mode); });
}


// ── Band selection (#60) ──────────────────────────────────────────────────
// null = all bands (no band filter); otherwise a Set of band ids, possibly
// empty.  The URL/storage form is "" (all), "none", or "40m,20m"; the old
// single-band values ("20m", and "CBs" for the contest bands) still parse.

function bandSelToParam(sel) {
  if (!sel) return "";
  if (!sel.size) return "none";
  return CONFIG.sortBands([...sel]).join(",");
}

function bandSelFromParam(value) {
  if (!value) return null;
  if (value === "CBs" || value === "contest") return new Set(CONFIG.contestBands);
  if (value === "none") return new Set();
  return new Set(value.split(",").map(v => v.trim()).filter(Boolean));
}

/** Human description of a selection, e.g. "Contest Bands" or "14 MHz, 7 MHz". */
function describeBandSel(sel) {
  if (!sel) return "All Bands";
  if (!sel.size) return "no bands";
  const ids = CONFIG.sortBands([...sel]);
  if (ids.join() === CONFIG.contestBands.join()) return "Contest Bands";
  return ids.map(id => CONFIG.bandLabel(id, { style: CONFIG.bandLabelStyle() === "wl" ? "wl" : "freq" })).join(", ");
}

