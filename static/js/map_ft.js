/**
 * HamSCI Contesting Dashboard - Map Visualization (map_ft.js)
 *
 * Interactive Leaflet map for visualizing HF propagation using WSPR, FT8, and FT4 digital mode spots.
 * This script handles:
 * - Loading and displaying propagation spots on a world map
 * - Client-side filtering by band, country, continent, CQ zone, ITU zone, and mode
 * - Real-time updates with configurable auto-reload intervals
 * - Band-specific colored markers (star icons) for visual identification
 * - Geographic lookups using Turf.js point-in-polygon operations
 * - Session storage for filter persistence across page reloads
 *
 * Author: Owen Ruzanski (KD3ALD)
 * Organization: University of Scranton (W3USR), Frankford Radio Club
 * Project: HamSCI PSWS Dashboard Development
 *
 * Dependencies:
 * - Leaflet.js (map library)
 * - Leaflet.ExtraMarkers (colored star markers)
 * - Turf.js (geospatial analysis - point in polygon)
 * - GeoJSON data files (countries, continents, CQ zones, ITU zones)
 */

// async function loadCqZones() {
//   try {
//     const res = await fetch("js/cqzones.geojson");
//     const data = await res.json();
//     cqZoneFeat = data.features;
//     console.log("Loaded", cqZoneFeat.length, "CQ zones");
//     if (cqZoneBordersLayer) {
//         map.removeLayer(cqZoneBordersLayer);
//     }
    
//     // Draw outline of all CQ Zones
//     cqZoneBordersLayer = L.geoJSON(cqZoneFeat, {
//         style: {
//             color: "black",      // outline color
//             weight: .5,         // thin lines
//             fillOpacity: 0       // no fill, outline only
//         }
//     }).addTo(map);
//   } catch (e) {
//     console.error("Failed to load CQ zones", e);
//   }
// }

  async function loadCqZones() {
    try {
      const res = await fetch("js/cqzones.geojson");
      const data = await res.json();
      cqZoneFeat = data.features;
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
var map = L.map('map').setView(CONFIG.map.initialView, CONFIG.map.initialZoom);

// Disable marker shadows globally for performance
L.Icon.Default.prototype.createShadow = function () { return null; };

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

const bandOrder = [
  '160m', '80m', '60m', '40m', '30m',
  '20m', '17m', '15m', '12m', '10m',
  '6m', '4m', '2m', '70cm', 'unknown'
];

const bandColorMap = {
  '160m': 'black',
  '80m': 'red',
  '60m': 'orange-dark',
  '40m': 'orange',
  '30m': 'yellow',
  '20m': 'green',
  '17m': 'green-light',
  '15m': 'cyan',
  '12m': 'blue-dark',
  '10m': 'blue-dark',
  '6m': 'purple',
  '4m': 'violet',
  '2m': 'pink',
  '70cm': 'white',
  'unknown': 'green-dark'
};

const colorHexMap = {
  "red": "991F24",
  "orange-dark": "D43019",
  "orange": "EE8918",
  "yellow": "F5B72D",
  "blue-dark": "183C52",
  "blue": "106AB6",
  "cyan": "21A2DA",
  "purple": "4E2960",
  "violet": "8B1E89",
  "pink": "BB4A99",
  "green-dark": "004B22",
  "green": "008B38",
  "green-light": "5AA429",
  "black": "211D1E",
  "white": "F5F4F5"
};

spotCountControl.update = function (bandCounts) {
  const selectedBand = document.getElementById('bandFilter')?.value || '';
  const lines = Object.entries(bandCounts)
    .sort(([a], [b]) => bandOrder.indexOf(a) - bandOrder.indexOf(b))
    .map(([band, count]) => {
      const markerColor = bandColorMap[band] || 'black';
      const hex = colorHexMap[markerColor] || '000000';
      const activeClass = band === selectedBand ? ' active' : '';
      return `<div class="spot-count-row${activeClass}" data-band="${band}"><span style="
        display: inline-block;
        width: 12px;
        height: 12px;
        margin-right: 6px;
        border-radius: 50%;
        background-color: #${hex};
        border: 1px solid #333;
      "></span><b>${band}</b>: ${count}</div>`;
    });
  this._div.innerHTML = `<b>Spots:</b><br>${lines.join('')}`;
};

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


// Cached, metadata-tagged markers from the last /spots fetch. Every filter
// except lastInterval (mode, country, continent, CQ/ITU zone, band) is
// applied purely from this cache in renderMapFilters() — no refetch, since
// the server only ever respects lastInterval (confirmed in services/spots.py).
let spotRecords = [];

async function fetchSpots() {
  setStatus('checking', 'Checking…');

  const lastInterval = document.getElementById("lastInterval").value || CONFIG.defaults.lastInterval;

  try {
    const res = await fetch(`/spots?lastInterval=${lastInterval}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const spots = await res.json();

    // Clear markers from the previous fetch
    spotRecords.forEach(rec => {
      map.removeLayer(rec.txMarker);
      map.removeLayer(rec.rxMarker);
    });
    spotRecords = [];

    //all possible color options
    const markerColors = [
      'red', 'orange-dark', 'orange', 'yellow', 'blue-dark',
      'cyan', 'purple', 'violet', 'pink',
      'green-dark', 'green', 'green-light',
      'black', 'white'
    ];
    const markers = {};
    markerColors.forEach(color => {
      markers[color] = L.ExtraMarkers.icon({
        icon: 'fa-coffee',
        markerColor: color,
        shape: 'star',
        prefix: 'fa',
        shadowSize: [0, 0],
      });
    });

    spots.forEach(spot => {
      if (
        isNaN(spot.tx_lat) || isNaN(spot.tx_lon) ||
        isNaN(spot.rx_lat) || isNaN(spot.rx_lon) ||
        spot.tx_lat < -90 || spot.tx_lat > 90 ||
        spot.tx_lon < -180 || spot.tx_lon > 180 ||
        spot.rx_lat < -90 || spot.rx_lat > 90 ||
        spot.rx_lon < -180 || spot.rx_lon > 180
      ) {
        return; // skip invalid coordinates
      }

      // Precompute everything a filter could need, once, so re-filtering
      // later is just property comparisons — no repeat Turf.js lookups.
      const bandName = frequencyToBand(spot.frequency) || 'unknown';
      const markerColor = bandColorMap[bandName] || 'black';
      const icon = markers[markerColor] || markers['black'];

      const txMarker = L.marker([spot.tx_lat, spot.tx_lon], { icon });
      txMarker.bindPopup(`
        <b>Received Spot by ${spot.rx_sign}</b><br>
        <b>TX:</b> <a href="https://qrz.com/db/${spot.tx_sign}">${spot.tx_sign}</a><br>
        <b>SNR:</b> ${spot.snr} dB<br>
        <b>Drift:</b> ${spot.drift}<br>
        <b>Freq:</b> ${spot.frequency} MHz<br>
        <b>Time:</b> ${parseWsprTime(spot.time)}<br>
        <b>Band:</b> ${spot.band} <br>
        <b>Mode:</b>  ${spot.mode.toUpperCase()}

      `);

      const rxMarker = L.marker([spot.rx_lat, spot.rx_lon]);
      rxMarker.bindPopup(`
        <b>Receiver</b><br>
        <b>RX:</b> ${spot.rx_sign}<br>
        <b>TX:</b> <a href="https://qrz.com/db/${spot.tx_sign}">${spot.tx_sign}</a><br>
        <b>SNR:</b> ${spot.snr} dB<br>
        <b>Drift:</b> ${spot.drift}<br>
        <b>Freq:</b> ${spot.frequency} MHz<br>
        <b>Time:</b> ${parseWsprTime(spot.time)}<br>
        <b>Band:</b> ${spot.band}</br>
        <b>Mode:</b>  ${spot.mode.toUpperCase()}

      `);

      spotRecords.push({
        txMarker,
        rxMarker,
        band: bandName,
        country: lookupCountry(spot.tx_lat, spot.tx_lon),
        continent: lookupContinent(spot.tx_lat, spot.tx_lon),
        cqZone: lookupCqZone(spot.tx_lat, spot.tx_lon),
        ituZone: lookupITUZone(spot.tx_lat, spot.tx_lon),
        mode: (spot.mode || "").toLowerCase(),
      });
    });

    renderMapFilters();
    setStatus('connected', 'Connected');
    setLastUpdated();
  } catch (e) {
    console.error('Failed to load spots:', e);
    setStatus('disconnected', 'Error');
  }
}

// Pure client-side re-filter of the cached spotRecords — toggles marker
// visibility and rebuilds the spot-count control. No network involved.
function renderMapFilters() {
  const selectedBand = document.getElementById("bandFilter").value;
  const selectedCountry = document.getElementById("countryFilter").value;
  const selectedContinent = document.getElementById("continentFilter").value;
  const selectedCqZone = document.getElementById("cqZoneFilter").value;
  const selectedITUZone = document.getElementById("ITUZoneFilter").value;
  const allowWSPR = document.getElementById("modeWSPR").checked;
  const allowFT8  = document.getElementById("modeFT8").checked;
  const allowFT4  = document.getElementById("modeFT4").checked;
  const anyModeChecked = allowWSPR || allowFT8 || allowFT4;

  let bandCounts = {};
  let mapped = 0;

  spotRecords.forEach(rec => {
    let modeOk = true;
    if (anyModeChecked) {
      if (rec.mode === "wspr" && !allowWSPR) modeOk = false;
      else if (rec.mode === "ft8" && !allowFT8) modeOk = false;
      else if (rec.mode === "ft4" && !allowFT4) modeOk = false;
    }

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
      if (!map.hasLayer(rec.txMarker)) rec.txMarker.addTo(map);
      if (!map.hasLayer(rec.rxMarker)) rec.rxMarker.addTo(map);
    } else {
      if (map.hasLayer(rec.txMarker)) map.removeLayer(rec.txMarker);
      if (map.hasLayer(rec.rxMarker)) map.removeLayer(rec.rxMarker);
    }
  });

  spotCountControl.update(bandCounts);
  bandCountsOut = bandCounts;

  const spotInfo = document.getElementById("spot-info");
  if (spotInfo) {
    const countryName = selectedCountry || "all countries";
    const readableDate = `${document.getElementById("lastInterval").value || CONFIG.defaults.lastInterval} minutes`;
    const bandName1 = selectedBand === "CBs" ? "Contest Bands" : (selectedBand || "All Bands");
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
  function onInstantFilterChange() {
    persistFilterState();
    renderMapFilters();
  }

  update.addEventListener("click", onIntervalChange);
  intervalInput.addEventListener("change", onIntervalChange);

  [
    "bandFilter", "countryFilter", "continentFilter", "cqZoneFilter", "ITUZoneFilter",
    "cqOutline", "ituOutline", "modeWSPR", "modeFT8", "modeFT4"
  ].forEach(id => {
    document.getElementById(id).addEventListener("change", onInstantFilterChange);
  });

  // Sync lastInterval from table iframe via localStorage storage event
  window.addEventListener("storage", (e) => {
    if (e.key === "lastInterval" && e.newValue) {
      intervalInput.value = e.newValue;
      fetchSpots();
    }
  });

  fetchSpots();
});