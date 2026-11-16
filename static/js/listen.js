/**
 * HamSCI PSWS Contesting Dashboard - click-to-listen for the Waterfall tab (listen.js)
 *
 * Clicking a waterfall asks the frc-dashboard service for a radiod audio
 * channel at that frequency (POST /api/listen/open, then /tune on later
 * clicks) and plays its audio: GET /api/listen/audio streams signed 16-bit
 * mono PCM at 12 kHz, which is resampled to the sound card here.
 *
 * Playback uses a ScriptProcessorNode rather than an AudioWorklet because
 * AudioWorklet only exists in secure contexts (HTTPS / localhost) and the
 * dashboard is normally served over plain HTTP on the station LAN.
 *
 * Listening keeps playing when you switch to the Map or Table tab; Stop (or
 * closing the page) releases the radiod channel.
 */

const Listen = (() => {
  const RATE = 12000;              // stream sample rate (Hz)
  const PREBUFFER_SEC = 0.4;       // jitter buffer before (re)starting playback
  const MAX_BUFFER_SEC = 2.0;      // drop audio beyond this to bound latency
  const KEEPALIVE_MS = 5000;

  // Where each mode's audio sits relative to the dial, for the overlay.
  const PASSBAND = { usb: [200, 2900], lsb: [-2900, -200], cw: [-250, 250], am: [-4000, 4000] };
  // Lower edge of the voice/phone segment per band (US); below is CW/data.
  const PHONE_START = { "160m": 1.843e6, "80m": 3.600e6, "40m": 7.125e6,
                        "20m": 14.150e6, "15m": 21.200e6, "10m": 28.300e6 };

  const L = {
    enabled: true,
    sid: null, freq: null, mode: null, band: null,
    ctx: null, proc: null, gain: null,
    ring: new Float32Array(RATE * 4), rHead: 0, rTail: 0, rCount: 0,
    playing: false, phase: 0, last: 0,
    abort: null, keepalive: null, busy: false, retries: 0,
  };

  const $ = id => document.getElementById(id);

  // ── helpers ──────────────────────────────────────────────────────────────

  async function post(action, body) {
    const res = await fetch(`/api/listen/${action}`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body), cache: "no-store",
    });
    let data = {};
    try { data = await res.json(); } catch (e) { /* empty body */ }
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  }

  function autoMode(bandName, freq) {
    // RTTY segment (CONFIG.bands[].segments.rtty): LSB, the amateur RTTY convention.
    const rtty = CONFIG.band(bandName).segments?.rtty;
    if (rtty && freq >= rtty[0] * 1e6 && freq <= rtty[1] * 1e6) return "lsb";
    const phone = PHONE_START[bandName];
    if (phone && freq < phone) return "cw";
    return freq < 10e6 ? "lsb" : "usb";
  }

  /** Dial frequency for a click: the click marks the middle of the signal. */
  function dialFor(bandName, clickHz, mode) {
    // Clicks just above an FT8/FT4/WSPR dial frequency tune to that dial (USB).
    for (const mhz of Object.values(CONFIG.band(bandName).dials || {})) {
      const dial = mhz * 1e6;
      if (clickHz >= dial - 300 && clickHz <= dial + 3300) return { freq: dial, mode: "usb" };
    }
    if (mode === "usb") return { freq: Math.round((clickHz - 1500) / 100) * 100, mode };
    if (mode === "lsb") return { freq: Math.round((clickHz + 1500) / 100) * 100, mode };
    if (mode === "cw")  return { freq: Math.round(clickHz / 10) * 10, mode };
    return { freq: Math.round(clickHz / 100) * 100, mode };
  }

  function bandFor(freq) {
    for (const b of Object.values(state.bands)) {
      const hi = b.meta.lo_hz + b.meta.bins * b.meta.rbw_hz;
      if (freq >= b.meta.lo_hz && freq <= hi) return b;
    }
    return null;
  }

  // ── audio output ─────────────────────────────────────────────────────────

  function ensureAudio() {
    if (L.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    L.ctx = new AC();
    L.gain = L.ctx.createGain();
    L.gain.gain.value = Number($("ls-volume").value) / 100;
    L.proc = L.ctx.createScriptProcessor(2048, 0, 1);
    L.proc.onaudioprocess = onAudio;
    L.proc.connect(L.gain).connect(L.ctx.destination);
  }

  function clearRing() {
    L.rHead = L.rTail = L.rCount = 0;
    L.playing = false;
    L.phase = 0;
  }

  function pushSamples(f32) {
    const cap = L.ring.length, max = RATE * MAX_BUFFER_SEC;
    for (let i = 0; i < f32.length; i++) {
      L.ring[L.rHead] = f32[i];
      L.rHead = (L.rHead + 1) % cap;
      if (L.rCount < cap) L.rCount++; else L.rTail = (L.rTail + 1) % cap;
    }
    // Bound latency: if we fell behind, skip ahead to the newest audio.
    while (L.rCount > max) { L.rTail = (L.rTail + 1) % cap; L.rCount--; }
  }

  function onAudio(ev) {
    const out = ev.outputBuffer.getChannelData(0);
    if (!L.playing && L.rCount >= RATE * PREBUFFER_SEC) L.playing = true;
    if (!L.playing) { out.fill(0); return; }
    const step = RATE / L.ctx.sampleRate;          // 12 kHz -> sound-card rate
    const cap = L.ring.length;
    for (let i = 0; i < out.length; i++) {
      if (L.rCount < 2) {                           // underrun: rebuffer
        out.fill(0, i);
        L.playing = false;
        setBuffering(true);
        return;
      }
      const a = L.ring[L.rTail], b = L.ring[(L.rTail + 1) % cap];
      out[i] = a + (b - a) * L.phase;               // linear interpolation
      L.phase += step;
      while (L.phase >= 1) {
        L.phase -= 1;
        L.rTail = (L.rTail + 1) % cap;
        L.rCount--;
      }
    }
    setBuffering(false);
  }

  let buffering = null;
  function setBuffering(on) {
    if (on === buffering) return;
    buffering = on;
    if (L.sid) setLabel();
  }

  // ── streaming ────────────────────────────────────────────────────────────

  async function readStream(sid) {
    const ctrl = new AbortController();
    L.abort = ctrl;
    try {
      const res = await fetch(`/api/listen/audio?sid=${encodeURIComponent(sid)}`,
                              { signal: ctrl.signal, cache: "no-store" });
      if (!res.ok || !res.body) {
        let msg = `HTTP ${res.status}`;
        try { msg = (await res.json()).error || msg; } catch (e) { /* not JSON */ }
        throw new Error(msg);
      }
      const reader = res.body.getReader();
      let carry = null;                             // odd byte between chunks
      L.retries = 0;
      for (;;) {
        const { value, done } = await reader.read();
        if (done || sid !== L.sid) break;
        let bytes = value;
        if (carry !== null) {
          bytes = new Uint8Array(value.length + 1);
          bytes[0] = carry; bytes.set(value, 1);
          carry = null;
        }
        if (bytes.length % 2) { carry = bytes[bytes.length - 1]; bytes = bytes.subarray(0, bytes.length - 1); }
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
        const f32 = new Float32Array(bytes.length / 2);
        for (let i = 0; i < f32.length; i++) f32[i] = view.getInt16(i * 2, true) / 32768;
        pushSamples(f32);
        window.DecodeUI?.feed(f32);                   // live CW/RTTY decoding (decode_ui.js)
      }
    } catch (e) {
      if (e.name === "AbortError") return;
      if (sid === L.sid) showError(`Audio stream: ${e.message}`);
    }
    // Stream ended while we still want audio: reconnect, reopening if expired.
    if (sid === L.sid && L.retries++ < 5) {
      setTimeout(() => {
        if (sid !== L.sid) return;
        post("keepalive", { sid }).then(() => readStream(sid))
          .catch(() => { const { freq, mode } = L; L.sid = null; start(freq, mode); });
      }, 1000);
    }
  }

  // ── actions ──────────────────────────────────────────────────────────────

  async function start(freq, mode) {
    if (L.busy) return;
    L.busy = true;
    try {
      ensureAudio();
      if (L.ctx.state === "suspended") await L.ctx.resume();
      if (L.sid) {
        await post("tune", { sid: L.sid, freq_hz: freq, mode });
        clearRing();                                // drop audio from the old frequency
      } else {
        const r = await post("open", { freq_hz: freq, mode });
        L.sid = r.sid;
        clearRing();
        readStream(r.sid);
        clearInterval(L.keepalive);
        L.keepalive = setInterval(() => {
          if (L.sid) post("keepalive", { sid: L.sid }).catch(() => {});
        }, KEEPALIVE_MS);
      }
      L.freq = freq; L.mode = mode;
      window.DecodeUI?.retuned({ freq, mode, bandName: bandFor(freq)?.name });
      showError("");
      $("ls-panel").hidden = false;
      setLabel();
      refreshOverlay();
    } catch (e) {
      showError(`Can't listen: ${e.message}`);
    } finally {
      L.busy = false;
    }
  }

  async function stop() {
    const sid = L.sid;
    L.sid = null;
    clearInterval(L.keepalive);
    L.abort?.abort();
    clearRing();
    window.DecodeUI?.stopped();
    if (L.ctx && L.ctx.state === "running") L.ctx.suspend();
    $("ls-panel").hidden = true;
    refreshOverlay();
    if (sid) post("close", { sid }).catch(() => {});
  }

  function retune(deltaHz) {
    if (L.sid && L.freq) start(L.freq + deltaHz, L.mode);
  }

  // ── UI ───────────────────────────────────────────────────────────────────

  function setLabel() {
    const band = bandFor(L.freq);
    $("ls-freq").textContent = `${(L.freq / 1e6).toFixed(L.mode === "cw" ? 5 : 4)} MHz`;
    $("ls-band").textContent = band ? CONFIG.bandLabel(band.name) : "";
    $("ls-mode").value = L.mode;
    $("ls-state").textContent = buffering ? "buffering…" : "live";
  }

  function showError(msg) {
    const el = $("ls-error");
    el.textContent = msg;
    el.hidden = !msg;
  }

  function refreshOverlay() {
    for (const b of Object.values(state.bands || {})) {
      const el = b.listenEl;
      if (!el) continue;
      // The displayed (possibly zoomed, #65) range of this band.
      const v0 = b.view ? b.view.lo : b.meta.lo_hz;
      const span = b.view ? b.view.hi - b.view.lo : b.meta.bins * b.meta.rbw_hz;
      if (!L.sid || !L.freq || L.freq < v0 || L.freq > v0 + span) {
        el.hidden = true;
        continue;
      }
      const [lo, hi] = PASSBAND[L.mode] || PASSBAND.usb;
      const left = (L.freq + lo - v0) / span * 100;
      const width = Math.max(0.4, (hi - lo) / span * 100);
      el.style.left = `${left}%`;
      el.style.width = `${width}%`;
      el.querySelector(".wf-listen-dial").style.left = `${(-lo) / (hi - lo) * 100}%`;
      el.hidden = false;
    }
  }

  function clickBand(band, clickHz) {
    const sel = $("ls-mode-pref").value;
    const mode = sel === "auto" ? autoMode(band.name, clickHz) : sel;
    const { freq, mode: m } = dialFor(band.name, clickHz, mode);
    start(freq, sel === "auto" ? m : sel);
  }

  function init() {
    $("ls-stop").addEventListener("click", stop);
    $("ls-mode").addEventListener("change", ev => { if (L.sid) start(L.freq, ev.target.value); });
    $("ls-volume").addEventListener("input", ev => {
      if (L.gain) L.gain.gain.value = Number(ev.target.value) / 100;
    });
    document.querySelectorAll("[data-step]").forEach(btn =>
      btn.addEventListener("click", () => retune(Number(btn.dataset.step))));
    document.addEventListener("keydown", ev => {
      if (!L.sid || ev.target.closest("input, select, textarea")) return;
      if (ev.key === "ArrowLeft")  { retune(ev.shiftKey ? -1000 : -100); ev.preventDefault(); }
      if (ev.key === "ArrowRight") { retune(ev.shiftKey ? 1000 : 100); ev.preventDefault(); }
      if (ev.key === "Escape") stop();
    });
    // Release the radiod channel when the page goes away.
    window.addEventListener("pagehide", () => {
      if (L.sid) navigator.sendBeacon("/api/listen/close", JSON.stringify({ sid: L.sid }));
    });
  }

  document.addEventListener("DOMContentLoaded", init);
  return { get enabled() { return L.enabled; }, clickBand, refreshOverlay, stop };
})();

window.Listen = Listen;
