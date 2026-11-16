// CW / RTTY decoder tests on synthetic signals (no browser, no station).
// Run: node tests/decoders.test.js
const assert = require("assert");
const { CwDecoder, RttyDecoder } = require("../static/js/decoders.js");
const { RATE, rng, addNoise, feedInChunks, cwSignal, rttySignal } = require("./decoder_signals.js");

// ── CW ────────────────────────────────────────────────────────────────────

function decodeCw(x) {
  let out = "";
  const dec = new CwDecoder({ onText: s => { out += s; } });
  feedInChunks(dec, x);
  dec.feed(new Float32Array(RATE));                         // trailing silence flushes the last word
  return { text: out.trim().replace(/\s+/g, " "), dec };
}

const CW_TEXT = "CQ CQ DE W3USR W3USR K";
const cwCases = [
  { wpm: 18, snr: 20 },
  { wpm: 25, snr: 10 },
  { wpm: 35, snr: 15 },
  { wpm: 25, snr: 3, tone: 750 },
];
for (const c of cwCases) {
  // Two rounds: the first teaches the decoder the speed, as on the air.
  const x = addNoise(cwSignal(`${CW_TEXT} ${CW_TEXT}`, c.wpm, c.tone || 600), 0.3, c.snr, c.wpm);
  const { text, dec } = decodeCw(x);
  const second = text.slice(text.lastIndexOf("CQ CQ"));
  console.log(`CW ${c.wpm} WPM, SNR ${c.snr} dB in 2.5 kHz: "${text}" (est. ${dec.wpm} WPM, tone ${Math.round(dec.tone)} Hz)`);
  assert.strictEqual(second, CW_TEXT, `CW ${c.wpm} WPM / ${c.snr} dB`);
  assert.ok(Math.abs(dec.wpm - c.wpm) <= Math.max(3, c.wpm * 0.15), `speed estimate ${dec.wpm} vs ${c.wpm}`);
}

// ── RTTY ──────────────────────────────────────────────────────────────────

function decodeRtty(x, opts) {
  let out = "";
  const dec = new RttyDecoder({ ...opts, onText: s => { out += s; } });
  feedInChunks(dec, x);
  return { text: out.replace(/\n/g, " ").trim(), dec };
}

const RTTY_TEXT = "RYRYRY CQ TEST DE W3USR W3USR 599 PA 73";
const rttyCases = [
  { name: "LSB audio (mark low), 2125/2295 style", markHigh: false, center: 2210, snr: 20 },
  { name: "USB audio (mark high)", markHigh: true, center: 1500, snr: 12 },
  { name: "weak", markHigh: true, center: 1300, snr: 6 },
];
for (const c of rttyCases) {
  const x = addNoise(rttySignal(`${RTTY_TEXT} ${RTTY_TEXT}`, c), 0.3, c.snr, 7);
  const { text, dec } = decodeRtty(x, { markHigh: c.markHigh });
  const second = text.slice(text.lastIndexOf("RYRYRY"));
  console.log(`RTTY ${c.name}, SNR ${c.snr} dB: "${text}" (mark ${Math.round(dec.mark)} space ${Math.round(dec.space)}, ${dec.errors} framing errors)`);
  assert.strictEqual(second, RTTY_TEXT, `RTTY ${c.name}`);
}

// Wrong polarity decodes garbage, and setReverse fixes it.
{
  const x = addNoise(rttySignal(`${RTTY_TEXT} ${RTTY_TEXT}`, { markHigh: false, center: 1500 }), 0.3, 20, 3);
  const wrong = decodeRtty(x, { markHigh: true }).text;
  assert.ok(!wrong.includes("W3USR"), "reversed polarity should not decode");
  let out = "";
  const dec = new RttyDecoder({ markHigh: true, onText: s => { out += s; } });
  dec.setReverse(true, true);
  feedInChunks(dec, x);
  assert.ok(out.includes("CQ TEST DE W3USR W3USR 599 PA 73"), `reverse: "${out}"`);
}

// Noise only: nothing much comes out.
{
  const g = rng(99);
  const x = new Float32Array(RATE * 10).map(() => 0.05 * g());
  assert.ok(decodeCw(x).text.length <= 2, "CW on noise should stay quiet");
  assert.ok(decodeRtty(x, {}).text.length <= 2, "RTTY on noise should stay quiet");
}

console.log("all decoder tests passed");
