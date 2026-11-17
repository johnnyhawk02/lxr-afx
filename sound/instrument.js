// The sound engine as an instrument: seven voices, each played with play(note, velocity, params).
// No UI, no sequencer, no Web Audio: render() fills float buffers at any sample rate, so it runs in an
// AudioWorklet, a ScriptProcessor, or offline in node.
//
//   const inst = new LxrInstrument(48000);
//   inst.loadKit(values);                       // a kit: parameter values 0..127 by parameter number
//   inst.voices[0].play(60, 100, [[par, v]]);   // drum 1, C3, velocity 100, with these parameters first
//   inst.render(left, right);                   // Float32Arrays of any length
//
// The engine is the LXR-02 firmware's drum engine ported to JS (engine/lxr.js, sample exact). It runs at
// 44 140 Hz in 64-sample blocks; render() resamples that to the output rate.
import { LxrEngine, REAL_FS, BLOCK } from '../engine/lxr.js';
import { SOUNDS, VOICE_SCHEMAS } from './schema.js';

export class Voice {
  constructor(inst, index) {
    this.inst = inst;
    this.index = index;
    this.def = SOUNDS[index];
    this.schema = VOICE_SCHEMAS[this.def.engineVoice];
  }
  /** note: MIDI note (60 = the sound's own pitch); velocity 1..127; params: [[parameter, value], ...] set first */
  play(note, velocity, params) { this.inst.play(this.index, note, velocity, params); }
}

export class LxrInstrument {
  constructor(sampleRate) {
    this.e = new LxrEngine();
    this.e.loadInitKit();
    this.ratio = REAL_FS / sampleRate;
    this.gain = 0.8;
    this.voices = SOUNDS.map((_, i) => new Voice(this, i));
    this.A = [new Float32Array(BLOCK), new Float32Array(BLOCK)];
    this.B = [new Float32Array(BLOCK), new Float32Array(BLOCK)];
    this.idx = 0; this.frac = 0;
    this.peak = new Float32Array(6); // each engine voice's peak since the last read
    this._block(this.A); this._block(this.B);
  }
  loadKit(values) { this.e.loadKit(values); }
  setParam(par, value) { if (this.e.activeParameters[par] !== value) this.e.setParam(par, value); }
  play(sound, note, velocity, params) {
    if (params) for (const [par, v] of params) this.setParam(par, v);
    this.e.trigger(SOUNDS[sound].trigger, Math.max(1, Math.min(127, velocity | 0)), note);
  }
  // one 64-sample block at the engine's rate: each voice panned as it was triggered
  _block(dst) {
    const out = this.e.renderBlock(), e = this.e;
    const pans = [e.drums[0], e.drums[1], e.drums[2], e.snare, e.cymbal, e.hat];
    const [L, R] = dst;
    L.fill(0); R.fill(0);
    for (let n = 0; n < 6; n++) {
      const o = out[n], pl = pans[n].triggeredPanL / 32768 * this.gain, pr = pans[n].triggeredPanR / 32768 * this.gain;
      let pk = this.peak[n];
      for (let i = 0; i < BLOCK; i++) { const v = o[i]; L[i] += v * pl; R[i] += v * pr; const a = v < 0 ? -v : v; if (a > pk) pk = a; }
      this.peak[n] = pk;
    }
    // a soft limit, so seven voices at once don't clip hard
    for (let i = 0; i < BLOCK; i++) { L[i] = soft(L[i]); R[i] = soft(R[i]); }
  }
  /** fill left and right (Float32Arrays of the same length) at the output rate */
  render(left, right) {
    for (let n = 0; n < left.length; n++) {
      while (this.idx >= BLOCK) {
        const t = this.A; this.A = this.B; this.B = t;
        this._block(this.B);
        this.idx -= BLOCK;
      }
      const i = this.idx, fr = this.frac;
      const l0 = this.A[0][i], r0 = this.A[1][i];
      const l1 = i < BLOCK - 1 ? this.A[0][i + 1] : this.B[0][0];
      const r1 = i < BLOCK - 1 ? this.A[1][i + 1] : this.B[1][0];
      left[n] = l0 + (l1 - l0) * fr;
      right[n] = r0 + (r1 - r0) * fr;
      this.frac += this.ratio;
      const k = Math.floor(this.frac);
      this.idx += k; this.frac -= k;
    }
  }
  /** each engine voice's peak (0..1) since the last call */
  readPeaks() { const p = Array.from(this.peak, (v) => v / 32768); this.peak.fill(0); return p; }
}

const soft = (x) => (x > 0.9 ? 0.9 + 0.1 * Math.tanh((x - 0.9) * 10) : x < -0.9 ? -0.9 - 0.1 * Math.tanh((-x - 0.9) * 10) : x);
