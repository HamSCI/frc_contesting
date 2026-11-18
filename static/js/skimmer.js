/**
 * HamSCI PSWS Contesting Dashboard - CW and RTTY skimmer page, /cws (skimmer.js)
 *
 * Shows the station's skimmers (sigmond frc-dashboard, skimmer.py), which run
 * on the configured bands while this page is open (or always, with
 * skimmer.always_on): per band, the spectrum of the
 * skimmed CW and RTTY ranges with every decoded signal marked, each signal's
 * decoded text, and the spots (RBN format on request).  The band and mode
 * selectors only choose what this page shows.
 */

const SK = {
  POLL_MS: 1500,
  MAX_SPOTS: 600,
};

const sk = {
  seq: 0,
  spots: [],
  snap: null,
  timer: null,
  active: true,
  band: "",
  prefs: { unconfirmed: true, rbn: false, mode: "all", allBands: false },
  hover: null,
};

const $ = id => document.getElementById(id);

function setStatus(kind, label) {
  $("sk-status-dot").className = `status-dot status-${kind}`;
  $("sk-status-label").textContent = label;
}

function showMessage(text) {
  $("sk-msg").hidden = !text;
  $("sk-msg").textContent = text || "";
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

function utcHHMM(t) {
  return new Date(t * 1000).toISOString().slice(11, 16);
}

// ── settings (display only; kept in the dashboard URL) ────────────────────
function loadPrefs() {
  sk.prefs.unconfirmed = ViewState.get(["sku"], "sk.unconfirmed", "1") !== "0";
  sk.prefs.rbn = ViewState.get(["skrbn"], "sk.rbn", "0") === "1";
  sk.prefs.mode = ViewState.get(["skmode"], "sk.mode", "all");
  sk.prefs.allBands = ViewState.get(["skall"], "sk.allbands", "0") === "1";
  sk.band = ViewState.get(["skband"], "sk.band", "");
  $("sk-unconfirmed").checked = sk.prefs.unconfirmed;
  $("sk-rbn").checked = sk.prefs.rbn;
  $("sk-mode").value = ["all", "CW", "RTTY"].includes(sk.prefs.mode) ? sk.prefs.mode : "all";
  $("sk-allbands").checked = sk.prefs.allBands;
}

function savePrefs() {
  const st = {
    sku: sk.prefs.unconfirmed ? "1" : "0", skrbn: sk.prefs.rbn ? "1" : "0",
    skmode: sk.prefs.mode, skall: sk.prefs.allBands ? "1" : "0", skband: sk.band,
  };
  try {
    sessionStorage.setItem("sk.unconfirmed", st.sku);
    sessionStorage.setItem("sk.rbn", st.skrbn);
    sessionStorage.setItem("sk.mode", st.skmode);
    sessionStorage.setItem("sk.allbands", st.skall);
    sessionStorage.setItem("sk.band", st.skband);
  } catch (e) { /* storage unavailable */ }
  ViewState.publish("skimmer", st, { sku: "1", skrbn: "0", skmode: "all", skall: "0", skband: "" });
}

// ── polling ───────────────────────────────────────────────────────────────
async function poll() {
  clearTimeout(sk.timer);
  if (!sk.active || document.hidden) return;
  try {
    const res = await fetch(`/api/skimmer?since=${sk.seq}&band=${encodeURIComponent(sk.band)}`, { cache: "no-store" });
    const data = await res.json();
    if (data.bands) showBands(data);
    if (data.running) {
      if (data.seq < sk.seq) { sk.seq = 0; sk.spots = []; }   // the station restarted
      for (const s of data.spots || []) sk.spots.push(s);
      if (data.spots?.length) sk.seq = Math.max(sk.seq, ...data.spots.map(s => s.seq));
      if (sk.spots.length > SK.MAX_SPOTS) sk.spots = sk.spots.slice(-SK.MAX_SPOTS);
      sk.snap = data;
      setStatus(data.ready ? "connected" : "checking", data.ready ? "Running" : "Starting this band…");
      showStats(data);
      showMessage(data.ready ? "" : "Waiting for this band's first data…");
    } else if (data.starting) {
      setStatus("checking", "Starting…");
      showMessage("Starting the skimmers (one radiod IQ channel per band)…");
    } else {
      setStatus("disconnected", "Unavailable");
      showMessage(data.error || "The skimmer is not available.");
    }
    if (data.band) showRange(data);
    render();
  } catch (e) {
    setStatus("disconnected", "Disconnected");
    showMessage(`Cannot reach the dashboard (${e.message}).`);
  }
  sk.timer = setTimeout(poll, SK.POLL_MS);
}

function showBands(data) {
  const sel = $("sk-band");
  const have = [...sel.options].map(o => o.value).join(",");
  if (have !== data.bands.join(",")) {
    sel.innerHTML = data.bands.map(b => `<option value="${b}">${CONFIG.bandLabel(b)}</option>`).join("");
  }
  if (!sk.band || !data.bands.includes(sk.band)) sk.band = data.band;
  if (document.activeElement !== sel) sel.value = sk.band;
}

function showStats(data) {
  const sum = data.bands_summary || {};
  const parts = Object.entries(sum).map(([b, s]) =>
    `${b}: ${s.cw_signals} CW${s.rtty_signals || s.rtty_signals === 0 ? ` / ${s.rtty_signals} RTTY` : ""}` +
    (s.running ? "" : " (down)"));
  const st = data.stats || {}, store = data.store || {};
  $("sk-stats").textContent = parts.join(" · ") + ` · ${sk.spots.length} spots` +
    (st.cpu_pct != null ? ` · CPU ${st.cpu_pct}% (this band)` : "") +
    (store.enabled ? ` · ${store.written.toLocaleString()} stored${store.error ? " (database error)" : ""}` : "");
}

function showRange(data) {
  const r = (a, b) => `${(a / 1e6).toFixed(3)}–${(b / 1e6).toFixed(3)}`;
  const masks = (data.masks || []).map(m => `${(m[0] / 1e6).toFixed(4)}–${(m[1] / 1e6).toFixed(4)}`).join(", ");
  $("sk-range").textContent = `${CONFIG.bandLabel(data.band)}: CW ${r(...data.cw_range)} MHz` +
    (data.rtty_range ? ` · RTTY ${r(...data.rtty_range)} MHz` : " · no RTTY segment") +
    (masks ? ` · FT8/FT4/WSPR ignored: ${masks}` : "") + ` · spotter ${data.spotter}-#`;
  const store = data.store;
  $("sk-feed-note").textContent =
    (store?.enabled ? `Stored in MongoDB ${store.database}.spots. ` : "Not stored (skimmer.store off). ") +
    (data.telnet ? `Confirmed spots are served on telnet ${data.telnet.bind}:${data.telnet.port} (${data.telnet.clients} connected).`
                 : "RBN-format telnet feed: off (skimmer.telnet_port). Nothing is uploaded.");
}

// ── rendering ─────────────────────────────────────────────────────────────
function render() {
  renderPanorama();
  renderSignals();
  renderSpots();
}

function signalsShown() {
  const snap = sk.snap;
  if (!snap) return [];
  const cw = (snap.cw?.signals || []).map(s => ({ ...s, mode: "CW" }));
  const rt = (snap.rtty?.signals || []).map(s => ({ ...s, mode: "RTTY" }));
  return [...cw, ...rt].filter(s => sk.prefs.mode === "all" || s.mode === sk.prefs.mode)
    .sort((a, b) => a.freq_khz - b.freq_khz);
}

function renderSignals() {
  const all = signalsShown(), sigs = all.filter(s => s.text || s.call);
  $("sk-sig-count").textContent = sk.snap ? `(${sigs.length} with text, ${all.length} tracked)` : "";
  $("sk-signals").tBodies[0].innerHTML = sigs.map(s =>
    `<tr${s.call ? ' class="sk-has-call"' : ""}><td class="num">${s.freq_khz.toFixed(2)}</td>` +
    `<td class="sk-mode sk-${s.mode.toLowerCase()}">${s.mode}</td>` +
    `<td class="num">${s.snr_db.toFixed(0)}</td>` +
    `<td class="num">${s.mode === "RTTY" ? `${s.clean_pct}%` : (s.wpm ?? "")}</td>` +
    `<td class="sk-call">${esc(s.call || "")}</td><td class="sk-text">${esc(s.text)}</td></tr>`).join("") ||
    `<tr><td colspan="6" class="sk-empty">No decoded text yet.</td></tr>`;
}

function spotsShown() {
  return sk.spots.filter(s => (sk.prefs.unconfirmed || s.confirmed) &&
    (sk.prefs.allBands || s.band === sk.band) &&
    (sk.prefs.mode === "all" || s.mode === sk.prefs.mode)).slice().reverse();
}

function renderSpots() {
  const shown = spotsShown();
  $("sk-spot-count").textContent = `(${shown.length})`;
  $("sk-spots").hidden = sk.prefs.rbn;
  $("sk-rbn-text").hidden = !sk.prefs.rbn;
  if (sk.prefs.rbn) {
    $("sk-rbn-text").textContent = shown.map(s => (s.confirmed ? "  " : "? ") + s.rbn).join("\n") || "No spots yet.";
    return;
  }
  $("sk-spots").tBodies[0].innerHTML = shown.map(s =>
    `<tr class="${s.confirmed ? "" : "sk-unconf"}" title="${esc(s.reason)}"><td>${utcHHMM(s.t)}</td>` +
    `<td>${esc(s.band)}</td><td class="sk-mode sk-${s.mode.toLowerCase()}">${s.mode}</td>` +
    `<td class="num">${s.freq_khz.toFixed(1)}</td><td class="sk-call">${esc(s.call)}</td>` +
    `<td class="num">${s.snr_db}</td><td class="num">${s.speed}</td>` +
    `<td>${s.confirmed ? "✓" : "?"}</td></tr>`).join("") ||
    `<tr><td colspan="8" class="sk-empty">No spots yet: a spot needs a call after CQ, TEST, DE or TU.</td></tr>`;
}

function renderPanorama() {
  const cv = $("sk-pan"), wrap = cv.parentElement;
  const W = Math.max(300, wrap.clientWidth - 24), H = cv.height;
  if (cv.width !== W) cv.width = W;
  const g = cv.getContext("2d");
  g.fillStyle = "#070a10";
  g.fillRect(0, 0, W, H);
  const snap = sk.snap;
  if (!snap || !snap.lo_hz) { $("sk-pan-axis").innerHTML = ""; return; }
  const lo = snap.lo_hz, hi = snap.hi_hz, span = hi - lo;
  const X = f => (f - lo) / span * W;
  const top = 42, base = H - 4, dbMax = 40;
  const Y = db => base - Math.max(0, Math.min(dbMax, db)) / dbMax * (base - top);
  // ranges, then masked sub-bands
  const tint = { cw: "rgba(111, 168, 220, 0.07)", rtty: "rgba(180, 140, 255, 0.08)" };
  for (const m of ["cw", "rtty"]) {
    const r = snap[`${m}_range`];
    if (r) { g.fillStyle = tint[m]; g.fillRect(X(r[0]), 0, X(r[1]) - X(r[0]), H); }
  }
  g.fillStyle = "rgba(159, 224, 122, 0.12)";
  for (const [a, b] of snap.masks || []) g.fillRect(X(a), 0, Math.max(2, X(b) - X(a)), H);
  // each engine's spectrum over its own range
  const colors = { cw: "#38bdf8", rtty: "#b48cff" };
  for (const m of ["cw", "rtty"]) {
    const e = snap[m];
    if (!e?.spectrum?.length) continue;
    const n = e.spectrum.length, x0 = X(e.lo_hz), x1 = X(e.hi_hz);
    g.beginPath();
    g.moveTo(x0, base);
    e.spectrum.forEach((v, i) => g.lineTo(x0 + i / (n - 1) * (x1 - x0), Y(v)));
    g.lineTo(x1, base);
    g.closePath();
    g.fillStyle = m === "cw" ? "rgba(56, 189, 248, 0.22)" : "rgba(180, 140, 255, 0.22)";
    g.fill();
    g.strokeStyle = colors[m];
    g.lineWidth = 1;
    g.stroke();
  }
  // signals; calls above in up to three rows
  g.font = "11px ui-monospace, Consolas, monospace";
  g.textAlign = "center";
  const lastX = [-1e9, -1e9, -1e9];
  for (const s of signalsShown()) {
    const x = X(s.freq_khz * 1e3);
    g.strokeStyle = s.call ? "#7ee787" : (s.text ? "#e6a157" : "rgba(255,255,255,0.35)");
    g.beginPath(); g.moveTo(x, base); g.lineTo(x, Y(s.snr_db) - 2); g.stroke();
    if (s.call) {
      const w = g.measureText(s.call).width + 6;
      const row = lastX.findIndex(lx => x - lx > w);
      if (row < 0) continue;
      lastX[row] = x;
      g.fillStyle = "#7ee787";
      g.fillText(s.call, x, 11 + row * 12);
    }
  }
  const step = span > 100e3 ? 20e3 : 10e3, ticks = [];
  for (let f = Math.ceil(lo / step) * step; f <= hi; f += step) ticks.push(f);
  $("sk-pan-axis").innerHTML = ticks.map(f =>
    `<span style="left:${(X(f) / W * 100).toFixed(2)}%">${(f / 1e6).toFixed(3)}</span>`).join("");
  if (sk.hover != null) {
    const f = lo + sk.hover / W * span;
    g.fillStyle = "rgba(255,255,255,0.8)";
    g.textAlign = sk.hover > W - 80 ? "right" : "left";
    g.fillText(`${(f / 1e3).toFixed(2)} kHz`, sk.hover + (sk.hover > W - 80 ? -6 : 6), H - 8);
  }
}

// ── start-up ──────────────────────────────────────────────────────────────
function initControls() {
  $("sk-band").addEventListener("change", e => { sk.band = e.target.value; sk.snap = null; savePrefs(); render(); poll(); });
  $("sk-mode").addEventListener("change", e => { sk.prefs.mode = e.target.value; savePrefs(); render(); });
  $("sk-allbands").addEventListener("change", e => { sk.prefs.allBands = e.target.checked; savePrefs(); renderSpots(); });
  $("sk-unconfirmed").addEventListener("change", e => { sk.prefs.unconfirmed = e.target.checked; savePrefs(); renderSpots(); });
  $("sk-rbn").addEventListener("change", e => { sk.prefs.rbn = e.target.checked; savePrefs(); renderSpots(); });
  $("sk-clear").addEventListener("click", () => { sk.spots = []; renderSpots(); });
  const cv = $("sk-pan");
  cv.addEventListener("mousemove", e => { sk.hover = e.offsetX * cv.width / cv.clientWidth; renderPanorama(); });
  cv.addEventListener("mouseleave", () => { sk.hover = null; renderPanorama(); });
  window.addEventListener("resize", renderPanorama);
}

// If embedded as a dashboard tab, the shell says when it is shown or hidden.
window.addEventListener("message", ev => {
  if (ev.origin !== window.location.origin || !ev.data || ev.data.type !== "frc-tab") return;
  sk.active = ev.data.active === "skimmer-frame";
  if (sk.active) poll(); else clearTimeout(sk.timer);
});
document.addEventListener("visibilitychange", () => { if (!document.hidden) poll(); });
window.addEventListener("storage", ev => {
  if (ev.key !== "bandLabels") return;
  for (const o of $("sk-band").options) o.textContent = CONFIG.bandLabel(o.value);
  if (sk.snap) showRange(sk.snap);
});

document.addEventListener("DOMContentLoaded", async () => {
  loadPrefs();
  initControls();
  savePrefs();
  if (typeof CONFIG.loadStation === "function") {
    await CONFIG.loadStation();
    if (CONFIG.station.callsign && CONFIG.station.callsign !== "Unknown") {
      $("title").textContent = `CW and RTTY Skimmer — ${CONFIG.station.callsign}`;
    }
  }
  poll();
});
