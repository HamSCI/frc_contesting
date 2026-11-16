// spacewx.js — space-weather strip in the dashboard header (#73), with this
// station's own PSWS measurements (#74: hf-timestd Doppler, spot-derived
// indicators, band noise floors), which need no internet.
// Loaded by both.html, so it shows on every tab.  Data comes only from this
// server (/api/spacewx), which fetches and caches NOAA SWPC products; the
// browser never contacts SWPC.  Optional context: offline, the strip says
// "unavailable" and every value shows its age.

const SpaceWx = (() => {
  const POLL_MS = 60 * 1000;
  const el = id => document.getElementById(id);

  const age = t => {
    if (!t) return "";
    const s = Math.max(0, Date.now() / 1000 - t);
    return s < 90 ? `${Math.round(s)} s` : s < 5400 ? `${Math.round(s / 60)} min` : `${(s / 3600).toFixed(1)} h`;
  };
  const stale = (t, maxSec) => !t || Date.now() / 1000 - t > maxSec;
  const fmt = (v, d = 0) => (v === null || v === undefined ? "—" : Number(v).toFixed(d));

  function xrayLevel(cls) {
    const c = (cls || "A")[0];
    return c === "X" ? "swx-bad" : c === "M" ? "swx-warn" : c === "C" ? "swx-note" : "";
  }

  // log-flux sparkline (A1 .. X1) for the 6-h GOES series
  function xraySpark(series, w = 60, h = 16) {
    if (!series || series.length < 2) return "";
    const lo = Math.log10(1e-8), hi = Math.log10(1e-4);
    const t0 = series[0][0], t1 = series[series.length - 1][0];
    const pts = series.filter(p => p[1] > 0).map(([t, f]) =>
      `${((t - t0) / Math.max(1, t1 - t0) * w).toFixed(1)},${(h - (Math.log10(f) - lo) / (hi - lo) * h).toFixed(1)}`);
    const lines = [1e-6, 1e-5].map(f => { const y = (h - (Math.log10(f) - lo) / (hi - lo) * h).toFixed(1); return `<line x1="0" x2="${w}" y1="${y}" y2="${y}" class="swx-grid"/>`; }).join("");
    return `<svg class="swx-spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true">${lines}<polyline points="${pts.join(" ")}"/></svg>`;
  }

  function item(label, value, title, cls = "") {
    return `<span class="swx-item ${cls}" title="${title}"><span class="swx-label">${label}</span> ${value}</span>`;
  }

  let last = null, local = null;

  function render(d) {
    last = d;
    const strip = el("swx");
    if (!strip) return;
    const haveLocal = local && ["timestd", "spots", "noise"].some(k => local[k]?.available);
    if ((!d || d.enabled === false) && !haveLocal) { strip.hidden = true; return; }
    strip.hidden = false;
    d = d && d.enabled !== false ? d : { enabled: false };
    const parts = [];
    if (d.xray) {
      const x = d.xray, st = stale(x.time, 900);
      parts.push(item("X-ray", `<b>${x.class || "—"}</b>${xraySpark(x.spark)}`,
        `GOES 0.1–0.8 nm X-ray flux; 6-h peak ${x.peak6h || "—"}; ${age(x.time)} old${st ? " (stale)" : ""}`,
        `${xrayLevel(x.class)}${st ? " swx-stale" : ""}`));
    }
    if (d.wind) {
      const w = d.wind;
      parts.push(item("Wind", `<b>${fmt(w.speed)}</b> km/s · ${fmt(w.density, 1)} p/cm³`,
        `Solar wind speed (${age(w.time)} old) and density (${age(w.dtime)} old)`,
        `${(w.speed || 0) >= 600 ? "swx-warn" : ""}${stale(w.time, 900) ? " swx-stale" : ""}`));
    }
    if (d.imf) {
      const m = d.imf, south = (m.bz ?? 0) <= -5;
      parts.push(item("IMF", `Bt <b>${fmt(m.bt)}</b> · Bz <b class="${south ? "swx-south" : ""}">${fmt(m.bz, 1)}</b> nT`,
        `Interplanetary magnetic field; sustained southward Bz drives geomagnetic activity, aurora and polar-path absorption. ${age(m.time)} old`,
        stale(m.time, 900) ? "swx-stale" : ""));
    }
    if (d.kp) {
      const k = d.kp, kp = k.est ?? k.kp3h;
      parts.push(item("Kp", `<b>${fmt(kp, 1)}</b>${k.g ? ` (G${k.g})` : ""}`,
        `Planetary K index: estimated now ${fmt(k.est, 2)} (${age(k.time)} old), last 3-h value ${fmt(k.kp3h, 2)}`,
        `${k.g >= 3 ? "swx-bad" : k.g >= 1 ? "swx-warn" : (kp || 0) >= 4 ? "swx-note" : ""}${stale(k.time || k.time3h, 3 * 3600) ? " swx-stale" : ""}`));
    }
    if (d.f107) {
      parts.push(item("SFI", `<b>${fmt(d.f107.flux)}</b>`, `F10.7 solar flux (sfu), ${age(d.f107.time)} old: higher = more ionisation, higher MUF`,
        stale(d.f107.time, 2 * 86400) ? "swx-stale" : ""));
    }
    if (d.protons) {
      const p = d.protons;
      parts.push(item("p⁺", `${fmt(p.p10, p.p10 < 10 ? 2 : 0)} pfu${p.s ? ` (S${p.s})` : ""}`,
        `GOES ≥10 MeV protons; S1+ means polar cap absorption on polar paths. ${age(p.time)} old`,
        `${p.s ? "swx-warn" : ""}${stale(p.time, 1800) ? " swx-stale" : ""}`));
    }
    if (d.scales) {
      const sc = ["R", "S", "G"].map(k => {
        const v = d.scales[k].scale;
        return `<span class="swx-scale ${v >= 3 ? "swx-bad" : v >= 1 ? "swx-warn" : ""}" title="NOAA ${k}: ${d.scales[k].text}">${k}${v}</span>`;
      }).join("");
      parts.push(`<span class="swx-item" title="NOAA scales now: R radio blackout, S radiation storm, G geomagnetic storm">${sc}</span>`);
    }
    parts.push(...localSummary());
    if (!parts.length && d.enabled !== false) {
      // Nothing cached yet: the server has just started fetching (retry
      // soon), or every fetch failed (no internet at the server).
      const failed = Object.keys(d.errors || {}).length;
      parts.push(`<span class="swx-item swx-stale">Space weather: ${failed ? "unavailable (no internet at the server?)" : "loading…"}</span>`);
      if (!failed) setTimeout(poll, 5000);
    }
    // Event banner: a flare in progress explains a sudden dayside fadeout.
    const flare = d.xray && /^[MX]/.test(d.xray.class || "") && !stale(d.xray.time, 900);
    let banner = "";
    if (flare) banner = `<span class="swx-banner swx-bad">${d.xray.class} flare in progress: expect HF fadeout on the sunlit side</span>`;
    else if (d.alerts && d.alerts.length) {
      const a = d.alerts[0];
      banner = `<span class="swx-banner" title="${a.headline} (${age(a.time)} ago)">${a.headline} · ${age(a.time)} ago</span>`;
    }
    el("swx-summary").innerHTML = parts.join("") + banner;
    strip.classList.toggle("swx-flare", flare);
    renderDetails(d);
  }

  // ── Local PSWS (#74) ──────────────────────────────────────────────────
  function localSummary() {
    const out = [];
    const t = local?.timestd;
    if (t?.available) {
      const dist = t.series.filter(x => x.disturbed);
      out.push(item("WWV Doppler", dist.length
        ? `<b class="swx-warn">disturbed</b> (${[...new Set(dist.map(x => x.freq_mhz))].join(", ")} MHz)`
        : "<b>quiet</b>",
        "This station's hf-timestd measurement of the WWV/WWVH carriers: Doppler swings show ionospheric motion (sunrise/sunset, TIDs, flare onsets) within seconds. Click for plots.",
        "swx-local"));
    }
    const sp = local?.spots;
    if (sp?.available) {
      let best = null;
      const now = Date.now() / 1000;
      for (const [band, bins] of Object.entries(sp.bands)) {
        const b = bins[bins.length - 1];
        if (b && now - b[0] < 1800 && (!best || CONFIG.band(band).lo > CONFIG.band(best[0]).lo)) best = [band, b];
      }
      if (best) out.push(item("Highest band", `<b>${CONFIG.bandShort(best[0])}</b> · ${best[1][2].toLocaleString()} km`,
        "Highest-frequency band with spots at this station in the last 15-30 min, and its farthest spot (a crude open-band / skip indicator)", "swx-local"));
    }
    return out;
  }

  function lineSvg(seriesList, w, h, { sym = true, fmtY = v => v } = {}) {
    const all = seriesList.flatMap(s => s.pts);
    if (all.length < 2) return "—";
    const t0 = Math.min(...all.map(p => p[0])), t1 = Math.max(...all.map(p => p[0]));
    let lo = Math.min(...all.map(p => p[1])), hi = Math.max(...all.map(p => p[1]));
    if (sym) { const m = Math.max(Math.abs(lo), Math.abs(hi), 1e-3); lo = -m; hi = m; }
    if (hi === lo) hi = lo + 1;
    const X = t => ((t - t0) / Math.max(1, t1 - t0) * w).toFixed(1);
    const Y = v => (h - (v - lo) / (hi - lo) * h).toFixed(1);
    const zero = sym ? `<line x1="0" x2="${w}" y1="${Y(0)}" y2="${Y(0)}" class="swx-grid"/>` : "";
    return `<svg width="${w}" height="${h}" class="swx-lines">${zero}` +
      seriesList.map(s => `<polyline points="${s.pts.map(p => `${X(p[0])},${Y(p[1])}`).join(" ")}" style="stroke:${s.color}"` +
        `${s.dash ? ' stroke-dasharray="3 2"' : ""}><title>${s.label}</title></polyline>`).join("") +
      `<text x="2" y="9" class="swx-axis">${fmtY(hi)}</text><text x="2" y="${h - 2}" class="swx-axis">${fmtY(lo)}</text></svg>`;
  }

  const FREQ_COLORS = { 2.5: "#991F24", 3.33: "#d46a19", 5: "#EE8918", 7.85: "#e0c000", 10: "#21A2DA",
                        14.67: "#5AA429", 15: "#008B38", 20: "#8B1E89", 25: "#BB4A99" };

  function renderLocal() {
    const box = el("swx-local");
    if (!box) return;
    const parts = [];
    const t = local?.timestd;
    if (t?.available) {
      const ser = t.series.map(x => ({ pts: x.series, color: FREQ_COLORS[x.freq_mhz] || "#aaa", dash: x.station !== "WWV",
                                       label: `${x.station} ${x.freq_mhz} MHz` }));
      const rows = t.series.map(x => `<li><span class="swx-dot" style="background:${FREQ_COLORS[x.freq_mhz] || "#aaa"}"></span>` +
        `${x.station} ${x.freq_mhz} MHz: ${x.doppler_hz >= 0 ? "+" : ""}${x.doppler_hz.toFixed(3)} Hz · SNR ${x.snr_db ?? "—"} dB` +
        `${x.disturbed ? ' <b class="swx-warn">disturbed</b>' : ""}</li>`).join("");
      parts.push(`<div class="swx-panel"><div class="swx-panel-title">WWV/WWVH Doppler, last ${t.hours} h (hf-timestd; WWVH dashed)</div>` +
        `${lineSvg(ser, 300, 70, { fmtY: v => `${v.toFixed(2)} Hz` })}<ul class="swx-list">${rows}</ul></div>`);
    }
    const sp = local?.spots;
    if (sp?.available) {
      const bands = CONFIG.sortBands(Object.keys(sp.bands)).filter(b => CONFIG.band(b).hf);
      const ser = bands.map(b => ({ pts: sp.bands[b].map(([tt, , km]) => [tt, km]), color: CONFIG.bandColor(b), label: CONFIG.bandShort(b) }));
      parts.push(`<div class="swx-panel"><div class="swx-panel-title">Farthest spot per band, last ${sp.hours} h (km, per 15 min)</div>` +
        `${lineSvg(ser, 300, 70, { sym: false, fmtY: v => `${Math.round(v / 1000)}k` })}<div class="swx-legend">` +
        bands.map(b => `<span><span class="swx-dot" style="background:${CONFIG.bandColor(b)}"></span>${CONFIG.bandShort(b)}</span>`).join("") +
        `</div></div>`);
    }
    const n = local?.noise;
    if (n?.available) {
      const bands = CONFIG.sortBands(Object.keys(n.bands)).filter(b => n.bands[b].length);
      const ser = bands.map(b => ({ pts: n.bands[b], color: CONFIG.bandColor(b), label: CONFIG.bandShort(b) }));
      parts.push(`<div class="swx-panel"><div class="swx-panel-title">Band noise floor (dB, 1-min medians while the Waterfall runs)</div>` +
        `${lineSvg(ser, 300, 70, { sym: false, fmtY: v => `${v.toFixed(0)}` })}</div>`);
    }
    box.innerHTML = parts.length
      ? `<div class="swx-local-title">Local PSWS: this station's own measurements (no internet needed)</div>${parts.join("")}`
      : "";
    box.hidden = !parts.length || !el("swx").classList.contains("open");
  }

  async function pollLocal() {
    try {
      local = await (await fetch("/api/psws", { cache: "no-store" })).json();
    } catch (e) {
      local = null;
    }
    renderLocal();
    render(last);
  }


  function renderDetails(d) {
    const box = el("swx-details");
    if (!box) return;
    const kpBars = (d.kp?.bars || []).map(([t, v]) =>
      `<span class="swx-kpbar ${v >= 5 ? "swx-bad" : v >= 4 ? "swx-warn" : ""}" style="height:${Math.max(2, v / 9 * 40)}px" title="${new Date(t * 1000).toISOString().slice(5, 16).replace("T", " ")} UTC: Kp ${v}"></span>`).join("");
    const bz = d.imf?.bz24h || [];
    let bzSvg = "";
    if (bz.length > 1) {
      const w = 240, h = 40, t0 = bz[0][0], t1 = bz[bz.length - 1][0];
      const y = v => (h / 2 - Math.max(-20, Math.min(20, v)) / 20 * (h / 2)).toFixed(1);
      bzSvg = `<svg width="${w}" height="${h}" class="swx-bz"><line x1="0" x2="${w}" y1="${h / 2}" y2="${h / 2}" class="swx-grid"/>` +
        `<polyline points="${bz.map(([t, v]) => `${((t - t0) / Math.max(1, t1 - t0) * w).toFixed(1)},${y(v)}`).join(" ")}"/></svg>`;
    }
    const alerts = (d.alerts || []).map(a => `<li>${new Date(a.time * 1000).toISOString().slice(11, 16)} UTC · ${a.headline}</li>`).join("");
    box.innerHTML =
      `<div class="swx-panel"><div class="swx-panel-title">GOES X-ray, 6 h (log; lines at C1, M1)</div>${xraySpark(d.xray?.spark, 240, 40)}</div>` +
      `<div class="swx-panel"><div class="swx-panel-title">Kp, last 24 h (3-h values)</div><div class="swx-kp">${kpBars || "—"}</div></div>` +
      `<div class="swx-panel"><div class="swx-panel-title">IMF Bz, ±20 nT (kept by this server)</div>${bzSvg || "—"}</div>` +
      `<div class="swx-panel swx-alerts"><div class="swx-panel-title">SWPC alerts, last 24 h</div><ul>${alerts || "<li>none</li>"}</ul></div>` +
      `<p class="swx-src">Source: NOAA SWPC, fetched by this dashboard's server. Optional: without internet these values go stale; nothing else is affected.</p>`;
    if (d.enabled === false) box.innerHTML = "";
  }

  async function poll() {
    try {
      const res = await fetch("/api/spacewx", { cache: "no-store" });
      render(await res.json());
    } catch (e) {
      render({ enabled: true, errors: { server: String(e) } });
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    const strip = el("swx");
    if (!strip) return;
    el("swx-summary").addEventListener("click", () => {
      const open = strip.classList.toggle("open");
      el("swx-details").hidden = !open || !el("swx-details").innerHTML;
      el("swx-local").hidden = !open || !el("swx-local").innerHTML;
    });
    poll();
    setInterval(poll, POLL_MS);
    pollLocal();
    setInterval(pollLocal, 2 * POLL_MS);
  });
  return { poll };
})();
