/**
 * HamSCI PSWS Contesting Dashboard - live CW / RTTY decoding in the listen bar
 * (decode_ui.js).  Requires decoders.js; fed by listen.js.
 *
 * Auto picks the decoder from where you are listening: CW mode -> CW; USB or
 * LSB inside a band's RTTY segment (CONFIG.bands[].segments.rtty) -> RTTY;
 * otherwise nothing (phone).  The choice can be forced to CW, RTTY or Off.
 * Decoding runs on the audio the browser already receives, so it adds
 * nothing on the station, and it keeps going with the volume at zero.
 */

const DecodeUI = (() => {
  const $ = id => document.getElementById(id);
  const MAX_TEXT = 6000;
  const S = { dec: null, kind: null, tune: null, pending: "" };

  function pref(key, fallback) {
    try { return sessionStorage.getItem(`dec.${key}`) ?? fallback; } catch (e) { return fallback; }
  }
  function save(key, value) {
    try { sessionStorage.setItem(`dec.${key}`, value); } catch (e) { /* storage unavailable */ }
  }

  /** Which decoder Auto would use at this frequency/mode. */
  function autoKind({ freq, mode, bandName }) {
    if (mode === "cw") return "cw";
    const rtty = bandName && CONFIG.band(bandName).segments?.rtty;
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

  function write(text) {
    const el = $("dec-text");
    S.pending += text;
    // Batch DOM updates (decoders call back per character).
    if (S.flush) return;
    S.flush = requestAnimationFrame(() => {
      S.flush = null;
      const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 4;
      el.textContent = (el.textContent + S.pending).slice(-MAX_TEXT);
      S.pending = "";
      if (atBottom) el.scrollTop = el.scrollHeight;
    });
  }

  function status(text) {
    $("dec-status").textContent = text;
  }

  /** (Re)build the decoder for the current tuning and settings. */
  function rebuild() {
    const kind = wantedKind();
    const sel = $("dec-mode").value;
    $("dec-rtty-opts").hidden = kind !== "rtty";
    if (!kind) {
      S.dec = null; S.kind = null;
      status(sel === "off" ? "off" : (S.tune ? "Auto: no decoder here (phone); pick CW or RTTY to force one" : ""));
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
    } else {
      const usb = S.tune.mode !== "lsb";
      S.dec = new RttyDecoder({
        baud: Number($("dec-baud").value), shift: Number($("dec-shift").value),
        markHigh: usb !== $("dec-reverse").checked,
        onText: write,
        onStatus: s => status(`RTTY ${s.baud} Bd / ${s.shift} Hz · mark ${s.mark} space ${s.space} Hz · ${s.good} ok, ${s.errors} errors`),
      });
      status(`RTTY ${$("dec-baud").value} Bd / ${$("dec-shift").value} Hz · looking for a mark/space pair…`);
    }
    S.kind = kind;
  }

  // ── called by listen.js ────────────────────────────────────────────────
  function feed(samples) {
    if (S.dec) S.dec.feed(samples);
  }

  function retuned(tune) {
    const changed = !S.tune || tune.freq !== S.tune.freq || tune.mode !== S.tune.mode;
    S.tune = tune;
    if (!changed) return;
    if ($("dec-text").textContent || S.pending) {
      write(`\n— ${(tune.freq / 1e6).toFixed(tune.mode === "cw" ? 5 : 4)} MHz ${tune.mode.toUpperCase()} —\n`);
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
    $("dec-mode").value = pref("mode", "auto");
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
    $("dec-clear").addEventListener("click", () => { $("dec-text").textContent = ""; S.pending = ""; });
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
  return { feed, retuned, stopped, autoKind };
})();

window.DecodeUI = DecodeUI;
