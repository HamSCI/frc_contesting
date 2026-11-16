/**
 * HamSCI Contesting Dashboard - Map Visualization (map_ft.js)
 *
 * Interactive Leaflet map for visualizing HF propagation using WSPR, FT8, and FT4 digital mode spots.
 * This script handles:
 * - Loading and displaying propagation spots on a world map
 * - Client-side filtering by band, country, continent, CQ zone, ITU zone, and mode
 * - Real-time updates with configurable auto-reload intervals
 * - Canvas-drawn spot symbols: colour = band, shape = mode (spot_symbols.js)
 * - Geographic lookups using Turf.js point-in-polygon operations
 * - Every setting kept in the URL and session storage (viewstate.js)
 *
 * Author: Owen Ruzanski (KD3ALD)
 * Organization: University of Scranton (W3USR), Frankford Radio Club
 * Project: HamSCI PSWS Dashboard Development
 *
 * Dependencies:
 * - Leaflet.js (map library)
 * - spot_symbols.js (canvas spot symbols)
 * - Turf.js (geospatial analysis - point in polygon)
 * - GeoJSON data files (countries, continents, CQ zones, ITU zones)
 */

  async function loadCqZones() {
    try {
      const res = await fetch("js/cqzones.geojson");
      const data = await res.json();
      cqZoneFeat = withBBoxes(data.features);
      console.log("Loaded", cqZoneFeat.length, "CQ zones");

      // Remove old layer if it exists
      if (cqZoneBordersLayer) {
        map.removeLayer(cqZoneBordersLayer);
      }

      // Build the outline layer
      cqZoneBordersLayer = L.geoJSON(IS_AE ? AEQD.cutSeams(cqZoneFeat, map.options.crs) : cqZoneFeat, {
        style: {
          color: "black",
          weight: .5,
          fillOpacity: 0
        }
      });

      // Add CQ zone number labels
      cqZoneLabelsLayer = L.layerGroup();

      cqZoneFeat.forEach(feature => {
          const zoneNum = feature.properties.cq_zone_number;

          // Compute the center of the polygon
          const center = turf.center(feature).geometry.coordinates; 
          const lat = center[1];
          const lon = center[0];

          // Add a simple Leaflet div marker
          const label = L.divIcon({
              className: "cq-zone-label",
              html: `<b>${zoneNum}</b>`,
              iconSize: [20, 20],
              iconAnchor: [10, 10]
          });

          const marker = L.marker([lat, lon], { icon: label });
          cqZoneLabelsLayer.addLayer(marker);
      });

      // Add it only if checkbox is checked
      const cb = document.getElementById("cqOutline");
      if (cb && cb.checked) {
        cqZoneBordersLayer.addTo(map);
      }

    } catch (e) {
      console.error("Failed to load CQ zones", e);
    }
  }


// generate cq-zones select
const select1 = document.getElementById("cqZoneFilter");

for (let i = 1; i <= 40; i++) {
  const opt = document.createElement("option");
  opt.value = i;
  opt.textContent = i;
  select1.appendChild(opt);
}
const select2 = document.getElementById("ITUZoneFilter");

for (let i = 1; i <= 90; i++) {
  const opt = document.createElement("option");
  opt.value = i;
  opt.textContent = i;
  select2.appendChild(opt);
}
// Projection (#71): a great-circle (azimuthal equidistant) map centred on
// the station is the default; Mercator is the alternative.  The station grid
// comes with the page so the map can be built right away.
const STATION_LL = gridToLatLon(document.body.dataset.grid);
const MAP_PROJ = ViewState.get("proj", "map.proj", "ae") === "merc" || !STATION_LL ? "merc" : "ae";
const IS_AE = MAP_PROJ === "ae";

// preferCanvas: the basemap, zone outlines and spot symbols are all drawn on
// canvas, which keeps up with zoom/pan where thousands of DOM pins did not (#68).
var map = IS_AE
  ? L.map('map', { preferCanvas: true, crs: AEQD.crs(STATION_LL[0], STATION_LL[1]), zoomSnap: 0.25 })
  : L.map('map', { preferCanvas: true });
document.getElementById('map').classList.toggle('aeqd', IS_AE);

// Initial view: the whole disc for the great-circle map, the world otherwise.
const INITIAL = IS_AE
  ? { center: STATION_LL, zoom: Math.max(0, Math.floor(Math.log2(Math.min(map.getSize().x, map.getSize().y) * 0.9 / 256) * 4) / 4) }
  : { center: CONFIG.map.initialView, zoom: CONFIG.map.initialZoom };
map.setView(INITIAL.center, INITIAL.zoom);

// Only a user gesture (or an at= from a link) counts as "moved": the frame's
// size changes while it loads, so comparing against a computed initial view
// would misfire and put a stray at= in the URL.
let userMoved = false;
map.on('dragstart', () => { userMoved = true; });
['wheel', 'dblclick', 'keydown', 'touchstart'].forEach(ev =>
  map.getContainer().addEventListener(ev, () => { userMoved = true; }, { passive: true }));
map.getContainer().addEventListener('click', e => {
  if (e.target.closest('.leaflet-control-zoom')) userMoved = true;
});

// Built inside a hidden tab, the map has no size yet (zoom 0): fit the disc
// the first time it becomes visible, unless the user has moved it.
if (IS_AE && !map.getSize().x) {
  map.once('resize', () => {
    INITIAL.zoom = Math.max(0, Math.floor(Math.log2(Math.min(map.getSize().x, map.getSize().y) * 0.9 / 256) * 4) / 4);
    if (!userMoved) map.setView(INITIAL.center, INITIAL.zoom);
  });
}

// Disable marker shadows globally (the receiver pin is the only DOM marker)
L.Icon.Default.prototype.createShadow = function () { return null; };

// Panes, bottom to top: basemap, night shading (#72), zone outlines
// (overlayPane, 400), spot symbols.  Spot symbols get their own canvas so
// redrawing them never re-rasterises the basemap polygons underneath.
map.createPane('basemap').style.zIndex = 250;
map.createPane('night').style.zIndex = 350;
map.createPane('aurora').style.zIndex = 360;
map.getPane('aurora').style.pointerEvents = 'none';
map.getPane('night').style.pointerEvents = 'none';
map.createPane('spots').style.zIndex = 450;
const spotRenderer = L.canvas({ padding: 0.5, pane: 'spots' });

//cq zone overlay
let cqZoneBordersLayer = null;
let cqZoneLabelsLayer  = null;

//itu zone overlay
let ituZoneBordersLayer = null;
let ituZoneLabelsLayer  = null;




// Create the spot count control once, outside fetchSpots/renderMapFilters
let spotCountControl = L.control({ position: 'bottomright' });

spotCountControl.onAdd = function () {
  this._div = L.DomUtil.create('div', 'spot-counter');
  this.update({});

  // Clicking a band's row toggles it in the band selection (#60);
  // Shift-click shows only that band.  No refetch.
  this._div.addEventListener('click', (e) => {
    const row = e.target.closest('.spot-count-row');
    if (!row) return;
    const band = row.dataset.band;
    if (e.shiftKey) setBandSel(new Set([band]));
    else toggleBand(band);
  });

  return this._div;
};

// Band colours, order and labels all come from CONFIG.bands (#66).
spotCountControl.update = function (bandCounts, modeCounts = {}) {
  // Only the selected bands are listed (#59): with Contest Bands selected the
  // legend shows those six, not every band that has spots.
  const lines = CONFIG.sortBands(Object.keys(bandCounts).filter(bandSelected))
    .map(band => {
      return `<div class="spot-count-row" data-band="${band}" title="${CONFIG.bandTitle(band)} · click: hide · shift-click: only this band">` +
        `<span class="band-dot" style="background-color:${CONFIG.bandColor(band)}"></span>` +
        `<b>${CONFIG.bandLabel(band, { html: true })}</b>: ${bandCounts[band]}</div>`;
    });
  // Shape = mode (#67): one row per mode on the map, with its count.
  const order = id => { const i = CONFIG.modes.findIndex(m => m.id === id); return i < 0 ? 99 : i; };
  const modes = Object.keys(modeCounts).sort((a, b) => order(a) - order(b)).map(id => CONFIG.mode(id));
  const modeLines = modes.map(m =>
    `<div class="mode-legend-row" title="${m.about || m.label}">${spotShapeSvg(m.shape, '#cfd6e6', 12, '#0b0e14')}` +
    `<b>${m.label}</b>: ${modeCounts[m.id]}</div>`);
  this._div.innerHTML = `<b>Spots:</b><br>${lines.join('')}` +
    (modeLines.length ? `<div class="legend-section"><b>Modes:</b>${modeLines.join('')}</div>` : '');
};

// ── Band selection (#60) ──────────────────────────────────────────────────
// Any combination of bands: null = all bands, otherwise a Set of band ids.
let bandSel = null;
let lastBandCounts = {};      // per band, after every filter except band

function bandSelected(id) {
  return !bandSel || bandSel.has(id);
}

function setBandSel(sel) {
  bandSel = sel;
  onMapFilterChange();
}

function toggleBand(id) {
  const next = new Set(bandSel || Object.keys(lastBandCounts).concat(CONFIG.hfBands));
  if (next.has(id)) next.delete(id); else next.add(id);
  setBandSel(next);
}

// One toggle chip per band, highest frequency first, in the band's colour
// and with its spot count.  HF bands always; others only when they have spots
// (or are selected).  Presets: All, Contest, Clear.
function renderBandChips() {
  const box = document.getElementById('bandChips');
  if (!box) return;
  const ids = CONFIG.sortBands([...new Set([
    ...CONFIG.hfBands, ...Object.keys(lastBandCounts), ...(bandSel ? [...bandSel] : []),
  ])]);
  const contest = CONFIG.contestBands.join();
  const selIds = bandSel ? CONFIG.sortBands([...bandSel]).join() : null;
  const preset = (name, label, active, title) =>
    `<button type="button" class="band-preset${active ? ' active' : ''}" data-preset="${name}" title="${title}">${label}</button>`;
  box.innerHTML =
    preset('all', 'All', !bandSel, 'Show every band') +
    preset('contest', 'Contest', selIds === contest, 'Contest bands: 160/80/40/20/15/10 m') +
    preset('none', 'Clear', !!bandSel && !bandSel.size, 'Deselect every band, then pick some') +
    ids.map(id => {
      const on = bandSelected(id);
      const n = lastBandCounts[id] || 0;
      return `<button type="button" class="band-chip${on ? ' on' : ''}${n ? '' : ' empty'}" data-band="${id}" ` +
        `aria-pressed="${on}" title="${CONFIG.bandTitle(id)}: ${n} spot${n === 1 ? '' : 's'}">` +
        `<span class="band-dot" style="background-color:${CONFIG.bandColor(id)}"></span>` +
        `${CONFIG.bandLabel(id, { html: true })}<span class="band-count">${n}</span></button>`;
    }).join('');
}

document.getElementById('bandChips').addEventListener('click', e => {
  const preset = e.target.closest('[data-preset]');
  if (preset) {
    const p = preset.dataset.preset;
    setBandSel(p === 'all' ? null : p === 'contest' ? new Set(CONFIG.contestBands) : new Set());
    return;
  }
  const chip = e.target.closest('[data-band]');
  if (chip) toggleBand(chip.dataset.band);
});

// Add the control to the map ONCE
spotCountControl.addTo(map);



// Load offline basemap from local GeoJSON files (no external tile server)
async function loadBasemap() {
  try {
    const [landRes, countriesRes, statesRes] = await Promise.all([
      fetch("vendor/basemap/ne_50m_land.json"),
      fetch("vendor/basemap/ne_50m_admin_0_countries.json"),
      fetch("vendor/basemap/states-50m.json"),
    ]);
    let [land, countries, states] = await Promise.all([
      landRes.json(), countriesRes.json(), statesRes.json()
    ]);
    if (IS_AE) {
      const crs = map.options.crs;
      [land, countries, states] = [land, countries, states].map(g => AEQD.cutSeams(g, crs));
      // Ocean disc out to the antipode; outside it is empty space.
      L.polygon(AEQD.circle(STATION_LL, 20015, 360), {
        pane: 'basemap', interactive: false, stroke: false, fillColor: '#a8d5e8', fillOpacity: 1,
      }).addTo(map);
    }

    L.geoJSON(land, {
      pane: 'basemap', interactive: false,
      style: { color: "#aaa", weight: 0.5, fillColor: "#e8e0d8", fillOpacity: 1 }
    }).addTo(map);

    L.geoJSON(countries, {
      pane: 'basemap', interactive: false,
      style: { color: "#888", weight: 0.5, fill: false }
    }).addTo(map);

    L.geoJSON(states, {
      pane: 'basemap', interactive: false,
      style: { color: "#bbb", weight: 0.3, fill: false }
    }).addTo(map);

    if (IS_AE) AEQD.graticule(STATION_LL, 'basemap').addTo(map);
  } catch (e) {
    console.error("Failed to load offline basemap", e);
  }
}
loadBasemap();



// ── Solar terminator / gray line (#72) ────────────────────────────────────
// Night plus civil, nautical and astronomical twilight as stacked
// translucent fills (darkest in full night), the terminator line and the
// subsolar point.  Computed locally (solar.js); redrawn every minute and on
// every spot refresh.  Sits under the zone outlines and the spots.
let terminatorLayer = null;
const TWILIGHT = [
  { alt: 0,   fill: 0.12, name: "night" },
  { alt: -6,  fill: 0.08, name: "civil twilight" },
  { alt: -12, fill: 0.08, name: "nautical twilight" },
  { alt: -18, fill: 0.08, name: "astronomical twilight" },
];

function drawTerminator() {
  const on = document.getElementById("terminatorToggle")?.checked;
  if (terminatorLayer) { map.removeLayer(terminatorLayer); terminatorLayer = null; }
  if (!on) return;
  const now = new Date();
  const g = L.layerGroup();
  const lineStyle = { pane: 'night', interactive: false, color: '#f5c542', weight: 1.2, opacity: 0.8, dashArray: '4 4' };
  for (const t of TWILIGHT) {
    L.polygon(IS_AE ? AEQD.solarRegion(STATION_LL, now, t.alt) : Solar.regionLatLngs(now, t.alt), {
      pane: 'night', interactive: false, stroke: false, fillColor: '#0a1030', fillOpacity: t.fill,
    }).addTo(g);
  }
  // the gray line itself (sun altitude 0)
  if (IS_AE) {
    const line = { type: "LineString", coordinates: Solar.ring(now, 0).pts.map(([la, lo]) => [lo, la]) };
    L.geoJSON(AEQD.cutSeams(line, map.options.crs), { style: () => lineStyle, pane: 'night', interactive: false }).addTo(g);
  } else {
    Solar.regionLatLngs(now, 0).forEach(copy => {
      L.polyline(copy.filter(p => Math.abs(p[0]) < 89.9), lineStyle).addTo(g);
    });
  }
  const sun = Solar.subsolar(now);
  (IS_AE ? [0] : [-360, 0, 360]).forEach(k => L.circleMarker([sun.lat, sun.lon + k], {
    pane: 'night', radius: 6, color: '#b8860b', weight: 1.5, fillColor: '#ffd84d', fillOpacity: 1,
  }).bindTooltip(`Subsolar point ${sun.lat.toFixed(1)}°, ${sun.lon.toFixed(1)}° at ${now.toISOString().slice(11, 16)} UTC`).addTo(g));
  terminatorLayer = g.addTo(map);
}
setInterval(drawTerminator, 60 * 1000);

// ── OVATION aurora overlay (#73) ───────────────────────────────────────────
// Optional (default off): the server fetches SWPC's OVATION forecast; cells
// with >= 10 % aurora probability are drawn as translucent green 1-deg cells.
let auroraLayer = null;
let auroraTimer = null;

async function drawAurora() {
  const on = document.getElementById("auroraToggle")?.checked;
  clearTimeout(auroraTimer);
  if (!on) {
    if (auroraLayer) { map.removeLayer(auroraLayer); auroraLayer = null; }
    return;
  }
  try {
    const a = await (await fetch('/api/aurora')).json();
    const g = L.layerGroup();
    for (const [lon0, lat, pct] of a.cells || []) {
      if (pct < 10) continue;
      const lon = lon0 > 180 ? lon0 - 360 : lon0;
      L.polygon([[lat - 0.5, lon - 0.5], [lat - 0.5, lon + 0.5], [lat + 0.5, lon + 0.5], [lat + 0.5, lon - 0.5]], {
        pane: 'aurora', interactive: false, stroke: false, fillColor: '#3cff7a', fillOpacity: Math.min(0.6, pct / 100),
      }).addTo(g);
    }
    if (auroraLayer) map.removeLayer(auroraLayer);
    auroraLayer = g.addTo(map);
    const el = document.getElementById("auroraToggle").closest(".check-field");
    if (el) el.title = a.forecast ? `OVATION aurora forecast for ${a.forecast.replace('T', ' ').replace('Z', '')} UTC (NOAA SWPC)` :
      'Aurora forecast unavailable (no internet at the server?)';
  } catch (e) {
    console.warn('aurora overlay unavailable', e);
  }
  // Nothing yet means the server has only just started fetching: look again soon.
  auroraTimer = setTimeout(drawAurora, auroraLayer && auroraLayer.getLayers().length ? 15 * 60 * 1000 : 20 * 1000);
}

// Connection status helpers (#36 / #41)
function setStatus(state, label) {
  const dot = document.getElementById('conn-status-dot');
  const lbl = document.getElementById('conn-status-label');
  if (dot) dot.className = `status-dot status-${state}`;
  if (lbl) lbl.textContent = label;
}

function setLastUpdated() {
  const el = document.getElementById('last-updated');
  if (el) {
    const now = new Date();
    el.textContent = `Last updated: ${now.toISOString().slice(11, 19)} UTC`;
  }
}

// ITU zone rendering (#40) — modeled after loadCqZones()
async function renderITUZones() {
  if (!ITUZoneFeat || ITUZoneFeat.length === 0) return;

  if (ituZoneBordersLayer) map.removeLayer(ituZoneBordersLayer);
  if (ituZoneLabelsLayer)  map.removeLayer(ituZoneLabelsLayer);

  ituZoneBordersLayer = L.geoJSON(IS_AE ? AEQD.cutSeams(ITUZoneFeat, map.options.crs) : ITUZoneFeat, {
    style: {
      color: "navy",
      weight: 0.5,
      fillOpacity: 0
    }
  });

  ituZoneLabelsLayer = L.layerGroup();

  ITUZoneFeat.forEach(feature => {
    const zoneNum = feature.properties.itu_zone_number;
    const center  = turf.center(feature).geometry.coordinates;
    const lat = center[1];
    const lon = center[0];

    const label = L.divIcon({
      className: "itu-zone-label",
      html: `<b>${zoneNum}</b>`,
      iconSize:   [20, 20],
      iconAnchor: [10, 10]
    });

    ituZoneLabelsLayer.addLayer(L.marker([lat, lon], { icon: label }));
  });

  const cb = document.getElementById("ituOutline");
  if (cb && cb.checked) {
    ituZoneBordersLayer.addTo(map);
    ituZoneLabelsLayer.addTo(map);
  }
}

// band counts out for tables / charts
let bandCountsOut = {};


// Spot records from the last /spots fetch, each with its canvas symbol and
// every attribute a filter needs (band, country, continent, zones, mode).
// Every filter except lastInterval is applied purely from this cache in
// renderMapFilters() - no refetch, since the server only ever respects
// lastInterval (confirmed in services/spots.py).
let spotRecords = [];
let spotLayer = null;       // L.featureGroup of the visible symbols
let rxMarker = null;        // one receiver marker, not one per spot (#68)

const SPOT_STYLE = { radius: 5, weight: 1, color: '#1b1b1b', opacity: 0.9, fillOpacity: 0.85 };

function spotPopupHtml(rec) {
  const s = rec.spot;
  return `
    <b>Received Spot by ${s.rx_sign}</b><br>
    <b>TX:</b> <a href="https://qrz.com/db/${s.tx_sign}">${s.tx_sign}</a><br>
    ${s.snr != null ? `<b>SNR:</b> ${s.snr} dB<br>` : ''}
    ${s.drift != null ? `<b>Drift:</b> ${s.drift} Hz/min<br>` : ''}
    ${s.power != null ? `<b>Power:</b> ${s.power} dBm<br>` : ''}
    <b>Freq:</b> ${s.frequency} MHz<br>
    <b>Time:</b> ${parseWsprTime(s.time)}<br>
    <b>Band:</b> ${CONFIG.bandLabel(rec.band)}<br>
    <b>Mode:</b> ${(s.mode || '').toUpperCase()}${pathHtml(rec)}`;
}

// Beam heading and great-circle distance from the receiver (#71).
function pathHtml(rec) {
  const rx = Number.isFinite(rec.spot.rx_lat) ? [rec.spot.rx_lat, rec.spot.rx_lon] : STATION_LL;
  if (!rx) return '';
  const { bearing, km } = AEQD.bearingDistance(rx, [rec.spot.tx_lat, rec.spot.tx_lon]);
  const lp = 40030 - km, lpb = (bearing + 180) % 360;
  return `<br><b>Short path:</b> ${bearing.toFixed(0)}° · ${Math.round(km).toLocaleString()} km` +
         `<br><b>Long path:</b> ${lpb.toFixed(0)}° · ${Math.round(lp).toLocaleString()} km`;
}

async function fetchSpots() {
  setStatus('checking', 'Checking…');

  const lastInterval = document.getElementById("lastInterval").value || CONFIG.defaults.lastInterval;

  try {
    const res = await fetch(`/spots?lastInterval=${lastInterval}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const spots = await res.json();

    // Build the complete new record set first; the old symbols stay on the
    // map until the new layer is ready, so a refresh never blanks it (#68).
    const t0 = performance.now();
    const records = [];
    let rx = null;
    spots.forEach(spot => {
      if (
        isNaN(spot.tx_lat) || isNaN(spot.tx_lon) ||
        spot.tx_lat < -90 || spot.tx_lat > 90 ||
        spot.tx_lon < -180 || spot.tx_lon > 180
      ) {
        return; // skip invalid coordinates
      }
      if (!rx && !isNaN(spot.rx_lat) && !isNaN(spot.rx_lon)) rx = [spot.rx_lat, spot.rx_lon];

      // Everything a filter could need, computed once (geo lookups cached).
      const band = frequencyToBand(spot.frequency) || 'unknown';
      const mode = (spot.mode || "").toLowerCase();
      const rec = { spot, band, mode, ...lookupGeo(spot.tx_lat, spot.tx_lon), shown: false };
      rec.marker = new SpotMarker([spot.tx_lat, spot.tx_lon], {
        ...SPOT_STYLE,
        renderer: spotRenderer,
        fillColor: CONFIG.bandColor(band),
        shape: CONFIG.mode(mode).shape,     // colour = band, shape = mode (#67)
      });
      rec.marker.rec = rec;
      records.push(rec);
    });
    const t1 = performance.now();

    // Any mode in the data without a pill gets one (#67).
    renderModePills(document.getElementById('modePills'), [...new Set(records.map(r => r.mode))], onMapFilterChange);

    const oldLayer = spotLayer;
    spotRecords = records;
    spotLayer = L.featureGroup().addTo(map);
    spotLayer.on('click', e => {
      L.popup().setLatLng(e.layer.getLatLng()).setContent(spotPopupHtml(e.layer.rec)).openOn(map);
    });
    renderMapFilters();
    if (oldLayer) map.removeLayer(oldLayer);
    console.log(`spots: ${records.length} records in ${(t1 - t0).toFixed(0)} ms, ` +
                `rendered in ${(performance.now() - t1).toFixed(0)} ms`);

    updateReceiverMarker(rx, records.length);
    drawTerminator();
    setStatus('connected', 'Connected');
    setLastUpdated();
  } catch (e) {
    console.error('Failed to load spots:', e);
    setStatus('disconnected', 'Error');
  }
}

function updateReceiverMarker(latlng, count) {
  if (!latlng) return;
  const html = `<b>Receiver ${CONFIG.station.callsign}</b><br>${CONFIG.station.gridSquare || ''}<br>` +
               `${count} spot${count === 1 ? '' : 's'} in the window`;
  if (!rxMarker) {
    rxMarker = L.marker(latlng, { zIndexOffset: 1000, title: 'Receiver' }).bindPopup(html).addTo(map);
  } else {
    rxMarker.setLatLng(latlng).setPopupContent(html);
  }
}

// Pure client-side re-filter of the cached spotRecords - adds/removes symbols
// from the canvas spot layer and rebuilds the spot-count control.
function renderMapFilters() {
  const selectedCountry = document.getElementById("countryFilter").value;
  const selectedContinent = document.getElementById("continentFilter").value;
  const selectedCqZone = document.getElementById("cqZoneFilter").value;
  const selectedITUZone = document.getElementById("ITUZoneFilter").value;
  const modes = selectedModes(document.getElementById("modePills"));   // null = all

  let bandCounts = {};
  let modeCounts = {};
  let mapped = 0;

  spotRecords.forEach(rec => {
    const modeOk = !modes || modes.has(rec.mode);

    let countryOk = true;
    if (selectedCountry === "nonUS") {
      countryOk = rec.country !== "United States of America";
    } else if (selectedCountry && selectedCountry !== "all") {
      countryOk = rec.country === selectedCountry;
    }

    const continentOk = !selectedContinent || rec.continent === selectedContinent;

    let cqOk = true;
    if (selectedCqZone && selectedCqZone !== "CBs") {
      cqOk = rec.cqZone === String(selectedCqZone);
    }

    const ituOk = !selectedITUZone || rec.ituZone === selectedITUZone;

    const otherFiltersOk = modeOk && countryOk && continentOk && cqOk && ituOk;

    if (otherFiltersOk) {
      bandCounts[rec.band] = (bandCounts[rec.band] || 0) + 1;
    }

    const visible = otherFiltersOk && bandSelected(rec.band);

    if (visible) {
      mapped++;
      modeCounts[rec.mode] = (modeCounts[rec.mode] || 0) + 1;
    }
    if (visible !== rec.shown) {
      if (visible) spotLayer.addLayer(rec.marker); else spotLayer.removeLayer(rec.marker);
      rec.shown = visible;
    }
  });

  lastBandCounts = bandCounts;
  renderBandChips();
  spotCountControl.update(bandCounts, modeCounts);
  bandCountsOut = bandCounts;

  const spotInfo = document.getElementById("spot-info");
  if (spotInfo) {
    const countryName = selectedCountry || "all countries";
    const readableDate = `${document.getElementById("lastInterval").value || CONFIG.defaults.lastInterval} minutes`;
    spotInfo.textContent = `Found ${mapped} spot${mapped !== 1 ? "s" : ""} from ${countryName} for last ${readableDate} on ${describeBandSel(bandSel)}`;
  }
}

// Show/hide the CQ and ITU zone outline overlays to match their checkboxes.
function syncZoneOverlays() {
  const show = (on, ...layers) => layers.forEach(l => {
    if (!l) return;
    if (on) map.addLayer(l); else map.removeLayer(l);
  });
  show(document.getElementById("cqOutline").checked, cqZoneBordersLayer, cqZoneLabelsLayer);
  show(document.getElementById("ituOutline").checked, ituZoneBordersLayer, ituZoneLabelsLayer);
}

// Map settings as URL params (#62).  Short, stable names; the legacy names
// they replace are still read on load and dropped from the URL.
const MAP_DEFAULTS = { last: CONFIG.defaults.lastInterval, reload: CONFIG.defaults.reload, term: "1", proj: "ae" };
const MAP_LEGACY = ["lastInterval", "continent", "cqzone", "ITUzone", "CQZoneOutline"];

function mapState() {
  const c = map.getCenter();
  return {
    last: document.getElementById("lastInterval").value,
    band: bandSelToParam(bandSel),
    country: document.getElementById("countryFilter").value,
    cont: document.getElementById("continentFilter").value,
    cq: document.getElementById("cqZoneFilter").value,
    itu: document.getElementById("ITUZoneFilter").value,
    cqo: document.getElementById("cqOutline").checked ? "1" : "",
    ituo: document.getElementById("ituOutline").checked ? "1" : "",
    term: document.getElementById("terminatorToggle").checked ? "1" : "0",
    aur: document.getElementById("auroraToggle").checked ? "1" : "",
    modes: modesParam(document.getElementById("modePills")),
    reload: document.getElementById("reloadInterval").value,
    at: userMoved ? `${c.lat.toFixed(2)},${c.lng.toFixed(2)},${map.getZoom()}` : "",
    proj: document.getElementById("projection").value,
  };
}

// Persist every setting (#61): this session, the URL and the dashboard's
// top-level URL (#62), plus the settings the Table shares via localStorage.
// Runs on every change, whether or not that change needs a refetch.
function persistFilterState() {
  syncZoneOverlays();
  const st = mapState();
  try {
    for (const [k, v] of Object.entries(st)) sessionStorage.setItem(`map.${k}`, v);
    localStorage.setItem("lastInterval", st.last);
    localStorage.setItem("bandSel", st.band);
    localStorage.setItem("reload", st.reload);
  } catch (e) { /* storage unavailable */ }
  ViewState.publish("map", st, MAP_DEFAULTS, MAP_LEGACY);
}

// Every filter except lastInterval is a pure client-side re-render.
function onMapFilterChange() {
  persistFilterState();
  renderMapFilters();
}

// Auto reload (#61): refetch the spots, not the page, so every filter, the
// zoom/pan and the loaded overlays survive, and the GeoJSON isn't reloaded.
let reloadTimer = null;

function setReloadInterval(seconds) {
  if (reloadTimer) {
    clearInterval(reloadTimer);
    reloadTimer = null;
  }
  if (seconds > 0) {
    reloadTimer = setInterval(fetchSpots, seconds * 1000);
  }
}

// Set a <select>'s value only if it has that option.
function setSelect(el, value) {
  if (value !== null && value !== undefined && [...el.options].some(o => o.value === value)) el.value = value;
}


window.addEventListener('DOMContentLoaded', async () => {
  await CONFIG.loadStation();
  await loadCountryPolygons();
  await loadContinentPolygons();
  await loadCqZones();
  await loadITUZones();
  await renderITUZones();

  const titleEl = document.getElementById("title");
  if (titleEl) titleEl.textContent = `WSPR Spots From ${CONFIG.station.callsign} PSWS Receiver`;

  const update = document.getElementById("updateButton");
  const intervalInput = document.getElementById("lastInterval");
  const select = document.getElementById("reloadInterval");
  const countrySelect = document.getElementById("countryFilter");
  const continentSelect = document.getElementById("continentFilter");
  const cqZoneSelect = document.getElementById("cqZoneFilter");
  const ITUZoneSelect = document.getElementById("ITUZoneFilter");

  // Restore every setting (#61): URL first (a shared link wins, #62), then
  // this session, then the defaults.
  const get = (names, key, fallback) => ViewState.get(names, `map.${key}`, fallback);
  intervalInput.value = ViewState.get(["last", "lastInterval"], "map.last", String(CONFIG.defaults.lastInterval), "lastInterval");
  bandSel = bandSelFromParam(get("band", "band", ""));
  setSelect(countrySelect, get("country", "country", ""));
  setSelect(continentSelect, get(["cont", "continent"], "cont", ""));
  setSelect(cqZoneSelect, get(["cq", "cqzone"], "cq", ""));
  setSelect(ITUZoneSelect, get(["itu", "ITUzone"], "itu", ""));
  const flag = v => v === "1" || v === "true";
  document.getElementById("cqOutline").checked = flag(get(["cqo", "CQZoneOutline"], "cqo", ""));
  document.getElementById("ituOutline").checked = flag(get("ituo", "ituo", ""));
  document.getElementById("terminatorToggle").checked = get("term", "term", "1") !== "0";
  document.getElementById("auroraToggle").checked = get("aur", "aur", "") === "1";
  drawAurora();
  const modesSaved = get("modes", "modes", "");
  renderModePills(document.getElementById("modePills"), modesSaved ? modesSaved.split(",") : [], onMapFilterChange);
  if (modesSaved) setSelectedModes(document.getElementById("modePills"), modesSaved.split(","));
  setSelect(select, ViewState.get("reload", "map.reload", String(CONFIG.defaults.reload), "reload"));
  setReloadInterval(parseInt(select.value, 10));
  const at = (get("at", "at", "") || "").split(",").map(Number);
  if (at.length === 3 && at.every(Number.isFinite)) {
    map.setView([at[0], at[1]], at[2]);
    userMoved = true;                       // keep a linked view in the URL
  }
  renderBandChips();
  persistFilterState();

  select.addEventListener("change", () => {
    setReloadInterval(parseInt(select.value, 10));
    persistFilterState();
  });
  map.on("moveend", persistFilterState);

  // lastInterval changes the server-side time window, so it needs a real
  // refetch (Update forces the same full refresh). Every other filter is a
  // pure client-side re-render of the cached spots — see renderMapFilters().
  function onIntervalChange() {
    persistFilterState();
    fetchSpots();
  }

  update.addEventListener("click", onIntervalChange);
  intervalInput.addEventListener("change", onIntervalChange);

  [
    "countryFilter", "continentFilter", "cqZoneFilter", "ITUZoneFilter",
    "cqOutline", "ituOutline"
  ].forEach(id => {
    document.getElementById(id).addEventListener("change", onMapFilterChange);
  });
  // Changing projection rebuilds the map: reload with the new setting (every
  // other setting is in the URL, so nothing is lost).
  const projSelect = document.getElementById("projection");
  projSelect.value = MAP_PROJ;
  projSelect.disabled = !STATION_LL;
  projSelect.addEventListener("change", () => {
    persistFilterState();
    try { sessionStorage.setItem("map.at", ""); } catch (e) { /* storage unavailable */ }
    const p = new URLSearchParams(window.location.search);
    p.delete("at");
    window.location.search = p.toString();
  });
  document.getElementById("auroraToggle").addEventListener("change", () => {
    drawAurora();
    persistFilterState();
  });
  document.getElementById("terminatorToggle").addEventListener("change", () => {
    drawTerminator();
    persistFilterState();
  });

  // Sync lastInterval from table iframe via localStorage storage event, and
  // relabel bands when the dashboard's label style changes (#66).
  window.addEventListener("storage", (e) => {
    if (e.key === "lastInterval" && e.newValue && e.newValue !== intervalInput.value) {
      intervalInput.value = e.newValue;
      persistFilterState();
      fetchSpots();
    } else if (e.key === "reload" && e.newValue !== null && e.newValue !== select.value) {
      setSelect(select, e.newValue);          // one Auto Reload setting for Map and Table
      setReloadInterval(parseInt(select.value, 10));
      persistFilterState();
    } else if (e.key === "bandSel" && e.newValue !== bandSelToParam(bandSel)) {
      bandSel = bandSelFromParam(e.newValue);     // e.g. "Open in Map" on the Bands view
      onMapFilterChange();
    } else if (e.key === "bandLabels") {
      renderMapFilters();
    }
  });

  fetchSpots();
});