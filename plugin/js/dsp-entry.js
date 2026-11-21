// Dipogon inside the plugin: the prototype's own instrument (sound/instrument.js, the same file the AudioWorklet runs),
// driven by the plugin instead of sound/worklet.js. Bundled into one script (plugin/tools/bundle.mjs) and run in
// JavaScriptCore on the plugin's audio thread. The native side calls the functions on globalThis.lxr:
//   init(sampleRate, left, right)  a new instrument; left/right: Float32Arrays over the plugin's output buffers
//   render(n)                      fill the first n samples of left/right
//   msg(json)                      a message from the page, as the worklet gets them, plus 'keys' and 'restore'
//   midi(status, d1, d2)           a MIDI event from the DAW, at the sample it is due (notes play here, not on the page)
//   poll()                         '' or the worklet's 'peaks' message as JSON (about 30 a second) for the page's meters
//
// Notes from the DAW are played here, sample accurately and with the plugin window shut: the page sends what every key
// plays ('keys': keyPatch() of each key, app/main.js window.afx.keyTable), and each zone is mono, last-note priority,
// as app/main.js keyDown / noteOff do it.
import { LxrInstrument } from '../../sound/instrument.js';
import { SOUNDS, setZoneStart } from '../../sound/schema.js';
import { BUILTIN_IDS, need } from '../../engine/wavetables.js';

let inst = null, L = null, R = null, views = new Map(), rate = 48000, n30 = 0, count = 0;
// what the instrument was last told, so a new one (another sample rate) starts the same
let last = { kit: null, fx: null, engines: null };
// keys[note] = [sound, note to play, [[par, value], ...]]
let keys = new Map();
const held = SOUNDS.map(() => []);

const plain = (k, v) => (ArrayBuffer.isView(v) ? Array.from(v) : v);

function view(n) {
  let v = views.get(n);
  if (!v) { v = [L.subarray(0, n), R.subarray(0, n)]; views.set(n, v); }
  return v;
}

function apply(m) {
  switch (m.type) {
    case 'kit': last.kit = m.values; inst.loadKit(m.values); break;
    case 'param': inst.setParam(m.par, m.value); break;
    case 'fx': last.fx = m.fx; inst.setFx(m.fx); break;
    case 'engines': last.engines = m.n; inst.setEngines(m.n); break;
    case 'release': inst.release(m.sound); break;
    case 'macro': if (m.v !== undefined) inst.setMacro(m.i, m.v); break;
    case 'play': inst.play(m.sound, m.note, m.vel, m.params, m.hold !== false, !!m.glide); break;
    case 'back': inst.back(m.sound, m.note, m.vel, m.params, !!m.glide); break;
    case 'table': break; // (made here: init() makes every built-in table)
    case 'keys': // every key's sound, or only the keys that changed
      if (m.full) keys = new Map();
      for (const [note, sound, play, params] of m.keys) keys.set(note, [sound, play, params]);
      if (m.drop) for (const n of m.drop) keys.delete(n);
      if (m.zoneStart) setZoneStart(m.zoneStart);
      break;
    case 'restore': { // a DAW project opened: the page's saved state (localStorage 'lxr-afx-v3') and its key table
      const s = m.store;
      if (s && s.values) { if (s.engines) apply({ type: 'engines', n: s.engines }); apply({ type: 'kit', values: s.values }); if (s.fx) apply({ type: 'fx', fx: s.fx }); }
      if (s && s.zoneStart) setZoneStart(s.zoneStart);
      if (m.keys) apply({ type: 'keys', full: true, keys: m.keys });
      held.forEach((h) => { h.length = 0; });
      break;
    }
    default: break;
  }
}

function keyDown(note, vel) {
  const k = keys.get(note); if (!k) return;
  const [sound, play, params] = k, st = held[sound], i = st.findIndex((x) => x.note === note);
  if (i >= 0) st.splice(i, 1);
  st.push({ note, vel });
  inst.play(sound, play, vel, params, true, true);
}
function keyUp(note) {
  const k = keys.get(note); if (!k) return;
  const sound = k[0], st = held[sound], i = st.findIndex((x) => x.note === note);
  if (i < 0) return;
  st.splice(i, 1);
  if (!st.length) inst.release(sound); // (as app/main.js noteOff: a key still held isn't played again)
}
function allOff() { held.forEach((st, sound) => { if (st.length) { st.length = 0; inst.release(sound); } }); }

globalThis.lxr = {
  init(sampleRate, left, right) {
    rate = sampleRate; L = left; R = right; views = new Map();
    for (const id of BUILTIN_IDS) need(id); // (every built-in wavetable now, not while a note plays)
    inst = new LxrInstrument(sampleRate);
    held.forEach((h) => { h.length = 0; });
    if (last.engines) inst.setEngines(last.engines);
    if (last.kit) inst.loadKit(last.kit);
    if (last.fx) inst.setFx(last.fx);
    n30 = 0;
  },
  render(n) {
    const [l, r] = view(n);
    try { inst.render(l, r); } catch (e) { l.fill(0); r.fill(0); if (!count++) globalThis.lxrError = String(e && e.stack || e); }
    n30 += n;
  },
  msg(json) { try { apply(JSON.parse(json)); } catch (e) { globalThis.lxrError = String(e && e.stack || e); } },
  midi(st, d1, d2) {
    const t = st & 0xf0, ch = (st & 0x0f) + 1;
    if (ch !== 1) return; // (only channel 1 plays, as on the page)
    if (t === 0x90 && d2 > 0) keyDown(d1, d2);
    else if (t === 0x80 || t === 0x90) keyUp(d1);
    else if (t === 0xb0 && (d1 === 120 || d1 === 123)) allOff();
  },
  poll() {
    if (n30 < rate / 30) return '';
    n30 = 0;
    return JSON.stringify({ type: 'peaks', peaks: inst.readPeaks(), gr: inst.readGr(), out: inst.readOut(), steps: inst.readSteps(), waves: inst.e.voices.map((v) => v.osc.wraw), mods: inst.e.readMods(), macros: [...inst.macroV], stepAt: [...inst.e.stepPlayed] }, plain);
  },
};
