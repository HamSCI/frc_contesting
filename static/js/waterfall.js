/**
 * HamSCI PSWS Contesting Dashboard - contest band waterfalls (waterfall.js)
 *
 * Polls /api/waterfall for new spectrum rows (one per band every poll_sec,
 * 2 s by default) and draws one waterfall per contest band, newest at the
 * top and the highest band first.  Rows arrive as base64 uint8 values
 * spanning [db_min, db_max]; contrast and palette are applied here, so they
 * can change without refetching.
 *
 * Time is drawn truthfully (#63): each canvas row covers a fixed slice of the
 * selected span and is painted from the rows whose own timestamps fall in it
 * (the per-bin maximum when several do), so late polls, Pause and restarts
 * show up as gaps instead of compressing the history, and the UTC time axis
 * beside each band is exact.
 *
 * Each viewer can reorder, hide and zoom bands (#65 tier 1).  Zoom crops the
 * band's existing row, so it costs radiod nothing; the resolution stays that
 * of the full-band channel.
 *
 * The rows come from radiod spectrum channels that the frc-dashboard sigmond
 * service opens only while someone is watching.  This page stops polling
 * when its tab is hidden, which lets the service release them.
 */

const WF = {
  ROWS: 300,                 // canvas height in pixel rows (any span)
  MAX_SPAN: 3600,            // longest selectable span; rows older than this are dropped
  POLL_MS: 2000,             // replaced by the server's poll_sec
  RETRY_MS: 5000,
  SPANS: [300, 600, 1800, 3600],
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
  pollSec: 2,
  bands: {},          // name -> band view (see buildBand)
  names: [],          // bands the server sends, in its order
  paused: false,
  active: true,       // false while our dashboard tab is hidden
  timer: null,
  lastRowEpoch: null,
  prefs: {
    auto: true, floor: -130, range: 35, palette: "spectrum", layout: "grid",
    span: 600,          // seconds shown (#63)
    order: null,        // band names, top first (#65); null = highest frequency first
    hidden: [],         // band names not shown
    seg: "full",        // full | cw | ssb | rtty | custom (#65)
    zoom: {},           // custom: name -> [loMHz, hiMHz]
  },
};

// ── helpers ────────────────────────────────────────────────────────────────

// Waterfall settings <-> URL params (#62): a shared link wins over this
// session's saved prefs, which win over the defaults.
const WF_PARAMS = {           // pref -> [param, toParam, fromParam]
  auto:    ["auto", v => (v ? "1" : "0"), v => v !== "0"],
  floor:   ["floor", String, Number],
  range:   ["range", String, Number],
  palette: ["pal", String, String],
  layout:  ["layout", String, String],
  span:    ["span", v => String(v / 60), v => Number(v) * 60],
  seg:     ["seg", String, String],
  order:   ["wfb", v => (v ? v.filter(n => !state.prefs.hidden.includes(n)).join(",") : ""),
            v => v.split(",").filter(Boolean)],
  zoom:    ["zoom", v => Object.entries(v || {}).map(([n, [a, b]]) => `${n}:${a}-${b}`).join(","),
            v => Object.fromEntries(v.split(",").map(z => z.split(":")).filter(z => z.length === 2)
                   .map(([n, r]) => [n, r.split("-").map(Number)]))],
};
const WF_DEFAULTS = JSON.parse(JSON.stringify(state.prefs));

function loadPrefs() {
  try {
    const saved = JSON.parse(sessionStorage.getItem("wfPrefs") || "{}");
    Object.assign(state.prefs, saved);
  } catch (e) { /* storage unavailable: keep defaults */ }
  for (const [pref, [name, , from]] of Object.entries(WF_PARAMS)) {
    const v = ViewState.param(name);
    if (v !== null && v !== "") state.prefs[pref] = from(v);
  }
  // wfb lists the shown bands in order; every other contest band is hidden.
  if (ViewState.param("wfb")) state.prefs.hidden = CONFIG.contestBands.filter(n => !state.prefs.order.includes(n));
  if (!WF.SPANS.includes(state.prefs.span)) state.prefs.span = WF_DEFAULTS.span;
}

function savePrefs() {
  try { sessionStorage.setItem("wfPrefs", JSON.stringify(state.prefs)); } catch (e) { /* ignore */ }
  const st = {}, defs = {};
  for (const [pref, [name, to]] of Object.entries(WF_PARAMS)) {
    st[name] = to(state.prefs[pref]);
    defs[name] = to(WF_DEFAULTS[pref]);
  }
  if (state.prefs.seg !== "custom") st.zoom = "";
  // Every band shown in the default order: leave wfb out.
  if (state.names.length && st.wfb === defaultOrder().join(",")) st.wfb = "";
  ViewState.publish("waterfall", st, defs);
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

const utcHHMM = t => new Date(t * 1000).toISOString().slice(11, 16);
const utcHHMMSS = t => new Date(t * 1000).toISOString().slice(11, 19);

// ── band order, visibility and zoom (#65) ─────────────────────────────────

function defaultOrder() {
  return CONFIG.sortBands(state.names);
}

/** Shown band names, top first: the viewer's order, then any new bands. */
function shownOrder() {
  const known = state.prefs.order ? state.prefs.order.filter(n => state.names.includes(n)) : [];
  const rest = defaultOrder().filter(n => !known.includes(n));
  return [...known, ...rest].filter(n => !state.prefs.hidden.includes(n));
}

/** Displayed frequency range [loHz, hiHz] of a band for the current segment. */
function viewRange(band) {
  const lo0 = band.meta.lo_hz, hi0 = band.meta.lo_hz + band.meta.bins * band.meta.rbw_hz;
  let r = null;
  if (state.prefs.seg === "custom") r = state.prefs.zoom[band.name];
  else if (state.prefs.seg !== "full") r = CONFIG.band(band.name).segments?.[state.prefs.seg];
  if (!r) return [lo0, hi0];
  const lo = Math.max(lo0, r[0] * 1e6), hi = Math.min(hi0, r[1] * 1e6);
  return hi - lo >= band.meta.rbw_hz * 8 ? [lo, hi] : [lo0, hi0];
}

/** Update band.view {lo, hi, b0, b1}: the displayed range and its bin slice. */
function applyView(band) {
  const [lo, hi] = viewRange(band);
  const rbw = band.meta.rbw_hz;
  const b0 = Math.max(0, Math.floor((lo - band.meta.lo_hz) / rbw));
  const b1 = Math.min(band.meta.bins, Math.ceil((hi - band.meta.lo_hz) / rbw));
  band.view = { b0, b1, lo: band.meta.lo_hz + b0 * rbw, hi: band.meta.lo_hz + b1 * rbw };
  if (band.canvas.width !== b1 - b0) {
    band.canvas.width = b1 - b0;
    band.img = null;
  }
  band.rangeEl.textContent = `${(band.view.lo / 1e6).toFixed(3)}–${(band.view.hi / 1e6).toFixed(3)} MHz`;
  buildAxis(band);
}

// ── band cards ─────────────────────────────────────────────────────────────

function niceStep(spanHz) {
  const steps = [1e3, 2e3, 5e3, 10e3, 20e3, 25e3, 50e3, 100e3, 200e3, 250e3, 500e3];
  return steps.find(s => spanHz / s <= 8) || 1e6;
}

function buildAxis(band) {
  const { lo, hi } = band.view;
  const span = hi - lo, step = niceStep(span);
  const pct = f => ((f - lo) / span * 100).toFixed(3) + "%";
  // Both edges are always labelled (inside the card); interior ticks fall on
  // round multiples of `step` and are dropped near the edges.
  let html = `<span class="wf-tick wf-tick-first" style="left:0%">${(lo / 1e6).toFixed(3)}</span>` +
             `<span class="wf-tick wf-tick-last" style="left:100%">${(hi / 1e6).toFixed(3)}</span>`;
  for (let f = Math.ceil(lo / step) * step; f < hi; f += step) {
    const p = (f - lo) / span;
    if (p < 0.15 || p > 0.85) continue;
    html += `<span class="wf-tick" style="left:${pct(f)}">${(f / 1e6).toFixed(3)}</span>`;
  }
  band.axis.innerHTML = html;

  // FT8/FT4/WSPR sit a few kHz apart: stack labels that would overlap.
  const marks = Object.entries(CONFIG.band(band.name).dials || {})
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
  card.dataset.band = meta.name;
  card.innerHTML = `
    <header class="wf-card-head">
      <span class="wf-swatch" style="background:${CONFIG.bandColor(meta.name)}"></span>
      <span class="wf-band" data-role="label" title="${CONFIG.bandTitle(meta.name)}">${CONFIG.bandLabel(meta.name, { html: true })}</span>
      <span class="wf-range" data-role="range"></span>
      <span class="wf-stats" data-role="stats">—</span>
      <span class="wf-scale" data-role="scale" title="Colour scale: floor (darkest) to floor + range (brightest)">
        <span class="wf-scale-lo"></span><canvas width="64" height="8"></canvas><span class="wf-scale-hi"></span>
      </span>
    </header>
    <div class="wf-body">
      <!-- Grid: dial markers, canvas and frequency axis share column 1; the
           UTC time axis has column 2, so all frequency scales line up (#76). -->
      <div class="wf-markers" data-role="markers"></div>
      <div class="wf-canvas-wrap">
        <canvas class="wf-canvas" width="${meta.bins}" height="${WF.ROWS}"></canvas>
        <div class="wf-listen" data-role="listen" hidden><span class="wf-listen-dial"></span></div>
        <div class="wf-tip" data-role="tip" hidden></div>
      </div>
      <div class="wf-taxis" data-role="taxis" title="Time (UTC), newest at the top"></div>
      <div class="wf-axis" data-role="axis"></div>
    </div>`;
  const canvas = card.querySelector(".wf-canvas");
  const band = {
    name: meta.name,
    meta,
    card,
    canvas,
    ctx: canvas.getContext("2d"),
    img: null,
    rows: [],               // [{seq, t, data: Uint8Array}], oldest first
    autoFloor: state.prefs.floor,
    top: null,              // epoch (s) at the canvas top in the last render
    view: null,
    axis: card.querySelector('[data-role="axis"]'),
    taxis: card.querySelector('[data-role="taxis"]'),
    markers: card.querySelector('[data-role="markers"]'),
    stats: card.querySelector('[data-role="stats"]'),
    scale: card.querySelector('[data-role="scale"]'),
    rangeEl: card.querySelector('[data-role="range"]'),
    tip: card.querySelector('[data-role="tip"]'),
    listenEl: card.querySelector('[data-role="listen"]'),   // passband overlay (listen.js)
  };
  band.ctx.fillStyle = "#000";
  band.ctx.fillRect(0, 0, canvas.width, canvas.height);
  applyView(band);
  attachHover(band);
  // Click to listen (listen.js): tune a radiod audio channel to that spot.
  canvas.addEventListener("click", ev => {
    if (!window.Listen) return;
    window.Listen.clickBand(band, xToHz(band, ev));
  });
  return band;
}

function xToHz(band, ev) {
  const r = band.canvas.getBoundingClientRect();
  const x = Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width));
  return band.view.lo + x * (band.view.hi - band.view.lo);
}

/** Rows further apart than this leave a gap (missed polls, Pause, restart). */
function gapSec() {
  return Math.max(6, state.pollSec * 3);
}

/** Row covering epoch t (the latest row at or before t, if still current). */
function rowAt(band, t) {
  const rows = band.rows;
  let lo = 0, hi = rows.length - 1, k = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (rows[mid].t <= t) { k = mid; lo = mid + 1; } else hi = mid - 1;
  }
  if (k < 0) return null;
  const next = rows[k + 1];
  const limit = Math.min(gapSec(), next ? next.t - rows[k].t : gapSec());
  return t - rows[k].t <= Math.max(limit, state.prefs.span / WF.ROWS) ? rows[k] : null;
}

function attachHover(band) {
  const { canvas, tip } = band;
  canvas.addEventListener("mousemove", ev => {
    const r = canvas.getBoundingClientRect();
    const x = (ev.clientX - r.left) / r.width, y = (ev.clientY - r.top) / r.height;
    const { b0, b1 } = band.view;
    const bin = Math.min(b1 - 1, Math.max(b0, b0 + Math.floor(x * (b1 - b0))));
    const freq = band.meta.lo_hz + (bin + 0.5) * band.meta.rbw_hz;
    let text = `${(freq / 1e6).toFixed(4)} MHz`;
    if (band.top !== null) {
      const t = band.top - y * state.prefs.span;
      const row = rowAt(band, t);
      text += row ? ` · ${byteToDb(row.data[bin]).toFixed(1)} dB · ${utcHHMMSS(row.t)} UTC`
                  : ` · no data · ${utcHHMMSS(t)} UTC`;
    }
    if (window.Listen?.enabled) text += " · click to listen";
    tip.textContent = text;
    tip.hidden = false;
    tip.style.left = `${Math.min(r.width - 300, Math.max(0, ev.clientX - r.left + 12))}px`;
    tip.style.top = `${Math.max(0, ev.clientY - r.top - 28)}px`;
  });
  canvas.addEventListener("mouseleave", () => { band.tip.hidden = true; });
}

/** Put the cards in the viewer's order, hidden bands left out. */
function layoutBands() {
  const grid = document.getElementById("wf-grid");
  const order = shownOrder();
  if ([...grid.children].map(c => c.dataset.band).join() !== order.join()) {
    grid.replaceChildren(...order.map(n => state.bands[n].card));
  }
  window.Listen?.refreshOverlay();
}

function ensureBands(payload) {
  const names = Object.keys(payload.bands || {});
  if (names.join() === state.names.join()) return;
  state.names = names;
  state.bands = {};
  for (const name of names) state.bands[name] = buildBand(payload.bands[name]);
  document.getElementById("wf-grid").replaceChildren();
  layoutBands();
  renderBandPanel();
}

// ── drawing ────────────────────────────────────────────────────────────────

/**
 * Redraw one band for the current span: canvas row y covers
 * [top - (y+1)*span/ROWS, top - y*span/ROWS) and shows the per-bin maximum of
 * the rows whose timestamps fall there, or the still-current previous row
 * when the slice is shorter than the row interval.  No data -> black.
 */
function render(band, top) {
  const { b0, b1 } = band.view;
  const W = b1 - b0, H = WF.ROWS;
  if (!band.img || band.img.width !== W) band.img = band.ctx.createImageData(W, H);
  const px = band.img.data;
  const lut = levelLut(band);
  const rows = band.rows;
  const dt = state.prefs.span / H, gap = gapSec();
  const acc = new Uint8Array(W);
  let k = rows.length - 1;
  while (k >= 0 && rows[k].t >= top) k--;
  for (let y = 0; y < H; y++) {
    const tHi = top - y * dt, tLo = tHi - dt;
    let n = 0;
    while (k >= 0 && rows[k].t >= tLo) {
      const d = rows[k].data;
      if (n === 0) { for (let i = 0; i < W; i++) acc[i] = d[b0 + i]; }
      else { for (let i = 0; i < W; i++) { const v = d[b0 + i]; if (v > acc[i]) acc[i] = v; } }
      n++; k--;
    }
    let src = n ? acc : null;
    if (!n && k >= 0) {
      // No row starts in this slice: keep showing the previous row while it
      // is still current (slices shorter than the row interval).
      const nextT = k + 1 < rows.length ? rows[k + 1].t : Infinity;
      const mid = tLo + dt / 2;
      if (mid - rows[k].t <= Math.min(gap, nextT - rows[k].t)) src = rows[k].data.subarray(b0, b1);
    }
    const o0 = y * W * 4;
    if (!src) {
      for (let i = 0; i < W; i++) { const o = o0 + i * 4; px[o] = 0; px[o + 1] = 0; px[o + 2] = 0; px[o + 3] = 255; }
      continue;
    }
    for (let i = 0; i < W; i++) {
      const o = o0 + i * 4, c = lut[src[i]] * 3;
      px[o] = paletteLut[c]; px[o + 1] = paletteLut[c + 1]; px[o + 2] = paletteLut[c + 2]; px[o + 3] = 255;
    }
  }
  band.ctx.putImageData(band.img, 0, 0);
  band.top = top;
  drawTimeAxis(band, top);
}

/** UTC ticks beside the canvas, placed from timestamps (#63). */
function drawTimeAxis(band, top) {
  const span = state.prefs.span;
  const step = span <= 300 ? 60 : span <= 600 ? 120 : span <= 1800 ? 300 : 600;
  let html = `<span class="wf-ttick wf-ttick-now" style="top:0%">${utcHHMMSS(top)}</span>`;
  for (let t = Math.floor(top / step) * step; t > top - span; t -= step) {
    const p = (top - t) / span * 100;
    if (p < 7 || p > 93) continue;
    html += `<span class="wf-ttick" style="top:${p.toFixed(2)}%">${utcHHMM(t)}</span>`;
  }
  html += `<span class="wf-ttick wf-ttick-end" style="top:100%">−${span / 60}m</span>`;
  band.taxis.innerHTML = html;
}

/** Header: effective floor (#64), noise and peak, and the colour scale. */
function updateStats(band) {
  const last = band.rows[band.rows.length - 1]?.data;
  if (!last) return;
  const noise = byteToDb(percentileByte(last, 0.5));
  const peak = byteToDb(percentileByte(last, 0.999));
  const floor = bandFloor(band);
  band.stats.textContent = `floor ${floor.toFixed(0)}${state.prefs.auto ? " (auto)" : ""} · ` +
    `noise ${noise.toFixed(0)} · peak ${peak.toFixed(0)} dB`;
  band.stats.title = state.prefs.auto
    ? "floor: this band's own auto floor (20th percentile of each row minus 3 dB, smoothed) = the darkest colour. noise: median of the latest row. peak: its 99.9th percentile."
    : "floor: the manual Floor shared by every band = the darkest colour. noise: median of the latest row. peak: its 99.9th percentile.";
  const c = band.scale.querySelector("canvas"), g = c.getContext("2d");
  for (let x = 0; x < c.width; x++) {
    const i = Math.round(x / (c.width - 1) * 255) * 3;
    g.fillStyle = `rgb(${paletteLut[i]},${paletteLut[i + 1]},${paletteLut[i + 2]})`;
    g.fillRect(x, 0, 1, c.height);
  }
  band.scale.querySelector(".wf-scale-lo").textContent = floor.toFixed(0);
  band.scale.querySelector(".wf-scale-hi").textContent = `${(floor + state.prefs.range).toFixed(0)} dB`;
}

function renderAll() {
  if (!state.lastRowEpoch) return;
  const top = state.lastRowEpoch + 0.001;
  for (const name of shownOrder()) {
    render(state.bands[name], top);
    updateStats(state.bands[name]);
  }
}

function redrawAll() {
  paletteLut = buildPalette(state.prefs.palette);
  Object.values(state.bands).forEach(applyView);
  layoutBands();
  renderAll();
}

function addRows(band, rows) {
  if (!rows.length) return;
  for (const [seq, t, b64] of rows) {
    if (band.rows.length && t <= band.rows[band.rows.length - 1].t) continue;   // already have it
    const data = decodeRow(b64);
    // Auto contrast: track the noise floor (20th percentile) smoothly.
    const floorDb = byteToDb(percentileByte(data, 0.2)) - 3;
    band.autoFloor = band.rows.length ? band.autoFloor * 0.9 + floorDb * 0.1 : floorDb;
    band.rows.push({ seq, t, data });
  }
  // Keep the longest selectable span (about 8.6 MB for six bands at 60 min).
  const oldest = band.rows[band.rows.length - 1].t - WF.MAX_SPAN - 60;
  let drop = 0;
  while (drop < band.rows.length && band.rows[drop].t < oldest) drop++;
  if (drop) band.rows.splice(0, drop);
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
    // span limits the first response to rows the chosen span can show.
    const res = await fetch(`/api/waterfall?since=${state.seq}&span=${state.prefs.span}`, { cache: "no-store" });
    const payload = await res.json();
    if (payload.poll_sec) {
      state.pollSec = payload.poll_sec;
      WF.POLL_MS = Math.max(500, payload.poll_sec * 1000);
    }
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
      state.seq = 0; state.names = [];
    }
    state.dbMin = payload.db_min; state.dbMax = payload.db_max;
    ensureBands(payload);
    let newest = null;
    for (const name of state.names) {
      const rows = payload.bands[name].rows;
      addRows(state.bands[name], rows);
      if (rows.length) newest = Math.max(newest || 0, rows[rows.length - 1][1]);
    }
    state.seq = Math.max(state.seq, payload.seq);
    if (newest) state.lastRowEpoch = newest;
    renderAll();
    if (state.lastRowEpoch) {
      const age = Math.round(Date.now() / 1000 - state.lastRowEpoch);
      document.getElementById("wf-updated").textContent = `Last row: ${utcHHMMSS(state.lastRowEpoch)} UTC`;
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

// ── bands panel (#65): order, show/hide, segment zoom ─────────────────────

function renderBandPanel() {
  const list = document.getElementById("wf-band-list");
  if (!list) return;
  const shown = shownOrder();
  const order = [...shown, ...state.prefs.hidden.filter(n => state.names.includes(n))];
  const custom = state.prefs.seg === "custom";
  list.innerHTML = order.map(n => {
    const [lo, hi] = viewRange(state.bands[n]).map(v => (v / 1e6).toFixed(3));
    const i = shown.indexOf(n);
    return `<div class="wf-band-row" data-band="${n}">
        <input type="checkbox" data-act="show" ${i >= 0 ? "checked" : ""} aria-label="Show ${n}">
        <span class="wf-swatch" style="background:${CONFIG.bandColor(n)}"></span>
        <span class="wf-band-row-name">${CONFIG.bandLabel(n, { html: true })}</span>
        <input type="number" data-act="lo" step="0.001" value="${lo}" ${custom ? "" : "disabled"} aria-label="${n} low MHz">
        <span class="wf-dash">–</span>
        <input type="number" data-act="hi" step="0.001" value="${hi}" ${custom ? "" : "disabled"} aria-label="${n} high MHz">
        <button type="button" class="btn-secondary" data-act="up" ${i <= 0 ? "disabled" : ""} aria-label="Move ${n} up">↑</button>
        <button type="button" class="btn-secondary" data-act="down" ${i < 0 || i >= shown.length - 1 ? "disabled" : ""} aria-label="Move ${n} down">↓</button>
      </div>`;
  }).join("");
  document.getElementById("wf-seg").value = state.prefs.seg;
}

function initBandPanel() {
  const seg = document.getElementById("wf-seg");
  seg.addEventListener("change", () => {
    if (seg.value === "custom") {
      // Start the custom ranges from what is on screen now.
      state.prefs.zoom = Object.fromEntries(Object.values(state.bands).map(b =>
        [b.name, viewRange(b).map(v => +(v / 1e6).toFixed(3))]));
    }
    state.prefs.seg = seg.value;
    savePrefs(); redrawAll(); renderBandPanel();
  });
  document.getElementById("wf-bands-reset").addEventListener("click", () => {
    Object.assign(state.prefs, { order: null, hidden: [], seg: "full", zoom: {} });
    savePrefs(); redrawAll(); renderBandPanel();
  });
  const list = document.getElementById("wf-band-list");
  list.addEventListener("change", ev => {
    const row = ev.target.closest("[data-band]");
    if (!row) return;
    const n = row.dataset.band, act = ev.target.dataset.act;
    if (act === "show") {
      state.prefs.order = [...shownOrder(), ...state.prefs.hidden];
      state.prefs.hidden = ev.target.checked ? state.prefs.hidden.filter(h => h !== n) : [...state.prefs.hidden, n];
    } else if (act === "lo" || act === "hi") {
      const lo = Number(row.querySelector('[data-act="lo"]').value);
      const hi = Number(row.querySelector('[data-act="hi"]').value);
      if (hi > lo) state.prefs.zoom[n] = [lo, hi];
    }
    savePrefs(); redrawAll(); renderBandPanel();
  });
  list.addEventListener("click", ev => {
    const act = ev.target.dataset?.act;
    if (act !== "up" && act !== "down") return;
    const n = ev.target.closest("[data-band]").dataset.band;
    const order = shownOrder();
    const i = order.indexOf(n), j = act === "up" ? i - 1 : i + 1;
    if (i < 0 || j < 0 || j >= order.length) return;
    [order[i], order[j]] = [order[j], order[i]];
    state.prefs.order = [...order, ...state.prefs.hidden];
    savePrefs(); layoutBands(); renderAll(); renderBandPanel();
  });
}

// ── controls ───────────────────────────────────────────────────────────────

function initControls() {
  const auto = document.getElementById("wf-auto");
  const floor = document.getElementById("wf-floor");
  const range = document.getElementById("wf-range");
  const palette = document.getElementById("wf-palette");
  const layout = document.getElementById("wf-layout");
  const span = document.getElementById("wf-span");
  const pause = document.getElementById("wf-pause");
  const grid = document.getElementById("wf-grid");

  // Floor box (#64): in Auto mode each band uses its own floor, shown in its
  // header, so the box reads "auto" instead of keeping a stale number.
  function showFloor() {
    floor.disabled = state.prefs.auto;
    floor.value = state.prefs.auto ? "" : state.prefs.floor;
  }
  auto.checked = state.prefs.auto;
  showFloor();
  range.value = state.prefs.range;
  palette.value = state.prefs.palette;
  layout.value = state.prefs.layout;
  span.value = String(state.prefs.span);
  grid.classList.toggle("wf-stack", state.prefs.layout === "stack");

  auto.addEventListener("change", () => {
    state.prefs.auto = auto.checked;
    if (!auto.checked) {
      // Start manual mode from the current average auto floor.
      const floors = Object.values(state.bands).map(b => b.autoFloor);
      if (floors.length) state.prefs.floor = Math.round(floors.reduce((a, b) => a + b, 0) / floors.length);
    }
    showFloor();
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
  span.addEventListener("change", () => {
    const longer = Number(span.value) > state.prefs.span;
    state.prefs.span = Number(span.value); savePrefs(); renderAll();
    // The server may hold more history than we fetched: ask again from the
    // start (addRows skips rows we already have).
    if (longer) { state.seq = 0; resume(); }
  });
  pause.addEventListener("click", () => {
    state.paused = !state.paused;
    pause.textContent = state.paused ? "Resume" : "Pause";
    if (state.paused) { clearTimeout(state.timer); setStatus("checking", "Paused"); } else resume();
  });
  initBandPanel();
}

// Parent dashboard (both.html) tells us when our tab is shown or hidden.
window.addEventListener("message", ev => {
  if (ev.origin !== window.location.origin || !ev.data || ev.data.type !== "frc-tab") return;
  state.active = ev.data.active === "waterfall-frame";
  if (state.active) resume(); else clearTimeout(state.timer);
});
document.addEventListener("visibilitychange", () => { if (!document.hidden) resume(); });
// The dashboard's band label style changed (#66): relabel the panels.
window.addEventListener("storage", ev => {
  if (ev.key !== "bandLabels") return;
  Object.values(state.bands).forEach(b => {
    b.card.querySelector('[data-role="label"]').innerHTML = CONFIG.bandLabel(b.name, { html: true });
  });
  renderBandPanel();
});

document.addEventListener("DOMContentLoaded", async () => {
  loadPrefs();
  paletteLut = buildPalette(state.prefs.palette);
  initControls();
  savePrefs();          // report the restored settings to the dashboard URL
  if (typeof CONFIG.loadStation === "function") {
    await CONFIG.loadStation();
    if (CONFIG.station.callsign && CONFIG.station.callsign !== "Unknown") {
      document.getElementById("title").textContent = `Contest Band Waterfalls — ${CONFIG.station.callsign}`;
    }
  }
  poll();
});
