/**
 * HamSCI PSWS Contesting Dashboard - CW and RTTY decoders (decoders.js)
 *
 * Decode the click-to-listen audio (listen.js) live in the browser: signed
 * 16-bit mono PCM at 12 kHz from the station's radiod audio channel.  Pure
 * DSP, no libraries and no extra load on the station: it uses the audio the
 * listener is already receiving.
 *
 *   CwDecoder    finds the strongest tone in the CW passband (radiod's cwu
 *                preset puts the signal near 500 Hz), detects its envelope,
 *                adapts the on/off threshold and the speed, and turns element
 *                timing into text (letters, figures, punctuation, prosigns).
 *   RttyDecoder  45.45 baud, 170 Hz shift (both settable): finds the mark /
 *                space tone pair, frames start / 5 data / stop bits and maps
 *                ITA2 Baudot (US figures) with LTRS/FIGS shifts.
 *
 * Both take Float32Array chunks of any size through feed() and call
 * onText(string) as characters are decoded.  Works in the browser and in
 * Node (tests/decoders.test.js).
 */

const DSP = {
  RATE: 12000,

  /** In-place radix-2 FFT of re/im (length a power of two). */
  fft(re, im) {
    const n = re.length;
    for (let i = 1, j = 0; i < n; i++) {
      let bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
    }
    for (let len = 2; len <= n; len <<= 1) {
      const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang);
      for (let i = 0; i < n; i += len) {
        let cr = 1, ci = 0;
        for (let k = 0; k < len / 2; k++) {
          const a = i + k, b = a + len / 2;
          const tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
          re[b] = re[a] - tr; im[b] = im[a] - ti;
          re[a] += tr; im[a] += ti;
          const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
        }
      }
    }
  },

  /** Power spectrum (Hann window) of the last n samples of a ring buffer. */
  spectrum(ring, head, n) {
    const re = new Float64Array(n), im = new Float64Array(n), cap = ring.length;
    for (let i = 0; i < n; i++) {
      const w = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (n - 1));
      re[i] = ring[(head - n + i + cap) % cap] * w;
    }
    DSP.fft(re, im);
    const p = new Float64Array(n / 2);
    for (let i = 0; i < n / 2; i++) p[i] = re[i] * re[i] + im[i] * im[i];
    return p;
  },

  median(arr) {
    const a = Array.from(arr).sort((x, y) => x - y);
    return a.length ? a[a.length >> 1] : 0;
  },
};

// ── CW ────────────────────────────────────────────────────────────────────

const MORSE = {
  ".-": "A", "-...": "B", "-.-.": "C", "-..": "D", ".": "E", "..-.": "F", "--.": "G", "....": "H",
  "..": "I", ".---": "J", "-.-": "K", ".-..": "L", "--": "M", "-.": "N", "---": "O", ".--.": "P",
  "--.-": "Q", ".-.": "R", "...": "S", "-": "T", "..-": "U", "...-": "V", ".--": "W", "-..-": "X",
  "-.--": "Y", "--..": "Z",
  "-----": "0", ".----": "1", "..---": "2", "...--": "3", "....-": "4", ".....": "5", "-....": "6",
  "--...": "7", "---..": "8", "----.": "9",
  ".-.-.-": ".", "--..--": ",", "..--..": "?", "-..-.": "/", "-...-": "=", ".-.-.": "+",
  "-....-": "-", "---...": ":", ".----.": "'", "-.--.": "(", "-.--.-": ")", ".-..-.": "\"",
  ".--.-.": "@", "-.-.--": "!",
  "...-.-": "<SK>", "-.--.": "(", ".-...": "<AS>", "-.-.-": "<KA>", "...-.": "<SN>",
  "........": "<HH>", "-...-.-": "<BK>",
};

class CwDecoder {
  /**
   * @param {object} opts
   *   onText(text), onStatus({tone, wpm, snrDb, locked}),
   *   lo/hi: tone search range (Hz), default 250..1000
   */
  constructor(opts = {}) {
    this.rate = DSP.RATE;
    this.onText = opts.onText || (() => {});
    this.onStatus = opts.onStatus || (() => {});
    this.lo = opts.lo || 250;
    this.hi = opts.hi || 1000;
    this.block = 24;                          // 2 ms envelope samples
    this.reset();
  }

  reset() {
    this.ring = new Float32Array(8192);
    this.head = 0;
    this.filled = 0;
    this.sinceSpec = 0;
    this.tone = 0;                            // Hz; 0 = not found yet
    this.lockedTone = null;                   // user-set tone (Hz) or null
    this.phase = 0;
    this.accI = 0; this.accQ = 0; this.accN = 0;
    this.smooth = [];                         // last few block magnitudes
    this.hist = [];                           // envelope, last 4 s (level estimates)
    this.levelTick = 0;
    this.noise = 0; this.peak = 0;
    this.on = false;
    this.runMs = 0;                           // duration of the current mark/space
    this.dit = 60;                            // ms (20 WPM)
    this.elements = 0;                        // marks seen (fast speed learning at first)
    this.symbol = "";
    this.wordDone = true;
    this.snrDb = 0;
  }

  /** Fix the tone (Hz) instead of tracking the strongest one; null = track. */
  setTone(hz) {
    this.lockedTone = hz;
    if (hz) this.tone = hz;
  }

  feed(samples) {
    for (let i = 0; i < samples.length; i++) {
      const x = samples[i];
      this.ring[this.head] = x;
      this.head = (this.head + 1) % this.ring.length;
      if (this.filled < this.ring.length) this.filled++;
      if (++this.sinceSpec >= 3000) { this.sinceSpec = 0; this._findTone(); }
      if (!this.tone) continue;
      // Mix the tone to DC and integrate over a 2 ms block (I/Q).
      this.phase += 2 * Math.PI * this.tone / this.rate;
      if (this.phase > 2 * Math.PI) this.phase -= 2 * Math.PI;
      this.accI += x * Math.cos(this.phase);
      this.accQ -= x * Math.sin(this.phase);
      if (++this.accN === this.block) {
        const i = this.accI / this.block, q = this.accQ / this.block;
        this.accI = this.accQ = this.accN = 0;
        this._envelope(i, q);
      }
    }
  }

  /** Strongest tone in the passband, every 0.25 s (unless locked). */
  _findTone() {
    if (this.filled < 4096 || this.lockedTone) return;
    const p = DSP.spectrum(this.ring, this.head, 4096);
    const hz = this.rate / 4096;
    const a = Math.ceil(this.lo / hz), b = Math.floor(this.hi / hz);
    let best = a;
    for (let i = a; i <= b; i++) if (p[i] > p[best]) best = i;
    const floor = DSP.median(p.subarray(a, b + 1)) || 1e-20;
    // Quadratic peak interpolation for a sub-bin estimate.
    const l = p[best - 1] || 0, c = p[best], r = p[best + 1] || 0;
    const d = (l - r) / (2 * (l - 2 * c + r) || 1);
    const f = (best + (Number.isFinite(d) ? d : 0)) * hz;
    const strong = c > floor * 30;            // ~15 dB above the passband median
    const jump = strong && (!this.tone || Math.abs(f - this.tone) > 15);
    if (jump) this.tone = f;
    else if (strong) this.tone = 0.8 * this.tone + 0.2 * f;
    if (jump) this._status();                 // show the tone before any text arrives
  }

  _envelope(bi, bq) {
    // Coherent average of the 2 ms I/Q blocks over about a third of a dot,
    // then the magnitude: as narrow a detector as the speed allows (~60 Hz
    // at 25 WPM).  Averaging magnitudes instead would leave the noise of the
    // 2 ms (~500 Hz) blocks.  Works because the tone is known to ~1 Hz.
    const ms = this.block / this.rate * 1000;
    const len = Math.max(3, Math.min(12, Math.round(this.dit / 3 / ms)));
    this.smooth.push([bi, bq]);
    while (this.smooth.length > len) this.smooth.shift();
    let si = 0, sq = 0;
    for (const [a, b] of this.smooth) { si += a; sq += b; }
    const v = Math.hypot(si, sq) / this.smooth.length;
    // Levels from the last 4 s: noise = 30th percentile, signal = 95th.
    // A keyed signal is on 30-60 % of the time, so these straddle it; noise
    // alone gives a ratio of ~3 (Rayleigh), so require > 4 (12 dB): squelch.
    this.hist.push(v);
    if (this.hist.length > 2000) this.hist.shift();
    if (++this.levelTick >= 25) {             // every 50 ms
      this.levelTick = 0;
      const sorted = Float32Array.from(this.hist).sort();
      this.noise = sorted[Math.floor(sorted.length * 0.3)];
      this.peak = sorted[Math.floor(sorted.length * 0.95)];
    }
    if (!this.noise) return;
    this.snrDb = 20 * Math.log10(Math.max(1e-9, this.peak / this.noise));
    const usable = this.peak > this.noise * 4 && this.hist.length >= 500;
    const mid = Math.sqrt(this.noise * this.peak);                    // geometric middle
    const th = this.on ? mid * 0.8 : mid * 1.25;                       // hysteresis
    const now = usable && v > th;
    if (now === this.on) {
      this.runMs += ms;
      if (!this.on) this._spaceSoFar(this.runMs);
      return;
    }
    // A state change shorter than a third of a dit is a glitch: ignore it.
    if (this.runMs < this.dit * 0.3) { this.runMs += ms; return; }
    if (this.on) this._mark(this.runMs); else this._space(this.runMs);
    this.on = now;
    this.runMs = ms;
  }

  _mark(d) {
    // Learn the speed quickly for the first elements, then settle.
    const a = this.elements++ < 12 ? 0.4 : 0.15;
    if (d < 2 * this.dit) {                   // dit
      this.symbol += ".";
      this.dit = this.dit * (1 - a) + d * a;
    } else {                                  // dah
      this.symbol += "-";
      this.dit = this.dit * (1 - a) + (d / 3) * a;
    }
    this.dit = Math.min(200, Math.max(20, this.dit));   // 6..60 WPM
    if (this.symbol.length > 9) this.symbol = "";       // noise, not Morse
  }

  _space(d) {
    if (d >= 2 * this.dit) this._endLetter();
    if (d >= 5 * this.dit) this._endWord();
  }

  /** While a space is still running: end the letter / word on time. */
  _spaceSoFar(d) {
    if (this.symbol && d >= 2.5 * this.dit) this._endLetter();
    if (!this.wordDone && d >= 6 * this.dit) this._endWord();
  }

  _endLetter() {
    if (!this.symbol) return;
    this.onText(MORSE[this.symbol] || "*");
    this.symbol = "";
    this.wordDone = false;
    this._status();
  }

  _endWord() {
    if (this.wordDone) return;
    this.onText(" ");
    this.wordDone = true;
  }

  get wpm() {
    return Math.round(1200 / this.dit);
  }

  _status() {
    this.onStatus({ tone: Math.round(this.tone), wpm: this.wpm, snrDb: Math.round(this.snrDb),
                    locked: !!this.lockedTone });
  }
}

// ── RTTY ──────────────────────────────────────────────────────────────────

// ITA2 Baudot, bit 1 first (LSB).  Figures: the US TTY set amateurs use.
const BAUDOT_LTRS = ["", "E", "\n", "A", " ", "S", "I", "U", "\r", "D", "R", "J", "N", "F", "C", "K",
                     "T", "Z", "L", "W", "H", "Y", "P", "Q", "O", "B", "G", null, "M", "X", "V", null];
const BAUDOT_FIGS = ["", "3", "\n", "-", " ", "", "8", "7", "\r", "$", "4", "'", ",", "!", ":", "(",
                     "5", "\"", ")", "2", "#", "6", "0", "1", "9", "?", "&", null, ".", "/", ";", null];
const FIGS = 27, LTRS = 31;

class RttyDecoder {
  /**
   * @param {object} opts
   *   onText(text), onStatus({mark, space, baud, shift, locked, errors}),
   *   baud (45.45), shift (170), markHigh (true for USB audio, false for LSB),
   *   lo/hi: tone search range (Hz), default 300..2900
   */
  constructor(opts = {}) {
    this.rate = DSP.RATE;
    this.onText = opts.onText || (() => {});
    this.onStatus = opts.onStatus || (() => {});
    this.baud = opts.baud || 45.45;
    this.shift = opts.shift || 170;
    this.markHigh = opts.markHigh !== undefined ? opts.markHigh : true;
    this.lo = opts.lo || 300;
    this.hi = opts.hi || 2900;
    this.reset();
  }

  reset() {
    this.ring = new Float32Array(16384);
    this.head = 0;
    this.total = 0;                           // samples seen
    this.sinceSpec = 0;
    this.center = 0;                          // midpoint of the tone pair (Hz)
    this.lockedCenter = null;
    this.sym = this.rate / this.baud;         // samples per bit
    this.idleMark = 0;                        // samples of continuous mark
    this.frameStart = null;                   // sample index of a start edge
    this.figs = false;
    this.errors = 0;
    this.good = 0;
  }

  setCenter(hz) {
    this.lockedCenter = hz;
    if (hz) this.center = hz;
  }

  setReverse(reverse, usbAudio = true) {
    this.markHigh = usbAudio !== !!reverse;
  }

  get mark() { return this.center + (this.markHigh ? 1 : -1) * this.shift / 2; }
  get space() { return this.center - (this.markHigh ? 1 : -1) * this.shift / 2; }

  feed(samples) {
    for (let i = 0; i < samples.length; i++) {
      this.ring[this.head] = samples[i];
      this.head = (this.head + 1) % this.ring.length;
      this.total++;
      if (++this.sinceSpec >= 3000) { this.sinceSpec = 0; this._findPair(); }
      if (!this.center) continue;
      // Every 1/8 bit: short-window discriminator for start-edge detection,
      // and finish any frame whose bits have all arrived.
      if (this.total % Math.round(this.sym / 8) === 0) this._tick();
    }
  }

  /** Strongest pair of peaks `shift` apart, every 0.25 s (unless locked). */
  _findPair() {
    if (this.total < 8192 || this.lockedCenter) return;
    const n = 8192, p = DSP.spectrum(this.ring, this.head, n), hz = this.rate / n;
    const sh = Math.round(this.shift / hz);
    const a = Math.ceil(this.lo / hz), b = Math.floor(this.hi / hz) - sh;
    // Sum over +-1 bin around each tone (FSK spreads energy a little).
    const e = i => p[i - 1] + p[i] + p[i + 1];
    let best = a, bestV = 0;
    for (let i = a; i <= b; i++) {
      const v = Math.min(e(i), e(i + sh));      // both tones must be present
      if (v > bestV) { bestV = v; best = i; }
    }
    const floor = DSP.median(p.subarray(a, b + sh)) * 3 || 1e-20;
    if (bestV < floor * 20) return;             // no RTTY-like pair (~13 dB)
    const c = (best + sh / 2) * hz;
    const jump = !this.center || Math.abs(c - this.center) > 20;
    if (jump) this.center = c;
    else this.center = 0.8 * this.center + 0.2 * c;
    if (jump) this._status();                 // show the tone pair before any text arrives
  }

  /** Tone energy difference (mark - space) over [from, from+len) samples. */
  _disc(from, len) {
    let mi = 0, mq = 0, si = 0, sq = 0;
    const cap = this.ring.length, wm = 2 * Math.PI * this.mark / this.rate, ws = 2 * Math.PI * this.space / this.rate;
    for (let k = 0; k < len; k++) {
      const n = from + k;
      const x = this.ring[((n % cap) + cap) % cap];
      mi += x * Math.cos(wm * n); mq += x * Math.sin(wm * n);
      si += x * Math.cos(ws * n); sq += x * Math.sin(ws * n);
    }
    const m = mi * mi + mq * mq, s = si * si + sq * sq;
    return (m - s) / (m + s + 1e-30);
  }

  _tick() {
    const now = this.total;
    if (this.frameStart === null) {
      // Look for a mark -> space edge.  d is measured over the last quarter
      // bit every eighth of a bit, so a reading that straddles the edge sits
      // near 0: accept the edge when either of the two previous readings was
      // clearly mark, and place it where d crosses zero.
      const q = Math.round(this.sym / 4);
      const d = this._disc(now - q, q);
      const t = now - q / 2;                    // centre of this reading
      const h = this.hist || (this.hist = []);
      if (d < -0.2 && this.idleMark >= this.sym * 0.5) {
        // most recent clearly-mark reading among the last two
        let k = h.length - 1;
        while (k >= 0 && h.length - k <= 2 && !(h[k][1] > 0.2)) k--;
        if (k >= 0 && h.length - k <= 2) {
          // zero crossing: first reading after k at or below 0 (or this one)
          const pts = [...h.slice(k), [t, d]];
          let j = 1;
          while (j < pts.length - 1 && pts[j][1] > 0) j++;
          const [t1, d1] = pts[j - 1], [t2, d2] = pts[j];
          this.frameStart = d1 - d2 > 0 ? t1 + (t2 - t1) * d1 / (d1 - d2) : t2;
          this.hist = [];
          return;
        }
      }
      if (d > 0.2) this.idleMark += this.sym / 8;
      if (d < -0.2) this.idleMark = 0;
      h.push([t, d]);
      if (h.length > 3) h.shift();
      return;
    }
    // A frame is start + 5 data + stop; bit k is read over (k+0.2..k+0.8) bits,
    // so decide once the stop bit's window (to 6.8 bits) has fully arrived.
    if (now - this.frameStart < this.sym * 6.9) return;
    const bit = k => this._disc(Math.round(this.frameStart + (k + 0.2) * this.sym), Math.round(this.sym * 0.6));
    const start = bit(0), stop = bit(6);
    let code = 0;
    for (let k = 0; k < 5; k++) if (bit(k + 1) > 0) code |= 1 << k;
    this.frameStart = null;
    this.hist = [[now - this.sym * 0.1, stop]];
    // The stop bit is mark: count it, so the next start edge (as soon as
    // 1.5 bits after the stop began) is caught even after a bad frame.
    this.idleMark = stop > 0.2 ? this.sym : 0;
    if (start > -0.1 || stop < 0.1) {          // not a clean frame: start must be space, stop mark
      this.errors++;
      this._status();
      return;
    }
    this.good++;
    this._char(code);
  }

  _char(code) {
    if (code === FIGS) { this.figs = true; return; }
    if (code === LTRS) { this.figs = false; return; }
    const ch = (this.figs ? BAUDOT_FIGS : BAUDOT_LTRS)[code];
    if (ch === " ") this.figs = false;          // unshift on space (USOS), as most software does
    if (ch === "\r" || ch === "") return;
    this.onText(ch);
    this._status();
  }

  _status() {
    this.onStatus({ mark: Math.round(this.mark), space: Math.round(this.space), baud: this.baud,
                    shift: this.shift, locked: !!this.lockedCenter, errors: this.errors, good: this.good });
  }
}

if (typeof module !== "undefined") module.exports = { DSP, CwDecoder, RttyDecoder, MORSE, BAUDOT_LTRS, BAUDOT_FIGS };
