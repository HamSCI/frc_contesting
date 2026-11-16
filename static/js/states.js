/**
 * HamSCI Contesting Dashboard - States / Provinces view (states.js), #69
 *
 * For ARRL Sweepstakes (a US/Canada contest whose multipliers are the
 * ARRL/RAC sections): which US states and Canadian provinces each band
 * reaches right now, and - the operator's real question - which ones are
 * missing, and which bands give the best chance of finding them.
 *
 * Spots come from the same /spots endpoint as the Map; each TX location is
 * placed in a state/province client-side with the vendored Natural Earth
 * boundaries (states-50m.json), bbox-prefiltered and cached (see #68).
 * Rows are grouped by call area.  DC is counted with Maryland, as in the
 * ARRL Maryland-DC section.  Full section attribution (split states, RAC
 * sections) needs county-level boundaries and is not done yet.
 */

// Call areas, in the order operators think of them.
const CALL_AREAS = [
  ["W1", ["CT", "ME", "MA", "NH", "RI", "VT"]],
  ["W2", ["NJ", "NY"]],
  ["W3", ["DE", "MD", "PA"]],
  ["W4", ["AL", "FL", "GA", "KY", "NC", "SC", "TN", "VA"]],
  ["W5", ["AR", "LA", "MS", "NM", "OK", "TX"]],
  ["W6", ["CA"]],
  ["W7", ["AZ", "ID", "MT", "NV", "OR", "UT", "WA", "WY"]],
  ["W8", ["MI", "OH", "WV"]],
  ["W9", ["IL", "IN", "WI"]],
  ["W0", ["CO", "IA", "KS", "MN", "MO", "NE", "ND", "SD"]],
  ["KL7 · KH6", ["AK", "HI"]],
  ["VE1 · VE9 · VY2 · VO", ["NS", "NB", "PE", "NL"]],
  ["VE2", ["QC"]],
  ["VE3", ["ON"]],
  ["VE4", ["MB"]],
  ["VE5", ["SK"]],
  ["VE6", ["AB"]],
  ["VE7", ["BC"]],
  ["VE8 · VY0 · VY1", ["NT", "NU", "YT"]],
];
const STATE_NAMES = {};          // postal -> name, from the boundary file
let stateFeat = [];
const stateCache = new Map();

const ST_DEFAULTS = { last: CONFIG.defaults.lastInterval, sthr: CONFIG.defaults.threshold,
                      reload: CONFIG.defaults.reload, ssort: "area" };
let cachedSpots = [];
let reloadTimer = null;
let ready = false;                 // settings restored; ignore storage events before

async function loadStates() {
  const res = await fetch("vendor/basemap/states-50m.json");
  const data = await res.json();
  stateFeat = withBBoxes(data.features.filter(f => ["USA", "CAN"].includes(f.properties.adm0_a3)));
  for (const f of stateFeat) {
    const p = f.properties;
    STATE_NAMES[p.postal] = p.postal === "QC" ? "Québec" : p.name;
  }
  STATE_NAMES.MD = "Maryland + DC";
}

/** US state / Canadian province postal code at (lat, lon), or null. */
function lookupState(lat, lon) {
  const key = `${lat.toFixed(4)},${lon.toFixed(4)}`;
  if (stateCache.has(key)) return stateCache.get(key);
  let code = null;
  const pt = turf.point([lon, lat]);
  for (const f of stateFeat) {
    if (inBBox(lon, lat, f.bbox) && turf.booleanPointInPolygon(pt, f)) { code = f.properties.postal; break; }
  }
  if (code === "DC") code = "MD";       // ARRL Maryland-DC section
  stateCache.set(key, code);
  return code;
}

function setStatus(state, label) {
  const dot = document.getElementById("conn-status-dot");
  const lbl = document.getElementById("conn-status-label");
  if (dot) dot.className = `status-dot status-${state}`;
  if (lbl) lbl.textContent = label;
}

// Band columns: band= from a shared link first, then the Map's live
// selection (localStorage "bandSel"), else the six contest bands.
let bandSel = null;
function initBands() {
  let v = ViewState.param("band");
  if (v === null) { try { v = localStorage.getItem("bandSel"); } catch (e) { v = null; } }
  bandSel = bandSelFromParam(v);
}
function columns() {
  return bandSel && bandSel.size ? CONFIG.sortBands([...bandSel]) : CONFIG.contestBands;
}

function persist() {
  const st = {
    last: document.getElementById("lastInterval").value,
    sthr: document.getElementById("threshold").value,
    smodes: modesParam(document.getElementById("modePills")),
    reload: document.getElementById("reloadInterval").value,
    ssort: document.getElementById("stateSort").value,
    band: bandSel ? bandSelToParam(bandSel) : "",
  };
  try {
    for (const [k, v] of Object.entries(st)) sessionStorage.setItem(`states.${k}`, v);
    localStorage.setItem("lastInterval", st.last);
    localStorage.setItem("reload", st.reload);
  } catch (e) { /* storage unavailable */ }
  ViewState.publish("states", st, ST_DEFAULTS);
}

async function fetchSpots() {
  setStatus("checking", "Checking…");
  persist();
  const mins = Number(document.getElementById("lastInterval").value) || CONFIG.defaults.lastInterval;
  try {
    const res = await fetch(`/spots?lastInterval=${mins}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    cachedSpots = (await res.json()).filter(s =>
      Number.isFinite(s.tx_lat) && Number.isFinite(s.tx_lon) && !(s.tx_lat === 0 && s.tx_lon === 0));
    render();
    setStatus("connected", "Connected");
    document.getElementById("last-updated").textContent =
      `Last updated: ${new Date().toISOString().slice(11, 19)} UTC`;
  } catch (e) {
    console.error("Failed to load spots:", e);
    setStatus("disconnected", "Error");
  }
}

function render() {
  const pills = document.getElementById("modePills");
  renderModePills(pills, [...new Set(cachedSpots.map(s => (s.mode || "").toLowerCase()))], () => { persist(); render(); });
  const modes = selectedModes(pills);
  const bands = columns();
  const thr = Number(document.getElementById("threshold").value) || CONFIG.defaults.threshold;

  // state -> band -> count, over the selected bands and modes
  const counts = {};
  let outside = 0, used = 0;
  for (const s of cachedSpots) {
    if (modes && !modes.has((s.mode || "").toLowerCase())) continue;
    const band = frequencyToBand(s.frequency);
    if (!bands.includes(band)) continue;
    const st = lookupState(s.tx_lat, s.tx_lon);
    if (!st) { outside++; continue; }
    used++;
    (counts[st] ||= {})[band] = (counts[st][band] || 0) + 1;
  }
  const total = st => bands.reduce((a, b) => a + (counts[st]?.[b] || 0), 0);
  const best = obj => {
    const top = Object.entries(obj || {}).sort((a, b) => b[1] - a[1])[0];
    return top ? top[0] : null;
  };

  const all = CALL_AREAS.flatMap(([, sts]) => sts);
  const missing = all.filter(st => total(st) === 0);
  document.getElementById("statesSummary").innerHTML =
    `Heard <b>${all.length - missing.length}</b> of ${all.length} states/provinces ` +
    `(${used} spot${used === 1 ? "" : "s"} in the US/Canada, ${outside} elsewhere) · ` +
    (missing.length
      ? `<span class="states-missing-label">Missing:</span> ${missing.map(st =>
          `<span class="state-chip" title="${STATE_NAMES[st] || st}">${st}</span>`).join(" ")}`
      : `<b>Clean sweep!</b>`);

  const sortMissing = document.getElementById("stateSort").value === "missing";
  let html = `<table class="states-table"><thead><tr><th class="state-name-h">State / province</th>` +
    bands.map(b => `<th class="band-header" title="${CONFIG.bandTitle(b)}">${CONFIG.bandLabel(b, { html: true })}</th>`).join("") +
    `<th class="band-header">Total</th><th class="band-header" title="The band with the most spots from there">Best band</th></tr></thead><tbody>`;
  const colspan = bands.length + 3;
  for (const [area, sts] of CALL_AREAS) {
    // The busiest band toward this call area is the best bet for its missing states.
    const areaCounts = {};
    sts.forEach(st => Object.entries(counts[st] || {}).forEach(([b, n]) => { areaCounts[b] = (areaCounts[b] || 0) + n; }));
    const areaBest = best(areaCounts);
    const heard = sts.filter(st => total(st) > 0).length;
    let rows = sts.map(st => ({ st, n: total(st) }));
    if (sortMissing) rows.sort((a, b) => (a.n > 0) - (b.n > 0) || a.st.localeCompare(b.st));
    html += `<tr class="area-row"><th colspan="${colspan}">${area} <span class="area-meta">heard ${heard}/${sts.length}` +
      (areaBest ? ` · busiest: ${CONFIG.bandShort(areaBest)} (${areaCounts[areaBest]})` : " · nothing heard") + `</span></th></tr>`;
    for (const { st, n } of rows) {
      const b = best(counts[st]);
      html += `<tr class="${n ? "" : "state-missing"}"><td class="state-name"><b>${st}</b> ${STATE_NAMES[st] || ""}</td>` +
        bands.map(band => {
          const v = counts[st]?.[band] || 0;
          return `<td class="${v >= thr ? "value" : ""}">${v || ""}</td>`;
        }).join("") +
        `<td class="state-total">${n || "—"}</td>` +
        `<td class="state-best">${b ? CONFIG.bandShort(b) : (areaBest ? `<span class="hint">try ${CONFIG.bandShort(areaBest)}</span>` : "")}</td></tr>`;
    }
  }
  html += "</tbody></table>";
  document.getElementById("statesTable").innerHTML = html;
}

function setReloadInterval(seconds) {
  if (reloadTimer) clearInterval(reloadTimer);
  reloadTimer = seconds > 0 ? setInterval(fetchSpots, seconds * 1000) : null;
}

window.addEventListener("storage", e => {
  if (!ready) return;
  const reloadSel = document.getElementById("reloadInterval");
  if (e.key === "lastInterval" && e.newValue && e.newValue !== document.getElementById("lastInterval").value) {
    document.getElementById("lastInterval").value = e.newValue;
    fetchSpots();
  } else if (e.key === "reload" && e.newValue !== null && e.newValue !== reloadSel.value) {
    reloadSel.value = e.newValue;
    setReloadInterval(Number(reloadSel.value));
    persist();
  } else if (e.key === "bandSel") {
    bandSel = bandSelFromParam(e.newValue);
    persist();
    render();
  } else if (e.key === "bandLabels") {
    render();
  }
});

window.addEventListener("DOMContentLoaded", async () => {
  await CONFIG.loadStation();
  document.getElementById("title").textContent = `States & Provinces Heard at ${CONFIG.station.callsign}`;
  await loadStates();

  const get = (names, key, fallback) => ViewState.get(names, `states.${key}`, fallback);
  document.getElementById("lastInterval").value = ViewState.get(["last", "lastInterval"], "states.last", String(CONFIG.defaults.lastInterval), "lastInterval");
  document.getElementById("threshold").value = get(["sthr", "thr"], "sthr", String(CONFIG.defaults.threshold));
  document.getElementById("stateSort").value = get("ssort", "ssort", "area");
  const pills = document.getElementById("modePills");
  const modesSaved = get(["smodes", "modes"], "smodes", "");
  renderModePills(pills, modesSaved ? modesSaved.split(",") : [], () => { persist(); render(); });
  if (modesSaved) setSelectedModes(pills, modesSaved.split(","));
  initBands();
  const reloadSel = document.getElementById("reloadInterval");
  const reload = ViewState.get("reload", "states.reload", String(CONFIG.defaults.reload), "reload");
  if ([...reloadSel.options].some(o => o.value === reload)) reloadSel.value = reload;
  setReloadInterval(Number(reloadSel.value));
  ready = true;

  document.getElementById("updateButton").addEventListener("click", fetchSpots);
  document.getElementById("lastInterval").addEventListener("change", fetchSpots);
  ["threshold", "stateSort"].forEach(id => document.getElementById(id).addEventListener("change", () => { persist(); render(); }));
  reloadSel.addEventListener("change", () => { setReloadInterval(Number(reloadSel.value)); persist(); });

  fetchSpots();
});
