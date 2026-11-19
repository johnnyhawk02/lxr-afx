// The click: the transient at the start of a hit. METAMORF's click (its engine/voice.js "CLICK: SHAPE" block, lifted out
// line for line): a pulse, a falling sine chirp or a band-passed noise burst, crossfading along SHAPE, fading out as
// (1 - t)^2 over LENGTH. It replaced the firmware's sampled transients on 2026-11-19.
//
// Controls, each 0..127 on its knob (x = value / 127):
//   LEVEL  linear 0..1           SHAPE  0 pulse, 0.5 chirp, 1 noise burst
//   TONE   20 * 800^x Hz         LENGTH 0.2 * 150^x ms         DIRECT the share that skips the filter and drive
export const clickTone = (x) => 20 * Math.pow(800, x / 127), clickLen = (x) => 0.2 * Math.pow(150, x / 127);
export const toneKnob = (hz) => (127 * Math.log(hz / 20)) / Math.log(800), lenKnob = (ms) => (127 * Math.log(ms / 0.2)) / Math.log(150);

export class Click {
  constructor(fs) { this.fs = fs; this.ct = 1; this.cph = 0; this.cb1 = 0; this.cb2 = 0; this.crng = 0x9e3779b9; }
  /** at every note start (and every retrigger) */
  trigger() { this.ct = 0; this.cph = 0; this.cb1 = 0; this.cb2 = 0; this.crng = 0x9e3779b9; }
  get on() { return this.ct < 1; }
  /** one sample of the whole click (before DIRECT splits it): about -1.2..1.2 at LEVEL 1 */
  next(level, shape, toneHz, lenMs) {
    if (level <= 0 || this.ct >= 1) return 0;
    const fs = this.fs, len = lenMs / 1000, tone = Math.min(toneHz, 0.45 * fs), sec = this.ct * len, sh = shape;
    let c = 0;
    // shape 0: a pulse, decaying at TONE
    if (sh < 0.5) c += Math.exp(-2 * Math.PI * tone * sec) * (1 - 2 * sh);
    // shape 0.5: a sine chirp falling from TONE by three octaves over LENGTH
    if (sh > 0 && sh < 1) { const fr = tone * Math.pow(0.125, this.ct); this.cph += fr / fs; c += Math.sin(2 * Math.PI * this.cph) * (sh < 0.5 ? 2 * sh : 2 - 2 * sh); }
    // shape 1: a noise burst through a band-pass at TONE (state-variable, two poles, Q 1.5)
    if (sh > 0.5) {
      this.crng = xs(this.crng); const w = this.crng / 2147483648 - 1, g = Math.tan(Math.PI * tone / fs), k = 1 / 1.5;
      const hp = (w - (k + g) * this.cb1 - this.cb2) / (1 + k * g + g * g), bp = g * hp + this.cb1, lp = g * bp + this.cb2;
      this.cb1 = g * hp + bp; this.cb2 = g * bp + lp; c += bp * 2.2 * (2 * sh - 1);
    }
    // between the shapes, neighbours crossfade; the whole click fades out as (1 - t)^2 over LENGTH
    const fade = 1 - this.ct;
    this.ct += 1 / (len * fs);
    return c * level * fade * fade;
  }
}
// xorshift32 (the burst uses a fixed seed, so every click sounds the same)
const xs = (s) => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; return s >>> 0; };
