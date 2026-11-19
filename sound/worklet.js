// The instrument in an AudioWorklet. Messages from the page:
//   { type: 'kit', values }                     load a whole kit
//   { type: 'param', par, value }               one parameter edit (the base sound)
//   { type: 'play', sound, note, vel, params, hold }  play a sound (params: [[par, value], ...] set first; hold: a
//                                               key held down, so its sequence plays until 'release')
//   { type: 'back', sound, note, vel, params }  the zone back to an earlier held key, on the next RETURN step
//   { type: 'release', sound }                  every key of the zone let go
//   { type: 'engines', n }                      ENGINES: how many engines are in use (1..6)
//   { type: 'table', t }                        a wavetable the page made (sound/tables.js), for the voices whose TABLE it is
// It posts { type: 'peaks', peaks, ..., waves } about 30 times a second for the level lights (waves: where each voice's
// tone is on its WAVE dial now, modulation and all, for the wave display)
import { LxrInstrument } from './instrument.js?v=mwn23log';

registerProcessor('lxr-afx', class extends AudioWorkletProcessor {
  constructor() {
    super({ numberOfInputs: 0 });
    this.inst = new LxrInstrument(sampleRate);
    this.n = 0;
    this.port.onmessage = (e) => {
      const m = e.data;
      if (m.type === 'kit') this.inst.loadKit(m.values);
      else if (m.type === 'param') this.inst.setParam(m.par, m.value);
      else if (m.type === 'fx') this.inst.setFx(m.fx);
      else if (m.type === 'table') this.inst.hold(m.t);
      else if (m.type === 'engines') this.inst.setEngines(m.n);
      else if (m.type === 'release') this.inst.release(m.sound);
      else if (m.type === 'play') this.inst.play(m.sound, m.note, m.vel, m.params, m.hold !== false);
      else if (m.type === 'back') this.inst.back(m.sound, m.note, m.vel, m.params);
    };
  }
  process(_, outputs) {
    const o = outputs[0];
    // (an error in one block must not stop the processor: the browser would then go silent until the page reloads)
    try { this.inst.render(o[0], o[1] || o[0]); } catch (e) { o[0].fill(0); if (o[1]) o[1].fill(0); if (!this.told) { this.told = true; console.error('LXR-AFX engine error', e); } }
    if ((this.n += o[0].length) >= sampleRate / 30) { this.n = 0; this.port.postMessage({ type: 'peaks', peaks: this.inst.readPeaks(), gr: this.inst.readGr(), sc: this.inst.readSc(), steps: this.inst.readSteps(), waves: this.inst.e.voices.map((v) => v.osc.wraw) }); }
    return true;
  }
});
