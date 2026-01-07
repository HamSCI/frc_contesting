//lat-lon to country, continent, and cq zone
let countryFeat = [];
let continentFeat = [];
let cqZoneFeat = [];

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
async function loadCqZones() {
  try {
    const res = await fetch("js/cq-zones.geojson");
    const data = await res.json();
    cqZoneFeat = data.features;
    console.log("Loaded", cqZoneFeat.length, "CQ zones");
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

function lookupCountry(lat, lon) {
  const pt = turf.point([lon, lat]);
  for (const feature of countryFeat) {
    if (turf.booleanPointInPolygon(pt, feature)) {
      return feature.properties.name || "Unknown";
    }
  }
  return "Unknown";
}
function lookupContinent(lat, lon) {
  const pt = turf.point([lon, lat]);
  for (const feature of continentFeat) {
    if (turf.booleanPointInPolygon(pt, feature)) {
      return feature.properties.continent || "Unknown";
    }
  }
  return null;
}

function lookupCqZone(lat, lon) {
  const pt = turf.point([lon, lat]);
  for (const feature of cqZoneFeat) {
    if (turf.booleanPointInPolygon(pt, feature)) {
      return String(feature.properties.cq_zone_number);
    }
  }
  return "Unknown";
}

//format date
function dateToYYMMDD(dateStr) {
  if (!dateStr) return "";
  const dateObj = new Date(dateStr);
  const yy = String(dateObj.getFullYear()).slice(2);
  const mm = String(dateObj.getMonth() + 1).padStart(2, '0');
  const dd = String(dateObj.getDate() +1).padStart(2, '0');
  yymmdd = yy + mm + dd;
  return yymmdd
}


function getQueryParam(name) {
  const urlParams = new URLSearchParams(window.location.search);
  return urlParams.get(name);
}

var map = L.map('map').setView([20, 0], 2);



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
//export let bandCountsOut = {};


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
  const numSpots = document.getElementById("spots").value || getQueryParam("numSpots") || 100;
  const date = dateToYYMMDD(document.getElementById("date").value )|| getQueryParam("date") || "";
  const time = document.getElementById("hour").value || getQueryParam("time") || "";
  const selectedBand = getQueryParam("band") || document.getElementById("bandFilter").value;
  const selectedCountry = document.getElementById("countryFilter").value;
  const selectedContinent = document.getElementById("continentFilter").value;
  const selectedCqZone = document.getElementById("cqZoneFilter").value;
  const queryParams = new URLSearchParams();
  queryParams.set("numSpots", numSpots);
  if (date) queryParams.set("date", date);
  if (time) queryParams.set("time", time);
  if (selectedBand) queryParams.set("band", selectedBand);
  if (selectedCountry) queryParams.set("country", selectedCountry);
  if (selectedContinent) queryParams.set("continent", selectedContinent)
  const res = await fetch(`/spots?${queryParams.toString()}`);
  //console.log(`/spots?${queryParams.toString()}`)
  const spots = await res.json();

  // set spot info h3 and title
  const readableDate = (date && reverseWsprDate(date)) || "today";
  const readableTime = (time && `${time.slice(0, 2)}:00`) || "all times";
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

    //map by country
    const tx_country = lookupCountry(spot.tx_lat, spot.tx_lon);
    if (selectedCountry && tx_country !== selectedCountry) {
      return; // skip this spot
    }
    //map by cont.
    const tx_continent = lookupContinent(spot.tx_lat, spot.tx_lon);
    if(selectedContinent && tx_continent !== selectedContinent){
      return; //skip spot
    }
    //map by cq zone
    const tx_cqzone = lookupCqZone(spot.tx_lat, spot.tx_lon);
    if(selectedCqZone && tx_cqzone !== selectedCqZone){
      return; //skip spot
    }

    
    //freq to band
    const bandName = frequencyToBand(spot.frequency) || 'unknown';
    if (selectedBand && bandName !== selectedBand) {
      return; // skip this spot if it doesn't match the filter
    }
    bandCounts[bandName] = (bandCounts[bandName] || 0) + 1;

    //dynamic num spots mapped and title
    mapped++;
    const spotInfo = document.getElementById("spot-info");
    spotInfo.textContent = `Found ${mapped} spot${mapped !== 1 ? "s" : ""} from ${countryName} on ${readableDate} at ${readableTime} on ${bandName1}`;
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
      <b>Freq:</b> ${spot.frequency} MHz<br>
      <b>Time:</b> ${parseWsprTime(spot.time)}<br>
      <b>Band:</b> ${bandName} <br>
      <b>Decoded Spots:</b> ${spotCount}

    `);

    //make rx markers
    const rxMarker = L.marker([spot.rx_lat, spot.rx_lon]).addTo(map);
    rxMarker.bindPopup(`
      <b>Receiver</b><br>
      <b>RX:</b> ${spot.rx_sign}<br>
      <b>TX:</b> <a href="https://qrz.com/db/${spot.tx_sign}">${spot.tx_sign}</a><br>
      <b>SNR:</b> ${spot.snr} dB<br>
      <b>Freq:</b> ${spot.frequency} MHz<br>
      <b>Time:</b> ${parseWsprTime(spot.time)}<br>
      <b>Band:</b> ${bandName}
    `);

    path.bindPopup(`
      <b>TX:</b> <a href="https://qrz.com/db/${spot.tx_sign}">${spot.tx_sign}</a> ➔ <b>RX:</b> ${spot.rx_sign}<br>
      <b>SNR:</b> ${spot.snr} dB<br>
      <b>Freq:</b> ${spot.frequency} MHz<br>
      <b>Time:</b> ${parseWsprTime(spot.time)}<br>
      <b>Band:</b> ${bandName} <br>
      <b>Decoded Spots:</b> ${spotCount}
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
  //console.log(lookupContinent(40.7128, -74.0060))
  //console.log(lookupCqZone(40.7128, -74.0060))


  const update = document.getElementById("updateButton")
  const spotsInput = document.getElementById("spots");
  const dateInput = document.getElementById("date");
  const hourSelect = document.getElementById("hour");
  const select = document.getElementById("reloadInterval");
  const countrySelect = document.getElementById("countryFilter");
  const continentSelect = document.getElementById("continentFilter");
  const cqZoneSelect = document.getElementById("cqZoneFilter")
  const savedCountry = getQueryParam("country");
  const savedContinent = getQueryParam("continent")
  const savedCQZone = getQueryParam("cqzone")


  // Restore previous selections from sessionStorage
  const savedInterval = sessionStorage.getItem("reloadInterval");
  const spotsSaved = sessionStorage.getItem("spots") || getQueryParam("numSpots")
  const dateSaved = sessionStorage.getItem("date") || getQueryParam("date")
  const hourSaved = sessionStorage.getItem("hour") || getQueryParam("time")
  const countrySaved = sessionStorage.getItem("country") || getQueryParam("country")
  const continentSaved = sessionStorage.getItem("continent") || getQueryParam("continent")
  const CQZoneSaved = sessionStorage.getItem("cqzone") || getQueryParam("cqzone")
  if (savedInterval) {
    select.value = savedInterval;
    setReloadInterval(parseInt(savedInterval, 10));
  }
  if (spotsSaved) spotsInput.value = spotsSaved;
  if (dateSaved) {
    dateInput.value = dateSaved;
  } else {
    dateInput.value = dateToYYMMDD(getQueryParam("date")) || "";
  }  if (hourSaved) hourSelect.value = hourSaved;
  if (countrySaved) countrySelect.value = countrySaved;
  if (continentSaved) continentSelect.value = continentSaved;
  if(CQZoneSaved) cqZoneSelect.value = CQZoneSaved
  loadSpots();


  select.addEventListener("change", () => {
    const interval = parseInt(select.value, 10);
    sessionStorage.setItem("reloadInterval", interval);
    setReloadInterval(interval);
  });
  if(savedCountry){
    countrySelect.value = savedCountry;
  }
  if(savedContinent){
    continentSelect.value = savedContinent
  }
  spotsInput.value = getQueryParam("numSpots") || "100";
  dateInput.value = dateToYYMMDD(getQueryParam("date")) || "";
  hourSelect.value = getQueryParam("time") || "";
  const bandSelect = document.getElementById("bandFilter");
  const savedBand = getQueryParam("band")
  if(savedBand){
    bandSelect.value = savedBand;
  }
  // bandSelect.addEventListener("change", () => {
  //   const newBand = bandSelect.value;
  //   const url = new URL(window.location.href);
  //   if (newBand) {
  //     url.searchParams.set("band", newBand);
  //   } else {
  //     url.searchParams.delete("band");
  //   }
  //   window.location.href = url.toString();
  // });
  update.addEventListener("click", function() {
    const params = new URLSearchParams(window.location.search);

    const spots = document.getElementById("spots").value;
    sessionStorage.setItem("spots", document.getElementById("spots").value);
    if (spots) params.set("numSpots", spots); else params.delete("numSpots");

    const dateVal = document.getElementById("date").value;
    sessionStorage.setItem("date", document.getElementById("date").value);
    if (dateVal) params.set("date", dateToYYMMDD(dateVal)); else params.delete("date");

    const timeVal = document.getElementById("hour").value;
    sessionStorage.setItem("hour", document.getElementById("hour").value);
    if (timeVal) params.set("time", timeVal); else params.delete("time");

    const band = document.getElementById("bandFilter").value;
    if (band) params.set("band", band); else params.delete("band");

    const country = document.getElementById("countryFilter").value;
    sessionStorage.setItem("country", document.getElementById("countryFilter").value);
    if (country) params.set("country", country); else params.delete("country");

    const continent = document.getElementById("continentFilter").value;
    sessionStorage.setItem("continent", document.getElementById("continentFilter").value);
    if(continent) params.set("continent", continent); else params.delete("continent");
    
    const cqZone = document.getElementById("cqZoneFilter").value;
    sessionStorage.setItem("cqzone", document.getElementById("cqZoneFilter").value);
    if(cqZone) params.set("cqzone", cqZone); else params.delete("cqzone");

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
