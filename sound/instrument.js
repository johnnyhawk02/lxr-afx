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
import { LxrEngine, REAL_FS, BLOCK, FxBus, ReverbBus, Rng, FX_DELAY } from '../engine/lxr.js?v=mwnrjspw';
import { SOUNDS, VOICE_SCHEMAS, SEND_BASE, REPEAT_BASE, SEQ_ON_BASE, SEQ_PAT_BASE, TRIM_BASE, trimDb, ALL_PARAMS, EXTRA_BASE, NUM_EXTRAS, EXTRA_LIVE, setEngines,
  MOD_BASE, MOD_AMT_ZERO, routeOf, TABLE_BASE, DEPTH_BASE, STEP_BASE, NUM_STEPS, STEPX_BASE } from './schema.js?v=mwnrjspw';
import { tableFor, hold, holds, drop } from './tables.js?v=mwnrjspw';
import { Dirt, DIRT_DEFAULTS } from './dirt.js?v=mwnrjspw';

// The two send effects (as in Elixir Desktop): the firmware's delay as an echo and its reverb (written for the firmware
// but never switched on there), each a bus of its own, all wet, fed by every voice at its send and added
// to the dry mix at unity. settings: see FX_DEFAULTS
export const FX_DEFAULTS = {
  echo: { time: 74, feedback: 60, tone: 90, pingpong: 1, level: 100, sync: 0, div: 7, duck: 0 }, // sync: TIME is a note length (div);
  // duck: how far the echoes go down while the dry sound plays (0 off .. 127 all the way), swelling back in the gaps
  reverb: { size: 70, decay: 90, tone: 64, early: 64, level: 100 },
  tempo: { bpm: 120, ret: 2 }, // for the sequencer, and RETURN: a zone back to an earlier held key now (0) or on the
  // next 1/32, 1/16, 1/8 or 1/4 (1..4)
  // the master: the whole mix (dry and FX returns) through the distortion (sound/dirt.js), then a compressor, then
  // the level
  dirt: { ...DIRT_DEFAULTS },
  master: { thresh: 12, ratio: 30, attack: 5, release: 120, knee: 6, makeup: 0, level: 100 },
};
// the master compressor's knobs in real units: threshold 0..-40 dB, ratio 1:1..20:1 (tenths), attack 1..100 ms,
// release 10..1000 ms, knee 0..24 dB, makeup 0..24 dB
// the echo's time knob (0..127) in milliseconds: 10 ms to 2 s, evenly in octaves
export const echoMs = (v) => Math.round(10 * Math.pow(200, v / 127));
// the echo's TIME with SYNC on: note lengths at the BPM, shortest first (T triplet, D dotted), each as [name, beats]
export const ECHO_DIVS = [['1/32', 1 / 8], ['1/16T', 1 / 6], ['1/16', 1 / 4], ['1/8T', 1 / 3], ['1/16D', 3 / 8], ['1/8', 1 / 2],
  ['1/4T', 2 / 3], ['1/8D', 3 / 4], ['1/4', 1], ['1/2T', 4 / 3], ['1/4D', 3 / 2], ['1/2', 2]];
// the echo's time in seconds: TIME's milliseconds, or with SYNC its note length at the BPM
export const echoSeconds = (echo, bpm) => (echo.sync ? (ECHO_DIVS[echo.div] || ECHO_DIVS[7])[1] * 60 / bpm : echoMs(echo.time) / 1000);

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
    // each voice's TABLE, and whether a table not made yet is made here (not in the AudioWorklet: the page makes it and
    // posts it, then retable())
    this.tableOf = new Float64Array(6); this.build = typeof registerProcessor === 'undefined';
    this.ratio = REAL_FS / sampleRate;
    this.gain = 0.8;
    this.voices = SOUNDS.map((_, i) => new Voice(this, i));
    this.A = [new Float32Array(BLOCK), new Float32Array(BLOCK)];
    this.B = [new Float32Array(BLOCK), new Float32Array(BLOCK)];
    this.idx = 0; this.frac = 0;
    this.peak = new Float32Array(6); // each engine voice's peak since the last read
    this.sends = [0, 1].map(() => new Float32Array(6)); // [effect][voice], 0..1
    // AUTO LEVEL's trim: each voice's gain (1 = none), and where it is now: a new hit starts at its key's trim, a
    // change while a sound rings glides there over a block (no click)
    this.trim = new Float32Array(6).fill(1); this.trimNow = new Float32Array(6).fill(1);
    this.echo = new FxBus(); this.echo.fxType = FX_DELAY; this.echo.forceWet = true;
    this.verb = new ReverbBus(); this.verb.stereo = true; // (the right side from its own taps: a stereo reverb)
    this.fxRng = new Rng(0x2545f491);
    this.ret = new Float32Array(3).fill(1);
    this.busIn = new Float32Array(BLOCK * 2); this.busOut = new Int16Array(BLOCK * 2);
    // the sequencer: per voice ACTIVE and its pattern, and per sound the held key it's playing: { note, vel, at, step,
    // cur } (at: the beat of its next step; step: the next step, 0..7; cur: the step played last, -1 before the first)
    this.seqOn = new Uint8Array(6); this.seqPat = new Uint8Array(6).fill(0b00010001); this.held = SOUNDS.map(() => null); this.bpm = 120;
    // the grid: beats since the start (it follows the BPM), and per sound a key coming back on a step: { at, note, vel, params }
    this.beat = 0; this.retQ = 2; this.backs = SOUNDS.map(() => null);
    this.dirt = new Dirt(REAL_FS); this.key = new Float32Array(BLOCK);
    this.m = { ...FX_DEFAULTS.master }; this.env = 0; this.gr = 0;
    this.outPk = new Float32Array(4); // the output meter since the last read: left and right peaks (0..1), left and right over full scale (0/1)
    // the echo's DUCK: its depth (0..1), the dry sound's envelope that drives it, and the gain it gives the echo per sample
    this.duck = 0; this.duckEnv = 0; this.duckG = new Float32Array(BLOCK).fill(1);
    this.duckA = Math.exp(-1 / (0.002 * REAL_FS)); this.duckR = Math.exp(-1 / (0.1 * REAL_FS));
    this.setFx(FX_DEFAULTS);
    this._block(this.A); this._block(this.B);
  }
  /** a wavetable the page made (sound/tables.js), for the voices whose TABLE it is */
  hold(t) { hold(t); this.retable(); }
  static holds(id) { return holds(id); }
  static drop(id) { drop(id); }
  /** the wavetables again (after one arrived) */
  retable() { for (let v = 0; v < 6; v++) this.e.setTable(v, tableFor(this.tableOf[v], this.build)); }
  /** ENGINES: how many engines are in use (1..6); only their voices are made */
  setEngines(n) {
    setEngines(n);
    const on = [0, 0, 0, 0, 0, 0];
    SOUNDS.forEach((s, i) => { if (i < n) on[s.engineVoice] = 1; else { this.held[i] = null; this.backs[i] = null; } });
    this.e.only = on;
  }
  loadKit(values) { this.e.loadKit(values); for (let p = SEND_BASE; p < Math.min(values.length, ALL_PARAMS); p++) this.setParam(p, values[p]); }
  setParam(par, value) {
    if (par >= STEPX_BASE) { // STEP SEQ's STEP TIME or SLEW
      const i = par - STEPX_BASE; if (i >= 12) return;
      if (i % 2) this.e.setStepSlew(i >> 1, value); else this.e.setStepTime(i >> 1, value);
      return;
    }
    if (par >= STEP_BASE) { // a STEP SEQ level
      const i = par - STEP_BASE; if (i >= 6 * NUM_STEPS) return;
      this.e.setStep(Math.floor(i / NUM_STEPS), i % NUM_STEPS, value / 127);
      return;
    }
    if (par >= DEPTH_BASE) { // a knob's depth from one source
      const r = routeOf(par); if (!r || r.dest < 0) return;
      this.e.setRouteAmt(r.voice, r.dest, r.src, (value - MOD_AMT_ZERO) / 127);
      return;
    }
    if (par >= TABLE_BASE) { // a voice's wavetable (0: CLASSIC)
      const v = par - TABLE_BASE; if (v >= 6) return;
      this.tableOf[v] = value; this.e.setTable(v, tableFor(value, this.build));
      return;
    }
    if (par >= MOD_BASE) return; // (the old one-source pairs: brought across as depths, schema.js pairsToDepths)
    if (par >= EXTRA_BASE) { // a voice's extra (only the ones it uses: the others shadow a firmware parameter)
      if (EXTRA_LIVE.has(par)) { const i = par - EXTRA_BASE, n = Math.floor(i / NUM_EXTRAS), k = i % NUM_EXTRAS; if (this.e.voices[n].extra[k] !== value) this.e.setExtra(n, k, value); }
      return;
    }
    if (par >= TRIM_BASE) { if (par < ALL_PARAMS) this.trim[par - TRIM_BASE] = Math.pow(10, trimDb(value) / 20); return; }
    if (par >= SEQ_PAT_BASE) { this.seqPat[par - SEQ_PAT_BASE] = value; return; }
    if (par >= SEQ_ON_BASE) { this.seqOn[par - SEQ_ON_BASE] = value ? 1 : 0; return; }
    if (par >= REPEAT_BASE) return; // the dropped note repeat's slots
    if (par >= SEND_BASE) { const i = par - SEND_BASE; if (i % 3 < 2) this.sends[i % 3][Math.floor(i / 3)] = value / 127; return; }
    if (this.e.activeParameters[par] !== value) this.e.setParam(par, value);
  }
  /** the effects' settings: { echo, reverb, master, tempo }, each as FX_DEFAULTS (0..127 values) */
  setFx(fx) {
    const { echo, reverb, master, tempo, dirt } = fx;
    if (tempo) { this.setBpm(tempo.bpm); if (tempo.ret !== undefined) this.retQ = tempo.ret; } // (first: a synced echo follows it)
    if (echo) {
      this.echo.delay.type = echo.pingpong ? 1 : 0;
      [0.5, 0.5, echo.tone / 127, echo.feedback / 127].forEach((v, i) => this.echo.setParameter(i, v));
      this.echo.setDelaySync(echoSeconds(echo, this.bpm) * REAL_FS);
      this.ret[0] = 1; // returns fixed at unity
      this.duck = (echo.duck || 0) / 127;
    }
    if (reverb) { [reverb.size, reverb.decay, reverb.tone, reverb.early].forEach((v, i) => this.verb.setParameter(i, v / 127)); this.ret[1] = 1; }
    if (dirt) this.dirt.set(dirt);
    if (master) Object.assign(this.m, master);
  }
  /** hold: the key is held down, so with its sequencer ACTIVE it plays its pattern until release(), from the next
   * 1/16 of the grid; otherwise (or not held: a key auditioned) it plays once, now */
  play(sound, note, velocity, params, hold = true) {
    if (params) for (const [par, v] of params) this.setParam(par, v);
    const vel = Math.max(1, Math.min(127, velocity | 0)), v = SOUNDS[sound].engineVoice;
    this.backs[sound] = null;
    if (hold && this.seqOn[v]) { this.held[sound] = { note, vel, at: Math.ceil(this.beat * 4 - 1e-6) / 4, step: 0, cur: -1 }; return; }
    this.held[sound] = null;
    this._hit(sound, vel, note);
  }
  // a hit of a sound's voice, at the trim it has now
  _hit(sound, vel, note) { const d = SOUNDS[sound]; this.e.trigger(d.trigger, vel, note); this.trimNow[d.engineVoice] = this.trim[d.engineVoice]; }
  /** the zone's newest key let go while an earlier one is held: the newest's sequence stops, and the earlier key plays
   * again (held, so its own sequence starts over) at once or on the next RETURN step of the grid */
  back(sound, note, vel, params) {
    this.held[sound] = null;
    const div = [0, 8, 4, 2, 1][this.retQ] || 0; // steps per beat
    if (!div) { this.play(sound, note, vel, params); return; }
    this.backs[sound] = { at: Math.ceil(this.beat * div - 1e-6) / div, note, vel, params };
  }
  /** every key of a sound let go: its sequence stops, and a key waiting to come back doesn't */
  release(sound) { this.held[sound] = null; this.backs[sound] = null; }
  /** the step each sound's sequence played last (0..7), -1 for none */
  readSteps() { return this.held.map((h) => (h ? h.cur : -1)); }
  setBpm(bpm) { this.bpm = Math.max(20, Math.min(300, bpm)); this.e.stepBpm = this.bpm; } // (STEP SEQ's STEP TIME follows it)
  // one 64-sample block at the engine's rate: each voice panned as it was triggered
  _block(dst) {
    // keys coming back on a step of the grid that falls in this block (1.45 ms), then the grid moves on
    const step = BLOCK * this.bpm / 60 / REAL_FS;
    for (let s = 0; s < this.backs.length; s++) { const b = this.backs[s]; if (b && b.at < this.beat + step) this.play(s, b.note, b.vel, b.params); }
    // the sequences' steps due in this block, a 1/16 (a quarter of a beat) apart; the pattern and ACTIVE are read as
    // they are now, so editing them while the key is held is heard at once
    for (let s = 0; s < this.held.length; s++) {
      const h = this.held[s]; if (!h) continue;
      const v = SOUNDS[s].engineVoice;
      while (h.at < this.beat + step) {
        if (this.seqOn[v] && (this.seqPat[v] >> h.step) & 1) this._hit(s, h.vel, h.note);
        h.cur = h.step; h.step = (h.step + 1) & 7; h.at += 0.25;
      }
    }
    this.beat += step;
    const out = this.e.renderBlock(), e = this.e;
    const pans = [e.drums[0], e.drums[1], e.drums[2], e.snare, e.cymbal, e.hat];
    const [L, R] = dst;
    L.fill(0); R.fill(0);
    // each voice's trim, gliding across the block to where it's set (the sends hear the trimmed voice too)
    const tr = this.trimBuf ||= [0, 1, 2, 3, 4, 5].map(() => new Float32Array(BLOCK));
    for (let n = 0; n < 6; n++) {
      const t0 = this.trimNow[n], t1 = this.trim[n], d = (t1 - t0) / BLOCK, t = tr[n];
      for (let i = 0; i < BLOCK; i++) t[i] = t0 + d * (i + 1);
      this.trimNow[n] = t1;
    }
    for (let n = 0; n < 6; n++) {
      const o = out[n], t = tr[n], pl = pans[n].triggeredPanL / 32768 * this.gain, pr = pans[n].triggeredPanR / 32768 * this.gain;
      let pk = this.peak[n];
      for (let i = 0; i < BLOCK; i++) { const v = o[i] * t[i]; L[i] += v * pl; R[i] += v * pr; const a = v < 0 ? -v : v; if (a > pk) pk = a; }
      this.peak[n] = pk;
    }
    // the echo's DUCK: the dry sound's level (fast up, 100 ms back down) turns the echo's return down by up to its depth,
    // so the echoes sit under each hit and swell back up in the gaps
    const dk = this.duck, dg = this.duckG;
    if (dk > 0) {
      let env = this.duckEnv; const a = this.duckA, r = this.duckR;
      for (let i = 0; i < BLOCK; i++) {
        const x = Math.max(Math.abs(L[i]), Math.abs(R[i]));
        env = x + (x > env ? a : r) * (env - x);
        dg[i] = 1 - dk * env / (env + 0.05); // half down at -26 dB, nearly all the way at a full hit
      }
      this.duckEnv = env;
    } else this.duckEnv = 0;
    // the sends: each effect's bus gets every voice panned in at its send, saturated to int16, and comes back all wet
    const buses = [this.echo, this.verb];
    for (let k = 0; k < buses.length; k++) {
      const sends = this.sends[k], bus = buses[k], bi = this.busIn; bi.fill(0);
      for (let n = 0; n < 6; n++) {
        const g = sends[n]; if (!g) continue;
        const o = out[n], t = tr[n], pl = pans[n].triggeredPanL * g, pr = pans[n].triggeredPanR * g;
        for (let i = 0; i < BLOCK; i++) { const v = o[i] * t[i]; bi[2 * i] += v * pl; bi[2 * i + 1] += v * pr; }
      }
      for (let i = 0; i < BLOCK * 2; i++) bus.input[i] = Math.max(-32768, Math.min(32767, Math.round(bi[i])));
      const bo = this.busOut; bo.fill(0);
      bus.process(bo, BLOCK, this.fxRng);
      const g = this.gain * this.ret[k] / 32768;
      if (!g) continue;
      if (k === 0 && dk > 0) for (let i = 0; i < BLOCK; i++) { const h = g * dg[i]; L[i] += bo[2 * i] * h; R[i] += bo[2 * i + 1] * h; }
      else for (let i = 0; i < BLOCK; i++) { L[i] += bo[2 * i] * g; R[i] += bo[2 * i + 1] * g; }
    }
    this._master(L, R, out);
    // a soft limit, so seven voices at once don't clip hard. The output meter reads both sides here: the peak that
    // goes out (after the limit), and whether the mix went over full scale on its way in (the limit squashing it: CLIP)
    const o = this.outPk;
    for (let i = 0; i < BLOCK; i++) {
      const l = L[i], r = R[i];
      if (l > 1 || l < -1) o[2] = 1;
      if (r > 1 || r < -1) o[3] = 1;
      L[i] = soft(l); R[i] = soft(r);
      const a = L[i] < 0 ? -L[i] : L[i], b = R[i] < 0 ? -R[i] : R[i];
      if (a > o[0]) o[0] = a; if (b > o[1]) o[1] = b;
    }
  }
  // the master: the distortion (its sidechain hears the mix, or one engine's own output), then a soft-knee compressor
  // (a peak detector in dB, gain reduction smoothed by attack and release), the makeup gain and the level
  _master(L, R, voices) {
    const M = this.m, D = this.dirt;
    if (D.active) {
      const src = D.p.sc ? D.p.src | 0 : 0;
      if (src >= 1 && src <= 3) { const n = SOUNDS[src - 1].engineVoice, o = voices[n], t = this.trimBuf[n], k = this.key, g = this.gain / 32768; for (let i = 0; i < BLOCK; i++) k[i] = o[i] * t[i] * g; }
      D.process(L, R, src >= 1 && src <= 3 ? this.key : null);
    } else D.readEnv();
    const T = -M.thresh, ratio = Math.max(1, M.ratio / 10), W = M.knee, slope = 1 / ratio - 1;
    const ca = Math.exp(-1000 / (Math.max(1, M.attack) * REAL_FS)), cr = Math.exp(-1000 / (Math.max(10, M.release) * REAL_FS));
    const out = Math.pow(10, M.makeup / 20) * M.level / 100;
    let env = this.env, gr = this.gr;
    for (let i = 0; i < BLOCK; i++) {
      const x = 20 * Math.log10(Math.max(Math.abs(L[i]), Math.abs(R[i])) + 1e-9), over = x - T;
      // the gain reduction wanted for this level (dB, <= 0): none below the knee, the full slope above it, a curve between
      const want = 2 * over < -W ? 0 : W > 0 && 2 * Math.abs(over) <= W ? slope * (over + W / 2) ** 2 / (2 * W) : slope * over;
      env = want + (want < env ? ca : cr) * (env - want);
      const g = Math.pow(10, env / 20) * out;
      L[i] *= g; R[i] *= g;
      if (-env > gr) gr = -env;
    }
    this.env = env; this.gr = gr;
  }
  /** the distortion's sidechain envelope (0..1) at its highest since the last call */
  readSc() { return this.dirt.readEnv(); }
  /** the output since the last call: [left peak, right peak] (0..1, what goes out) and [left, right] over full scale (CLIP) */
  readOut() { const o = this.outPk, r = [o[0], o[1], o[2], o[3]]; o.fill(0); return r; }
  /** the most gain reduction (dB) since the last call */
  readGr() { const g = this.gr; this.gr = 0; return g; }
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
