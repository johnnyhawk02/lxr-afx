// LXR-AFX: the page. Seven sounds on MIDI channels 1 to 7; every key from C1 to C5 plays a morph of its sound (C3 plays
// the base). The editor changes the base; the morphs follow from it. The sound engine is in sound/ (no UI here).
import { SOUNDS, VOICE_SCHEMAS, INIT_VALUES, PAGES, PAR, MOD_TARGETS, MOD_TARGET_VOICE_RANGES, NUM_PARAMS,
  voiceOwned, voiceOfTarget, showValue, parseSnd } from '../sound/schema.js';
import { morphKey, combinedAmount, newSeed, pitchOffset, keyDistance, BASE_NOTE, LOW_NOTE, HIGH_NOTE } from '../sound/morph.js';
import { KIT_FILES } from '../sound/kits.js';

const $ = (id) => document.getElementById(id);
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const noteName = (n) => NOTE_NAMES[n % 12] + (Math.floor(n / 12) - 2); // C3 = 60
const hex = (s) => (s >>> 0).toString(16).toUpperCase().padStart(8, '0');

// ---------------------------------------------------------------------------------------------------------------
// state, kept in this browser
// ---------------------------------------------------------------------------------------------------------------
const STORE = 'lxr-afx-v1';
const defaultLocks = () => { const s = new Set(); for (const sc of VOICE_SCHEMAS) for (const e of sc) if (e.rand === 'lock') s.add(e.par); return s; };
const S = {
  values: INIT_VALUES.slice(), // the kit: every sound's base
  defaults: INIT_VALUES.slice(), // what a double-click resets to (the last kit loaded)
  global: { depth: 100, pitch: 100, timbre: 100 },
  sounds: SOUNDS.map(() => ({ depth: 50, pitch: 50, timbre: 50, seed: newSeed() })),
  locks: defaultLocks(),
  rand: { amount: 30, wild: false },
  sel: 0, page: 0,
};
try {
  const d = JSON.parse(localStorage.getItem(STORE));
  if (d && d.values && d.values.length === NUM_PARAMS) {
    S.values = Uint8Array.from(d.values); S.defaults = Uint8Array.from(d.defaults || d.values);
    Object.assign(S.global, d.global); d.sounds.forEach((s, i) => Object.assign(S.sounds[i], s));
    S.locks = new Set(d.locks); Object.assign(S.rand, d.rand); S.sel = d.sel | 0; S.page = d.page | 0;
  }
} catch (e) { /* first visit, or storage blocked */ }
let saveT = 0;
const save = () => {
  clearTimeout(saveT);
  saveT = setTimeout(() => {
    try {
      localStorage.setItem(STORE, JSON.stringify({ values: [...S.values], defaults: [...S.defaults], global: S.global, sounds: S.sounds,
        locks: [...S.locks], rand: S.rand, sel: S.sel, page: S.page }));
    } catch (e) { /* storage blocked: it just isn't kept */ }
  }, 300);
};

const kits = KIT_FILES.map((k) => parseSnd(Uint8Array.from(atob(k.data), (c) => c.charCodeAt(0))));

// ---------------------------------------------------------------------------------------------------------------
// audio
// ---------------------------------------------------------------------------------------------------------------
let ctx = null, node = null;
const send = (m) => { if (node) node.port.postMessage(m); };
async function startAudio() {
  if (ctx) { if (ctx.state !== 'running') await ctx.resume(); return; }
  ctx = new AudioContext({ latencyHint: 'interactive' });
  await ctx.audioWorklet.addModule(new URL('../sound/worklet.js', import.meta.url));
  node = new AudioWorkletNode(ctx, 'lxr-afx', { numberOfInputs: 0, outputChannelCount: [2] });
  node.port.onmessage = (e) => { if (e.data.type === 'peaks') showPeaks(e.data.peaks); };
  node.connect(ctx.destination);
  send({ type: 'kit', values: S.values });
  if (ctx.state !== 'running') await ctx.resume();
}

// a sound on a key: the morph of its base for that key, then the trigger
const lastMorph = SOUNDS.map(() => null);
function play(sound, note, vel) {
  const def = SOUNDS[sound], sc = VOICE_SCHEMAS[def.engineVoice], st = S.sounds[sound];
  const amount = combinedAmount(pct(S.global), pct(st));
  const m = morphKey({ schema: sc, base: S.values, note, seed: st.seed, amount, voice: def.engineVoice });
  if (ctx && ctx.state !== 'running') ctx.resume();
  send({ type: 'play', sound, note: m.note, vel, params: m.params });
  lastMorph[sound] = { key: note, values: new Map(m.params), semitones: m.semitones };
  showLast(sound, note, vel, m.semitones);
  if (sound === S.sel) { drawFaders(); drawKeymap(); }
}
const pct = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, k === 'seed' ? v : v / 100]));

// a base edit: kept, sent, and it becomes the randomiser's new home for that voice
const homes = {};
function setValue(par, v, { quiet = false } = {}) {
  if (S.values[par] === v) return;
  S.values[par] = v;
  send({ type: 'param', par, value: v });
  if (!quiet) for (const k in homes) if (VOICE_SCHEMAS[k].some((e) => e.par === par)) delete homes[k];
  save();
}

// ---------------------------------------------------------------------------------------------------------------
// MIDI: note-ons on channels 1..7, keys C1..C5
// ---------------------------------------------------------------------------------------------------------------
let midi = null;
function midiStatus(text, live) { const el = $('midi-status'); el.textContent = text; el.classList.toggle('live', !!live); el.title = text; }
function onMidi(e) {
  const [st, note, vel] = e.data;
  if ((st & 0xf0) !== 0x90 || !vel) return; // note-ons only (a note-on at velocity 0 is a note-off)
  const ch = (st & 0x0f) + 1;
  noteOn(ch, note, vel);
}
function noteOn(ch, note, vel) {
  if (ch < 1 || ch > 7) { showLastText(`CH ${ch} · ${noteName(note)} · not a sound channel (1-7)`); return; }
  if (note < LOW_NOTE || note > HIGH_NOTE) { showLastText(`CH ${ch} · ${noteName(note)} · outside C1-C5`); return; }
  play(ch - 1, note, vel);
}
async function startMidi() {
  if (!navigator.requestMIDIAccess) { midiStatus('MIDI: not in this browser (use Chrome or Edge)'); return; }
  try {
    midi = await navigator.requestMIDIAccess();
    const hook = () => {
      const ins = [...midi.inputs.values()];
      for (const i of ins) i.onmidimessage = onMidi;
      midiStatus(ins.length ? 'MIDI: ' + ins.map((i) => i.name).join(', ') : 'MIDI: no input connected', ins.length);
    };
    midi.onstatechange = hook; hook();
  } catch (err) { midiStatus('MIDI: permission refused'); }
}
// for testing without a controller: afx.noteOn(channel, note, velocity) from the console
window.afx = { noteOn: (ch, note, vel = 100) => noteOn(ch, note, vel) };

// ---------------------------------------------------------------------------------------------------------------
// the last note
// ---------------------------------------------------------------------------------------------------------------
let lastT = 0;
function showLastText(t) {
  $('last-text').textContent = t;
  const box = $('last'); box.classList.add('hit'); clearTimeout(lastT); lastT = setTimeout(() => box.classList.remove('hit'), 90);
}
function showLast(sound, note, vel, st) {
  const p = note === BASE_NOTE ? 'BASE' : (st >= 0 ? '+' : '−') + Math.abs(st).toFixed(2) + ' ST';
  showLastText(`CH ${sound + 1} · ${SOUNDS[sound].name} · ${noteName(note)} · VEL ${vel} · ${p}`);
  const led = soundBtns[sound].querySelector('i');
  led.classList.add('on'); clearTimeout(led._t); led._t = setTimeout(() => led.classList.remove('on'), 120);
}
function showPeaks(peaks) {
  // the level lights follow the engine voices (both hats light with the hat voice)
  SOUNDS.forEach((s, i) => { if (peaks[s.engineVoice] > 0.02) { const led = soundBtns[i].querySelector('i'); led.classList.add('on'); clearTimeout(led._t); led._t = setTimeout(() => led.classList.remove('on'), 80); } });
}

// ---------------------------------------------------------------------------------------------------------------
// controls: horizontal bars (morph, amount, level) and vertical faders (the editor)
// ---------------------------------------------------------------------------------------------------------------
let detailT = 0;
const detail = (html) => { $('detail').innerHTML = html; };
// a drag changes a value from where it was; Shift is fine
function dragger(track, axis, o) {
  let d = null;
  track.addEventListener('pointerdown', (e) => {
    if (e.button) return;
    track.setPointerCapture(e.pointerId); track.focus({ preventScroll: true }); e.preventDefault();
    const r = track.getBoundingClientRect(), len = axis === 'x' ? r.width : r.height;
    // a press off the bar's end jumps there
    const at = axis === 'x' ? (e.clientX - r.left) / r.width : (r.bottom - e.clientY) / r.height;
    const f = (o.get() - o.min) / (o.max - o.min);
    if (Math.abs(at - f) * len > 8) o.put(o.min + clamp(at, 0, 1) * (o.max - o.min));
    d = { last: axis === 'x' ? e.clientX : e.clientY, acc: o.get(), len };
    o.held && o.held(true);
  });
  track.addEventListener('pointermove', (e) => {
    if (!d) return;
    const p = axis === 'x' ? e.clientX : e.clientY, dp = axis === 'x' ? p - d.last : d.last - p;
    d.last = p; d.acc = clamp(d.acc + dp / d.len * (o.max - o.min) * (e.shiftKey ? 0.25 : 1), o.min, o.max);
    o.put(d.acc);
  });
  const end = () => { if (d) { d = null; o.held && o.held(false); } };
  track.addEventListener('pointerup', end); track.addEventListener('pointercancel', end);
  track.addEventListener('wheel', (e) => { e.preventDefault(); o.put(o.get() + (e.deltaY < 0 ? 1 : -1) * (o.max - o.min > 20 ? 2 : 1)); }, { passive: false });
  track.addEventListener('keydown', (e) => {
    const big = Math.max(1, Math.round((o.max - o.min) / 10));
    const k = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1, PageUp: big, PageDown: -big }[e.key];
    if (k) { o.put(o.get() + k); e.preventDefault(); e.stopPropagation(); }
  });
}
function hbar(box, label, o) {
  const el = document.createElement('div'); el.className = 'hb';
  el.innerHTML = `<span class="lab"></span><div class="htrack" role="slider" tabindex="0"><i></i></div><output></output>`;
  el.querySelector('.lab').textContent = label;
  const tr = el.querySelector('.htrack'), out = el.querySelector('output');
  tr.setAttribute('aria-label', label); tr.setAttribute('aria-valuemin', o.min); tr.setAttribute('aria-valuemax', o.max);
  const draw = () => { const v = o.get(); tr.style.setProperty('--f', (v - o.min) / (o.max - o.min)); out.textContent = o.show(v); tr.setAttribute('aria-valuenow', v); };
  const put = (v) => { v = clamp(Math.round(v), o.min, o.max); if (v !== o.get()) { o.set(v); draw(); } };
  dragger(tr, 'x', { ...o, put });
  el.querySelector('.lab').addEventListener('dblclick', () => put(typeof o.dflt === 'function' ? o.dflt() : o.dflt));
  tr.addEventListener('dblclick', () => put(typeof o.dflt === 'function' ? o.dflt() : o.dflt));
  box.append(el);
  return draw;
}

// ---- the morph bars ----
const P = (v) => v + '%';
const globalDraws = ['depth', 'pitch', 'timbre'].map((k) => hbar($('global-bars'), k.toUpperCase(), {
  min: 0, max: 100, get: () => S.global[k], set: (v) => { S.global[k] = v; save(); drawKeymap(); }, show: P, dflt: 100 }));
const soundDraws = ['depth', 'pitch', 'timbre'].map((k) => hbar($('sound-bars'), k.toUpperCase(), {
  min: 0, max: 100, get: () => S.sounds[S.sel][k], set: (v) => { S.sounds[S.sel][k] = v; save(); drawKeymap(); }, show: P, dflt: 50 }));
$('reroll').addEventListener('click', () => reroll());
function reroll() { S.sounds[S.sel].seed = newSeed(); lastMorph[S.sel] = null; save(); drawSide(); drawFaders(); detail(`${SOUNDS[S.sel].name}: new seed <em>${hex(S.sounds[S.sel].seed)}</em>`); }

// ---- level and the randomiser's amount ----
const levelPar = () => PAR['VOL' + (SOUNDS[S.sel].engineVoice + 1)];
const randDraws = [
  hbar($('rand-bars'), 'AMOUNT', { min: 0, max: 100, get: () => S.rand.amount, set: (v) => { S.rand.amount = v; save(); }, show: P, dflt: 30 }),
  hbar($('rand-bars'), 'LEVEL', { min: 0, max: 127, get: () => S.values[levelPar()], set: (v) => { setValue(levelPar(), v); drawFaders(); }, show: String, dflt: () => S.defaults[levelPar()] }),
];
$('wild').checked = S.rand.wild;
$('wild').addEventListener('change', () => { S.rand.wild = $('wild').checked; save(); });

// ---------------------------------------------------------------------------------------------------------------
// the key map: each key's pitch offset (a bar up or down from the middle line) and timbre amount (the dots under it)
// ---------------------------------------------------------------------------------------------------------------
function drawKeymap() {
  const cv = $('keymap'), dpr = window.devicePixelRatio || 1;
  const cw0 = cv.clientWidth, ch0 = cv.clientHeight;
  if (!cw0 || !ch0) return;
  if (cv.width !== Math.round(cw0 * dpr) || cv.height !== Math.round(ch0 * dpr)) { cv.width = Math.round(cw0 * dpr); cv.height = Math.round(ch0 * dpr); }
  const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
  const W = cw0, H = ch0, ink = '#17200e', ghost = 'rgba(23,32,14,.11)';
  g.clearRect(0, 0, W, H);
  const n = HIGH_NOTE - LOW_NOTE + 1, cw = W / n;
  // rows: pitch (up and down from the middle line), then timbre, then the keyboard strip
  const SEG = 5, STEP = 7, keysH = 8, timbreH = 3 * STEP, top = 4;
  const half = Math.floor((H - top - keysH - timbreH - 12) / 2 / STEP) * STEP, mid = top + half;
  const st = S.sounds[S.sel], amount = combinedAmount(pct(S.global), pct(st)), last = lastMorph[S.sel];
  const segsMax = half / STEP;
  for (let k = 0; k < n; k++) {
    const note = LOW_NOTE + k, x = Math.round(k * cw) + 1, w = Math.max(2, Math.round(cw) - 2);
    g.fillStyle = ghost;
    for (let s = 0; s < segsMax; s++) { g.fillRect(x, mid - STEP - s * STEP + 1, w, SEG); g.fillRect(x, mid + 1 + s * STEP, w, SEG); }
    // pitch: a segment per twelfth of the full 12 semitones' height, from the middle line
    const semis = pitchOffset(note, st.seed, amount.pitch), segs = Math.round(Math.abs(semis) / 12 * segsMax);
    g.fillStyle = ink;
    for (let s = 0; s < segs; s++) g.fillRect(x, semis > 0 ? mid - STEP - s * STEP + 1 : mid + 1 + s * STEP, w, SEG);
    // timbre: up to three segments
    const ty = mid + half + 6, t = Math.round(amount.timbre * keyDistance(note).dist * 3);
    for (let s = 0; s < 3; s++) { g.fillStyle = s < t ? ink : ghost; g.fillRect(x, ty + (2 - s) * STEP, w, SEG); }
    // the keyboard strip: white keys full, black keys short; C3 solid
    const ky = ty + timbreH + 3, black = [1, 3, 6, 8, 10].includes(note % 12);
    g.fillStyle = note === BASE_NOTE ? ink : black ? 'rgba(23,32,14,.35)' : 'rgba(23,32,14,.7)';
    g.fillRect(x, ky, w, black ? keysH / 2 : keysH);
    if (last && last.key === note) { g.strokeStyle = ink; g.lineWidth = 2; g.strokeRect(x - 2, top - 3, w + 4, ky + keysH - top + 6); }
  }
  g.fillStyle = 'rgba(23,32,14,.55)'; g.fillRect(0, mid, W, 1);
}
window.addEventListener('resize', drawKeymap);

// ---------------------------------------------------------------------------------------------------------------
// the seven sounds
// ---------------------------------------------------------------------------------------------------------------
const soundBtns = SOUNDS.map((s, i) => {
  const b = document.createElement('button');
  b.className = 'btn snd'; b.type = 'button'; b.setAttribute('role', 'tab');
  b.innerHTML = `<i></i><span>${s.name}</span><span class="ch">CH${i + 1}</span>`;
  b.title = `${s.name}: MIDI channel ${i + 1} (key ${i + 1})`;
  b.addEventListener('click', () => select(i));
  $('sounds').append(b);
  return b;
});
function select(i) {
  S.sel = i; save();
  soundBtns.forEach((b, k) => b.setAttribute('aria-selected', k === i));
  buildFaders(); drawSide();
}
function drawSide() {
  const s = SOUNDS[S.sel];
  $('side-name').textContent = s.name; $('side-ch').textContent = 'CH ' + (S.sel + 1);
  $('rand-name').textContent = s.name + (s.engineVoice === 5 ? ' (HATS SHARE)' : '');
  $('seed').textContent = hex(S.sounds[S.sel].seed);
  soundDraws.forEach((d) => d()); globalDraws.forEach((d) => d()); randDraws.forEach((d) => d());
  drawLocks(); drawKeymap();
}

// ---------------------------------------------------------------------------------------------------------------
// the editor: every parameter of the selected sound, on five pages
// ---------------------------------------------------------------------------------------------------------------
const pageBtns = PAGES.map((p, i) => {
  const b = document.createElement('button'); b.className = 'btn'; b.type = 'button'; b.setAttribute('role', 'tab'); b.textContent = p.toUpperCase();
  b.addEventListener('click', () => { S.page = i; save(); buildFaders(); });
  $('pages').append(b);
  return b;
});
let faderDraws = [];
function buildFaders() {
  pageBtns.forEach((b, i) => b.setAttribute('aria-selected', i === S.page));
  const box = $('faders'); box.innerHTML = ''; faderDraws = [];
  const voice = SOUNDS[S.sel].engineVoice, page = PAGES[S.page];
  const entries = VOICE_SCHEMAS[voice].filter((e) => e.page === page);
  const sections = [...new Set(entries.map((e) => e.section))];
  for (const sec of sections) {
    const list = entries.filter((e) => e.section === sec);
    const n = list.reduce((a, e) => a + (e.display.type === 'target' ? 2 : 1), 0);
    const el = document.createElement('div'); el.className = 'sect'; el.style.setProperty('--n', n);
    el.innerHTML = `<h3>${sec}</h3><div class="row"></div>`;
    const row = el.querySelector('.row');
    for (const e of list) row.append(e.display.type === 'target' ? targetSelect(e, voice) : vfader(e));
    box.append(el);
  }
  drawFaders();
}
function drawFaders() { faderDraws.forEach((d) => d()); }
function vfader(e) {
  const el = document.createElement('div'); el.className = 'vf';
  el.innerHTML = `<output></output><div class="vtrack" role="slider" tabindex="0"><i></i><b></b></div><span class="lab"></span><button class="lock" type="button">LOCK</button>`;
  el.querySelector('.lab').textContent = e.label;
  const tr = el.querySelector('.vtrack'), out = el.querySelector('output'), lock = el.querySelector('.lock');
  tr.setAttribute('aria-label', e.label); tr.setAttribute('aria-valuemin', 0); tr.setAttribute('aria-valuemax', e.max);
  lock.title = `Lock ${e.label}: the randomisers leave it alone`;
  const draw = () => {
    const v = S.values[e.par];
    tr.style.setProperty('--f', v / e.max); out.textContent = showValue(e, v);
    tr.setAttribute('aria-valuenow', v); tr.setAttribute('aria-valuetext', showValue(e, v));
    const lm = lastMorph[S.sel], mv = lm && lm.values.get(e.par);
    tr.classList.toggle('morphed', mv !== undefined && mv !== v);
    if (mv !== undefined) tr.style.setProperty('--m', mv / e.max);
    el.classList.toggle('changed', v !== S.defaults[e.par]);
    lock.setAttribute('aria-pressed', S.locks.has(e.par));
  };
  const put = (x) => {
    x = clamp(Math.round(x), 0, e.max);
    if (x === S.values[e.par]) return;
    setValue(e.par, x); draw();
    if (e.par === levelPar()) randDraws[1]();
    detail(`${SOUNDS[S.sel].name} ${e.label.toUpperCase()} <em>${showValue(e, x)}</em>${e.morph ? ' · morphs with timbre' : ''}`);
  };
  dragger(tr, 'y', { min: 0, max: e.max, get: () => S.values[e.par], put, held: (h) => el.classList.toggle('held', h) });
  const reset = () => put(S.defaults[e.par]);
  el.querySelector('.lab').addEventListener('dblclick', reset); tr.addEventListener('dblclick', reset);
  tr.addEventListener('focus', () => detail(`${SOUNDS[S.sel].name} ${e.label.toUpperCase()} <em>${showValue(e, S.values[e.par])}</em>${e.morph ? ' · morphs with timbre' : ''}`));
  lock.addEventListener('click', () => { if (S.locks.has(e.par)) S.locks.delete(e.par); else S.locks.add(e.par); save(); draw(); drawLocks(); });
  faderDraws.push(draw);
  return el;
}
// a modulation target: velocity targets stay in the voice, LFO targets can reach any voice
function targetSelect(e, voice) {
  const el = document.createElement('div'); el.className = 'vsel';
  const id = 'sel-' + e.par;
  el.innerHTML = `<label for="${id}">${e.label}</label>`;
  const s = document.createElement('select'); s.id = id;
  s.append(new Option('none', 0));
  const vnames = ['drum 1', 'drum 2', 'drum 3', 'snare', 'cymbal', 'hihat'];
  for (const v of e.display.anyVoice ? [0, 1, 2, 3, 4, 5] : [voice]) {
    const og = document.createElement('optgroup'); og.label = vnames[v];
    const [a, b] = MOD_TARGET_VOICE_RANGES[v];
    for (let i = a; i <= b; i++) {
      const [t, p] = MOD_TARGETS[i];
      if (t.startsWith('FX_') || t === 'VEL_DEST') continue;
      const pe = VOICE_SCHEMAS[v].find((x) => x.par === p);
      og.append(new Option(pe ? `${pe.section} ${pe.label}` : t.toLowerCase().replace(/_/g, ' '), i));
    }
    s.append(og);
  }
  s.addEventListener('change', () => {
    setValue(e.par, Number(s.value));
    if (e.display.anyVoice) setValue(PAR.VOICE_LFO1 + voice, voiceOfTarget(Number(s.value)) + 1, { quiet: true });
    detail(`${SOUNDS[S.sel].name} ${e.label.toUpperCase()} <em>${s.selectedOptions[0].text}</em>`);
  });
  el.append(s);
  faderDraws.push(() => { s.value = S.values[e.par]; });
  return el;
}

// ---------------------------------------------------------------------------------------------------------------
// randomisers (the logic of Elixir Desktop's, plus locks): every press starts from the voice's home (what it was before
// the first randomise since the last edit), so repeated presses vary one sound instead of drifting. Drum-safe ranges
// unless WILD; a locked control never moves
// ---------------------------------------------------------------------------------------------------------------
let rngState = (Date.now() ^ 0x9e3779b9) >>> 0 || 1;
const rnd = () => { rngState ^= rngState << 13; rngState >>>= 0; rngState ^= rngState >>> 17; rngState ^= rngState << 5; rngState >>>= 0; return rngState / 4294967296; };
let undoValues = null;
function randomiseVoice(voice, depth, wild) {
  const sc = VOICE_SCHEMAS[voice];
  if (!homes[voice]) homes[voice] = new Map(sc.map((e) => [e.par, S.values[e.par]]));
  const home = homes[voice];
  for (const e of sc) {
    if (S.locks.has(e.par) || e.display.type === 'target') continue;
    const h = home.get(e.par);
    let range = wild || e.rand === 'lock' ? [0, e.max] : e.rand; // an unlocked 'lock' control moves over its whole range
    let v = h;
    if (range === 'pitch') v = Math.round(h + (rnd() * 2 - 1) * depth * 12); // up to an octave either way
    else if (e.max < 20) { if (rnd() < depth) v = range[0] + Math.floor(rnd() * (Math.min(e.max, range[1]) - range[0] + 1)); }
    else {
      const lo = Math.min(range[0], h), hi = Math.max(range[1], h); // the home always stays reachable
      v = clamp(Math.round(h + (rnd() * 2 - 1) * depth * (hi - lo)), lo, hi);
    }
    setValue(e.par, clamp(v, 0, e.max), { quiet: true });
  }
}
// voice v from a random built-in kit (its level and pan stay)
function pickVoice(v) {
  const k = kits[Math.floor(rnd() * kits.length)].kit;
  const keep = new Set([PAR.VOL1 + v, PAR.PAN1 + v]);
  for (const par of voiceOwned(v)) if (!keep.has(par)) { setValue(par, k[par], { quiet: true }); S.defaults[par] = k[par]; }
  delete homes[v];
}
const alterVoice = (v) => { delete homes[v]; randomiseVoice(v, 0.1, false); delete homes[v]; };
async function randChange(fn, what) {
  await startAudio();
  undoValues = S.values.slice(); $('undo').disabled = false;
  fn();
  for (const s of lastMorph.keys()) lastMorph[s] = null;
  save(); drawFaders(); drawSide();
  detail(what);
}
const selVoice = () => SOUNDS[S.sel].engineVoice;
$('rand').addEventListener('click', () => randChange(() => randomiseVoice(selVoice(), S.rand.amount / 100, S.rand.wild),
  `${SOUNDS[S.sel].name} randomised <em>${S.rand.amount}%${S.rand.wild ? ' wild' : ''}</em>`));
$('from-kit').addEventListener('click', () => randChange(() => pickVoice(selVoice()), `${SOUNDS[S.sel].name} from a random built-in kit`));
$('alter').addEventListener('click', () => randChange(() => alterVoice(selVoice()), `${SOUNDS[S.sel].name} altered <em>10%</em>`));
$('kit-rand').addEventListener('click', () => randChange(() => { for (let v = 0; v < 6; v++) pickVoice(v); }, 'every sound from a random built-in kit'));
$('kit-alter').addEventListener('click', () => randChange(() => { for (let v = 0; v < 6; v++) alterVoice(v); }, 'every sound altered <em>10%</em>'));
$('kit-init').addEventListener('click', () => randChange(() => {
  for (let p = 0; p < NUM_PARAMS; p++) setValue(p, INIT_VALUES[p], { quiet: true });
  S.defaults = INIT_VALUES.slice(); for (const k in homes) delete homes[k];
}, 'the init kit'));
$('undo').addEventListener('click', () => {
  if (!undoValues) return;
  for (let p = 0; p < NUM_PARAMS; p++) setValue(p, undoValues[p], { quiet: true });
  undoValues = null; $('undo').disabled = true;
  for (const k in homes) delete homes[k];
  drawFaders(); drawSide(); detail('undone');
});
function drawLocks() {
  const n = VOICE_SCHEMAS[selVoice()].filter((e) => S.locks.has(e.par)).length;
  $('lock-count').textContent = `${n} LOCKED`;
}
$('lock-default').addEventListener('click', () => {
  const d = defaultLocks();
  for (const e of VOICE_SCHEMAS[selVoice()]) { if (d.has(e.par)) S.locks.add(e.par); else S.locks.delete(e.par); }
  save(); drawFaders(); drawLocks();
});
$('lock-none').addEventListener('click', () => { for (const e of VOICE_SCHEMAS[selVoice()]) S.locks.delete(e.par); save(); drawFaders(); drawLocks(); });

// ---------------------------------------------------------------------------------------------------------------
// keys: 1-7 pick a sound, [ and ] the editor page, R re-rolls the seed
// ---------------------------------------------------------------------------------------------------------------
document.addEventListener('keydown', (e) => {
  if (e.target.closest('select') || e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key >= '1' && e.key <= '7') select(Number(e.key) - 1);
  else if (e.key === '[' || e.key === ']') { S.page = (S.page + (e.key === ']' ? 1 : PAGES.length - 1)) % PAGES.length; save(); buildFaders(); }
  else if (e.key === 'r' || e.key === 'R') reroll();
});

// ---------------------------------------------------------------------------------------------------------------
// start
// ---------------------------------------------------------------------------------------------------------------
$('start-btn').addEventListener('click', async () => {
  $('start').hidden = true;
  await startAudio();
  startMidi();
});
select(clamp(S.sel, 0, 6));
if (new URLSearchParams(location.search).has('nostart')) $('start').hidden = true; // screenshots
