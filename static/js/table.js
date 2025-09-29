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


// async function loadSpots() {
//   const numSpots = document.getElementById("spots")?.value || getQueryParam("numSpots") || 100;
//   const date = dateToYYMMDD(document.getElementById("date")?.value) || getQueryParam("date") || "";
//   const selectedCountry = document.getElementById("countryFilter")?.value;

//   const queryParams = new URLSearchParams();
//   queryParams.set("numSpots", numSpots);
//   if (date) queryParams.set("date", date);
//   if (selectedCountry) queryParams.set("country", selectedCountry);

//   const res = await fetch(`/tbspots?${queryParams.toString()}`);
//   console.log(`/tbspots?${queryParams.toString()}`)
//   const spots = await res.json();

//   // --- Build aggregation ---
//   const counts = {}; // { country: { band: count } }
//   const allBands = new Set();

//   spots.forEach(s => {
//     const country = s.txcountry || "Unknown";
//     const band = s.band || "Unknown";
//     allBands.add(band);
//     if (!counts[country]) counts[country] = {};
//     if (!counts[country][band]) counts[country][band] = 0;
//     counts[country][band]++;
//   });

//   const bandList = Array.from(allBands).sort();

//   // --- Build HTML table ---
//   let html = "<table border='1' cellspacing='0' cellpadding='5' style='margin:auto; border-collapse:collapse; font-family:courier;'>";
//   html += "<tr><th>Country</th>";
//   bandList.forEach(b => { html += `<th>${b}</th>`; });
//   html += "</tr>";

//   Object.keys(counts).sort().forEach(country => {
//     html += `<tr><td>${country}</td>`;
//     bandList.forEach(b => {
//       html += `<td>${counts[country][b] || 0}</td>`;
//     });
//     html += "</tr>";
//   });

//   html += "</table>";

//   document.getElementById("spotsTableContainer").innerHTML = html;
//   console.log("successfully loaded")
// }

// //reload interval
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






const regionCountries = {
  "Europe": ["Spain", "United Kingdom", "Germany", "France", "Italy", "Poland", "Netherlands"],
  "Caribbean": ["Cuba", "Puerto Rico", "Dominican Republic", "Jamaica", "Bahamas"],
  "South America": ["Brazil", "Argentina", "Chile", "Uruguay", "Peru"],
  "Japan": ["Japan"],
  "Africa": ["South Africa", "Nigeria", "Kenya", "Morocco", "Egypt"],
  "VK": ["Australia"],
  "YB": ["Indonesia"],
  "China": ["China"],
  "UA9": ["Russia"],
  "Indian": ["India", "Sri Lanka"],
  "Middle East": ["Saudi Arabia", "United Arab Emirates", "Israel", "Jordan"],
  "Thailand": ["Thailand"],
  "North America": ["United States", "Canada", "Mexico"],
  "Unknown": ["unknown", "Unknown"]
};

function getRegionCount(region, band, counts) {
  let total = 0;
  (regionCountries[region] || []).forEach(c => {
    if (counts[c]?.[band]) total += counts[c][band];
  });
  return total;
}


async function loadSpots() {
  const numSpots = document.getElementById("spots").value || getQueryParam("numSpots") || 100;
  const res = await fetch(`/tbspots?numSpots=${numSpots}`);
  const spots = await res.json();

  // get threshold from input (default 1)
  const threshold = parseInt(document.getElementById("threshold")?.value || "1", 10);

  const counts = {}; // { country: { band: count } }
  const bandOrder = ["80m", "40m", "30m", "20m", "15m", "12m", "10m"];

  spots.forEach(s => {
    const country = s.txcountry || "Unknown";
    const band = s.band || "Unknown";
    if (!counts[country]) counts[country] = {};
    if (!counts[country][band]) counts[country][band] = 0;
    counts[country][band]++;
  });

  // build table
  let html = "<table border='1' cellspacing='0' cellpadding='5' style='margin:auto; border-collapse:collapse; font-family:courier;'>";

  // top blue band row
  html += "<tr>";
  bandOrder.slice(0,5).forEach(b => { html += `<th class='band-header'>${b.replace("m","")}</th>`; });
  bandOrder.slice(0,5).forEach(b => { html += `<th class='band-header'>${b.replace("m","")}</th>`; });
  html += "</tr>";

  function addRegionRow(r1, r2) {
    html += `<tr><th class='region-header' colspan='5'>${r1}</th><th class='region-header' colspan='5'>${r2}</th></tr>`;
    html += "<tr>";
    bandOrder.slice(0,5).forEach(b => {
      const val = getRegionCount(r1, b, counts);
      html += `<td class='${val >= threshold ? "value" : ""}'>${val || ""}</td>`;
    });
    bandOrder.slice(0,5).forEach(b => {
      const val = getRegionCount(r2, b, counts);
      html += `<td class='${val >= threshold ? "value" : ""}'>${val || ""}</td>`;
    });
    html += "</tr>";
  }

  addRegionRow("Europe","Caribbean");
  addRegionRow("South America","Japan");
  addRegionRow("Africa","VK");
  addRegionRow("YB","China");
  addRegionRow("UA9","Indian");
  addRegionRow("Middle East","Thailand");
  addRegionRow("North America","Unknown");

  html += "</table>";

  document.getElementById("spotsTableContainer").innerHTML = html;
}



window.addEventListener('DOMContentLoaded', async () => {


  const savedInterval = sessionStorage.getItem("reloadInterval");
  const spotsSaved = sessionStorage.getItem("spots") || getQueryParam("numSpots")
  const savedGreenThres = sessionStorage.getItem("greenThres");

  if (savedInterval) {
    select.value = savedInterval;
    setReloadInterval(parseInt(savedInterval, 10));
  }
  if (spotsSaved) document.getElementById("spots").value = spotsSaved;
  if(savedGreenThres) document.getElementById("threshold").value = savedGreenThres;


  //console.log(lookupContinent(40.7128, -74.0060))
  //console.log(lookupCqZone(40.7128, -74.0060))
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
    // Now load spots with new params
    loadSpots();
    console.log("fetched")
    //window.location.reload();
  });

  const select = document.getElementById("reloadInterval");
  select.addEventListener("change", () => {
    const interval = parseInt(select.value, 10);
    sessionStorage.setItem("reloadInterval", interval);
    setReloadInterval(interval);
  });
  const update = document.getElementById("updateButton")
  update.addEventListener("click", function() {
    const params = new URLSearchParams(window.location.search);

    const spots = document.getElementById("spots").value;
    sessionStorage.setItem("spots", document.getElementById("spots").value);
    if (spots) params.set("numSpots", spots); else params.delete("numSpots");

    const colorThres = document.getElementById("threshold").value;
    sessionStorage.setItem("greenThres", colorThres)

    loadSpots();
  })

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



