// config.js — Centralized configuration for the FRC Contesting web frontend.
// Edit values in this file to configure the station and display settings.
// This file must be loaded before map_ft.js and table_ft.js.

const CONFIG = {

  // ── Station ───────────────────────────────────────────────────────────────
  station: {
    callsign:   "KD3ALD",
    gridSquare: "FN21ni",   // Maidenhead grid locator (also referenced in web-ft.py)
  },

  // ── Contest bands ─────────────────────────────────────────────────────────
  // Bands included in the contest (excludes WARC bands by default).
  contestBands: ["160m", "80m", "40m", "20m", "15m", "10m"],

  // ── UI defaults ───────────────────────────────────────────────────────────
  defaults: {
    lastInterval: 15,   // minutes of spots to display on load
    threshold:    1,    // minimum spots to highlight a cell green in the table
  },

  // ── Map ───────────────────────────────────────────────────────────────────
  map: {
    initialView: [20, 0],
    initialZoom: 2,
    tileUrl: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    tileOptions: { noWrap: true, bounds: [[-90, -180], [90, 180]] },
  },

  // ── Band display order ────────────────────────────────────────────────────
  bandOrder: [
    "160m", "80m", "60m", "40m", "30m", "20m", "17m", "15m",
    "12m", "10m", "6m", "4m", "2m", "70cm", "unknown",
  ],

  // ── Band → color name ────────────────────────────────────────────────────
  bandColorMap: {
    "160m":    "black",
    "80m":     "red",
    "60m":     "orange-dark",
    "40m":     "orange",
    "30m":     "yellow",
    "20m":     "green",
    "17m":     "green-light",
    "15m":     "cyan",
    "12m":     "blue-dark",
    "10m":     "blue-dark",
    "6m":      "purple",
    "4m":      "violet",
    "2m":      "pink",
    "70cm":    "white",
    "unknown": "green-dark",
  },

  // ── Color name → hex code ────────────────────────────────────────────────
  colorHexMap: {
    "red":          "991F24",
    "orange-dark":  "D43019",
    "orange":       "EE8918",
    "yellow":       "F5B72D",
    "blue-dark":    "183C52",
    "blue":         "106AB6",
    "cyan":         "21A2DA",
    "purple":       "4E2960",
    "violet":       "8B1E89",
    "pink":         "BB4A99",
    "green-dark":   "004B22",
    "green":        "008B38",
    "green-light":  "5AA429",
    "black":        "211D1E",
    "white":        "F5F4F5",
  },

  // ── Frequency → band lookup ───────────────────────────────────────────────
  // Each entry: [minMHz (inclusive), maxMHz (exclusive), bandName]
  frequencyBands: [
    [0.136,   0.137,  "2200m"],
    [0.472,   0.479,   "630m"],
    [1.8,     2.0,     "160m"],
    [3.5,     4.0,      "80m"],
    [5.2,     5.5,      "60m"],
    [7.0,     7.3,      "40m"],
    [10.1,    10.15,    "30m"],
    [14.0,    14.35,    "20m"],
    [18.068,  18.168,   "17m"],
    [21.0,    21.45,    "15m"],
    [24.89,   24.99,    "12m"],
    [28.0,    29.7,     "10m"],
    [50.0,    54.0,      "6m"],
    [144.0,   148.0,     "2m"],
  ],

  // Helper: convert a frequency in MHz to a band name.
  freqToBand(freq) {
    const match = this.frequencyBands.find(([lo, hi]) => freq >= lo && freq < hi);
    return match ? match[2] : "unknown";
  },

  // ── CQ zone → region mapping ──────────────────────────────────────────────
  regionZones: {
    "Europe":        [14, 15, 16, 20],
    "Caribbean":     [8],
    "South America": [9, 10, 11, 12, 13],
    "Japan":         [25],
    "Africa":        [33, 34, 35, 36, 37, 38, 39],
    "VK":            [29, 30],
    "YB":            [27, 28],
    "China":         [23, 24],
    "UA9":           [17, 18, 19],
    "Indian":        [22],
    "Middle East":   [21],
    "Thailand":      [26],
    "North America": [1, 2, 3, 4, 5, 6, 7, 40],
    "Oceania":       [31, 32],
  },

  // ── Region table layout ───────────────────────────────────────────────────
  // Pairs of region names displayed side-by-side in the table view.
  regionPairs: [
    ["Europe",        "Caribbean"],
    ["South America", "Japan"],
    ["Africa",        "VK"],
    ["YB",            "China"],
    ["UA9",           "Indian"],
    ["Middle East",   "Thailand"],
    ["North America", "Oceania"],
    ["Unknown",       "Not in Use"],
  ],
};
