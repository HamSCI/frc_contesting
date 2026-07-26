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
    countryFeat = data.features;
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
    continentFeat = data.features;
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
    ITUZoneFeat = data.features;
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
    if (turf.booleanPointInPolygon(pt, feature)) {
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
    if (turf.booleanPointInPolygon(pt, feature)) {
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
    if (turf.booleanPointInPolygon(pt, feature)) {
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
    if (turf.booleanPointInPolygon(pt, feature)) {
      return String(feature.properties.itu_zone_number);
    }
  }
  return "Unknown";
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
