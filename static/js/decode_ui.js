/**
 * HamSCI PSWS Contesting Dashboard - live CW / RTTY / FT8 / FT4 decoding in
 * the listen bar (decode_ui.js).  Requires decoders.js and ft8.js; fed by
 * listen.js.
 *
 * Auto picks the decoder from where you are listening: CW mode -> CW; USB on
 * a band's FT8 or FT4 dial (CONFIG.bands[].dials) -> FT8 / FT4; USB or LSB
 * inside a band's RTTY segment (CONFIG.bands[].segments.rtty) -> RTTY;
 * otherwise nothing (phone).  The choice can be forced, or turned off.
 * Decoding runs on the audio the browser already receives, so it adds
 * nothing on the station, and it keeps going with the volume at zero.
 */

const DecodeUI = (() => {
  const $ = id => document.getElementById(id);
  const MAX_TEXT = 20000;
  const S = { dec: null, kind: null, tune: null, pending: "", len: 0, lastStatus: 0, lastSlot: null, adjMs: 0 };
  // Calls heard recently, so FT8/FT4 hashed calls (<...>) show by name.
  const hashes = window.FT8 ? new FT8.CallHashes() : null;

  function pref(key, fallback) {
    try { return sessionStorage.getItem(`dec.${key}`) ?? fallback; } catch (e) { return fallback; }
  }
  function save(key, value) {
    try { sessionStorage.setItem(`dec.${key}`, value); } catch (e) { /* storage unavailable */ }
  }

  const near = (hz, mhz) => mhz != null && Math.abs(hz - Math.round(mhz * 1e6)) < 50;

  /** Which decoder Auto would use at this frequency/mode. */
  function autoKind({ freq, mode, bandName }) {
    if (mode === "cw") return "cw";
    const band = bandName ? CONFIG.band(bandName) : null;
    if (mode === "usb" && band?.dials) {
      if (near(freq, band.dials.FT8)) return "ft8";
      if (near(freq, band.dials.FT4)) return "ft4";
    }
    const rtty = band?.segments?.rtty;
    if ((mode === "usb" || mode === "lsb") && rtty) {
      // The signal sits ~1.5 kHz from the SSB dial (below it on LSB).
      const sig = (freq + (mode === "lsb" ? -1500 : 1500)) / 1e6;
      if (sig >= rtty[0] && sig <= rtty[1]) return "rtty";
    }
    return null;
  }

  function wantedKind() {
    const sel = $("dec-mode").value;
    if (sel === "off" || !S.tune) return null;
    return sel === "auto" ? autoKind(S.tune) : sel;
  }

  /** Append text or a node to the decode box, dropping the oldest past MAX_TEXT. */
  function append(item) {
    const el = $("dec-text");
    const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 4;
    if (typeof item === "string") {
      const last = el.lastChild;
      if (last && last.nodeType === Node.TEXT_NODE) last.data += item; else el.append(item);
      S.len += item.length;
    } else {
      el.append(item);
      S.len += item.textContent.length;
    }
    while (S.len > MAX_TEXT && el.firstChild) {
      const f = el.firstChild, n = f.textContent.length;
      if (f.nodeType === Node.TEXT_NODE && S.len - n < MAX_TEXT) {
        const cut = S.len - MAX_TEXT;
        f.data = f.data.slice(cut);
        S.len -= cut;
        break;
      }
      f.remove();
      S.len -= n;
    }
    if (atBottom) el.scrollTop = el.scrollHeight;
  }

  function write(text) {
    S.pending += text;
    // Batch DOM updates (CW/RTTY call back per character).
    if (S.flush) return;
    S.flush = requestAnimationFrame(() => {
      S.flush = null;
      append(S.pending);
      S.pending = "";
    });
  }

  /** Write out batched CW/RTTY text now (before a marker or header line). */
  function flushNow() {
    if (S.flush) { cancelAnimationFrame(S.flush); S.flush = null; }
    if (S.pending) { append(S.pending); S.pending = ""; }
  }

  function line(text, cls) {
    const span = document.createElement("span");
    if (cls) span.className = cls;
    span.textContent = text + "\n";
    append(span);
  }

  function status(text) {
    $("dec-status").textContent = text;
  }

  // ── FT8 / FT4 ──────────────────────────────────────────────────────────
  // Slots are timed against the server's clock, not this computer's (which
  // is often seconds off): best of a few /api/time round trips, NTP style.
  const clock = { offset: 0, rtt: null, at: 0, busy: false, failed: false };
  async function syncClock() {
    if (clock.busy || (clock.at && Date.now() - clock.at < 10 * 60e3)) return;
    clock.busy = true;
    try {
      let best = null;
      for (let i = 0; i < 5; i++) {
        const a = Date.now();
        const j = await (await fetch("/api/time", { cache: "no-store" })).json();
        const b = Date.now();
        if (typeof j.t_ms === "number" && (!best || b - a < best.rtt)) best = { rtt: b - a, off: j.t_ms - (a + b) / 2 };
      }
      if (best) {
        const moved = Math.abs(best.off - clock.offset) > 100;
        clock.offset = best.off; clock.rtt = best.rtt; clock.at = Date.now(); clock.failed = false;
        // A running FT8/FT4 receiver planned its slots on the old clock (and
        // may have learnt a "delay" that was really the clock): start over.
        if (moved && S.dec instanceof FT8.FtxReceiver) {
          S.adjMs = 0; S.dec.adjMs = 0; S.dec.adjusted = false; S.dec.reset();
        }
      }
    } catch (e) {
      clock.failed = true;                     // older server: use this computer's clock
    } finally {
      clock.busy = false;
    }
  }
  const now = () => Date.now() + clock.offset;

  const utc = ms => new Date(ms).toISOString().slice(11, 19);

  function showSlot(kind, msgs, slotStartMs) {
    S.lastSlot = { n: msgs.length, at: slotStartMs };
    if (!msgs.length) return;
    const t = utc(slotStartMs).replace(/:/g, "");
    const me = (CONFIG.station?.callsign || "").toUpperCase();
    const hasMe = m => me && me !== "UNKNOWN" && [m.to, m.de].some(c => c && c.replace(/[<>]/g, "").split("/").includes(me));
    for (const m of msgs) {
      const text = `${t} ${String(m.snr).padStart(3)} ${m.dt.toFixed(1).padStart(4)} ${String(Math.round(m.freq)).padStart(4)} ~  ${m.text}`;
      line(text, hasMe(m) ? "dec-me" : /^CQ\b/.test(m.text) ? "dec-cq" : "");
    }
  }

  function ftxStatus(kind, s) {
    const now = performance.now();
    if (now - S.lastStatus < 250) return;
    S.lastStatus = now;
    const name = kind.toUpperCase();
    S.adjMs = s.adjMs;
    const last = S.lastSlot ? ` · ${utc(S.lastSlot.at)}: ${S.lastSlot.n} decode${S.lastSlot.n === 1 ? "" : "s"}` : "";
    const adj = Math.abs(s.adjMs) >= 50 ? ` · timing ${s.adjMs > 0 ? "+" : ""}${(s.adjMs / 1000).toFixed(1)} s` : "";
    const clk = clock.failed ? " · using this computer's clock"
      : Math.abs(clock.offset) >= 500 ? ` · this computer's clock is ${Math.abs(clock.offset / 1000).toFixed(1)} s ${clock.offset > 0 ? "slow" : "fast"} (corrected)` : "";
    if (s.waiting) {
      status(`${name} · waiting for the next slot (${Math.ceil(-s.msInto / 1000)} s)${last}${adj}${clk}`);
    } else {
      const left = Math.max(0, (s.slotMs - s.msInto) / 1000);
      status(`${name} · slot ${utc(s.slotStartMs)} · decoding in ${left.toFixed(0)} s${last}${adj}${clk}`);
    }
  }

  /** (Re)build the decoder for the current tuning and settings. */
  function rebuild() {
    const kind = wantedKind();
    const sel = $("dec-mode").value;
    $("dec-rtty-opts").hidden = kind !== "rtty";
    $("dec-text").classList.toggle("dec-ftx", kind === "ft8" || kind === "ft4");
    S.lastSlot = null;
    if (!kind) {
      S.dec = null; S.kind = null;
      status(sel === "off" ? "off" : (S.tune ? "Auto: no decoder here (phone); pick CW, RTTY, FT8 or FT4 to force one" : ""));
      return;
    }
    if (kind === "cw") {
      // radiod's cwu preset puts the signal you clicked near 500 Hz.
      S.dec = new CwDecoder({
        lo: 250, hi: 1000,
        onText: write,
        onStatus: s => status(`CW · tone ${s.tone} Hz · ${s.wpm} WPM${s.snrDb ? ` · ${s.snrDb} dB` : ""}${s.locked ? " · locked" : ""}`),
      });
      status("CW · looking for a signal…");
    } else if (kind === "rtty") {
      const usb = S.tune.mode !== "lsb";
      S.dec = new RttyDecoder({
        baud: Number($("dec-baud").value), shift: Number($("dec-shift").value),
        markHigh: usb !== $("dec-reverse").checked,
        onText: write,
        onStatus: s => status(`RTTY ${s.baud} Bd / ${s.shift} Hz · mark ${s.mark} space ${s.space} Hz · ${s.good} ok, ${s.errors} errors`),
      });
      status(`RTTY ${$("dec-baud").value} Bd / ${$("dec-shift").value} Hz · looking for a mark/space pair…`);
    } else {
      if (!window.FT8) { S.dec = null; status("FT8/FT4 decoder not loaded"); return; }
      line(`${kind.toUpperCase()}  UTC    dB   DT Freq    Message`, "dec-hdr");
      syncClock();
      S.dec = new FT8.FtxReceiver({
        protocol: kind,
        adjMs: S.adjMs,                        // audio delay learnt on the last frequency
        maxFreq: 3200,                         // the USB passband ends near 2.9 kHz
        hashes,
        onDecode: (msgs, slotStartMs) => showSlot(kind, msgs, slotStartMs),
        onStatus: s => ftxStatus(kind, s),
      });
      status(`${kind.toUpperCase()} · syncing to UTC slots…`);
    }
    S.kind = kind;
  }

  // ── called by listen.js ────────────────────────────────────────────────
  function feed(samples) {
    if (S.dec) S.dec.feed(samples, now());     // (CW/RTTY ignore the time)
  }

  function retuned(tune) {
    const changed = !S.tune || tune.freq !== S.tune.freq || tune.mode !== S.tune.mode;
    S.tune = tune;
    if (!changed) return;
    flushNow();
    if ($("dec-text").textContent) {
      append(`\n— ${(tune.freq / 1e6).toFixed(tune.mode === "cw" ? 5 : 4)} MHz ${tune.mode.toUpperCase()} —\n`);
    }
    rebuild();
  }

  function stopped() {
    S.tune = null;
    S.dec = null;
    status("");
  }

  function init() {
    if (!$("dec-mode")) return;
    if (window.FT8) syncClock();             // before anyone listens, so the first slot is right
    $("dec-mode").value = pref("mode", "auto");
    if (!$("dec-mode").value) $("dec-mode").value = "auto";
    $("dec-baud").value = pref("baud", "45.45");
    $("dec-shift").value = pref("shift", "170");
    $("dec-reverse").checked = pref("reverse", "0") === "1";
    for (const id of ["dec-mode", "dec-baud", "dec-shift", "dec-reverse"]) {
      $(id).addEventListener("change", () => {
        const el = $(id);
        save(id.slice(4), el.type === "checkbox" ? (el.checked ? "1" : "0") : el.value);
        rebuild();
      });
    }
    $("dec-clear").addEventListener("click", () => { $("dec-text").textContent = ""; S.pending = ""; S.len = 0; });
    $("dec-copy").addEventListener("click", () => {
      const t = $("dec-text");
      const range = document.createRange();
      range.selectNodeContents(t);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      try { document.execCommand("copy"); } catch (e) { /* the text stays selected */ }
    });
  }

  document.addEventListener("DOMContentLoaded", init);
  return { feed, retuned, stopped, autoKind, clock };
})();

window.DecodeUI = DecodeUI;
