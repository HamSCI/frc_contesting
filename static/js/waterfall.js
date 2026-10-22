/**
 * HamSCI PSWS Contesting Dashboard - contest band waterfalls (waterfall.js)
 *
 * Polls /api/waterfall for new spectrum rows (one per band per second) and
 * draws one scrolling waterfall per contest band, newest row at the top.
 * Rows arrive as base64 uint8 values spanning [db_min, db_max]; contrast and
 * palette are applied here, so they can change without refetching.
 *
 * The rows come from radiod spectrum channels that the frc-dashboard sigmond
 * service opens only while someone is watching.  This page stops polling
 * when its tab is hidden, which lets the service release them.
 */

const WF = {
  HISTORY: 300,              // rows kept per band (10 min at 1 row / 2 s)
  POLL_MS: 2000,             // replaced by the server's poll_sec
  RETRY_MS: 5000,
  // Dial frequencies (MHz) marked on each band's axis for orientation.
  MARKERS: {
    "160m": { FT8: 1.840, WSPR: 1.8366 },
    "80m":  { FT8: 3.573, FT4: 3.575, WSPR: 3.5686 },
    "40m":  { FT8: 7.074, FT4: 7.0475, WSPR: 7.0386 },
    "20m":  { FT8: 14.074, FT4: 14.080, WSPR: 14.0956 },
    "15m":  { FT8: 21.074, FT4: 21.140, WSPR: 21.0946 },
    "10m":  { FT8: 28.074, FT4: 28.180, WSPR: 28.1246 },
  },
  PALETTES: {
    spectrum: [[0, "#000014"], [0.15, "#00007a"], [0.35, "#0050ff"], [0.55, "#00e0ff"],
               [0.7, "#40ff60"], [0.85, "#ffe000"], [1, "#ff2a00"]],
    heat:     [[0, "#000000"], [0.3, "#5b0f8a"], [0.55, "#d6224c"], [0.75, "#ff8c00"],
               [0.9, "#ffe066"], [1, "#ffffff"]],
    gray:     [[0, "#000000"], [1, "#ffffff"]],
  },
};

const state = {
  seq: 0,
  dbMin: -150,
  dbMax: -60,
  bands: {},          // name -> band view (see buildBand)
  order: [],
  paused: false,
  active: true,       // false while our dashboard tab is hidden
  timer: null,
  lastRowEpoch: null,
  prefs: { auto: true, floor: -130, range: 35, palette: "spectrum", layout: "grid" },
};

// ── helpers ────────────────────────────────────────────────────────────────

function loadPrefs() {
  try {
    const saved = JSON.parse(sessionStorage.getItem("wfPrefs") || "{}");
    Object.assign(state.prefs, saved);
  } catch (e) { /* storage unavailable: keep defaults */ }
}

function savePrefs() {
  try { sessionStorage.setItem("wfPrefs", JSON.stringify(state.prefs)); } catch (e) { /* ignore */ }
}

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** 256-entry RGB lookup table for a palette's colour stops. */
function buildPalette(name) {
  const stops = (WF.PALETTES[name] || WF.PALETTES.spectrum).map(([p, c]) => [p, hexToRgb(c)]);
  const lut = new Uint8Array(256 * 3);
  for (let i = 0; i < 256; i++) {
    const t = i / 255;
    let k = 0;
    while (k < stops.length - 2 && t > stops[k + 1][0]) k++;
    const [p0, c0] = stops[k], [p1, c1] = stops[k + 1];
    const f = p1 > p0 ? Math.min(1, Math.max(0, (t - p0) / (p1 - p0))) : 0;
    for (let ch = 0; ch < 3; ch++) lut[i * 3 + ch] = Math.round(c0[ch] + (c1[ch] - c0[ch]) * f);
  }
  return lut;
}

let paletteLut = null;

const byteToDb = b => state.dbMin + b * (state.dbMax - state.dbMin) / 255;

function bandFloor(band) {
  return state.prefs.auto ? band.autoFloor : state.prefs.floor;
}

/** byte -> palette index LUT for one band's current floor/range. */
function levelLut(band) {
  const floor = bandFloor(band), range = Math.max(1, state.prefs.range);
  const lut = new Uint8Array(256);
  for (let b = 0; b < 256; b++) {
    const x = (byteToDb(b) - floor) / range;
    lut[b] = Math.max(0, Math.min(255, Math.round(x * 255)));
  }
  return lut;
}

function percentileByte(row, p) {
  const counts = new Uint32Array(256);
  for (let i = 0; i < row.length; i++) counts[row[i]]++;
  const target = row.length * p;
  let acc = 0;
  for (let b = 0; b < 256; b++) { acc += counts[b]; if (acc >= target) return b; }
  return 255;
}

function decodeRow(b64) {
  const bin = atob(b64);
  const row = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) row[i] = bin.charCodeAt(i);
  return row;
}

function bandColor(name) {
  const c = CONFIG.bandColorMap?.[name];
  const hex = c && CONFIG.colorHexMap?.[c];
  return hex ? `#${hex}` : "#888";
}

// ── band cards ─────────────────────────────────────────────────────────────

function niceStep(spanHz) {
  const steps = [5e3, 10e3, 20e3, 25e3, 50e3, 100e3, 200e3, 250e3, 500e3];
  return steps.find(s => spanHz / s <= 8) || 1e6;
}

function buildAxis(band) {
  const { lo_hz: lo, hi_hz: hi } = band.meta;
  const span = hi - lo, step = niceStep(span);
  const pct = f => ((f - lo) / span * 100).toFixed(3) + "%";
  // Both band edges are always labelled (inside the card); interior ticks
  // fall on round multiples of `step` and are dropped near the edges.
  let html = `<span class="wf-tick wf-tick-first" style="left:0%">${(lo / 1e6).toFixed(3)}</span>` +
             `<span class="wf-tick wf-tick-last" style="left:100%">${(hi / 1e6).toFixed(3)}</span>`;
  for (let f = Math.ceil(lo / step) * step; f < hi; f += step) {
    const p = (f - lo) / span;
    if (p < 0.15 || p > 0.85) continue;
    html += `<span class="wf-tick" style="left:${pct(f)}">${(f / 1e6).toFixed(3)}</span>`;
  }
  band.axis.innerHTML = html;

  // FT8/FT4/WSPR sit a few kHz apart: stack labels that would overlap.
  const marks = Object.entries(WF.MARKERS[band.name] || {})
    .map(([label, mhz]) => ({ label, mhz, p: (mhz * 1e6 - lo) / span * 100 }))
    .filter(m => m.p >= 0 && m.p <= 100)
    .sort((a, b) => a.p - b.p);
  const MIN_GAP = 7;                       // percent of width per label
  const lastInRow = [-Infinity, -Infinity, -Infinity];
  band.markers.innerHTML = marks.map(m => {
    let row = lastInRow.findIndex(last => m.p - last >= MIN_GAP);
    if (row < 0) row = lastInRow.length - 1;
    lastInRow[row] = m.p;
    return `<span class="wf-marker" style="left:${m.p.toFixed(3)}%;bottom:${row * 11}px" ` +
           `title="${m.label} ${m.mhz.toFixed(4)} MHz">${m.label}</span>`;
  }).join("");
}

function buildBand(meta) {
  const card = document.createElement("section");
  card.className = "wf-card";
  card.innerHTML = `
    <header class="wf-card-head">
      <span class="wf-swatch" style="background:${bandColor(meta.name)}"></span>
      <span class="wf-band">${meta.name}</span>
      <span class="wf-range">${(meta.lo_hz / 1e6).toFixed(3)}–${(meta.hi_hz / 1e6).toFixed(3)} MHz</span>
      <span class="wf-stats" data-role="stats">—</span>
    </header>
    <div class="wf-markers" data-role="markers"></div>
    <div class="wf-canvas-wrap">
      <canvas class="wf-canvas" width="${meta.bins}" height="${WF.HISTORY}"></canvas>
      <div class="wf-tip" data-role="tip" hidden></div>
    </div>
    <div class="wf-axis" data-role="axis"></div>`;
  const canvas = card.querySelector("canvas");
  const band = {
    name: meta.name,
    meta,
    card,
    canvas,
    ctx: canvas.getContext("2d"),
    rowImg: null,
    rows: [],               // [{seq, t, data: Uint8Array}], newest last
    autoFloor: state.prefs.floor,
    axis: card.querySelector('[data-role="axis"]'),
    markers: card.querySelector('[data-role="markers"]'),
    stats: card.querySelector('[data-role="stats"]'),
    tip: card.querySelector('[data-role="tip"]'),
  };
  band.ctx.fillStyle = "#000";
  band.ctx.fillRect(0, 0, canvas.width, canvas.height);
  band.rowImg = band.ctx.createImageData(canvas.width, 1);
  buildAxis(band);
  attachHover(band);
  return band;
}

function attachHover(band) {
  const { canvas, tip } = band;
  canvas.addEventListener("mousemove", ev => {
    const r = canvas.getBoundingClientRect();
    const x = (ev.clientX - r.left) / r.width, y = (ev.clientY - r.top) / r.height;
    const bin = Math.min(band.meta.bins - 1, Math.max(0, Math.floor(x * band.meta.bins)));
    const rowIdx = band.rows.length - 1 - Math.floor(y * WF.HISTORY);
    const freq = band.meta.lo_hz + (bin + 0.5) * band.meta.rbw_hz;
    let text = `${(freq / 1e6).toFixed(4)} MHz`;
    if (rowIdx >= 0 && rowIdx < band.rows.length) {
      const row = band.rows[rowIdx];
      const ago = Math.max(0, Math.round(Date.now() / 1000 - row.t));
      text += ` · ${byteToDb(row.data[bin]).toFixed(1)} dB · ${ago}s ago`;
    }
    tip.textContent = text;
    tip.hidden = false;
    tip.style.left = `${Math.min(r.width - 170, Math.max(0, ev.clientX - r.left + 12))}px`;
    tip.style.top = `${Math.max(0, ev.clientY - r.top - 28)}px`;
  });
  canvas.addEventListener("mouseleave", () => { band.tip.hidden = true; });
}

function ensureBands(payload) {
  const names = Object.keys(payload.bands || {});
  const order = (CONFIG.contestBands || []).filter(n => names.includes(n))
    .concat(names.filter(n => !(CONFIG.contestBands || []).includes(n)));
  if (order.join() === state.order.join()) return;
  const grid = document.getElementById("wf-grid");
  grid.innerHTML = "";
  state.bands = {};
  state.order = order;
  for (const name of order) {
    const band = buildBand(payload.bands[name]);
    state.bands[name] = band;
    grid.appendChild(band.card);
  }
}

// ── drawing ────────────────────────────────────────────────────────────────

function drawRowAtTop(band, data, lut) {
  const { ctx, canvas, rowImg } = band;
  const w = canvas.width, h = canvas.height;
  ctx.drawImage(canvas, 0, 0, w, h - 1, 0, 1, w, h - 1);   // scroll down one row
  const px = rowImg.data;
  for (let i = 0; i < w && i < data.length; i++) {
    const c = lut[data[i]] * 3;
    px[i * 4] = paletteLut[c];
    px[i * 4 + 1] = paletteLut[c + 1];
    px[i * 4 + 2] = paletteLut[c + 2];
    px[i * 4 + 3] = 255;
  }
  ctx.putImageData(rowImg, 0, 0);
}

/** Full redraw after a contrast or palette change. */
function redraw(band) {
  const { ctx, canvas } = band;
  const w = canvas.width, h = canvas.height;
  const img = ctx.createImageData(w, h);
  const lut = levelLut(band);
  const px = img.data;
  for (let y = 0; y < h; y++) {
    const row = band.rows[band.rows.length - 1 - y];
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      if (!row) { px[o + 3] = 255; continue; }
      const c = lut[row.data[x]] * 3;
      px[o] = paletteLut[c]; px[o + 1] = paletteLut[c + 1]; px[o + 2] = paletteLut[c + 2]; px[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
}

function redrawAll() {
  paletteLut = buildPalette(state.prefs.palette);
  Object.values(state.bands).forEach(redraw);
}

function addRows(band, rows) {
  if (!rows.length) return;
  for (const [seq, t, b64] of rows) {
    const data = decodeRow(b64);
    // Auto contrast: track the noise floor (20th percentile) smoothly.
    const floorDb = byteToDb(percentileByte(data, 0.2)) - 3;
    band.autoFloor = band.rows.length ? band.autoFloor * 0.9 + floorDb * 0.1 : floorDb;
    band.rows.push({ seq, t, data });
    if (band.rows.length > WF.HISTORY) band.rows.shift();
    drawRowAtTop(band, data, levelLut(band));
  }
  const last = band.rows[band.rows.length - 1].data;
  const noise = byteToDb(percentileByte(last, 0.5));
  const peak = byteToDb(percentileByte(last, 0.999));
  band.stats.textContent = `noise ${noise.toFixed(0)} dB · peak ${peak.toFixed(0)} dB`;
}

// ── status / polling ───────────────────────────────────────────────────────

function setStatus(kind, label) {
  const dot = document.getElementById("wf-status-dot");
  dot.className = `status-dot status-${kind}`;
  document.getElementById("wf-status-label").textContent = label;
}

function showMessage(text) {
  const el = document.getElementById("wf-message");
  el.hidden = !text;
  el.textContent = text || "";
}

function schedule(ms) {
  clearTimeout(state.timer);
  state.timer = setTimeout(poll, ms);
}

async function poll() {
  if (state.paused || !state.active || document.hidden) {
    setStatus("checking", state.paused ? "Paused" : "Idle (tab hidden)");
    return;   // resumed by the pause button / visibility change
  }
  try {
    const res = await fetch(`/api/waterfall?since=${state.seq}`, { cache: "no-store" });
    const payload = await res.json();
    if (payload.poll_sec) WF.POLL_MS = Math.max(500, payload.poll_sec * 1000);
    if (res.ok && payload.starting) {
      setStatus("checking", "Starting radiod spectrum channels…");
      showMessage("");
      schedule(1500);
      return;
    }
    if (!res.ok || !payload.running) {
      setStatus("disconnected", "Unavailable");
      showMessage(payload.error || `Waterfall service returned HTTP ${res.status}`);
      schedule(WF.RETRY_MS);
      return;
    }
    showMessage("");
    if (payload.seq < state.seq) {        // service restarted: start over
      state.seq = 0; state.order = [];
    }
    state.dbMin = payload.db_min; state.dbMax = payload.db_max;
    ensureBands(payload);
    let newest = null;
    for (const name of state.order) {
      const rows = payload.bands[name].rows;
      addRows(state.bands[name], rows);
      if (rows.length) newest = Math.max(newest || 0, rows[rows.length - 1][1]);
    }
    state.seq = Math.max(state.seq, payload.seq);
    if (newest) state.lastRowEpoch = newest;
    if (state.lastRowEpoch) {
      const age = Math.round(Date.now() / 1000 - state.lastRowEpoch);
      document.getElementById("wf-updated").textContent =
        `Last row: ${new Date(state.lastRowEpoch * 1000).toISOString().slice(11, 19)} UTC`;
      setStatus(age < 10 ? "connected" : "dberror", age < 10 ? "Live" : `Stale (${age}s)`);
    } else {
      setStatus("checking", "Starting radiod spectrum channels…");
    }
    schedule(WF.POLL_MS);
  } catch (e) {
    setStatus("disconnected", "Disconnected");
    showMessage(`Cannot reach the dashboard server: ${e.message}`);
    schedule(WF.RETRY_MS);
  }
}

function resume() {
  if (!state.paused && state.active && !document.hidden) schedule(0);
}

// ── controls ───────────────────────────────────────────────────────────────

function initControls() {
  const auto = document.getElementById("wf-auto");
  const floor = document.getElementById("wf-floor");
  const range = document.getElementById("wf-range");
  const palette = document.getElementById("wf-palette");
  const layout = document.getElementById("wf-layout");
  const pause = document.getElementById("wf-pause");
  const grid = document.getElementById("wf-grid");

  auto.checked = state.prefs.auto;
  floor.value = state.prefs.floor;
  floor.disabled = state.prefs.auto;
  range.value = state.prefs.range;
  palette.value = state.prefs.palette;
  layout.value = state.prefs.layout;
  grid.classList.toggle("wf-stack", state.prefs.layout === "stack");

  auto.addEventListener("change", () => {
    state.prefs.auto = auto.checked;
    floor.disabled = auto.checked;
    if (!auto.checked) {
      // Start manual mode from the current average auto floor.
      const floors = Object.values(state.bands).map(b => b.autoFloor);
      if (floors.length) {
        state.prefs.floor = Math.round(floors.reduce((a, b) => a + b, 0) / floors.length);
        floor.value = state.prefs.floor;
      }
    }
    savePrefs(); redrawAll();
  });
  floor.addEventListener("change", () => {
    state.prefs.floor = Number(floor.value) || -130; savePrefs(); redrawAll();
  });
  range.addEventListener("change", () => {
    state.prefs.range = Math.min(90, Math.max(5, Number(range.value) || 35)); savePrefs(); redrawAll();
  });
  palette.addEventListener("change", () => { state.prefs.palette = palette.value; savePrefs(); redrawAll(); });
  layout.addEventListener("change", () => {
    state.prefs.layout = layout.value; savePrefs();
    grid.classList.toggle("wf-stack", layout.value === "stack");
  });
  pause.addEventListener("click", () => {
    state.paused = !state.paused;
    pause.textContent = state.paused ? "Resume" : "Pause";
    if (state.paused) { clearTimeout(state.timer); setStatus("checking", "Paused"); } else resume();
  });
}

// Parent dashboard (both.html) tells us when our tab is shown or hidden.
window.addEventListener("message", ev => {
  if (ev.origin !== window.location.origin || !ev.data || ev.data.type !== "frc-tab") return;
  state.active = ev.data.active === "waterfall-frame";
  if (state.active) resume(); else clearTimeout(state.timer);
});
document.addEventListener("visibilitychange", () => { if (!document.hidden) resume(); });

document.addEventListener("DOMContentLoaded", async () => {
  loadPrefs();
  paletteLut = buildPalette(state.prefs.palette);
  initControls();
  if (typeof CONFIG.loadStation === "function") {
    await CONFIG.loadStation();
    if (CONFIG.station.callsign && CONFIG.station.callsign !== "Unknown") {
      document.getElementById("title").textContent = `Contest Band Waterfalls — ${CONFIG.station.callsign}`;
    }
  }
  poll();
});
