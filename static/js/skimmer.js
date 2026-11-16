/**
 * HamSCI PSWS Contesting Dashboard - CW Skimmer tab (skimmer.js)
 *
 * Shows the station's CW skimmer (sigmond frc-dashboard, skimmer.py): the
 * spectrum of the skimmed range with every decoded signal marked, each
 * signal's decoded text, and the spots it made (RBN format on request).
 * Polls /api/skimmer while the tab is visible; the station stops the
 * skimmer (and its radiod channel) a couple of minutes after nobody asks.
 *
 * The band is the station's, not this browser's: changing it moves the
 * skimmer for everyone watching.
 */

const SK = {
  POLL_MS: 1500,
  MAX_SPOTS: 400,
  BANDS: ["160m", "80m", "40m", "20m", "15m", "10m"],
};

const sk = {
  seq: 0,
  spots: [],
  snap: null,
  timer: null,
  active: true,
  busy: false,
  prefs: { unconfirmed: true, rbn: false },
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
  $("sk-unconfirmed").checked = sk.prefs.unconfirmed;
  $("sk-rbn").checked = sk.prefs.rbn;
}

function savePrefs() {
  try {
    sessionStorage.setItem("sk.unconfirmed", sk.prefs.unconfirmed ? "1" : "0");
    sessionStorage.setItem("sk.rbn", sk.prefs.rbn ? "1" : "0");
  } catch (e) { /* storage unavailable */ }
  ViewState.publish("skimmer", { sku: sk.prefs.unconfirmed ? "1" : "0", skrbn: sk.prefs.rbn ? "1" : "0" },
                    { sku: "1", skrbn: "0" });
}

// ── polling ───────────────────────────────────────────────────────────────
async function poll() {
  clearTimeout(sk.timer);
  if (!sk.active || document.hidden) return;
  try {
    const res = await fetch(`/api/skimmer?since=${sk.seq}`, { cache: "no-store" });
    const data = await res.json();
    if (data.running) {
      if (data.seq < sk.seq) sk.seq = 0;        // the station restarted: take everything again
      for (const s of data.spots || []) sk.spots.push(s);
      if (data.spots?.length) sk.seq = Math.max(sk.seq, ...data.spots.map(s => s.seq));
      if (sk.spots.length > SK.MAX_SPOTS) sk.spots = sk.spots.slice(-SK.MAX_SPOTS);
      sk.snap = data;
      const st = data.stats || {};
      const ready = data.ready !== false;
      setStatus(ready ? "connected" : "checking", ready ? "Running" : "Retuning…");
      $("sk-stats").textContent = `${data.signals?.length ?? 0} signals · ${sk.spots.length} spots` +
        (st.iq_rate ? ` · IQ ${(st.iq_rate / 1000).toFixed(1)} kS/s` : "") +
        (st.cpu_pct != null ? ` · CPU ${st.cpu_pct}%` : "") +
        (st.known_calls ? ` · ${st.known_calls.toLocaleString()} known calls` : "");
      showMessage("");
    } else if (data.starting) {
      setStatus("checking", "Starting…");
      showMessage("Starting the skimmer (one radiod IQ channel on the band's CW segment)…");
    } else {
      setStatus("disconnected", "Unavailable");
      showMessage(data.error || "The skimmer is not available.");
    }
    if (data.band) showBand(data);
    render();
  } catch (e) {
    setStatus("disconnected", "Disconnected");
    showMessage(`Cannot reach the dashboard (${e.message}).`);
  }
  sk.timer = setTimeout(poll, SK.POLL_MS);
}

function showBand(data) {
  const sel = $("sk-band");
  if (!sk.busy && document.activeElement !== sel) sel.value = data.band;
  const lo = (data.lo_hz / 1e6).toFixed(3), hi = (data.hi_hz / 1e6).toFixed(3);
  const masks = (data.masks || []).map(m => `${(m[0] / 1e6).toFixed(4)}–${(m[1] / 1e6).toFixed(4)}`).join(", ");
  $("sk-range").textContent = `Skimming ${CONFIG.bandLabel(data.band)}: ${lo}–${hi} MHz` +
    (masks ? ` (FT8/FT4/WSPR sub-bands ignored: ${masks} MHz)` : "") + ` · spotter ${data.spotter}-#`;
  $("sk-feed-note").textContent = data.telnet
    ? `Confirmed spots are also served on telnet ${data.telnet.bind}:${data.telnet.port} (${data.telnet.clients} connected).`
    : "RBN-format telnet feed: off (skimmer.telnet_port). Nothing is uploaded.";
}

async function changeBand(band) {
  sk.busy = true;
  setStatus("checking", `Moving to ${band}…`);
  try {
    const res = await fetch("/api/skimmer/band", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ band }),
    });
    if (!res.ok) throw new Error((await res.json()).error || res.statusText);
    sk.snap = null;
    render();
  } catch (e) {
    showMessage(`Could not change band: ${e.message}`);
  } finally {
    sk.busy = false;
    poll();
  }
}

// ── rendering ─────────────────────────────────────────────────────────────
function render() {
  renderPanorama();
  renderSignals();
  renderSpots();
}

function renderSignals() {
  const sigs = (sk.snap?.signals || []).filter(s => s.text || s.call);
  $("sk-sig-count").textContent = sk.snap ? `(${sigs.length} with text, ${sk.snap.signals.length} tracked)` : "";
  $("sk-signals").tBodies[0].innerHTML = sigs.map(s =>
    `<tr${s.call ? ' class="sk-has-call"' : ""}><td class="num">${s.freq_khz.toFixed(2)}</td>` +
    `<td class="num">${s.snr_db.toFixed(0)}</td><td class="num">${s.wpm ?? ""}</td>` +
    `<td class="sk-call">${esc(s.call || "")}</td><td class="sk-text">${esc(s.text)}</td></tr>`).join("") ||
    `<tr><td colspan="5" class="sk-empty">No decoded text yet.</td></tr>`;
}

function renderSpots() {
  const shown = sk.spots.filter(s => sk.prefs.unconfirmed || s.confirmed).slice().reverse();
  $("sk-spot-count").textContent = `(${shown.length})`;
  $("sk-spots").hidden = sk.prefs.rbn;
  $("sk-rbn-text").hidden = !sk.prefs.rbn;
  if (sk.prefs.rbn) {
    $("sk-rbn-text").textContent = shown.map(s => (s.confirmed ? "  " : "? ") + s.rbn).join("\n") || "No spots yet.";
    return;
  }
  $("sk-spots").tBodies[0].innerHTML = shown.map(s =>
    `<tr class="${s.confirmed ? "" : "sk-unconf"}" title="${esc(s.reason)}"><td>${utcHHMM(s.t)}</td>` +
    `<td class="num">${s.freq_khz.toFixed(1)}</td><td class="sk-call">${esc(s.call)}</td>` +
    `<td class="num">${s.snr_db}</td><td class="num">${s.wpm}</td>` +
    `<td>${s.confirmed ? "✓" : "?"}</td></tr>`).join("") ||
    `<tr><td colspan="6" class="sk-empty">No spots yet: a spot needs a call after CQ, TEST, DE or TU.</td></tr>`;
}

function renderPanorama() {
  const cv = $("sk-pan"), wrap = cv.parentElement;
  const W = Math.max(300, wrap.clientWidth), H = cv.height;
  if (cv.width !== W) cv.width = W;
  const g = cv.getContext("2d");
  g.fillStyle = "#070a10";
  g.fillRect(0, 0, W, H);
  const snap = sk.snap, sp = snap?.spectrum;
  if (!snap || !sp || !sp.db?.length || !sp.lo_hz) { $("sk-pan-axis").innerHTML = ""; return; }
  const lo = sp.lo_hz, hi = sp.hi_hz, span = hi - lo;
  const X = f => (f - lo) / span * W;
  // masked sub-bands
  g.fillStyle = "rgba(159, 224, 122, 0.10)";
  for (const [a, b] of snap.masks || []) g.fillRect(X(a), 0, Math.max(2, X(b) - X(a)), H);
  // spectrum: dB over the noise floor, 0..40 dB
  const top = 42, base = H - 4, dbMax = 40;           // room above for three rows of calls
  const Y = db => base - Math.max(0, Math.min(dbMax, db)) / dbMax * (base - top);
  g.beginPath();
  g.moveTo(0, base);
  sp.db.forEach((v, i) => g.lineTo(i / (sp.db.length - 1) * W, Y(v)));
  g.lineTo(W, base);
  g.closePath();
  g.fillStyle = "rgba(56, 189, 248, 0.25)";
  g.fill();
  g.strokeStyle = "#38bdf8";
  g.lineWidth = 1;
  g.stroke();
  // signals: a tick each; calls above, staggered to avoid overlaps
  g.font = "11px ui-monospace, Consolas, monospace";
  g.textAlign = "center";
  const lastX = [-1e9, -1e9, -1e9];
  for (const s of snap.signals || []) {
    const x = X(s.freq_khz * 1e3);
    g.strokeStyle = s.call ? "#7ee787" : (s.text ? "#e6a157" : "rgba(255,255,255,0.35)");
    g.beginPath(); g.moveTo(x, base); g.lineTo(x, Y(s.snr_db) - 2); g.stroke();
    if (s.call) {
      const w = g.measureText(s.call).width + 6;
      let row = lastX.findIndex(lx => x - lx > w);
      if (row < 0) continue;
      lastX[row] = x;
      g.fillStyle = "#7ee787";
      g.fillText(s.call, x, 11 + row * 12);
    }
  }
  // axis
  const ticks = [];
  const step = span > 60e3 ? 10e3 : 5e3;
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
  const sel = $("sk-band");
  sel.innerHTML = SK.BANDS.map(b => `<option value="${b}">${CONFIG.bandLabel(b)}</option>`).join("");
  sel.addEventListener("change", () => changeBand(sel.value));
  $("sk-unconfirmed").addEventListener("change", e => { sk.prefs.unconfirmed = e.target.checked; savePrefs(); renderSpots(); });
  $("sk-rbn").addEventListener("change", e => { sk.prefs.rbn = e.target.checked; savePrefs(); renderSpots(); });
  $("sk-clear").addEventListener("click", () => { sk.spots = []; renderSpots(); });
  const cv = $("sk-pan");
  cv.addEventListener("mousemove", e => { sk.hover = e.offsetX * cv.width / cv.clientWidth; renderPanorama(); });
  cv.addEventListener("mouseleave", () => { sk.hover = null; renderPanorama(); });
  window.addEventListener("resize", renderPanorama);
}

// Parent dashboard (both.html) tells us when our tab is shown or hidden.
window.addEventListener("message", ev => {
  if (ev.origin !== window.location.origin || !ev.data || ev.data.type !== "frc-tab") return;
  sk.active = ev.data.active === "skimmer-frame";
  if (sk.active) poll(); else clearTimeout(sk.timer);
});
document.addEventListener("visibilitychange", () => { if (!document.hidden) poll(); });
window.addEventListener("storage", ev => {
  if (ev.key !== "bandLabels") return;
  const sel = $("sk-band"), v = sel.value;
  sel.innerHTML = SK.BANDS.map(b => `<option value="${b}">${CONFIG.bandLabel(b)}</option>`).join("");
  sel.value = v;
  if (sk.snap) showBand(sk.snap);
});

document.addEventListener("DOMContentLoaded", async () => {
  loadPrefs();
  initControls();
  savePrefs();
  if (typeof CONFIG.loadStation === "function") {
    await CONFIG.loadStation();
    if (CONFIG.station.callsign && CONFIG.station.callsign !== "Unknown") {
      $("title").textContent = `CW Skimmer — ${CONFIG.station.callsign}`;
    }
  }
  poll();
});
