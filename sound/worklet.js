// The instrument in an AudioWorklet. Messages from the page:
//   { type: 'kit', values }                     load a whole kit
//   { type: 'param', par, value }               one parameter edit (the base sound)
//   { type: 'play', sound, note, vel, params }  play a sound (params: [[par, value], ...] set first)
// It posts { type: 'peaks', peaks } about 30 times a second for the level lights.
import { LxrInstrument } from './instrument.js?v=mwkmgli3';

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
      else if (m.type === 'play') this.inst.play(m.sound, m.note, m.vel, m.params);
    };
  }
  process(_, outputs) {
    const o = outputs[0];
    this.inst.render(o[0], o[1] || o[0]);
    if ((this.n += o[0].length) >= sampleRate / 30) { this.n = 0; this.port.postMessage({ type: 'peaks', peaks: this.inst.readPeaks(), gr: this.inst.readGr() }); }
    return true;
  }
});
