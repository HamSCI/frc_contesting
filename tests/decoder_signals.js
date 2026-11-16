// Synthetic CW / RTTY test signals for tests/decoders.test.js.
const assert = require("assert");
const { MORSE, BAUDOT_LTRS, BAUDOT_FIGS } = require("../static/js/decoders.js");

const RATE = 12000;

// Deterministic gaussian noise (so failures are reproducible).
function rng(seed) {
  let s = seed >>> 0;
  const u = () => ((s = (s * 1664525 + 1013904223) >>> 0) + 0.5) / 4294967296;
  return () => Math.sqrt(-2 * Math.log(u())) * Math.cos(2 * Math.PI * u());
}

/** Noise with the given SNR (dB) of a sine of amplitude `amp`, measured in 2.5 kHz. */
function addNoise(x, amp, snrDb, seed = 1) {
  const g = rng(seed);
  const sigPow = amp * amp / 2;
  const noiseIn2k5 = sigPow / Math.pow(10, snrDb / 10);
  const sigma = Math.sqrt(noiseIn2k5 * (RATE / 2) / 2500);
  return x.map(v => v + sigma * g());
}

function feedInChunks(dec, x, chunk = 1200) {
  for (let i = 0; i < x.length; i += chunk) dec.feed(x.subarray(i, i + chunk));
}

const TO_MORSE = Object.fromEntries(Object.entries(MORSE).filter(([, v]) => v.length === 1).map(([k, v]) => [v, k]));

function cwSignal(text, wpm, tone = 600, amp = 0.3, lead = 1.0) {
  const dit = 1.2 / wpm;                                     // seconds
  const units = [];                                          // [on?, units]
  text.split(" ").forEach((word, wi) => {
    if (wi) units.push([false, 7]);
    [...word].forEach((ch, ci) => {
      if (ci) units.push([false, 3]);
      [...TO_MORSE[ch]].forEach((el, ei) => {
        if (ei) units.push([false, 1]);
        units.push([true, el === "." ? 1 : 3]);
      });
    });
  });
  units.push([false, 10]);
  const total = lead + units.reduce((s, [, u]) => s + u * dit, 0);
  const x = new Float32Array(Math.ceil(total * RATE));
  let t = lead * RATE;
  const ramp = 0.005 * RATE;                                 // 5 ms raised-cosine edges
  for (const [on, u] of units) {
    const n = Math.round(u * dit * RATE);
    if (on) for (let i = 0; i < n; i++) {
      const e = Math.min(1, i / ramp, (n - i) / ramp);
      const env = 0.5 - 0.5 * Math.cos(Math.PI * e);
      x[t + i] = amp * env * Math.sin(2 * Math.PI * tone * (t + i) / RATE);
    }
    t += n;
  }
  return x;
}

/** Baudot codes for text, with LTRS/FIGS shifts. */
function baudot(text) {
  const codes = [31, 31];                                    // LTRS, LTRS to start
  let figs = false;
  for (const ch of text) {
    let i = BAUDOT_LTRS.indexOf(ch);
    if (ch === " " || ch === "\n") { codes.push(BAUDOT_LTRS.indexOf(ch)); if (ch === " ") figs = false; continue; }
    if (i > 0 && !figs) { codes.push(i); continue; }
    if (i > 0 && figs) { codes.push(31); figs = false; codes.push(i); continue; }
    i = BAUDOT_FIGS.indexOf(ch);
    assert.ok(i > 0, `no Baudot code for ${ch}`);
    if (!figs) { codes.push(27); figs = true; }
    codes.push(i);
  }
  return codes;
}

/** Phase-continuous FSK: idle mark, then start/5 data/1.5 stop per character. */
function rttySignal(text, { center = 1500, shift = 170, baud = 45.45, markHigh = true, amp = 0.3, lead = 1.0 } = {}) {
  const fm = center + (markHigh ? 1 : -1) * shift / 2, fs = center - (markHigh ? 1 : -1) * shift / 2;
  const bits = [];
  const bitSec = 1 / baud;
  bits.push([1, lead / bitSec]);                             // idle mark
  for (const code of baudot(text)) {
    bits.push([0, 1]);
    for (let k = 0; k < 5; k++) bits.push([(code >> k) & 1, 1]);
    bits.push([1, 1.5]);
  }
  bits.push([1, 20]);
  const total = bits.reduce((s, [, n]) => s + n * bitSec, 0);
  const x = new Float32Array(Math.ceil(total * RATE));
  let ph = 0, t = 0, acc = 0;
  for (const [b, n] of bits) {
    acc += n * bitSec * RATE;
    const end = Math.round(acc);
    const w = 2 * Math.PI * (b ? fm : fs) / RATE;
    for (; t < end; t++) { x[t] = amp * Math.sin(ph); ph += w; }
  }
  return x;
}

// ── FT8 / FT4 ──────────────────────────────────────────────────────────────

function erf(x) {                                            // Abramowitz & Stegun 7.1.26
  const s = Math.sign(x), a = Math.abs(x), t = 1 / (1 + 0.3275911 * a);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-a * a);
  return s * y;
}

/** WSJT-X GFSK frequency pulse (bt = 2 for FT8, 1 for FT4), t in symbols. */
function gfskPulse(bt, t) {
  const c = Math.PI * Math.sqrt(2 / Math.LN2);
  return 0.5 * (erf(c * bt * (t + 0.5)) - erf(c * bt * (t - 0.5)));
}

/**
 * Add one FT8/FT4 transmission of `tones` into the slot buffer x, GFSK like
 * WSJT-X: tone 0 at f0 Hz, keyed `start` s after the slot boundary.
 */
function addFtx(x, tones, { protocol = "ft8", f0 = 1000, start = 0.5, amp = 0.1, phase = 0 } = {}) {
  const sym = protocol === "ft4" ? 0.048 : 0.160, bt = protocol === "ft4" ? 1 : 2;
  const df = 1 / sym, nn = tones.length, ns = Math.round(sym * RATE);
  const tone = j => tones[Math.max(0, Math.min(nn - 1, j))];
  const s0 = Math.round(start * RATE);
  let ph = phase;
  for (let i = 0; i < nn * ns; i++) {
    const t = i / ns, j0 = Math.floor(t);
    let f = f0;
    for (let j = j0 - 2; j <= j0 + 2; j++) f += df * tone(j) * gfskPulse(bt, t - j - 0.5);
    ph += 2 * Math.PI * f / RATE;
    const k = s0 + i;
    if (k >= 0 && k < x.length) x[k] += amp * Math.sin(ph);
  }
  return x;
}

module.exports = { RATE, rng, addNoise, feedInChunks, cwSignal, baudot, rttySignal, addFtx, gfskPulse };
