// The master distortion: a bass-pedal style dual-path drive (our own design, after the signal flow of a dual-path
// bass distortion pedal). It sits on the master, before the compressor.
//
//   input ─┬─ PREGAIN ─ FILTER (HP, or LP when swapped) ─ GAIN ─ CLIP 1 ─ CLIP 2 ─ TONE (+ BASS) ─ DIRTY ─┬─ out
//          │                     └ XOVER on: the filter's other half goes to the clean path ┐              │
//          └──────────────────────────────────────────────────────────────── (clean) ─ CLEAN ─────────────┘
//
// Both clip stages are first-order antiderivative anti-aliased (ADAA) soft clippers, so heavy drive doesn't fold
// fizz back down the spectrum. Diode clipping clips early and hard; LED clipping later, louder and more open.
// Settings are knob values (see DIRT_DEFAULTS); every knob glides (about 10 ms) so turning it never clicks.

export const DIRT_DEFAULTS = {
  on: 0, pregain: 24, cutoff: 25, swap: 0, xover: 0, gain: 64, clip: 0, bass: 12, tone: 64, dirty: 85, clean: 0,
};
// the knobs in real units
export const dirtHz = (v) => 20 * Math.pow(1000, v / 127); // CUTOFF: 20 Hz .. 20 kHz
export const volDb = (v) => (v ? -40 + 48 * (v - 1) / 126 : -Infinity); // DIRTY, CLEAN: off, -40 .. +8 dB
export const pregainDb = (v) => v - 24; // -24 .. +24 dB
export const gainDb = (v) => v / 127 * 40; // 0 .. +40 dB into the first clip stage
export const bassDb = (v) => v - 12; // -12 .. +12 dB
const db = (d) => Math.pow(10, d / 20);

// ln(cosh x), the antiderivative of tanh, without overflow
const logcosh = (x) => { const a = x < 0 ? -x : x; return a + Math.log1p(Math.exp(-2 * a)) - Math.LN2; };
// one soft-clip stage, t·tanh(x/t + b) less its offset, anti-aliased against the previous input
class Clip {
  constructor() { this.u1 = 0; }
  run(x, t, b) {
    const u = x / t + b, d = u - this.u1;
    const y = Math.abs(d) < 1e-5 ? Math.tanh((u + this.u1) / 2) : (logcosh(u) - logcosh(this.u1)) / d;
    this.u1 = u;
    return t * (y - Math.tanh(b));
  }
}
// a state-variable filter (topology-preserving), coefficients set per sample so it can be swept
class Svf {
  constructor() { this.s1 = 0; this.s2 = 0; this.lp = 0; this.bp = 0; this.hp = 0; }
  run(x, a1, a2, a3, k) {
    const v3 = x - this.s2, v1 = a1 * this.s1 + a2 * v3, v2 = this.s2 + a2 * this.s1 + a3 * v3;
    this.s1 = 2 * v1 - this.s1; this.s2 = 2 * v2 - this.s2;
    this.lp = v2; this.bp = v1; this.hp = x - k * v1 - v2;
  }
}
const svfCoef = (hz, fs, k, o) => {
  const g = Math.tan(Math.PI * Math.min(hz, fs * 0.45) / fs), a1 = 1 / (1 + g * (g + k));
  o[0] = a1; o[1] = g * a1; o[2] = g * g * a1;
};
const onePole = (hz, fs) => 1 - Math.exp(-2 * Math.PI * hz / fs);

class Channel {
  constructor() {
    this.filt = new Svf(); this.c1 = new Clip(); this.c2 = new Clip();
    this.dc = 0; this.dcX = 0; this.lp = 0; this.hp = 0; this.hpX = 0; this.low = 0;
  }
}

export class Dirt {
  constructor(fs) {
    this.fs = fs;
    this.p = { ...DIRT_DEFAULTS };
    this.ch = [new Channel(), new Channel()];
    // the gliding knobs, and the wet amount (0 bypassed .. 1 on)
    this.cur = { pregain: 24, cutoff: 25, gain: 64, tone: 64, bass: 12, dirty: 85, clean: 0 };
    this.wet = 0;
    this.glide = 1 - Math.exp(-1 / (0.01 * fs));
    this.k = Math.SQRT2; this.co = new Float64Array(3);
    this.aDc = onePole(8, fs); this.aLp = onePole(400, fs); this.aHp = onePole(1200, fs); this.aLow = onePole(110, fs);
  }
  set(s) { Object.assign(this.p, s); }
  /** is anything to do: on, or still fading out */
  get active() { return this.p.on || this.wet > 1e-4; }
  /** L, R: the master (processed in place) */
  process(L, R) {
    const P = this.p, C = this.cur, gl = this.glide, k = this.k, co = this.co;
    const wetTo = P.on ? 1 : 0, diode = !P.clip, t1 = diode ? 0.32 : 0.85, t2 = diode ? 0.4 : 1.0;
    const b1 = diode ? 0.18 : 0.08, make = diode ? 1.7 : 0.9;
    for (let i = 0; i < L.length; i++) {
      // every knob glides to where it's set
      for (const n in C) C[n] += (P[n] - C[n]) * gl;
      this.wet += (wetTo - this.wet) * gl;
      const gPre = db(pregainDb(C.pregain)), gIn = db(gainDb(C.gain)), inter = 1 + 3 * C.gain / 127;
      const gDirty = C.dirty < 0.5 ? 0 : db(volDb(C.dirty)) * make, gClean = C.clean < 0.5 ? 0 : db(volDb(C.clean));
      const tt = C.tone / 127, norm = 1 / Math.max(tt, 1 - tt), gBass = db(bassDb(C.bass)) - 1;
      svfCoef(dirtHz(C.cutoff), this.fs, k, co);
      const w = this.wet;
      for (let c = 0; c < 2; c++) {
        const X = c ? R : L, x = X[i], ch = this.ch[c];
        // the input stage: pregain, then the filter (HP, or LP swapped); XOVER sends its other half to the clean path
        const xp = x * gPre;
        ch.filt.run(xp, co[0], co[1], co[2], k);
        const into = P.swap ? ch.filt.lp : ch.filt.hp;
        const clean = (P.xover ? x - into / gPre : x) * gClean; // (the clean half at its own level, not pregained)
        // the distortion: GAIN into two clip stages, the DC taken out
        let y = ch.c1.run(into * gIn, t1, b1);
        y = ch.c2.run(y * inter, t2, 0.04);
        ch.dc += (y - ch.dc) * this.aDc; y -= ch.dc;
        // TONE: a low-passed and a high-passed copy, blended (both halves at noon scoop the mids); BASS shelves the
        // low half, so it does most at the bass end of TONE and nothing at full treble
        ch.lp += (y - ch.lp) * this.aLp; ch.low += (ch.lp - ch.low) * this.aLow;
        ch.hpX += (y - ch.hpX) * this.aHp; const hp = y - ch.hpX;
        const lo = ch.lp + gBass * ch.low;
        const dirty = ((1 - tt) * lo + tt * hp) * norm * gDirty;
        X[i] = x + (dirty + clean - x) * w;
      }
    }
  }
}
