function getQueryParam(name) {
  const urlParams = new URLSearchParams(window.location.search);
  return urlParams.get(name);
}

var map = L.map('map').setView([20, 0], 2);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  noWrap: true,
  bounds: [[-90, -180], [90, 180]]
}).addTo(map);
var layers = [];

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

async function loadSpots() {

// load all params
  const numSpots = getQueryParam("numSpots");
  const date = getQueryParam("date")
  const time = getQueryParam('time')
  const res = await fetch(`/spots?numSpots=${numSpots}&date=${date}&time=${time}`);
  const spots = await res.json();

// set spot info h3
  const spotInfo = document.getElementById("spot-info");
  const readableDate = date ? reverseWsprDate(date) : "today";
  const readableTime = time ? `${time.slice(0, 2)}:00` : "all times";
  spotInfo.textContent = `Displaying ${spots.length} spots for ${readableDate} at ${readableTime}`;
  

  layers.forEach(layer => map.removeLayer(layer));
  layers = [];

  const bandCounts = {};
  let firstRxLat = null;
  let firstRxLon = null;
  let centered = false;

  // spot control for bottom right
  const spotCountControl = L.control({ position: 'bottomright' });

  spotCountControl.onAdd = function () {
    this._div = L.DomUtil.create('div', 'spot-counter');
    this.update({});
    return this._div;
  };

  spotCountControl.update = function (bandCounts) {
    const lines = Object.entries(bandCounts)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([band, count]) => `<b>${band}</b>: ${count}`);
    this._div.innerHTML = `<b>Spots:</b><br>${lines.join('<br>')}`;
  };

  spotCountControl.addTo(map);

  //map each spot 
  spots.forEach(spot => {
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

    //freq to band
    const bandName = frequencyToBand(spot.frequency);
    bandCounts[bandName] = (bandCounts[bandName] || 0) + 1;

    const path = L.polyline([
      [spot.tx_lat, spot.tx_lon],
      [spot.rx_lat, spot.rx_lon]
    ], { color: 'grey' }).addTo(map);


    //make tx markers
    const txMarker = L.marker([spot.tx_lat, spot.tx_lon]).addTo(map);
    txMarker._icon.classList.add(`hue-${bandName}`)
    txMarker.bindPopup(`
      <b>Received Spot by ${spot.rx_sign}</b><br>
      <b>TX:</b> <a href="https://qrz.com/db/${spot.tx_sign}">${spot.tx_sign}</a><br>
      <b>SNR:</b> ${spot.snr} dB<br>
      <b>Freq:</b> ${spot.frequency} MHz<br>
      <b>Time:</b> ${parseWsprTime(spot.time)}<br>
      <b>Band:</b> ${bandName}
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
      <b>Band:</b> ${bandName}
    `);

    layers.push(path, txMarker, rxMarker);

    
  });

  spotCountControl.update(bandCounts);

}

window.addEventListener('DOMContentLoaded', loadSpots);
