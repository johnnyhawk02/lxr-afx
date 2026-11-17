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
import { LxrEngine, REAL_FS, BLOCK, FxBus, ReverbBus, Rng, FX_DELAY, FX_DISTORTION } from '../engine/lxr.js';
import { SOUNDS, VOICE_SCHEMAS, SEND_BASE, ALL_PARAMS } from './schema.js';

// The three send effects (as in Elixir Desktop): the firmware's delay as an echo, its reverb (written for the firmware but
// never switched on there) and its distortion, each a bus of its own, all wet, fed by every voice at its send and added
// to the dry mix at the effect's return level. settings: see FX_DEFAULTS
export const FX_DEFAULTS = {
  echo: { time: 74, feedback: 60, tone: 90, pingpong: 1, level: 100 },
  reverb: { size: 70, decay: 90, tone: 64, early: 64, level: 100 },
  dist: { type: 0, drive: 70, color: 64, tone: 80, volume: 90, level: 100 },
};
// the echo's time knob (0..127) in milliseconds: 10 ms to 2 s, evenly in octaves
export const echoMs = (v) => Math.round(10 * Math.pow(200, v / 127));

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
    this.sends = [0, 1, 2].map(() => new Float32Array(6)); // [effect][voice], 0..1
    this.echo = new FxBus(); this.echo.fxType = FX_DELAY; this.echo.forceWet = true;
    this.verb = new ReverbBus();
    this.dist = new FxBus(); this.dist.fxType = FX_DISTORTION; this.dist.forceWet = true;
    this.fxRng = new Rng(0x2545f491);
    this.ret = new Float32Array(3).fill(1);
    this.busIn = new Float32Array(BLOCK * 2); this.busOut = new Int16Array(BLOCK * 2);
    this.setFx(FX_DEFAULTS);
    this._block(this.A); this._block(this.B);
  }
  loadKit(values) { this.e.loadKit(values); for (let p = SEND_BASE; p < Math.min(values.length, ALL_PARAMS); p++) this.setParam(p, values[p]); }
  setParam(par, value) {
    if (par >= SEND_BASE) { const i = par - SEND_BASE; this.sends[i % 3][Math.floor(i / 3)] = value / 127; return; }
    if (this.e.activeParameters[par] !== value) this.e.setParam(par, value);
  }
  /** the effects' settings: { echo, reverb, dist }, each as FX_DEFAULTS (0..127 values) */
  setFx(fx) {
    const { echo, reverb, dist } = fx;
    if (echo) {
      this.echo.delay.type = echo.pingpong ? 1 : 0;
      [0.5, 0.5, echo.tone / 127, echo.feedback / 127].forEach((v, i) => this.echo.setParameter(i, v));
      this.echo.setDelaySync(echoMs(echo.time) / 1000 * REAL_FS);
      this.ret[0] = echo.level / 100;
    }
    if (reverb) { [reverb.size, reverb.decay, reverb.tone, reverb.early].forEach((v, i) => this.verb.setParameter(i, v / 127)); this.ret[1] = reverb.level / 100; }
    if (dist) {
      this.dist.distortion.type = dist.type;
      [dist.drive, dist.color, dist.tone, dist.volume].forEach((v, i) => this.dist.setParameter(i, v / 127));
      this.ret[2] = dist.level / 100;
    }
  }
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
    // the sends: each effect's bus gets every voice panned in at its send, saturated to int16, and comes back all wet
    const buses = [this.echo, this.verb, this.dist];
    for (let k = 0; k < 3; k++) {
      const sends = this.sends[k], bus = buses[k], bi = this.busIn; bi.fill(0);
      for (let n = 0; n < 6; n++) {
        const g = sends[n]; if (!g) continue;
        const o = out[n], pl = pans[n].triggeredPanL * g, pr = pans[n].triggeredPanR * g;
        for (let i = 0; i < BLOCK; i++) { bi[2 * i] += o[i] * pl; bi[2 * i + 1] += o[i] * pr; }
      }
      for (let i = 0; i < BLOCK * 2; i++) bus.input[i] = Math.max(-32768, Math.min(32767, Math.round(bi[i])));
      const bo = this.busOut; bo.fill(0);
      bus.process(bo, BLOCK, this.fxRng);
      const g = this.gain * this.ret[k] / 32768;
      if (g) for (let i = 0; i < BLOCK; i++) { L[i] += bo[2 * i] * g; R[i] += bo[2 * i + 1] * g; }
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
