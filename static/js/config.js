// config.js — Centralized configuration for the FRC Contesting web frontend.
// Edit values in this file to configure the station and display settings.
// This file must be loaded before map_ft.js and table_ft.js.

const CONFIG = {

  // ── Station ───────────────────────────────────────────────────────────────
  // Populated at runtime by loadStation() — do not hardcode values here.
  station: {
    callsign:   "Unknown",
    gridSquare: "",
  },

  // Fetch receiver callsign and grid from the backend and update CONFIG.station in-place.
  // Call this once (await CONFIG.loadStation()) before using CONFIG.station values.
  async loadStation() {
    try {
      const res = await fetch('/config');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.receiver_callsign) this.station.callsign   = data.receiver_callsign;
      if (data.receiver_grid)     this.station.gridSquare = data.receiver_grid;
    } catch (e) {
      console.error('Failed to load station config from /config:', e);
    }
  },

  // ── Bands (#66) ───────────────────────────────────────────────────────────
  // The single band table.  Everything that lists bands (map legend and band
  // chips, table columns, waterfall titles, spot popups) is generated from it,
  // sorted highest frequency first like a spectrum display.  lo/hi are MHz,
  // lo inclusive and hi exclusive, and also drive freqToBand().
  //   freq / wl: the two label forms (see bandLabel());  hf: in the HF chip row;
  //   dials: digital-mode dial frequencies (MHz), marked on the waterfall axis.
  bands: [
    { id: "2m",    lo: 144.0,  hi: 148.0,  freq: "144 MHz",  wl: "2 m",    color: "#BB4A99" },
    { id: "6m",    lo: 50.0,   hi: 54.0,   freq: "50 MHz",   wl: "6 m",    color: "#4E2960" },
    { id: "10m",   lo: 28.0,   hi: 29.7,   freq: "28 MHz",   wl: "10 m",   color: "#183C52", hf: true, contest: true,
      dials: { FT8: 28.074, FT4: 28.180, WSPR: 28.1246 } },
    { id: "12m",   lo: 24.89,  hi: 24.99,  freq: "24.9 MHz", wl: "12 m",   color: "#106AB6", hf: true },
    { id: "15m",   lo: 21.0,   hi: 21.45,  freq: "21 MHz",   wl: "15 m",   color: "#21A2DA", hf: true, contest: true,
      dials: { FT8: 21.074, FT4: 21.140, WSPR: 21.0946 } },
    { id: "17m",   lo: 18.068, hi: 18.168, freq: "18 MHz",   wl: "17 m",   color: "#5AA429", hf: true },
    { id: "20m",   lo: 14.0,   hi: 14.35,  freq: "14 MHz",   wl: "20 m",   color: "#008B38", hf: true, contest: true,
      dials: { FT8: 14.074, FT4: 14.080, WSPR: 14.0956 } },
    { id: "30m",   lo: 10.1,   hi: 10.15,  freq: "10.1 MHz", wl: "30 m",   color: "#F5B72D", hf: true },
    { id: "40m",   lo: 7.0,    hi: 7.3,    freq: "7 MHz",    wl: "40 m",   color: "#EE8918", hf: true, contest: true,
      dials: { FT8: 7.074, FT4: 7.0475, WSPR: 7.0386 } },
    { id: "60m",   lo: 5.2,    hi: 5.5,    freq: "5.3 MHz",  wl: "60 m",   color: "#D43019", hf: true },
    { id: "80m",   lo: 3.5,    hi: 4.0,    freq: "3.5 MHz",  wl: "80 m",   color: "#991F24", hf: true, contest: true,
      dials: { FT8: 3.573, FT4: 3.575, WSPR: 3.5686 } },
    { id: "160m",  lo: 1.8,    hi: 2.0,    freq: "1.8 MHz",  wl: "160 m",  color: "#211D1E", hf: true, contest: true,
      dials: { FT8: 1.840, WSPR: 1.8366 } },
    { id: "630m",  lo: 0.472,  hi: 0.479,  freq: "475 kHz",  wl: "630 m",  color: "#8A6D3B" },
    { id: "2200m", lo: 0.1357, hi: 0.1378, freq: "137 kHz",  wl: "2200 m", color: "#6B6B47" },
  ],
  unknownBand: { id: "unknown", lo: 0, hi: 0, freq: "Other", wl: "Other", color: "#888888" },

  // ── UI defaults ───────────────────────────────────────────────────────────
  defaults: {
    lastInterval: 15,   // minutes of spots to display on load
    threshold:    1,    // minimum spots to highlight a cell green in the table
    reload:       300,  // auto reload every 5 min (#61): shows a flare fadeout and recovery
    bandLabels:   "both",  // freq | wl | both (#66)
  },

  // ── Map ───────────────────────────────────────────────────────────────────
  map: {
    initialView: [20, 0],
    initialZoom: 2,
  },

  // Look up a band by id ("20m"); unknown ids get the grey "Other" entry.
  band(id) {
    return this._bandIndex[id] || this.unknownBand;
  },

  // Band ids sorted highest frequency first; unknown ids sort last.
  sortBands(ids) {
    const lo = id => (this._bandIndex[id] ? this._bandIndex[id].lo : -1);
    return [...ids].sort((a, b) => lo(b) - lo(a) || String(a).localeCompare(String(b)));
  },

  bandColor(id) {
    return this.band(id).color;
  },

  // Band label in the viewer's chosen style (Frequency / Wavelength / Both).
  // Frequency comes first so reporters and scientists can read it; hams can
  // switch to meters.  html=true wraps the secondary form for dim styling.
  bandLabelStyle() {
    try {
      const v = localStorage.getItem("bandLabels");
      if (v === "freq" || v === "wl" || v === "both") return v;
    } catch (e) { /* storage unavailable */ }
    return this.defaults.bandLabels;
  },

  bandLabel(id, { html = false, style = this.bandLabelStyle() } = {}) {
    const b = this.band(id);
    if (style === "freq") return b.freq;
    if (style === "wl") return b.wl;
    if (b === this.unknownBand) return b.freq;
    return html ? `${b.freq} <span class="band-sub">${b.wl}</span>` : `${b.freq} · ${b.wl}`;
  },

  // Full description for tooltips, e.g. "14.000–14.350 MHz · 20 m".
  bandTitle(id) {
    const b = this.band(id);
    if (b === this.unknownBand) return "Outside the amateur bands";
    const f = v => (v < 1 ? `${(v * 1000).toFixed(1)} kHz` : `${v.toFixed(3)}`);
    return b.lo < 1 ? `${f(b.lo)}–${f(b.hi)} · ${b.wl}` : `${f(b.lo)}–${f(b.hi)} MHz · ${b.wl}`;
  },

  // Helper: convert a frequency in MHz to a band id.
  freqToBand(freq) {
    const match = this.bands.find(b => freq >= b.lo && freq < b.hi);
    return match ? match.id : "unknown";
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

// Derived band views (#66): an id index, and the contest bands (160/80/40/20/
// 15/10 m) in display order, highest frequency first.
CONFIG._bandIndex = Object.fromEntries(CONFIG.bands.map(b => [b.id, b]));
CONFIG.contestBands = CONFIG.bands.filter(b => b.contest).map(b => b.id);
CONFIG.hfBands = CONFIG.bands.filter(b => b.hf).map(b => b.id);

// Keep a pristine copy of the built-in region groupings so the region-settings
// modal (table_ft.js) can offer a "Reset to Defaults" option after the user
// has saved a custom grouping.
CONFIG.defaultRegionZones = JSON.parse(JSON.stringify(CONFIG.regionZones));
CONFIG.defaultRegionPairs = JSON.parse(JSON.stringify(CONFIG.regionPairs));

// Apply a region grouping saved from a previous session (see table_ft.js),
// overriding the defaults above in place.
(function applyStoredRegionConfig() {
  try {
    const saved = localStorage.getItem("regionConfig");
    if (!saved) return;
    const parsed = JSON.parse(saved);
    if (parsed && parsed.regionZones && parsed.regionPairs) {
      CONFIG.regionZones = parsed.regionZones;
      CONFIG.regionPairs = parsed.regionPairs;
    }
  } catch (e) {
    console.error("Failed to apply saved region config, using defaults:", e);
  }
})();
