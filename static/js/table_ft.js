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

// Auto-reload timer reference (standalone table page only)
let tableReloadTimer = null;

/**
 * Configure automatic spot reloading interval for standalone table page.
 *
 * @param {number} seconds - Reload interval in seconds (0 to disable)
 */
function setTableReloadInterval(seconds) {
  if (tableReloadTimer) clearInterval(tableReloadTimer);

  if (seconds > 0) {
    tableReloadTimer = setInterval(() => {
      tableLoadSpots();
    }, seconds * 1000);
  }
}

// Station callsign for display purposes — updated at startup by CONFIG.loadStation()
let call = CONFIG.station.callsign;

// Connection status helpers
function setTableStatus(state, label) {
  const dot = document.getElementById('table-conn-status-dot');
  const lbl = document.getElementById('table-conn-status-label');
  if (dot) dot.className = `status-dot status-${state}`;
  if (lbl) lbl.textContent = label;
}

function setTableLastUpdated() {
  const el = document.getElementById('table-last-updated');
  if (el) {
    const now = new Date();
    el.textContent = `Last updated: ${now.toISOString().slice(11, 19)} UTC`;
  }
}

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
  
  async function tableLoadSpots() {
    setTableStatus('checking', 'Checking…');
    const mins = Number(document.getElementById("lastInterval").value) || CONFIG.defaults.lastInterval;
    sessionStorage.setItem("lastInterval", mins);
    localStorage.setItem("lastInterval", mins);
    const threshold = Number(document.getElementById("threshold").value) || CONFIG.defaults.threshold;
    const bands = CONFIG.contestBands;

    // Always render the table structure immediately so it shows while loading
    if (!document.getElementById("spotsTableContainer").innerHTML) {
      buildTable({}, bands, threshold);
    }

    try {
      const res = await fetch(`/tbspots?lastInterval=${mins}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const spots = await res.json();

      const now = Date.now();
      const cutoff = now - mins * 60 * 1000;

      // Filter time
      const recent = spots.filter(s => parseTableTime(s.time).getTime() >= cutoff);

      // region → band → count
      const counts = {};

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
      setTableStatus('connected', 'Connected');
      setTableLastUpdated();
    } catch (e) {
      console.error('Failed to load spots:', e);
      buildTable({}, bands, threshold);
      setTableStatus('disconnected', 'Error');
    }
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
    document.getElementById("table-title").textContent = `WSPR Table for ${call} PSWS Reciever`
    document.getElementById("spotsTableContainer").innerHTML = html;
  }
  
  if (!window.UNIFIED_PAGE) {
    document.getElementById("updateButton").addEventListener("click", tableLoadSpots);

    // Sync lastInterval from map iframe via localStorage storage event (standalone only)
    window.addEventListener("storage", (e) => {
      if (e.key === "lastInterval" && e.newValue) {
        document.getElementById("lastInterval").value = e.newValue;
        tableLoadSpots();
      }
    });
  }
  window.addEventListener("DOMContentLoaded", async function(){
    await CONFIG.loadStation();
    call = CONFIG.station.callsign;

    const savedMins = sessionStorage.getItem("lastInterval");
    if (savedMins) document.getElementById("lastInterval").value = savedMins;

    tableLoadSpots();

    if (!window.UNIFIED_PAGE) {
      const reloadSelect = document.getElementById("reloadInterval");
      const savedInterval = sessionStorage.getItem("tableReloadInterval");
      if (savedInterval) {
        reloadSelect.value = savedInterval;
        setTableReloadInterval(Number(savedInterval));
      }
      reloadSelect.addEventListener("change", () => {
        const seconds = Number(reloadSelect.value);
        sessionStorage.setItem("tableReloadInterval", seconds);
        setTableReloadInterval(seconds);
      });
    }
  });
  