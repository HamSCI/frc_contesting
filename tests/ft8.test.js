// FT8 / FT4 decoder tests (static/js/ft8.js): synthetic GFSK signals, the live
// slot slicer, and real off-air slots recorded on W3USR-06 whose expected
// decodes come from the station's ft8_lib decode_ft8 (the C reference).
// Run: node tests/ft8.test.js
const assert = require("assert");
const fs = require("fs"), path = require("path");
const FT8 = require("../static/js/ft8.js");
const { RATE, addNoise, addFtx } = require("./decoder_signals.js");

// ── Message packing ───────────────────────────────────────────────────────
for (const m of ["CQ W3USR FN21", "W1AW K3ABC -12", "K3ABC W1AW R+05", "W1AW K3ABC RRR", "W1AW K3ABC RR73",
                 "W1AW K3ABC 73", "CQ K1ABC", "CQ K1ABC FN42", "TNX BOB 73 GL"]) {
  assert.strictEqual(FT8.unpack77(FT8.pack77(m)).text, m, `pack/unpack "${m}"`);
}
console.log("pack/unpack round trip ok");

// ── Synthetic slots ───────────────────────────────────────────────────────
// Several signals at different SNRs (dB in 2.5 kHz), start times and offsets.
function slot(protocol, sigs, noiseSeed) {
  const x = new Float64Array((protocol === "ft4" ? 7.5 : 15) * RATE);
  for (const s of sigs) {
    const amp = 0.1 * Math.pow(10, s.snr / 20);
    addFtx(x, FT8.encodeTones(FT8.pack77(s.text), protocol), { protocol, f0: s.f0, start: s.start, amp, phase: s.f0 });
  }
  return Float32Array.from(addNoise(x, 0.1, 0, noiseSeed));     // noise for 0 dB at amp 0.1
}

for (const protocol of ["ft8", "ft4"]) {
  const sigs = [
    { text: "CQ W3USR FN21", f0: 700, start: 0.5, snr: 0 },
    { text: "W1AW K3ABC -12", f0: 1203.1, start: 0.8, snr: -6 },
    { text: "K3ABC W1AW R+05", f0: 1850, start: 0.3, snr: -10 },
    { text: "CQ K1ABC FN42", f0: 2400, start: 0.6, snr: protocol === "ft8" ? -15 : -12 },
  ];
  const got = FT8.decodeSamples(slot(protocol, sigs, 3), { protocol, maxFreq: 3200 });
  console.log(`${protocol.toUpperCase()} synthetic:`);
  for (const d of got) console.log(`  ${String(d.snr).padStart(3)} ${d.dt.toFixed(2).padStart(5)} ${d.freq.toFixed(1).padStart(7)} ~ ${d.text}`);
  for (const s of sigs) {
    const d = got.find(m => m.text === s.text);
    assert.ok(d, `${protocol}: "${s.text}" at ${s.snr} dB not decoded`);
    // Half a search step: 3.125 Hz (FT8) / 10.4 Hz (FT4) with 2x frequency oversampling.
    assert.ok(Math.abs(d.freq - s.f0) <= (protocol === "ft4" ? 5.3 : 1.6), `${protocol}: freq ${d.freq} vs ${s.f0}`);
    assert.ok(Math.abs(d.dt - (s.start - 0.5)) <= 0.1, `${protocol}: dt ${d.dt} vs ${s.start - 0.5}`);
    assert.ok(Math.abs(d.snr - s.snr) <= 2, `${protocol}: snr ${d.snr} vs ${s.snr}`);
  }
  assert.strictEqual(got.length, sigs.length, `${protocol}: no false decodes`);
}

// Noise alone decodes nothing.
for (const protocol of ["ft8", "ft4"]) {
  assert.strictEqual(FT8.decodeSamples(slot(protocol, [], 5), { protocol, maxFreq: 3200 }).length, 0, `${protocol} noise only`);
}

// ── Live receiver: UTC slot slicing from arrival times with network jitter ─
// The stream starts 7.3 s into a slot (that partial slot is skipped) and runs
// through three full slots; `perSlot` lists each slot's signals.  Arrival
// times get 0-300 ms of jitter on top of `delayMs` (audio delay plus however
// far off the clock is).
function liveRun(protocol, perSlot, delayMs) {
  const slotMs = protocol === "ft4" ? 7500 : 15000;
  const T0 = Date.UTC(2026, 10, 16, 19, 0, 0) + 7300;
  const first = Date.UTC(2026, 10, 16, 19, 0, 0) + slotMs;
  const total = Math.round((first + 3 * slotMs + 2000 - T0) / 1000 * RATE);   // + 2 s so delayed slots finish
  const x = new Float32Array(total);
  perSlot.forEach((sigs, i) => {
    const k = Math.round((first + i * slotMs - T0) / 1000 * RATE), s = slot(protocol, sigs, 10 + i);
    x.set(s.subarray(0, total - k), k);
  });
  const got = [];
  let seed = 1;
  const jitter = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296) * 300;
  const rx = new FT8.FtxReceiver({ protocol, onDecode: (m, at) => got.push({ at, texts: m.map(d => d.text).sort(), dts: m.map(d => d.dt) }) });
  for (let k = 0; k < total; k += 1200) rx.feed(x.subarray(k, k + 1200), T0 + (k + 1200) / RATE * 1000 + delayMs + jitter());
  assert.strictEqual(got.length, 3, "three slots decoded (the partial first slot is skipped)");
  got.forEach((g, i) => {
    assert.strictEqual(g.at, first + i * slotMs, `slot ${i} start`);
    assert.deepStrictEqual(g.texts, perSlot[i].map(s => s.text).sort(), `slot ${i} text`);
  });
  return { got, rx };
}
{
  const per = [["CQ W3USR FN21", 900], ["W3USR K1ABC FN42", 1500], ["K1ABC W3USR -07", 900]]
    .map(([text, f0]) => [{ text, f0, start: 0.5, snr: -5 }]);
  const { got } = liveRun("ft8", per, 40);
  console.log("live FT8, 40 ms delay:", JSON.stringify(got.map(g => g.dts)));
  got.forEach((g, i) => assert.ok(Math.abs(g.dts[0] - 0.04) <= 0.12, `slot ${i} dt ${g.dts[0]} (40 ms delay)`));
}
// A clock 1.4 s fast (FT8) / audio 0.7 s late (FT4): the first slot decodes
// off-centre, then the slots are re-timed so DT comes back near zero.  For
// FT4 0.7 s is near the edge of what it can search at all.
for (const [protocol, delayMs] of [["ft8", -1400], ["ft4", 700]]) {
  const sigs = [["CQ W3USR FN21", 700], ["W1AW K3ABC -12", 1300], ["K3ABC W1AW R+05", 2000]];
  const per = [0, 1, 2].map(i => sigs.map(([text, f0]) => ({ text: text.replace("W1AW", ["W1AW", "N3XX", "K2YY"][i]), f0, start: 0.5, snr: -4 })));
  const { got, rx } = liveRun(protocol, per, delayMs);
  const med = g => g.dts.slice().sort((a, b) => a - b)[1];
  console.log(`live ${protocol.toUpperCase()}, ${delayMs} ms: median DT per slot ${got.map(med).join(", ")}, timing adjusted ${rx.adjMs.toFixed(0)} ms`);
  assert.ok(Math.abs(med(got[0]) - delayMs / 1000) <= 0.15, `${protocol} first slot sees the offset`);
  assert.ok(Math.abs(med(got[2])) <= 0.15, `${protocol} later slots re-timed`);
}

// ── Real off-air slots vs ft8_lib decode_ft8 (W3USR-06, 20 m, 16 Nov 2026) ─
function readWav(file) {
  const b = fs.readFileSync(file), x = new Float32Array((b.length - 44) / 2);
  for (let i = 0; i < x.length; i++) x[i] = b.readInt16LE(44 + i * 2) / 32768;
  return x;
}
for (const [protocol, name] of [["ft8", "ft8_20m_20261116T193815Z"], ["ft4", "ft4_20m_20261116T194107Z"]]) {
  const dir = path.join(__dirname, "data");
  const want = fs.readFileSync(path.join(dir, `${name}.decode_ft8.txt`), "utf8").trim().split("\n").sort();
  const x = readWav(path.join(dir, `${name}.wav`));
  // Same search as decode_ft8 (all bins, its candidate count) must give exactly its decodes...
  const full = FT8.decodeSamples(x, { protocol, maxCandidates: 220 }).map(d => d.text).sort();
  assert.deepStrictEqual(full, want, `${name}: same decodes as decode_ft8`);
  // ...and the browser's settings (search to 3.2 kHz) lose none of them.
  const live = FT8.decodeSamples(x, { protocol, maxFreq: 3200 }).map(d => d.text).sort();
  assert.deepStrictEqual(live, want, `${name}: browser settings`);
  console.log(`${name}: ${want.length} decodes, identical to decode_ft8`);
}

console.log("all FT8/FT4 tests passed");
