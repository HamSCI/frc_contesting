/**
 * HamSCI Contesting Dashboard - Table View (table_ft.js)
 *
 * Provides a tabular view of band openings organized by geographic region.
 * Aggregates WSPR/FT8/FT4 spots from the last N minutes and displays counts
 * in a matrix format showing which bands are open to which regions.
 *
 * Features:
 * - Regional grouping based on CQ zones
 * - Displays only the 6 contest bands (160m, 80m, 40m, 20m, 15m, 10m)
 * - Highlights active bands with green background when threshold is met
 * - Mode filtering (WSPR/FT8/FT4)
 * - Auto-reload capability with configurable intervals
 *
 * Author: Owen Ruzanski (KD3ALD)
 * Organization: University of Scranton (W3USR), Frankford Radio Club
 * Project: HamSCI PSWS Dashboard Development
 */

// Auto-reload timer reference
let reloadTimer = null;

/**
 * Configure automatic spot reloading interval.
 *
 * @param {number} seconds - Reload interval in seconds (0 to disable)
 */
function setReloadInterval(seconds) {
  if (reloadTimer) clearInterval(reloadTimer);

  if (seconds > 0) {
    reloadTimer = setInterval(() => {
      loadSpots();
    }, seconds * 1000);
  }
}

// Station callsign for display purposes
const call = "KD3ALD"

/**
 * CQ Zone to Region mapping.
 *
 * Maps the 40 CQ zones to human-readable geographic regions
 * for display in the table view. Allows operators to quickly
 * identify which parts of the world are reachable on each band.
 *
 * Region Categories:
 * - Europe: Western/Central Europe
 * - Caribbean: Caribbean islands
 * - South America: All of South America
 * - Japan: Japanese islands
 * - Africa: African continent
 * - VK: Australia/New Zealand
 * - YB: Indonesia
 * - China: Mainland China
 * - UA9: Asiatic Russia (Siberia)
 * - Indian: Indian subcontinent
 * - Middle East: Middle Eastern countries
 * - Thailand: Southeast Asia (Thailand region)
 * - North America: USA, Canada, Alaska, Mexico
 * - Oceania: Pacific islands
 */
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
  
  /**
   * Map CQ zone number to geographic region name.
   *
   * @param {number|string} cqZone - CQ zone number (1-40)
   * @returns {string} Region name or "Unknown" if invalid zone
   *
   * @example
   * getRegionFromCQ(5)  // "North America" (CQ zone 5 is eastern USA)
   * getRegionFromCQ(14) // "Europe" (CQ zone 14 is Western Europe)
   */
  function getRegionFromCQ(cqZone) {
    // Convert to number safely
    const num = Number(cqZone);

    // Validate zone number (1-40)
    if (!num || num < 1 || num > 40) {
      return "Unknown";
    }

    // Search for zone in region mapping
    for (const [region, zones] of Object.entries(regionZones)) {
      if (zones.includes(num)) return region;
    }

    // Zone not in any defined region
    return "Unknown";
  }


  /**
   * Parse spot timestamp from database format to JavaScript Date.
   *
   * Database stores dates as "YYMMDD HHMM" strings in UTC.
   * Example: "260107 1430" = January 7, 2026 at 14:30 UTC
   *
   * @param {string} t - Timestamp string in "YYMMDD HHMM" format
   * @returns {Date} JavaScript Date object in UTC
   *
   * @example
   * parseTableTime("260107 1430") // Date object: 2026-01-07 14:30:00 UTC
   */
  function parseTableTime(t) {
    const yy = Number(t.slice(0, 2)) + 2000;  // YY → YYYY
    const mm = Number(t.slice(2, 4)) - 1;     // Month (0-11 for JS Date)
    const dd = Number(t.slice(4, 6));         // Day
    const HH = Number(t.slice(7, 9));         // Hour
    const MM = Number(t.slice(9, 11));        // Minute
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
      // MODE FILTER
      const allowWSPR = document.getElementById("modeWSPR").checked;
      const allowFT8  = document.getElementById("modeFT8").checked;
      const allowFT4  = document.getElementById("modeFT4").checked;

      // Normalize mode from backend (wspr / ft8 / ft4)
      const mode = (s.mode || "").toLowerCase();

      // If none selected → treat as "all modes"
      if (!allowWSPR && !allowFT8 && !allowFT4) {
          // allow everything
      } else {
          if (mode === "wspr" && !allowWSPR) return;
          if (mode === "ft8"  && !allowFT8)  return;
          if (mode === "ft4"  && !allowFT4)  return;
      }

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
  