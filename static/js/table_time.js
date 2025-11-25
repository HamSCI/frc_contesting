

let reloadTimer = null;

function setReloadInterval(seconds) {
  if (reloadTimer) clearInterval(reloadTimer);

  if (seconds > 0) {
    reloadTimer = setInterval(() => {
      loadSpots();
    }, seconds * 1000);
  }
}


const call = "UACNJ"
// CQ zone → Region mapping

const regionZones = {
    "Europe":       [14, 15, 16, 20],
    "Caribbean":    [8],
    "South America":[9, 10, 11, 12, 13],
    "Japan":        [25],
    "Africa":       [33, 34, 35, 36, 37, 38, 39],
    "VK":           [29, 30],
    "YB":           [27, 28],
    "China":        [23, 24],
    "UA9":          [17, 18, 19],
    "Indian":       [22],
    "Middle East":  [21],
    "Thailand":     [26],
    "North America":[1, 2, 3, 4, 5, 6, 7, 40],
    "Oceania":      [31, 32]
  };
  
  // Determine region based on cq_zone integer
  function getRegionFromCQ(cqZone) {
    // convert to number safely
    const num = Number(cqZone);
  
    // if empty, null, NaN, undefined, or 0 ⇒ Unknown
    if (!num || num < 1 || num > 40) {
      return "Unknown";
    }
  
    // check defined regions
    for (const [region, zones] of Object.entries(regionZones)) {
      if (zones.includes(num)) return region;
    }
  
    // just in case
    return "Unknown";
  }
  
  
  // Parse "YYMMDD HHMM" → JS Date
  function parseTableTime(t) {
    const yy = Number(t.slice(0, 2)) + 2000;
    const mm = Number(t.slice(2, 4)) - 1;
    const dd = Number(t.slice(4, 6));
    const HH = Number(t.slice(7, 9));
    const MM = Number(t.slice(9, 11));
    return new Date(Date.UTC(yy, mm, dd, HH, MM));
  }
  
  async function loadSpots() {
    const mins = Number(document.getElementById("lastInterval").value) || 15;
    const threshold = Number(document.getElementById("threshold").value) || 1;
  
    const res = await fetch(`/tbspots?lastInterval=${mins}`);
    const spots = await res.json();
  
    const now = Date.now();
    const cutoff = now - mins * 60 * 1000;
  
    // Filter time
    const recent = spots.filter(s => parseTableTime(s.time).getTime() >= cutoff);
  
    // region → band → count
    const counts = {};
    const bands = ["160m","80m","40m","20m","15m","10m"];
    const total = 0;
  
    recent.forEach(s => {
      const region = getRegionFromCQ(s.cq_zone);
      if (!region) return;
  
      const band = s.band;  // ✔ using backend band directly
      if (!bands.includes(band)) return;
  
      if (!counts[region]) counts[region] = {};
      if (!counts[region][band]) counts[region][band] = 0;
      counts[region][band]++;
    });
  
    buildTable(counts, bands, threshold);
  }
  
  function buildTable(counts, bands, threshold) {
    let total = 0;
    for (const region of Object.keys(counts)) {
        for (const band of bands) {
            total += counts[region]?.[band] || 0;
        }
    }

// update display
    document.getElementById("totalDisplay").textContent =
        `Total Spots Displayed: ${total}`;
    let html = "<table><tr>";
  
    // header row twice
    bands.forEach(b => html += `<th class='band-header'>${b.replace("m","")}</th>`);
    bands.forEach(b => html += `<th class='band-header'>${b.replace("m","")}</th>`);
    html += "</tr>";
  
    const regionPairs = [
      ["Europe","Caribbean"],
      ["South America","Japan"],
      ["Africa","VK"],
      ["YB","China"],
      ["UA9","Indian"],
      ["Middle East","Thailand"],
      ["North America","Oceania"],
      ["Unknown","Not in Use"]
    ];
  
    for (const [r1, r2] of regionPairs) {
      html += `<tr><th class='region-header' colspan='${bands.length}'>${r1}</th><th class='region-header' colspan='${bands.length}'>${r2}</th></tr>`;
  
      html += "<tr>";
      bands.forEach(b => {
        const v = counts[r1]?.[b] || 0;
        html += `<td class='${v >= threshold ? "value" : ""}'>${v || ""}</td>`;
      });
      bands.forEach(b => {
        const v = counts[r2]?.[b] || 0;
        html += `<td class='${v >= threshold ? "value" : ""}'>${v || ""}</td>`;
      });
      html += "</tr>";
    }
  
    html += "</table>";
    document.getElementById("title").textContent = `WSPR Table for ${call} PSWS Reciever`
    document.getElementById("spotsTableContainer").innerHTML = html;
  }
  
  document.getElementById("updateButton").addEventListener("click", loadSpots);
  window.addEventListener("DOMContentLoaded", function(){
    loadSpots()
    const reloadSelect = document.getElementById("reloadInterval");

    // restore any saved setting
    const savedInterval = sessionStorage.getItem("tableReloadInterval");
    if (savedInterval) {
    reloadSelect.value = savedInterval;
    setReloadInterval(Number(savedInterval));
    }

    reloadSelect.addEventListener("change", () => {
    const seconds = Number(reloadSelect.value);
    sessionStorage.setItem("tableReloadInterval", seconds);
    setReloadInterval(seconds);
    });
  });
  