/**
 * HamSCI Contesting Dashboard - Bands view (bands.js), #70
 *
 * One card per band: how active it is and in which direction it is open, at
 * a glance (FR-Q-01 what's open where, FR-Q-04 most active band, FR-Q-05
 * direction), readable by operators and by non-ham visitors.
 *
 * Each card has:
 *   - a header: frequency label (#66), an Open / Marginal / Closed chip
 *     relative to the band's own last hour, spot count and rate, a 60-min
 *     spot-rate sparkline, the busiest heading and the trend;
 *   - a direction map centred on the station: bearing-true, distance
 *     compressed (r ~ d^0.55, so North American spots aren't squashed into
 *     the centre) or true azimuthal equidistant; shape = mode (#67), fade =
 *     age, rim bars = spots per 16-point heading;
 *   - a mini waterfall of the same band from the existing supervisor
 *     spectrum channels (/api/waterfall: no extra radiod channels or FFTs),
 *     with a CW / DIGI / PHONE band-plan strip and a time axis (#63).
 *
 * Spots come from the existing /spots endpoint, split by band here.
 */

const BV = {
  HOUR: 60,                  // minutes of spots fetched (sparkline, baseline)
  WF_SPAN: 600,              // seconds of mini waterfall
  WF_ROWS: 100,
  RINGS_KM: [1000, 3000, 6000, 12000],
  COMPASS: ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"],
  PALETTE: [[0, "#000014"], [0.15, "#00007a"], [0.35, "#0050ff"], [0.55, "#00e0ff"],
            [0.7, "#40ff60"], [0.85, "#ffe000"], [1, "#ff2a00"]],
};
const BV_DEFAULTS = { last: CONFIG.defaults.lastInterval, reload: CONFIG.defaults.reload, dist: "c", bseg: "full" };

const bv = {
  station: null,           // [lat, lon]
  spots: [],               // [{band, mode, lat, lon, t(ms), brg, km}]
  land: {},                // dist mode -> [[x, y]...] rings in the unit disc
  cards: {},               // band -> card view
  bandSel: null,
  wf: { seq: 0, bands: {}, dbMin: -150, dbMax: -60, pollSec: 2, timer: null },
  active: true,
  ready: false,            // settings restored; ignore storage events before
  reloadTimer: null,
  lut: null,
};

// ── projection: station-centred, bearing-true ─────────────────────────────

function radius(km) {
  const f = Math.min(1, km / 20015);
  return document.getElementById("bvDist").value === "t" ? f : Math.pow(f, 0.55);
}

/** Unit-disc position (+x east, +y south) of a bearing/distance. */
function polar(brg, km) {
  const r = radius(km), a = brg * Math.PI / 180;
  return [r * Math.sin(a), -r * Math.cos(a)];
}

async function loadLand() {
  const res = await fetch("vendor/basemap/ne_50m_land.json");
  bv.landGeo = await res.json();
}

/** Land rings projected once per distance mode; edges that jump across the disc (near the antipode) are cut. */
function landRings() {
  const mode = document.getElementById("bvDist").value;
  if (bv.land[mode]) return bv.land[mode];
  const rings = [];
  for (const f of bv.landGeo.features) {
    const polys = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
    for (const poly of polys) for (const ring of poly) {
      let cur = [], prev = null;
      for (const [lon, lat] of ring) {
        const { bearing, km } = AEQD.bearingDistance(bv.station, [lat, lon]);
        const p = polar(bearing, km);
        if (prev && Math.hypot(p[0] - prev[0], p[1] - prev[1]) > 0.5) { if (cur.length > 2) rings.push(cur); cur = []; }
        cur.push(p);
        prev = p;
      }
      if (cur.length > 2) rings.push(cur);
    }
  }
  return (bv.land[mode] = rings);
}

// ── data ────────────────────────────────────────────────────────────────────

function setStatus(state, label) {
  const dot = document.getElementById("conn-status-dot");
  const lbl = document.getElementById("conn-status-label");
  if (dot) dot.className = `status-dot status-${state}`;
  if (lbl) lbl.textContent = label;
}

async function fetchSpots() {
  setStatus("checking", "Checking…");
  persist();
  try {
    const res = await fetch(`/spots?lastInterval=${Math.max(BV.HOUR, windowMin())}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const raw = await res.json();
    const rx0 = raw.find(s => Number.isFinite(s.rx_lat));
    if (rx0 && !bv.station) bv.station = [rx0.rx_lat, rx0.rx_lon];
    bv.spots = raw.filter(s => Number.isFinite(s.tx_lat) && Number.isFinite(s.tx_lon) && !(s.tx_lat === 0 && s.tx_lon === 0))
      .map(s => {
        const { bearing, km } = AEQD.bearingDistance(bv.station, [s.tx_lat, s.tx_lon]);
        return { band: frequencyToBand(s.frequency), mode: (s.mode || "").toLowerCase(),
                 t: parseTableTime(s.time).getTime(), brg: bearing, km };
      });
    renderAll();
    setStatus("connected", "Connected");
    document.getElementById("last-updated").textContent = `Last updated: ${new Date().toISOString().slice(11, 19)} UTC`;
  } catch (e) {
    console.error("Failed to load spots:", e);
    setStatus("disconnected", "Error");
  }
}

function windowMin() {
  return Number(document.getElementById("lastInterval").value) || CONFIG.defaults.lastInterval;
}

function shownBands() {
  return bv.bandSel && bv.bandSel.size ? CONFIG.sortBands([...bv.bandSel]) : CONFIG.contestBands;
}

// ── cards ─────────────────────────────────────────────────────────────────

function buildCard(band) {
  const b = CONFIG.band(band);
  const el = document.createElement("section");
  el.className = "bv-card";
  el.dataset.band = band;
  el.innerHTML = `
    <header class="bv-head">
      <span class="wf-swatch" style="background:${b.color}"></span>
      <div class="bv-title"><b>${b.freq}</b> <span class="band-sub">${b.wl} · ${CONFIG.bandTitle(band).split(" · ")[0]}</span></div>
      <span class="bv-chip" data-role="chip">—</span>
    </header>
    <div class="bv-stats">
      <div class="bv-count" data-role="count">—</div>
      <div class="bv-spark" title="Spot rate over the last 60 minutes, oldest left. Each band is scaled to its own peak: compare shapes, not heights.">
        <div class="bv-spark-title">Spot rate · last 60 min</div>
        <svg data-role="spark" viewBox="0 0 120 26" preserveAspectRatio="none"></svg>
        <div class="bv-spark-ticks"><span>−60 m</span><span>−30 m</span><span>now</span></div>
      </div>
      <div class="bv-heading" data-role="heading">—</div>
    </div>
    <canvas class="bv-map" data-role="map" title="Centred on the station: direction = beam heading; distance from the centre grows with path length"></canvas>
    <div class="bv-wf">
      <!-- Grid: the band plan, canvas, frequency axis and message share column 1;
           the time ticks have column 2, so all frequency scales line up (#76). -->
      <div class="bv-plan" data-role="plan"></div>
      <canvas class="bv-wf-canvas" data-role="wf" height="${BV.WF_ROWS}"></canvas>
      <div class="bv-wf-ticks"><span>now</span><span>−5 m</span><span>−10 m</span></div>
      <div class="bv-wf-axis" data-role="wfaxis"></div>
      <div class="bv-wf-msg" data-role="wfmsg" hidden></div>
    </div>
    <div class="bv-links">
      <button type="button" class="bv-link" data-open="map">Open in Map ↗</button>
      <button type="button" class="bv-link" data-open="waterfall">Open waterfall ↗</button>
    </div>`;
  const q = r => el.querySelector(`[data-role="${r}"]`);
  return { band, el, chip: q("chip"), count: q("count"), spark: q("spark"), heading: q("heading"),
           map: q("map"), wf: q("wf"), plan: q("plan"), wfaxis: q("wfaxis"), wfmsg: q("wfmsg") };
}

function layoutCards() {
  const grid = document.getElementById("bvGrid");
  const bands = shownBands();
  for (const band of bands) if (!bv.cards[band]) bv.cards[band] = buildCard(band);
  grid.replaceChildren(...bands.map(b => bv.cards[b].el));
}

function renderAll() {
  if (!bv.station || !bv.landGeo) return;     // not initialised yet (e.g. an early storage event)
  layoutCards();
  const modes = selectedModes(document.getElementById("modePills"));
  renderModePills(document.getElementById("modePills"), [...new Set(bv.spots.map(s => s.mode))], onFilterChange);
  const now = Date.now(), win = windowMin() * 60000;
  for (const band of shownBands()) {
    const all = bv.spots.filter(s => s.band === band && (!modes || modes.has(s.mode)));
    renderCard(bv.cards[band], all, now, win);
  }
  renderWaterfalls();
}

/** Open / Marginal / Closed, relative to the band's own last hour. */
function bandStatus(perMin) {
  const ten = k => perMin.slice(k, k + 10).reduce((a, b) => a + b, 0);
  const recent = ten(50);
  const peak = Math.max(...[0, 10, 20, 30, 40, 50].map(ten));
  if (recent === 0) return ["closed", "Closed", "No spots in the last 10 min"];
  if (recent >= 3 && recent >= 0.5 * peak) return ["open", "Open", `${recent} spots in the last 10 min, at least half this band's busiest 10 min of the hour (${peak})`];
  return ["marginal", "Marginal", `${recent} spots in the last 10 min; this band's busiest 10 min of the hour had ${peak}`];
}

function renderCard(card, all, now, win) {
  // per-minute counts for the last 60 min (index 59 = the current minute)
  const perMin = new Array(60).fill(0);
  for (const s of all) {
    const ago = Math.floor((now - s.t) / 60000);
    if (ago >= 0 && ago < 60) perMin[59 - ago]++;
  }
  const inWin = all.filter(s => now - s.t <= win + 60000);
  const [cls, label, why] = bandStatus(perMin);
  card.chip.className = `bv-chip ${cls}`;
  card.chip.textContent = label;
  card.chip.title = why;
  const rate = inWin.length / Math.max(1, windowMin());
  card.count.innerHTML = `<b>${inWin.length}</b> spot${inWin.length === 1 ? "" : "s"} · ${rate.toFixed(1)}/min <span class="bv-dim">(last ${windowMin()} min)</span>`;

  // sparkline (5-min smoothing keeps it readable at this size)
  const smooth = perMin.map((_, i) => perMin.slice(Math.max(0, i - 4), i + 1).reduce((a, b) => a + b, 0));
  const max = Math.max(1, ...smooth);
  const pts = smooth.map((v, i) => `${(i / 59 * 120).toFixed(1)},${(25 - v / max * 23).toFixed(1)}`).join(" ");
  card.spark.innerHTML = `<polyline points="0,25 ${pts} 120,25" class="bv-spark-fill"/><polyline points="${pts}" class="bv-spark-line"/>`;

  // busiest heading (16-point) and trend (last 15 min vs the 15 before)
  const sectors = new Array(16).fill(0);
  for (const s of inWin) sectors[Math.round(s.brg / 22.5) % 16]++;
  const top = sectors.indexOf(Math.max(...sectors));
  const last15 = perMin.slice(45).reduce((a, b) => a + b, 0), prev15 = perMin.slice(30, 45).reduce((a, b) => a + b, 0);
  const trend = last15 > prev15 * 1.25 + 1 ? "rising ↑" : last15 < prev15 * 0.75 - 1 ? "falling ↓" : "steady →";
  card.heading.innerHTML = inWin.length
    ? `busiest <b>${BV.COMPASS[top]} ${Math.round(top * 22.5)}°</b> · ${trend}`
    : `<span class="bv-dim">no spots in the window · ${trend}</span>`;

  drawMap(card, inWin, sectors, now, win);
}

function drawMap(card, spots, sectors, now, win) {
  const c = card.map, dpr = window.devicePixelRatio || 1;
  const size = Math.round(c.clientWidth * dpr) || 300;
  if (c.width !== size) { c.width = size; c.height = size; }
  const g = c.getContext("2d");
  const R = size * 0.37, cx = size / 2, cy = size / 2;     // room outside for rim bars + compass
  const P = ([x, y]) => [cx + x * R, cy + y * R];
  g.clearRect(0, 0, size, size);
  // ocean disc + land
  g.fillStyle = "#16314a";
  g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.fill();
  g.fillStyle = "#3a4a5e";
  g.beginPath();
  for (const ring of landRings()) {
    ring.forEach((p, i) => { const [x, y] = P(p); if (i) g.lineTo(x, y); else g.moveTo(x, y); });
    g.closePath();
  }
  g.fill("evenodd");
  // range rings + labels
  g.strokeStyle = "rgba(200,215,235,0.25)"; g.lineWidth = dpr * 0.8; g.fillStyle = "rgba(200,215,235,0.55)";
  g.font = `${9 * dpr}px sans-serif`;
  for (const km of BV.RINGS_KM) {
    const r = radius(km) * R;
    g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.stroke();
    g.fillText(`${km / 1000}k`, cx + r * 0.71 + 2 * dpr, cy - r * 0.71);
  }
  // rim bars: spots per 16-point heading
  const maxS = Math.max(1, ...sectors);
  g.fillStyle = CONFIG.bandColor(card.band);
  for (let i = 0; i < 16; i++) {
    if (!sectors[i]) continue;
    const a0 = (i * 22.5 - 9) * Math.PI / 180 - Math.PI / 2, a1 = (i * 22.5 + 9) * Math.PI / 180 - Math.PI / 2;
    const r1 = R + 3 * dpr + sectors[i] / maxS * size * 0.07;
    g.beginPath(); g.arc(cx, cy, R + 2 * dpr, a0, a1); g.arc(cx, cy, r1, a1, a0, true); g.closePath();
    g.globalAlpha = 0.85; g.fill(); g.globalAlpha = 1;
  }
  // compass labels
  g.fillStyle = "rgba(230,235,245,0.8)"; g.font = `bold ${10 * dpr}px sans-serif`; g.textAlign = "center"; g.textBaseline = "middle";
  [["N", 0], ["E", 90], ["S", 180], ["W", 270]].forEach(([t, a]) => {
    const r = size * 0.465, rad = a * Math.PI / 180;
    g.fillText(t, cx + Math.sin(rad) * r, cy - Math.cos(rad) * r);
  });
  g.textAlign = "start"; g.textBaseline = "alphabetic";
  // spots: shape = mode, colour = band, older = fainter
  const color = CONFIG.bandColor(card.band);
  const sorted = [...spots].sort((a, b) => a.t - b.t);
  for (const s of sorted) {
    const [x, y] = P(polar(s.brg, s.km));
    g.globalAlpha = Math.max(0.25, 1 - 0.75 * Math.min(1, (now - s.t) / win));
    g.beginPath();
    drawSpotShape(g, CONFIG.mode(s.mode).shape, x, y, 3.2 * dpr);
    g.fillStyle = color; g.fill();
    g.lineWidth = dpr * 0.8; g.strokeStyle = "rgba(255,255,255,0.75)"; g.stroke();
  }
  g.globalAlpha = 1;
  // station
  g.fillStyle = "#ffffff"; g.beginPath(); g.arc(cx, cy, 3 * dpr, 0, Math.PI * 2); g.fill();
}

// ── mini waterfalls (existing supervisor channels) ─────────────────────────

function buildLut() {
  const stops = BV.PALETTE.map(([p, c]) => [p, [1, 3, 5].map(i => parseInt(c.slice(i, i + 2), 16))]);
  const lut = new Uint8Array(256 * 3);
  for (let i = 0; i < 256; i++) {
    const t = i / 255;
    let k = 0;
    while (k < stops.length - 2 && t > stops[k + 1][0]) k++;
    const [p0, c0] = stops[k], [p1, c1] = stops[k + 1];
    const f = Math.min(1, Math.max(0, (t - p0) / (p1 - p0)));
    for (let ch = 0; ch < 3; ch++) lut[i * 3 + ch] = Math.round(c0[ch] + (c1[ch] - c0[ch]) * f);
  }
  return lut;
}

function wfRange(band, meta) {
  const lo0 = meta.lo_hz, hi0 = meta.lo_hz + meta.bins * meta.rbw_hz;
  const seg = document.getElementById("bvSeg").value, b = CONFIG.band(band);
  let r = null;
  if (seg === "cw" || seg === "ssb") r = b.segments?.[seg];
  if (seg === "digi" && b.dials) {
    const f = Object.values(b.dials);
    r = [Math.min(...f) - 0.006, Math.max(...f) + 0.006];
  }
  if (!r) return [lo0, hi0];
  const lo = Math.max(lo0, r[0] * 1e6), hi = Math.min(hi0, r[1] * 1e6);
  return hi - lo > meta.rbw_hz * 8 ? [lo, hi] : [lo0, hi0];
}

function renderWaterfalls() {
  const now = bv.wf.newest;
  for (const band of shownBands()) {
    const card = bv.cards[band], w = bv.wf.bands[band];
    if (!card) continue;                 // cards not built yet (no spots loaded)
    if (!w) {
      card.wfmsg.hidden = false;
      card.wfmsg.textContent = bv.wf.error || (bv.wf.started ? "No waterfall for this band (the station's spectrum channels cover the contest bands)." : "Starting…");
      continue;
    }
    card.wfmsg.hidden = true;
    const { meta, rows } = w;
    const [lo, hi] = wfRange(band, meta);
    const b0 = Math.max(0, Math.floor((lo - meta.lo_hz) / meta.rbw_hz)), b1 = Math.min(meta.bins, Math.ceil((hi - meta.lo_hz) / meta.rbw_hz));
    const W = b1 - b0, H = BV.WF_ROWS, c = card.wf;
    if (c.width !== W) c.width = W;
    const g = c.getContext("2d"), img = g.createImageData(W, H), px = img.data;
    // auto contrast: floor = smoothed 20th percentile of each row - 3 dB, 35 dB range
    const floor = w.floor, range = 35;
    const lvl = new Uint8Array(256);
    for (let v = 0; v < 256; v++) {
      const db = bv.wf.dbMin + v * (bv.wf.dbMax - bv.wf.dbMin) / 255;
      lvl[v] = Math.max(0, Math.min(255, Math.round((db - floor) / range * 255)));
    }
    const dt = BV.WF_SPAN / H;
    let k = rows.length - 1;
    for (let y = 0; y < H; y++) {
      const tHi = now - y * dt, tLo = tHi - dt;
      let src = null;
      while (k >= 0 && rows[k].t >= tHi) k--;
      if (k >= 0 && rows[k].t >= tLo - Math.max(6, bv.wf.pollSec * 3)) src = rows[k].data;
      for (let x = 0; x < W; x++) {
        const o = (y * W + x) * 4;
        if (!src) { px[o] = px[o + 1] = px[o + 2] = 0; px[o + 3] = 255; continue; }
        const ci = lvl[src[b0 + x]] * 3;
        px[o] = bv.lut[ci]; px[o + 1] = bv.lut[ci + 1]; px[o + 2] = bv.lut[ci + 2]; px[o + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    drawPlan(card, band, meta.lo_hz + b0 * meta.rbw_hz, meta.lo_hz + b1 * meta.rbw_hz);
  }
}

/** [a, z] ranges (MHz) minus the ranges in `cut`. */
function subtractRanges(ranges, cut) {
  let out = ranges;
  for (const [c0, c1] of cut) {
    out = out.flatMap(([a, z]) => (c1 <= a || c0 >= z) ? [[a, z]]
      : [[a, Math.min(z, c0)], [Math.max(a, c1), z]].filter(([x, y]) => y - x > 1e-9));
  }
  return out;
}

/**
 * CW / PHONE / DIGI strip over the waterfall, from the band table's segments
 * and dials.  Where CW and PHONE overlap (160 m) the strip shows both
 * (striped "CW/PH").  The FT8/FT4/WSPR sub-bands sit inside the CW segment on
 * several bands, so each label goes in the widest stretch of its segment
 * that nothing covers, and is left out if it doesn't fit there.
 */
function drawPlan(card, band, lo, hi) {
  const b = CONFIG.band(band), span = hi - lo;
  const widthPx = card.plan.clientWidth || 400;
  const pct = f => Math.max(0, Math.min(100, (f * 1e6 - lo) / span * 100));
  const mhz = (r) => `${r[0].toFixed(3)}–${r[1].toFixed(3)} MHz`;
  const cw = b.segments?.cw, ssb = b.segments?.ssb;
  const both = cw && ssb && Math.max(cw[0], ssb[0]) < Math.min(cw[1], ssb[1])
    ? [Math.max(cw[0], ssb[0]), Math.min(cw[1], ssb[1])] : null;
  const pieces = [];                                  // {ranges, cls, name, short}
  if (cw) pieces.push({ ranges: subtractRanges([cw], both ? [both] : []), cls: "cw", name: "CW", title: `CW ${mhz(cw)}` });
  if (ssb) pieces.push({ ranges: subtractRanges([ssb], both ? [both] : []), cls: "ph", name: "PHONE", short: "PH", title: `PHONE ${mhz(ssb)}` });
  if (both) pieces.push({ ranges: [both], cls: "mix", name: "CW/PH", title: `CW and PHONE ${mhz(both)}` });
  const digi = Object.entries(b.dials || {}).map(([m, f]) => ({ m, f, r: [f - 0.0015, f + 0.0035] }));

  let html = "";
  for (const p of pieces) {
    for (const r of p.ranges) {
      const a = pct(r[0]), z = pct(r[1]);
      if (z - a > 0.2) html += `<span class="bv-plan-seg ${p.cls}" style="left:${a}%;width:${z - a}%" title="${p.title}"></span>`;
    }
  }
  for (const d of digi) {
    const a = pct(d.r[0]), z = pct(d.r[1]);
    if (z > a) html += `<span class="bv-plan-seg dg" style="left:${a}%;width:${z - a}%" title="${d.m} ${d.f.toFixed(4)} MHz"></span>`;
  }
  // Labels: widest uncovered stretch of each piece, if the text fits (8 px bold mono-ish).
  const textPx = s => s.length * 5.5 + 6;
  for (const p of pieces) {
    const free = subtractRanges(p.ranges, digi.map(d => d.r))
      .map(([x, y]) => [Math.max(x * 1e6, lo), Math.min(y * 1e6, hi)]).filter(([x, y]) => y > x);
    if (!free.length) continue;
    const [x, y] = free.reduce((best, g) => (g[1] - g[0] > best[1] - best[0] ? g : best));
    const px = (y - x) / span * widthPx;
    const text = px >= textPx(p.name) ? p.name : (p.short && px >= textPx(p.short) ? p.short : null);
    if (!text) continue;
    const a = (x - lo) / span * 100, w = (y - x) / span * 100;
    html += `<span class="bv-plan-label" style="left:${a}%;width:${w}%">${text}</span>`;
  }
  card.plan.innerHTML = html;
  card.wfaxis.innerHTML = `<span>${(lo / 1e6).toFixed(3)}</span><span>${(hi / 1e6).toFixed(3)} MHz</span>`;
}

function decodeRow(b64) {
  const bin = atob(b64), row = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) row[i] = bin.charCodeAt(i);
  return row;
}

function percentileByte(row, p) {
  const counts = new Uint32Array(256);
  for (let i = 0; i < row.length; i++) counts[row[i]]++;
  let acc = 0;
  for (let b = 0; b < 256; b++) { acc += counts[b]; if (acc >= row.length * p) return b; }
  return 255;
}

async function pollWaterfall() {
  clearTimeout(bv.wf.timer);
  if (!bv.active || document.hidden) return;
  try {
    const res = await fetch(`/api/waterfall?since=${bv.wf.seq}&span=${BV.WF_SPAN}`, { cache: "no-store" });
    const p = await res.json();
    if (p.poll_sec) bv.wf.pollSec = p.poll_sec;
    if (p.starting) { bv.wf.timer = setTimeout(pollWaterfall, 1500); return; }
    if (!res.ok || !p.running) {
      bv.wf.error = p.error ? `Waterfall unavailable: ${p.error}` : `Waterfall unavailable (HTTP ${res.status})`;
      renderWaterfalls();
      bv.wf.timer = setTimeout(pollWaterfall, 10000);
      return;
    }
    bv.wf.error = null;
    bv.wf.started = true;
    if (p.seq < bv.wf.seq) { bv.wf.seq = 0; bv.wf.bands = {}; }
    bv.wf.dbMin = p.db_min; bv.wf.dbMax = p.db_max;
    for (const [name, b] of Object.entries(p.bands)) {
      const w = bv.wf.bands[name] || (bv.wf.bands[name] = { meta: b, rows: [], floor: -130 });
      w.meta = b;
      for (const [, t, b64] of b.rows) {
        if (w.rows.length && t <= w.rows[w.rows.length - 1].t) continue;
        const data = decodeRow(b64);
        const f = bv.wf.dbMin + percentileByte(data, 0.2) * (bv.wf.dbMax - bv.wf.dbMin) / 255 - 3;
        w.floor = w.rows.length ? w.floor * 0.9 + f * 0.1 : f;
        w.rows.push({ t, data });
        bv.wf.newest = Math.max(bv.wf.newest || 0, t);
      }
      const oldest = (bv.wf.newest || 0) - BV.WF_SPAN - 30;
      while (w.rows.length && w.rows[0].t < oldest) w.rows.shift();
    }
    bv.wf.seq = Math.max(bv.wf.seq, p.seq);
    renderWaterfalls();
    bv.wf.timer = setTimeout(pollWaterfall, Math.max(1000, bv.wf.pollSec * 1000));
  } catch (e) {
    bv.wf.timer = setTimeout(pollWaterfall, 10000);    // retry first, whatever rendering does
    bv.wf.error = `Waterfall unavailable: ${e.message}`;
    renderWaterfalls();
  }
}

// ── settings ──────────────────────────────────────────────────────────────

function persist() {
  const st = {
    last: document.getElementById("lastInterval").value,
    reload: document.getElementById("reloadInterval").value,
    dist: document.getElementById("bvDist").value,
    bseg: document.getElementById("bvSeg").value,
    bmodes: modesParam(document.getElementById("modePills")),
    band: bv.bandSel ? bandSelToParam(bv.bandSel) : "",
  };
  try {
    for (const [k, v] of Object.entries(st)) sessionStorage.setItem(`bands.${k}`, v);
    localStorage.setItem("lastInterval", st.last);
    localStorage.setItem("reload", st.reload);
  } catch (e) { /* storage unavailable */ }
  ViewState.publish("bands", st, BV_DEFAULTS);
}

function onFilterChange() {
  persist();
  renderAll();
}

function setReloadInterval(seconds) {
  if (bv.reloadTimer) clearInterval(bv.reloadTimer);
  bv.reloadTimer = seconds > 0 ? setInterval(fetchSpots, seconds * 1000) : null;
}

window.addEventListener("message", ev => {
  if (ev.origin !== window.location.origin || !ev.data || ev.data.type !== "frc-tab") return;
  bv.active = ev.data.active === "bands-frame";
  if (bv.active) pollWaterfall(); else clearTimeout(bv.wf.timer);
});
document.addEventListener("visibilitychange", () => { if (!document.hidden && bv.active) pollWaterfall(); });
window.addEventListener("storage", e => {
  if (!bv.ready) return;
  const reloadSel = document.getElementById("reloadInterval");
  if (e.key === "lastInterval" && e.newValue && e.newValue !== document.getElementById("lastInterval").value) {
    document.getElementById("lastInterval").value = e.newValue;
    fetchSpots();
  } else if (e.key === "reload" && e.newValue !== null && e.newValue !== reloadSel.value) {
    reloadSel.value = e.newValue;
    setReloadInterval(Number(reloadSel.value));
    persist();
  } else if (e.key === "bandSel") {
    bv.bandSel = bandSelFromParam(e.newValue);
    persist();
    renderAll();
  } else if (e.key === "bandLabels") {
    renderAll();
  }
});
window.addEventListener("resize", () => renderAll());

window.addEventListener("DOMContentLoaded", async () => {
  await CONFIG.loadStation();
  bv.station = gridToLatLon(CONFIG.station.gridSquare);
  document.getElementById("title").textContent = `Bands at ${CONFIG.station.callsign}: activity and direction`;
  bv.lut = buildLut();
  await loadLand();

  const get = (names, key, fallback) => ViewState.get(names, `bands.${key}`, fallback);
  document.getElementById("lastInterval").value = ViewState.get(["last", "lastInterval"], "bands.last", String(CONFIG.defaults.lastInterval), "lastInterval");
  document.getElementById("bvDist").value = get("dist", "dist", "c") === "t" ? "t" : "c";
  document.getElementById("bvSeg").value = get("bseg", "bseg", "full");
  const pills = document.getElementById("modePills");
  const modesSaved = get(["bmodes", "modes"], "bmodes", "");
  renderModePills(pills, modesSaved ? modesSaved.split(",") : [], onFilterChange);
  if (modesSaved) setSelectedModes(pills, modesSaved.split(","));
  let band = ViewState.param("band");
  if (band === null) { try { band = localStorage.getItem("bandSel"); } catch (e) { band = null; } }
  bv.bandSel = bandSelFromParam(band);
  const reloadSel = document.getElementById("reloadInterval");
  const reload = ViewState.get("reload", "bands.reload", String(CONFIG.defaults.reload), "reload");
  if ([...reloadSel.options].some(o => o.value === reload)) reloadSel.value = reload;
  setReloadInterval(Number(reloadSel.value));
  bv.ready = true;

  document.getElementById("updateButton").addEventListener("click", fetchSpots);
  document.getElementById("lastInterval").addEventListener("change", fetchSpots);
  reloadSel.addEventListener("change", () => { setReloadInterval(Number(reloadSel.value)); persist(); });
  document.getElementById("bvDist").addEventListener("change", onFilterChange);
  document.getElementById("bvSeg").addEventListener("change", () => { persist(); renderWaterfalls(); });
  // "Open in Map" / "Open waterfall": select that band and switch tabs.
  document.getElementById("bvGrid").addEventListener("click", ev => {
    const btn = ev.target.closest("[data-open]");
    if (!btn) return;
    const band = btn.closest("[data-band]").dataset.band;
    if (btn.dataset.open === "map") { try { localStorage.setItem("bandSel", band); } catch (e) { /* ignore */ } }
    if (window.parent !== window) window.parent.postMessage({ type: "frc-open", view: btn.dataset.open }, window.location.origin);
    else window.location.href = btn.dataset.open === "map" ? `/map?band=${band}` : "/waterfall";
  });

  await fetchSpots();
  pollWaterfall();
});
