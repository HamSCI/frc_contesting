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
 * - Session storage for filter persistence across page reloads
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
      cqZoneBordersLayer = L.geoJSON(cqZoneFeat, {
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
// preferCanvas: the basemap, zone outlines and spot symbols are all drawn on
// canvas, which keeps up with zoom/pan where thousands of DOM pins did not (#68).
var map = L.map('map', { preferCanvas: true }).setView(CONFIG.map.initialView, CONFIG.map.initialZoom);

// Disable marker shadows globally (the receiver pin is the only DOM marker)
L.Icon.Default.prototype.createShadow = function () { return null; };

// Spot symbols get their own canvas so redrawing them never re-rasterises the
// basemap polygons underneath.
const spotRenderer = L.canvas({ padding: 0.5 });

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

  // Clicking a band's row instantly shows/hides that band's already-rendered
  // markers (click the active band again to show All Bands) — no refetch.
  this._div.addEventListener('click', (e) => {
    const row = e.target.closest('.spot-count-row');
    if (!row) return;
    const bandFilter = document.getElementById('bandFilter');
    if (!bandFilter) return;
    bandFilter.value = (bandFilter.value === row.dataset.band) ? '' : row.dataset.band;
    persistFilterState();
    renderMapFilters();
  });

  return this._div;
};

// Band colours, order and labels all come from CONFIG.bands (#66).
spotCountControl.update = function (bandCounts, modeCounts = {}) {
  const selectedBand = document.getElementById('bandFilter')?.value || '';
  const lines = CONFIG.sortBands(Object.keys(bandCounts))
    .map(band => {
      const activeClass = band === selectedBand ? ' active' : '';
      return `<div class="spot-count-row${activeClass}" data-band="${band}" title="${CONFIG.bandTitle(band)}">` +
        `<span class="band-dot" style="background-color:${CONFIG.bandColor(band)}"></span>` +
        `<b>${CONFIG.bandLabel(band, { html: true })}</b>: ${bandCounts[band]}</div>`;
    });
  // Shape = mode (#67): one row per mode on the map, with its count.
  const modes = Object.keys(modeCounts).map(id => CONFIG.mode(id));
  const modeLines = modes.map(m =>
    `<div class="mode-legend-row" title="${m.about || m.label}">${spotShapeSvg(m.shape, '#cfd6e6', 12, '#0b0e14')}` +
    `<b>${m.label}</b>: ${modeCounts[m.id]}</div>`);
  this._div.innerHTML = `<b>Spots:</b><br>${lines.join('')}` +
    (modeLines.length ? `<div class="legend-section"><b>Modes:</b>${modeLines.join('')}</div>` : '');
};

// Band dropdown options, highest frequency first, labelled per the viewer's
// label style.  Rebuilt when the style changes (storage event).
function buildBandOptions() {
  const select = document.getElementById('bandFilter');
  if (!select) return;
  const value = select.value;
  select.querySelectorAll('option[data-band]').forEach(o => o.remove());
  CONFIG.bands.forEach(b => {
    const opt = document.createElement('option');
    opt.value = b.id;
    opt.dataset.band = b.id;
    opt.textContent = CONFIG.bandLabel(b.id);
    opt.title = CONFIG.bandTitle(b.id);
    select.appendChild(opt);
  });
  select.value = value;
}
buildBandOptions();

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
    const [land, countries, states] = await Promise.all([
      landRes.json(), countriesRes.json(), statesRes.json()
    ]);

    L.geoJSON(land, {
      style: { color: "#aaa", weight: 0.5, fillColor: "#e8e0d8", fillOpacity: 1 }
    }).addTo(map);

    L.geoJSON(countries, {
      style: { color: "#888", weight: 0.5, fill: false }
    }).addTo(map);

    L.geoJSON(states, {
      style: { color: "#bbb", weight: 0.3, fill: false }
    }).addTo(map);
  } catch (e) {
    console.error("Failed to load offline basemap", e);
  }
}
loadBasemap();



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

  ituZoneBordersLayer = L.geoJSON(ITUZoneFeat, {
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
    <b>Mode:</b> ${(s.mode || '').toUpperCase()}`;
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
  const selectedBand = document.getElementById("bandFilter").value;
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

    const bandOk = selectedBand === "CBs"
      ? CONFIG.contestBands.includes(rec.band)
      : !selectedBand || rec.band === selectedBand;

    const visible = otherFiltersOk && bandOk;

    if (visible) {
      mapped++;
      modeCounts[rec.mode] = (modeCounts[rec.mode] || 0) + 1;
    }
    if (visible !== rec.shown) {
      if (visible) spotLayer.addLayer(rec.marker); else spotLayer.removeLayer(rec.marker);
      rec.shown = visible;
    }
  });

  spotCountControl.update(bandCounts, modeCounts);
  bandCountsOut = bandCounts;

  const spotInfo = document.getElementById("spot-info");
  if (spotInfo) {
    const countryName = selectedCountry || "all countries";
    const readableDate = `${document.getElementById("lastInterval").value || CONFIG.defaults.lastInterval} minutes`;
    const bandName1 = selectedBand === "CBs" ? "Contest Bands" : (selectedBand ? CONFIG.bandLabel(selectedBand) : "All Bands");
    spotInfo.textContent = `Found ${mapped} spot${mapped !== 1 ? "s" : ""} from ${countryName} for last ${readableDate} on ${bandName1}`;
  }
}

// Persist filter state to sessionStorage/localStorage/the URL and sync the
// CQ/ITU zone outline overlays. Runs on every filter change, whether or not
// that filter needs a refetch. Top-level (not nested in DOMContentLoaded)
// since it's called both from there and from spotCountControl's click handler.
function persistFilterState() {
  const params = new URLSearchParams(window.location.search);

  const minInterval = document.getElementById("lastInterval").value;
  sessionStorage.setItem("lastInterval", minInterval);
  localStorage.setItem("lastInterval", minInterval);
  if (minInterval) params.set("lastInterval", minInterval); else params.delete("lastInterval");

  const band = document.getElementById("bandFilter").value;
  if (band) params.set("band", band); else params.delete("band");

  const country = document.getElementById("countryFilter").value;
  sessionStorage.setItem("country", country);
  // Do NOT pass "nonUS" to the backend — client filters it
  if (country && country !== "nonUS") {
    params.set("country", country);
  } else {
    params.delete("country");
  }

  //CQ Zone outline
  const cqOutlineCheckbox = document.getElementById("cqOutline");
  if (cqOutlineCheckbox.checked) {
    if (cqZoneBordersLayer) map.addLayer(cqZoneBordersLayer);
    if (cqZoneLabelsLayer)  map.addLayer(cqZoneLabelsLayer);
  } else {
    if (cqZoneBordersLayer) map.removeLayer(cqZoneBordersLayer);
    if (cqZoneLabelsLayer)  map.removeLayer(cqZoneLabelsLayer);
  }
  sessionStorage.setItem("CQZoneOutline", cqOutlineCheckbox.checked);
  if (cqOutlineCheckbox.checked) params.set("CQZoneOutline", "true"); else params.delete("CQZoneOutline");

  //ITU Zone outline
  const ituOutlineCheckbox = document.getElementById("ituOutline");
  if (ituOutlineCheckbox.checked) {
    if (ituZoneBordersLayer) map.addLayer(ituZoneBordersLayer);
    if (ituZoneLabelsLayer)  map.addLayer(ituZoneLabelsLayer);
  } else {
    if (ituZoneBordersLayer) map.removeLayer(ituZoneBordersLayer);
    if (ituZoneLabelsLayer)  map.removeLayer(ituZoneLabelsLayer);
  }
  sessionStorage.setItem("ITUZoneOutline", ituOutlineCheckbox.checked);

  const continent = document.getElementById("continentFilter").value;
  sessionStorage.setItem("continent", continent);
  if (continent) params.set("continent", continent); else params.delete("continent");

  const cqZone = document.getElementById("cqZoneFilter").value;
  sessionStorage.setItem("cqzone", cqZone);
  if (cqZone) params.set("cqzone", cqZone); else params.delete("cqzone");

  const ITUZone = document.getElementById("ITUZoneFilter").value;
  sessionStorage.setItem("ITUzone", ITUZone);
  if (ITUZone) params.set("ITUzone", ITUZone); else params.delete("ITUzone");

  const newUrl = `${window.location.pathname}?${params.toString()}`;
  window.history.replaceState(null, "", newUrl);
}

// Every filter except lastInterval is a pure client-side re-render.
function onMapFilterChange() {
  persistFilterState();
  renderMapFilters();
}

//reload interval
let reloadTimer = null;

function setReloadInterval(seconds) {
  if (reloadTimer) {
    clearInterval(reloadTimer);
  }
  if (seconds > 0) {
    reloadTimer = setInterval(() => {
      window.location.reload();
    }, seconds * 1000);
  }
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

  // Restore previous selections from sessionStorage (falling back to
  // whatever's already in the URL query string)
  const savedInterval = sessionStorage.getItem("reloadInterval");
  const intervalSaved = sessionStorage.getItem("lastInterval") || getQueryParam("lastInterval");
  const countrySaved = sessionStorage.getItem("country") || getQueryParam("country");
  const continentSaved = sessionStorage.getItem("continent") || getQueryParam("continent");
  const CQZoneSaved = sessionStorage.getItem("cqzone") || getQueryParam("cqzone");
  const ITUZoneSaved = sessionStorage.getItem("ITUzone") || getQueryParam("ITUzone");

  if (savedInterval) {
    select.value = savedInterval;
    setReloadInterval(parseInt(savedInterval, 10));
  }
  intervalInput.value = intervalSaved || String(CONFIG.defaults.lastInterval);
  if (countrySaved) countrySelect.value = countrySaved;
  if (continentSaved) continentSelect.value = continentSaved;
  if (CQZoneSaved) cqZoneSelect.value = CQZoneSaved;
  if (ITUZoneSaved) ITUZoneSelect.value = ITUZoneSaved;

  const ITUZoneOutlineSaved = sessionStorage.getItem("ITUZoneOutline");
  if (ITUZoneOutlineSaved === "true") {
    const cb = document.getElementById("ituOutline");
    if (cb) cb.checked = true;
  }

  select.addEventListener("change", () => {
    const interval = parseInt(select.value, 10);
    sessionStorage.setItem("reloadInterval", interval);
    setReloadInterval(interval);
  });

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
    "bandFilter", "countryFilter", "continentFilter", "cqZoneFilter", "ITUZoneFilter",
    "cqOutline", "ituOutline"
  ].forEach(id => {
    document.getElementById(id).addEventListener("change", onMapFilterChange);
  });
  renderModePills(document.getElementById("modePills"), [], onMapFilterChange);

  // Sync lastInterval from table iframe via localStorage storage event, and
  // relabel bands when the dashboard's label style changes (#66).
  window.addEventListener("storage", (e) => {
    if (e.key === "lastInterval" && e.newValue) {
      intervalInput.value = e.newValue;
      fetchSpots();
    } else if (e.key === "bandLabels") {
      buildBandOptions();
      renderMapFilters();
    }
  });

  fetchSpots();
});