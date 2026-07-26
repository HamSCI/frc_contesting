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
      fetchSpots();
    }, seconds * 1000);
  }
}

// Station callsign for display purposes — updated at startup by CONFIG.loadStation()
let call = CONFIG.station.callsign;

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
  
  // Raw /tbspots response for the current lastInterval window. The server
  // only ever filters by lastInterval — mode, threshold, and region grouping
  // are all client-side, so only lastInterval changes need a real refetch;
  // everything else just recomputes from this cache (see renderTable()).
  let cachedSpots = [];

  async function fetchSpots() {
    setStatus('checking', 'Checking…');
    const mins = Number(document.getElementById("lastInterval").value) || CONFIG.defaults.lastInterval;
    sessionStorage.setItem("lastInterval", mins);
    localStorage.setItem("lastInterval", mins);

    try {
      const res = await fetch(`/tbspots?lastInterval=${mins}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      cachedSpots = await res.json();
      renderTable();
      setStatus('connected', 'Connected');
      setLastUpdated();
    } catch (e) {
      console.error('Failed to load spots:', e);
      setStatus('disconnected', 'Error');
    }
  }

  function renderTable() {
    const mins = Number(document.getElementById("lastInterval").value) || CONFIG.defaults.lastInterval;
    const threshold = Number(document.getElementById("threshold").value) || CONFIG.defaults.threshold;

    const now = Date.now();
    const cutoff = now - mins * 60 * 1000;

    // Filter time
    const recent = cachedSpots.filter(s => parseTableTime(s.time).getTime() >= cutoff);

    // region → band → count
    const counts = {};
    const bands = CONFIG.contestBands;

    const allowWSPR = document.getElementById("modeWSPR").checked;
    const allowFT8  = document.getElementById("modeFT8").checked;
    const allowFT4  = document.getElementById("modeFT4").checked;

    recent.forEach(s => {
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

      const band = s.band;  // ✔ using backend band directly
      if (!bands.includes(band)) return;

      // A CQ zone can be claimed by more than one user-defined region
      // (e.g. a cloned/overlapping region) — count the spot into all of them.
      const regions = getRegionsFromCQ(s.cq_zone);
      regions.forEach(region => {
        if (!counts[region]) counts[region] = {};
        if (!counts[region][band]) counts[region][band] = 0;
        counts[region][band]++;
      });
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

    for (const [r1, r2] of CONFIG.regionPairs) {
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
  
  document.getElementById("updateButton").addEventListener("click", fetchSpots);

  // lastInterval changes the server-side time window, so it needs a real
  // refetch. Every other filter is a pure client-side re-render of the cache.
  document.getElementById("lastInterval").addEventListener("change", fetchSpots);
  ["threshold", "modeWSPR", "modeFT8", "modeFT4"].forEach(id => {
    document.getElementById(id).addEventListener("change", renderTable);
  });

  // ── Region settings modal ────────────────────────────────────────────────
  // Lets the operator regroup which CQ zones map to which named region
  // (e.g. Europe, Caribbean, ...) shown as table rows. Saved to localStorage
  // and applied on top of CONFIG.regionZones/regionPairs (see config.js).

  function addRegionRow(name = "", zones = "") {
    const container = document.getElementById("regionRows");
    const row = document.createElement("div");
    row.className = "region-row";
    row.innerHTML = `
      <input type="text" class="region-name-input" placeholder="Region name" value="${name}">
      <input type="text" class="region-zones-input" placeholder="CQ zones, e.g. 14, 15, 16" value="${zones}">
      <button type="button" class="region-remove-btn" aria-label="Remove region">&times;</button>
    `;
    row.querySelector(".region-remove-btn").addEventListener("click", () => row.remove());
    container.appendChild(row);
  }

  function renderRegionRows(regionZones) {
    const container = document.getElementById("regionRows");
    container.innerHTML = "";
    Object.entries(regionZones).forEach(([name, zones]) => addRegionRow(name, zones.join(", ")));
  }

  function openRegionModal() {
    renderRegionRows(CONFIG.regionZones);
    document.getElementById("regionModalOverlay").classList.add("open");
  }

  function closeRegionModal() {
    document.getElementById("regionModalOverlay").classList.remove("open");
  }

  function saveRegionConfig() {
    const rows = document.querySelectorAll("#regionRows .region-row");
    const regionZones = {};
    const regionNames = [];

    rows.forEach(row => {
      const name = row.querySelector(".region-name-input").value.trim();
      const zones = row.querySelector(".region-zones-input").value
        .split(",")
        .map(z => parseInt(z.trim(), 10))
        .filter(z => Number.isInteger(z) && z >= 1 && z <= 40);

      if (!name || !zones.length) return;
      regionZones[name] = zones;
      regionNames.push(name);
    });

    if (!regionNames.length) {
      alert("Add at least one region with a name and valid CQ zones (1-40) before saving.");
      return;
    }

    // Pair regions two at a time for the table's side-by-side layout, always
    // ending with the fixed Unknown/Not in Use row for unmapped zones.
    const regionPairs = [];
    for (let i = 0; i < regionNames.length; i += 2) {
      regionPairs.push([regionNames[i], regionNames[i + 1] || "—"]);
    }
    regionPairs.push(["Unknown", "Not in Use"]);

    CONFIG.regionZones = regionZones;
    CONFIG.regionPairs = regionPairs;
    localStorage.setItem("regionConfig", JSON.stringify({ regionZones, regionPairs }));

    closeRegionModal();
    // Region grouping is purely a client-side reshuffle of already-fetched
    // spots — no need to hit the server again.
    renderTable();
  }

  function resetRegionConfig() {
    CONFIG.regionZones = JSON.parse(JSON.stringify(CONFIG.defaultRegionZones));
    CONFIG.regionPairs = JSON.parse(JSON.stringify(CONFIG.defaultRegionPairs));
    localStorage.removeItem("regionConfig");
    renderRegionRows(CONFIG.regionZones);
    renderTable();
  }

  document.getElementById("regionSettingsButton").addEventListener("click", openRegionModal);
  document.getElementById("regionModalClose").addEventListener("click", closeRegionModal);
  document.getElementById("cancelRegionsButton").addEventListener("click", closeRegionModal);
  document.getElementById("saveRegionsButton").addEventListener("click", saveRegionConfig);
  document.getElementById("resetRegionsButton").addEventListener("click", resetRegionConfig);
  document.getElementById("addRegionRow").addEventListener("click", () => addRegionRow());
  document.getElementById("regionModalOverlay").addEventListener("click", (e) => {
    if (e.target.id === "regionModalOverlay") closeRegionModal();
  });

  // Sync lastInterval from map iframe via localStorage storage event
  window.addEventListener("storage", (e) => {
    if (e.key === "lastInterval" && e.newValue) {
      document.getElementById("lastInterval").value = e.newValue;
      fetchSpots();
    }
  });
  window.addEventListener("DOMContentLoaded", async function(){
    // Fetch receiver config via CONFIG.loadStation() (populates CONFIG.station)
    await CONFIG.loadStation();
    call = CONFIG.station.callsign;

    // Restore last interval from sessionStorage (shared with map view)
    const savedMins = sessionStorage.getItem("lastInterval");
    if (savedMins) document.getElementById("lastInterval").value = savedMins;

    fetchSpots()
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
  