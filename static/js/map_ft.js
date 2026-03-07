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




// Create the spot count control once, outside loadSpots
let spotCountControl = L.control({ position: 'bottomright' });

spotCountControl.onAdd = function () {
  this._div = L.DomUtil.create('div', 'spot-counter');
  this.update({});
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
  const lines = Object.entries(bandCounts)
    .sort(([a], [b]) => bandOrder.indexOf(a) - bandOrder.indexOf(b))
    .map(([band, count]) => {
      const markerColor = bandColorMap[band] || 'black';
      const hex = colorHexMap[markerColor] || '000000';
      return `<span style="
        display: inline-block;
        width: 12px;
        height: 12px;
        margin-right: 6px;
        border-radius: 50%;
        background-color: #${hex};
        border: 1px solid #333;
      "></span><b>${band}</b>: ${count}`;
    });
  this._div.innerHTML = `<b>Spots:</b><br>${lines.join('<br>')}`;
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
var layers = [];



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


async function loadSpots() {
  setStatus('checking', 'Checking…');

  //all possible color options
  const markerColors = [
    'red', 'orange-dark', 'orange', 'yellow', 'blue-dark',
    'cyan', 'purple', 'violet', 'pink',
    'green-dark', 'green', 'green-light',
    'black', 'white'
  ];
  //band color map
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
  

// load all params, build url , load json
  const lastInterval = document.getElementById("lastInterval").value || getQueryParam("lastInterval") || 15;
  const selectedBand = getQueryParam("band") || document.getElementById("bandFilter").value;
  const selectedCountry = document.getElementById("countryFilter").value;
  const selectedContinent = document.getElementById("continentFilter").value;
  const selectedCqZone = document.getElementById("cqZoneFilter").value;
  const selectedITUZone = document.getElementById("ITUZoneFilter").value;
  const queryParams = new URLSearchParams();
  queryParams.set("lastInterval", lastInterval);
  // no date/time params sent to server; server only supports lastInterval
  if (selectedBand) queryParams.set("band", selectedBand);
  if (selectedCountry) queryParams.set("country", selectedCountry);
  if (selectedContinent) queryParams.set("continent", selectedContinent)
  try {
  const res = await fetch(`/spots?${queryParams.toString()}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  //console.log(`/spots?${queryParams.toString()}`)
  const spots = await res.json();

  // set spot info h3 and title
  const readableDate = `${lastInterval} minutes`; // show the minutes window
  const readableTime = "recent";
  const countryName = selectedCountry || "all countries";
  const bandName1 = getQueryParam("band") || "All Bands"


  layers.forEach(layer => map.removeLayer(layer));
  layers = [];

  let bandCounts = {};
  let firstRxLat = null;
  let firstRxLon = null;
  let centered = true;
  let mapped = 0;

  //map each spot 
  const spotCountsMap = {};
  spots.forEach(spot => {
    const key = `${spot.tx_sign}_${spot.rx_sign}_${spot.frequency}`;
    spotCountsMap[key] = (spotCountsMap[key] || 0) + 1;
    if (!centered && spot.rx_lat && spot.rx_lon) {
      map.setView([spot.rx_lat, spot.rx_lon]);
      centered = true;
    }
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
    // FILTER BY MODE (WSPR, FT8, FT4)
    const modeLower = (spot.mode || "").toLowerCase();

    const allowWSPR = document.getElementById("modeWSPR").checked;
    const allowFT8  = document.getElementById("modeFT8").checked;
    const allowFT4  = document.getElementById("modeFT4").checked;

    if (!allowWSPR && !allowFT8 && !allowFT4) {
        // treat as "All modes"
    } else {
        if (modeLower === "wspr" && !allowWSPR) return;
        if (modeLower === "ft8"  && !allowFT8)  return;
        if (modeLower === "ft4"  && !allowFT4)  return;
    }

    //map by country
    const tx_country = lookupCountry(spot.tx_lat, spot.tx_lon);
    if (selectedCountry === "nonUS") {
      if (tx_country === "United States of America") return;  // skip US
    }

    else if (selectedCountry && selectedCountry !== "" && selectedCountry !== "all") {
      if (tx_country !== selectedCountry) return;  // skip non-matching country
}
    //map by cont.
    const tx_continent = lookupContinent(spot.tx_lat, spot.tx_lon);
    if(selectedContinent && tx_continent !== selectedContinent){
      return; //skip spot
    }
    //map by cq zone
    const tx_cqzone = lookupCqZone(spot.tx_lat, spot.tx_lon);

    // If user selected "All zones" (blank), skip filtering
    if (selectedCqZone === "" || selectedCqZone === null) {
      // do nothing
    }
    // Normal numeric zone filtering
    else if (selectedCqZone !== "CBs") {   // Do NOT zone-filter CBs mode
      if (tx_cqzone !== String(selectedCqZone)) {
        return; // Skip spots not in this CQ zone
      }
    }

    //map by itu zone
     const tx_ITUzone = lookupITUZone(spot.tx_lat, spot.tx_lon);
    if(selectedITUZone && tx_ITUzone !== selectedITUZone){
      return; //skip spot
    }

    
    //freq to band
    // const bandName = frequencyToBand(spot.frequency) || 'unknown';
    // if (selectedBand && bandName !== selectedBand) {
    //   return; // skip this spot if it doesn't match the filter
    // }
    // bandCounts[bandName] = (bandCounts[bandName] || 0) + 1;


    //freq to band
    const bandName = frequencyToBand(spot.frequency) || 'unknown';

    // "Contest Bands Only" mode
    if (selectedBand === "CBs") {
      if (!CONTEST_BANDS.includes(bandName)) {
        return; // skip non-contest bands
      }
    }
    // Normal single-band filter
    else if (selectedBand && bandName !== selectedBand) {
      return; // skip this spot if it doesn't match the selected band
    }

    bandCounts[bandName] = (bandCounts[bandName] || 0) + 1;


    //dynamic num spots mapped and title
    mapped++;
    const spotInfo = document.getElementById("spot-info");
    spotInfo.textContent = `Found ${mapped} spot${mapped !== 1 ? "s" : ""} from ${countryName} for last ${readableDate} on ${bandName1}`;
    const title = document.getElementById("title");
    title.textContent = `WSPR Spots From ${spot.rx_sign} PSWS Receiver`

    //num decoded per spot
    const spotKey = `${spot.tx_sign}_${spot.rx_sign}_${spot.frequency}`;
    const spotCount = spotCountsMap[spotKey];
    

    //colored markers
    const markerColor = bandColorMap[bandName] || 'black';
    const icon = markers[markerColor] || markers['black'];


    if (!markers[markerColor]) {
      console.warn(`Missing marker color for band: ${bandName}, color: ${markerColor}`);
    }
    //make tx markers
    const txMarker = L.marker([spot.tx_lat, spot.tx_lon], {
      icon: icon
    }).addTo(map);
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

    //make rx markers
    const rxMarker = L.marker([spot.rx_lat, spot.rx_lon]).addTo(map);
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

    layers.push(txMarker, rxMarker);

    
  });

  spotCountControl.update(bandCounts);
  bandCountsOut = bandCounts;
  console.log(bandCountsOut);
  setStatus('connected', 'Connected');
  setLastUpdated();
  } catch (e) {
    console.error('Failed to load spots:', e);
    setStatus('disconnected', 'Error');
  }
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
  //console.log(lookupContinent(40.7128, -74.0060))
  //console.log(lookupCqZone(40.7128, -74.0060))


  const update = document.getElementById("updateButton")
  const intervalInput = document.getElementById("lastInterval");
  // optional inputs that may not exist in every template

  const select = document.getElementById("reloadInterval");
  const countrySelect = document.getElementById("countryFilter");
  const continentSelect = document.getElementById("continentFilter");
  const cqZoneSelect = document.getElementById("cqZoneFilter")
  const ITUZoneSelect = document.getElementById("ITUZoneFilter")
  const savedCountry = getQueryParam("country");
  const savedContinent = getQueryParam("continent")
  const savedCQZone = getQueryParam("cqzone")
  const modeWSPR = document.getElementById("modeWSPR").checked;
  const modeFT8  = document.getElementById("modeFT8").checked;
  const modeFT4  = document.getElementById("modeFT4").checked;

  // Restore previous selections from sessionStorage
  const savedInterval = sessionStorage.getItem("reloadInterval");
  const intervalSaved = sessionStorage.getItem("lastInterval") || getQueryParam("lastInterval")
  const countrySaved = sessionStorage.getItem("country") || getQueryParam("country")
  const continentSaved = sessionStorage.getItem("continent") || getQueryParam("continent")
  const CQZoneSaved = sessionStorage.getItem("cqzone") || getQueryParam("cqzone")
  const ITUZoneSaved = sessionStorage.getItem("ITUzone") || getQueryParam("ITUzone")
  if (savedInterval) {
    select.value = savedInterval;
    setReloadInterval(parseInt(savedInterval, 10));
  }
  if (intervalSaved) intervalInput.value = intervalSaved;
  if (countrySaved) countrySelect.value = countrySaved;
  if (continentSaved) continentSelect.value = continentSaved;
  if(CQZoneSaved) cqZoneSelect.value = CQZoneSaved
  if(ITUZoneSaved) ITUZoneSelect.value = ITUZoneSaved

  const ITUZoneOutlineSaved = sessionStorage.getItem("ITUZoneOutline");
  if (ITUZoneOutlineSaved === "true") {
    const cb = document.getElementById("ituOutline");
    if (cb) cb.checked = true;
  }

  loadSpots();


  select.addEventListener("change", () => {
    
    const interval = parseInt(select.value, 10);
    sessionStorage.setItem("reloadInterval", interval);
    setReloadInterval(interval);
  });


  const params = new URLSearchParams(window.location.search);

  if(savedCountry){
    countrySelect.value = savedCountry;
  }
  if(savedContinent){
    continentSelect.value = savedContinent
  }
  if (!intervalSaved) intervalInput.value = getQueryParam("lastInterval") || String(CONFIG.defaults.lastInterval);

  //band filter
  const band = document.getElementById("bandFilter").value;

  // Don't send CBs to server
  if (band && band !== "CBs") {
    params.set("band", band);
  } else {
    params.delete("band");
  }
  
  update.addEventListener("click", function() {
    const params = new URLSearchParams(window.location.search);

    const minInterval = document.getElementById("lastInterval").value;
    sessionStorage.setItem("lastInterval", minInterval);
    localStorage.setItem("lastInterval", minInterval);
    if (minInterval) params.set("lastInterval", minInterval); else params.delete("lastInterval");

      // date/hour inputs removed; do not read or store them
      // no numSpots param — site only uses lastInterval for server filtering

    const band = document.getElementById("bandFilter").value;
    if (band) params.set("band", band); else params.delete("band");

    // const country = document.getElementById("countryFilter").value;
    // sessionStorage.setItem("country", document.getElementById("countryFilter").value);
    // if (country) params.set("country", country); else params.delete("country");
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
    sessionStorage.setItem("continent", document.getElementById("continentFilter").value);
    if(continent) params.set("continent", continent); else params.delete("continent");
    
    const cqZone = document.getElementById("cqZoneFilter").value;
    sessionStorage.setItem("cqzone", document.getElementById("cqZoneFilter").value);
    if(cqZone) params.set("cqzone", cqZone); else params.delete("cqzone");

    const ITUZone = document.getElementById("ITUZoneFilter").value;
    sessionStorage.setItem("ITUzone", document.getElementById("ITUZoneFilter").value);
    if(ITUZone) params.set("ITUzone", ITUZone); else params.delete("ITUzone");

    sessionStorage.setItem("CQZoneOutline", cqOutlineCheckbox.value);
    if(cqOutlineCheckbox) params.set("CQZoneOutline", cqOutlineCheckbox); else params.delete("CQZoneOutline");

    const newUrl = `${window.location.pathname}?${params.toString()}`;
    window.history.replaceState(null, "", newUrl);

    // Now load spots with new params
    loadSpots();
    //window.location.reload();
  });

  // Sync lastInterval from table iframe via localStorage storage event
  window.addEventListener("storage", (e) => {
    if (e.key === "lastInterval" && e.newValue) {
      document.getElementById("lastInterval").value = e.newValue;
      loadSpots();
    }
  });

  //auto reload-on select
  // countrySelect.addEventListener("change", () =>{
  //   const newCountry = countrySelect.value;
  //   const url = new URL(window.location.href)

  //   if(newCountry){
  //     url.searchParams.set("country", newCountry);
  //   } else{
  //     url.searchParams.delete("country")
  //   }
  //   window.location.href = url.toString();
  // })
  //bandSelect.addEventListener("change", () => {
  //loadSpots();
  //});


});