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

// Global arrays to store GeoJSON feature collections for geographic lookups
// These are loaded asynchronously on page load
let countryFeat = [];      // Country boundary polygons (~250 countries)
let continentFeat = [];    // Continent boundary polygons (7 continents)
let cqZoneFeat = [];       // CQ zone polygons (40 zones for amateur radio contests)
let ITUZoneFeat = [];      // ITU zone polygons (90 zones for telecommunications)

// Contest bands filter - limits display to the 6 traditional HF contest bands
// Excludes WARC bands (30m, 17m, 12m) where contesting is prohibited
const CONTEST_BANDS = ["160m", "80m", "40m", "20m", "15m", "10m"];


/**
 * Load country boundary polygons from GeoJSON file.
 *
 * Fetches the countries.geojson file (14MB) containing boundary polygons
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
 * Fetches the continents.geojson file (4KB) containing polygons for
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
    console.log("Loaded", continentFeat.length, "continent polygons")
  } catch (e) {
    console.error("Failed to load continent GeoJSON", e);
  }
}
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
/**
 * Lookup country name from geographic coordinates.
 *
 * Uses Turf.js point-in-polygon test against country boundary polygons
 * to determine which country contains the given coordinates.
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
 * CQ zones are numbered 1-40 and are used for amateur radio
 * contests and awards (e.g., Worked All Zones - WAZ).
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
 * ITU zones are numbered 1-90 and are defined by the International
 * Telecommunication Union for amateur radio purposes.
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

//format date
// removed date input conversion helper (UI no longer supports date filtering)


function getQueryParam(name) {
  const urlParams = new URLSearchParams(window.location.search);
  return urlParams.get(name);
}

var map = L.map('map').setView([20, 0], 2);


//cq zone overlay
let cqZoneBordersLayer = null;




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



//add images to map
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  noWrap: true,
  bounds: [[-90, -180], [90, 180]]
}).addTo(map);
var layers = [];



// helper funcs
function frequencyToBand(freq) {
  if (freq >= .136 && freq < .137) return "2200m";
  if (freq >=.472 && freq < .479) return "630m";
  if (freq >= 1.8 && freq < 2) return "160m";
  if (freq >= 3.5 && freq < 4) return "80m";
  if (freq >= 5.2 && freq < 5.5) return "60m";
  if (freq >= 7.0 && freq < 7.3) return "40m";
  if (freq >= 10.1 && freq < 10.15) return "30m";
  if (freq >= 14.0 && freq < 14.35) return "20m";
  if (freq >= 18.068 && freq < 18.168) return "17m";
  if (freq >= 21.0 && freq < 21.45) return "15m";
  if (freq >= 24.89 && freq < 24.99) return "12m";
  if (freq >= 28.0 && freq < 29.7) return "10m";
  if (freq >= 50.0 && freq < 54.0) return "6m";
  if (freq >= 144.0 && freq < 148.0) return "2m";
  return "Unknown";
}
function parseWsprTime(wsprTimeStr) {
  const [datePart, timePart] = wsprTimeStr.split(' ');
  const year = 2000 + parseInt(datePart.slice(0, 2), 10);
  const month = parseInt(datePart.slice(2, 4), 10) - 1; // JS months: 0–11
  const day = parseInt(datePart.slice(4, 6), 10);
  const hour = parseInt(timePart.slice(0, 2), 10);
  const minute = parseInt(timePart.slice(2, 4), 10);

  const dt = new Date(Date.UTC(year, month, day, hour, minute));
  return dt.toISOString().replace('T', ' ').slice(0, 19); // "YYYY-MM-DD HH:MM:SS"
}
function reverseWsprDate(dateStr) {
  if (!dateStr || dateStr.length !== 6) return "Unknown date";
  const year = 2000 + parseInt(dateStr.slice(0, 2), 10);
  const month = dateStr.slice(2, 4);
  const day = dateStr.slice(4, 6);
  return `${year}-${month}-${day}`;
}
// band counts out for tables / charts
let bandCountsOut = {};


async function loadSpots() {

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
  const res = await fetch(`/spots?${queryParams.toString()}`);
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
    // Use pre-computed CQ zone from backend instead of expensive client-side lookup
    // This eliminates point-in-polygon calculation for 40 CQ zone polygons per spot
    const tx_cqzone = spot.cq_zone ? String(spot.cq_zone) : "Unknown";

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


    const path = L.polyline([
      [spot.tx_lat, spot.tx_lon],
      [spot.rx_lat, spot.rx_lon]
    ], { color: 'grey' }).addTo(map);

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

    path.bindPopup(`
      <b>TX:</b> <a href="https://qrz.com/db/${spot.tx_sign}">${spot.tx_sign}</a> ➔ <b>RX:</b> ${spot.rx_sign}<br>
      <b>SNR:</b> ${spot.snr} dB<br>
      <b>Drift:</b> ${spot.drift}<br>
      <b>Freq:</b> ${spot.frequency} MHz<br>
      <b>Time:</b> ${parseWsprTime(spot.time)}<br>
      <b>Band:</b> ${spot.band} <br>
      <b>Decoded Spots:</b> ${spotCount} </br>
      <b>Mode:</b>  ${spot.mode.toUpperCase()}

    `);

    layers.push(path, txMarker, rxMarker);

    
  });

  spotCountControl.update(bandCounts);
  bandCountsOut = bandCounts;
  console.log(bandCountsOut)
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
  await loadCountryPolygons();
  await loadContinentPolygons();
  await loadCqZones();
  await loadITUZones();
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
  intervalInput.value = getQueryParam("lastInterval") || "15";

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