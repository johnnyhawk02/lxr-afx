// LXR-AFX: the page. Seven sounds on MIDI channels 1 to 7; every key from C1 to C5 plays a morph of its sound (C3 plays
// the base). The editor changes the base; the morphs follow from it. The sound engine is in sound/ (no UI here).
import { SOUNDS, VOICE_SCHEMAS, INIT_VALUES, PAGES, PAR, MOD_TARGETS, MOD_TARGET_VOICE_RANGES, NUM_PARAMS, ALL_PARAMS,
  voiceOwned, voiceOfTarget, showValue, parseSnd, soundOfNote, mapVoice, setZoneStart, DEFAULT_ZONE_START } from '../sound/schema.js?v=mwkmgli3';
import { morphKey, combinedAmount, newSeed, pitchOffset, keyDistance, BASE_NOTE } from '../sound/morph.js?v=mwkmgli3';
import { KIT_FILES } from '../sound/kits.js?v=mwkmgli3';
import { FX_DEFAULTS, echoMs } from '../sound/instrument.js?v=mwkmgli3';

const $ = (id) => document.getElementById(id);
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const noteName = (n) => NOTE_NAMES[n % 12] + (Math.floor(n / 12) - 2); // C3 = 60
const hex = (s) => (s >>> 0).toString(16).toUpperCase().padStart(8, '0');

// ---------------------------------------------------------------------------------------------------------------
// state, kept in this browser
// ---------------------------------------------------------------------------------------------------------------
const STORE = 'lxr-afx-v3'; // v3: AFX mode, three zones on the Bass Station 2's 25 keys
const defaultLocks = () => { const s = new Set(); for (const sc of VOICE_SCHEMAS) for (const e of sc) if (e.rand === 'lock') s.add(e.par); return s; };
const S = {
  values: INIT_VALUES.slice(), // the kit: every sound's base
  defaults: INIT_VALUES.slice(), // what a double-click resets to (the last kit loaded)
  global: { depth: 100, pitch: 100, timbre: 100 },
  sounds: SOUNDS.map(() => ({ depth: 50, pitch: 50, timbre: 50, seed: newSeed() })),
  locks: defaultLocks(),
  rand: { amount: 30, wild: false },
  sel: 0, page: 0,
  // per-key edits: keyEdits[sound][note] = { parameter: value }, laid over that key's morph
  keyEdits: SOUNDS.map(() => ({})),
  editAll: false,
  ccMap: null, // knob map, CC number -> target; null: the Bass Station 2 default
  fx: structuredClone(FX_DEFAULTS), // the three send effects' settings (the FX page)
  view: 'synth', // the editor shows the engine's knobs ('synth') or the effects ('fx')
  zoneStart: DEFAULT_ZONE_START, // the layout's lowest key (moved by octaves with LOW KEY) // the editor edits the last key pressed (false) or the base of every key (true)
};
try {
  const d = JSON.parse(localStorage.getItem(STORE));
  if (d && d.values && (d.values.length === NUM_PARAMS || d.values.length === ALL_PARAMS)) {
    const fit = (a) => { const o = INIT_VALUES.slice(); o.set(a.slice(0, ALL_PARAMS)); return o; };
    S.values = fit(d.values); S.defaults = fit(d.defaults || d.values);
    if (d.fx) for (const k in S.fx) Object.assign(S.fx[k], d.fx[k]);
    if (d.values.length === NUM_PARAMS) d.locks = [...d.locks, ...[...defaultLocks()].filter((p) => p >= NUM_PARAMS)]; // the sends are new: locked
    Object.assign(S.global, d.global); d.sounds.forEach((s, i) => Object.assign(S.sounds[i], s));
    S.locks = new Set(d.locks); Object.assign(S.rand, d.rand); S.sel = d.sel | 0; S.page = d.page | 0;
    if (d.keyEdits) d.keyEdits.forEach((k, i) => { S.keyEdits[i] = k || {}; }); S.editAll = !!d.editAll; if (d.zoneStart) S.zoneStart = d.zoneStart; S.ccMap = d.ccMap || null;
  }
} catch (e) { /* first visit, or storage blocked */ }
let saveT = 0;
const save = () => {
  clearTimeout(saveT);
  saveT = setTimeout(() => {
    try {
      localStorage.setItem(STORE, JSON.stringify({ values: [...S.values], defaults: [...S.defaults], global: S.global, sounds: S.sounds,
        locks: [...S.locks], rand: S.rand, sel: S.sel, page: S.page, keyEdits: S.keyEdits, editAll: S.editAll, zoneStart: S.zoneStart, ccMap: S.ccMap, fx: S.fx }));
    } catch (e) { /* storage blocked: it just isn't kept */ }
  }, 300);
};

setZoneStart(S.zoneStart);
const kits = KIT_FILES.map((k) => parseSnd(Uint8Array.from(atob(k.data), (c) => c.charCodeAt(0))));

// ---------------------------------------------------------------------------------------------------------------
// audio
// ---------------------------------------------------------------------------------------------------------------
let ctx = null, node = null;
const send = (m) => { if (node) node.port.postMessage(m); };
async function startAudio() {
  if (ctx) { if (ctx.state !== 'running') await ctx.resume(); return; }
  ctx = new AudioContext({ latencyHint: 'interactive' });
  await ctx.audioWorklet.addModule(new URL('../sound/worklet.js?v=mwkmgli3', import.meta.url));
  node = new AudioWorkletNode(ctx, 'lxr-afx', { numberOfInputs: 0, outputChannelCount: [2] });
  node.port.onmessage = (e) => { if (e.data.type === 'peaks') { showPeaks(e.data.peaks); showGr(e.data.gr || 0); } };
  node.connect(ctx.destination);
  send({ type: 'kit', values: S.values });
  send({ type: 'fx', fx: S.fx });
  if (ctx.state !== 'running') await ctx.resume();
}

// what a key of a sound plays: every parameter of its voice, from the base, then the key's morph, then the key's own
// edits on top. All of the voice's parameters are sent with each note (the engine skips unchanged ones), so an edit
// made on one key never stays on for the next
function keyPatch(sound, note) {
  const def = SOUNDS[sound], v = def.engineVoice, st = S.sounds[sound];
  // no morph (dropped): a key with no sound of its own plays the engine's base sound
  const m = { note: BASE_NOTE, semitones: 0, params: [] };
  const vals = new Map(voiceOwned(v).map((p) => [p, S.values[p]]));
  const ed = S.keyEdits[sound][note];
  // a locked key plays the snapshot taken when it was locked, whole (only the sound's level still follows the mix)
  if (ed && ed._lock) {
    for (const p in ed) if (p[0] !== '_') vals.set(Number(p), ed[p]);
    return { note: BASE_NOTE + Math.round(ed._st || 0), vals, semitones: ed._st || 0 };
  }
  // a scattered key (a kit sound dealt onto it) plays that sound as it is: no morph under it
  if (ed && ed._kit) { for (const [p] of m.params) vals.set(p, S.values[p]); }
  if (ed) for (const p in ed) if (p[0] !== '_') vals.set(Number(p), ed[p]);
  return ed && ed._kit ? { note: BASE_NOTE + Math.round(ed._st || 0), vals, semitones: ed._st || 0 } : { note: m.note, vals, semitones: m.semitones };
}
// how many parameters a key's edits set (its labels, _kit and _src, aren't parameters)
const editCount = (ed) => (ed ? Object.keys(ed).filter((k) => k[0] !== '_').length : 0);
// a sound on a key, and that key becomes the one the editor edits
const lastMorph = SOUNDS.map(() => null);
const editKey = SOUNDS.map((s) => s.zone.base);
function play(sound, note, vel) {
  const m = keyPatch(sound, note);
  if (ctx && ctx.state !== 'running') ctx.resume();
  send({ type: 'play', sound, note: m.note, vel, params: [...m.vals] });
  lastMorph[sound] = { key: note, values: m.vals, semitones: m.semitones };
  editKey[sound] = note;
  showLast(sound, note, vel, m.semitones);
  // the editor follows the sound you play, so the knobs and the screen are always on the key you just pressed
  if (sound !== S.sel) select(sound); else { drawFaders(); drawKeymap(); drawEditKey(); }
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

// an edit in the editor: to the last key pressed (kept as that key's own value), or to the base of every key
const editing = () => !S.editAll;
function valueNow(par) { return editing() ? keyPatch(S.sel, editKey[S.sel]).vals.get(par) : S.values[par]; }
function editValue(par, v) {
  if (!editing()) { // ALL KEYS: the engine's base and every key of the zone that has its own sound (locked keys stay)
    setValue(par, v);
    const k = S.keyEdits[S.sel];
    for (const n in k) if (!k[n]._lock) k[n][par] = v;
    send({ type: 'param', par, value: v }); save(); drawKeymap(); return;
  }
  const note = editKey[S.sel], k = S.keyEdits[S.sel];
  if (keyLocked(S.sel, note)) { lockedMsg(); drawFaders(); return; }
  (k[note] ||= {})[par] = v;
  send({ type: 'param', par, value: v }); // heard on what's still ringing
  save(); drawKeymap(); drawEditKey();
}
const keyEdited = (par) => { const ed = S.keyEdits[S.sel][editKey[S.sel]]; return !!ed && ed[par] !== undefined; };
function clearKey(sound, note) { if (keyLocked(sound, note)) return; delete S.keyEdits[sound][note]; save(); }
// ---- key locks: a locked key keeps exactly the sound it had when locked. Its whole sound (and its pitch) is kept
// as its edits, so nothing (randomisers, scatter, morph, seed, base edits, clear) reaches it until it's unlocked ----
const keyLocked = (sound, note) => !!S.keyEdits[sound][note]?._lock;
function lockKey(sound, note) {
  const ed = S.keyEdits[sound][note];
  if (ed && ed._lock) { delete ed._lock; ed._kit ||= 'kept'; } // unlocked: it keeps the sound, now editable
  else {
    const m = keyPatch(sound, note), level = PAR.VOL1 + SOUNDS[sound].engineVoice, snap = { _lock: true, _st: m.semitones };
    if (ed && ed._kit) snap._kit = ed._kit;
    for (const [p, x] of m.vals) if (p !== level) snap[p] = x;
    S.keyEdits[sound][note] = snap;
    if (S.editAll) S.editAll = false;
  }
  save(); drawFaders(); drawKeymap(); drawEditKey();
  detail(`${SOUNDS[sound].name} ${noteName(note)}: ${keyLocked(sound, note) ? 'locked, nothing changes it now' : 'unlocked'}`);
}
const lockedMsg = () => detail(`${SOUNDS[S.sel].name} ${noteName(editKey[S.sel])} is locked: <em>LOCK KEY</em> (L) unlocks it`);

// ---------------------------------------------------------------------------------------------------------------
// MIDI: note-ons on channels 1..7, keys C1..C5
// ---------------------------------------------------------------------------------------------------------------
let midi = null;
function midiStatus(text, live) { const el = $('midi-status'); el.textContent = text; el.classList.toggle('live', !!live); el.title = text; }
function onMidi(e) {
  const [st, note, vel] = e.data;
  const ch = (st & 0x0f) + 1;
  if ((st & 0xf0) === 0xb0) { if (ch === 1) onCC(note, vel); return; } // a knob or slider (control change)
  if ((st & 0xf0) !== 0x90 || !vel) return; // note-ons only (a note-on at velocity 0 is a note-off)
  noteOn(ch, note, vel);
}
function noteOn(ch, note, vel) {
  if (ch !== 1) { showLastText(`CH ${ch} · ${noteName(note)} · only channel 1 plays`); return; }
  const sound = soundOfNote(note);
  if (sound < 0) { showLastText(`${noteName(note)} #${note} · outside the zones (${noteName(SOUNDS[0].zone.lo)}-${noteName(SOUNDS[SOUNDS.length - 1].zone.hi)})`); return; }
  play(sound, note, vel);
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
// ---------------------------------------------------------------------------------------------------------------
// knobs: MIDI CCs on channel 1. Sound controls act like the editor: on the last key played (or every key with ALL
// KEYS), of the sound last played. The default map suits a Bass Station 2 (its CC numbers); LEARN maps any knob
// ---------------------------------------------------------------------------------------------------------------
// a target: { t: 'par', label: [labels to try, in order] } | { t: 'global', k } | { t: 'sound', k } | { t: 'zlevel', s }
const CC_DEFAULT = {
  16: { t: 'par', label: ['cutoff'], name: 'filter freq' }, 82: { t: 'par', label: ['reso'], name: 'resonance' },
  114: { t: 'par', label: ['drive'], name: 'overdrive' }, 85: { t: 'par', label: ['pitch amt', 'mod2 gain'], name: 'mod env depth' },
  90: { t: 'par', label: ['attack'], name: 'amp attack' }, 91: { t: 'par', label: ['decay'], name: 'amp decay' },
  103: { t: 'par', label: ['pitch dec', 'mod1 freq'], name: 'mod env decay' }, 94: { t: 'par', label: ['fm amt', 'mod1 gain'], name: 'distortion' },
  27: { t: 'par', label: ['coarse'], name: 'osc 1 coarse' }, 26: { t: 'par', label: ['fine'], name: 'osc 1 fine' },
  18: { t: 'par', label: ['echo'], name: 'lfo 1 speed' }, 5: { t: 'par', label: ['reverb'], name: 'portamento' }, 19: { t: 'par', label: ['dist'], name: 'lfo 2 speed' },
  20: { t: 'zlevel', s: 0, name: 'osc 1 level' }, 21: { t: 'zlevel', s: 1, name: 'osc 2 level' }, 22: { t: 'zlevel', s: 2, name: 'sub osc level' },
};
const ccMap = () => S.ccMap || CC_DEFAULT;
function ccTargetName(t) {
  if (t.t === 'par') return t.label[0];
  if (t.t === 'global') return 'morph ' + t.k + ' (all)';
  if (t.t === 'sound') return 'morph ' + t.k;
  if (t.t === 'randkey') return 'new sound on the key';
  return SOUNDS[t.s].name.toLowerCase() + ' level';
}
const ccHeld = {};
let learn = null; // null, { armed: true } waiting for a control, then { target } waiting for a knob
let ccDraw = 0;
function onCC(cc, val) {
  if (learn && learn.target) {
    S.ccMap = { ...ccMap() };
    for (const k in S.ccMap) if (JSON.stringify(S.ccMap[k]) === JSON.stringify(learn.target)) delete S.ccMap[k]; // one knob per control
    S.ccMap[cc] = learn.target; save();
    showLastText(`CC${cc} → ${ccTargetName(learn.target).toUpperCase()}`);
    setLearn(null); return;
  }
  const t = ccMap()[cc];
  if (!t) { showLastText(`CC${cc} ${val} · not mapped (LEARN maps it)`); return; }
  let text;
  if (t.t === 'global' || t.t === 'sound') { showLastText(`CC${cc} · was the morph (gone): BS2 MAP or LEARN maps it`); return; }
  if (t.t === 'randkey') { // a button: acts once as it goes past half way up
    const up = val >= 64, was = ccHeld[cc]; ccHeld[cc] = up;
    if (up && !was) randKey(); return;
  }
  else if (t.t === 'zlevel') { setValue(PAR.VOL1 + SOUNDS[t.s].engineVoice, val); text = `${ccTargetName(t)} ${val}`; }
  else {
    const sc = VOICE_SCHEMAS[SOUNDS[S.sel].engineVoice];
    const e = t.label.map((l) => sc.find((x) => x.label === l)).find(Boolean);
    if (!e) { showLastText(`CC${cc} · ${SOUNDS[S.sel].name} has no ${t.label[0]}`); return; }
    const v = Math.round(val / 127 * e.max);
    editValue(e.par, v);
    text = `${SOUNDS[S.sel].name} ${editing() ? noteName(editKey[S.sel]) : 'ALL'} ${e.label} ${showValue(e, v)}`;
  }
  save();
  showLastText(`CC${cc} · ${text.toUpperCase()}`);
  if (!ccDraw) ccDraw = requestAnimationFrame(() => { ccDraw = 0; drawFaders(); drawSide(); });
}
// LEARN: press it, touch a control on screen, turn a knob
function setLearn(l) {
  learn = l;
  $('learn').setAttribute('aria-pressed', !!l);
  document.body.classList.toggle('learning', !!l);
  if (l && !l.target) detail('LEARN: click a control on screen, then turn a knob (Esc cancels)');
  else if (l) detail(`LEARN: now turn a knob for <em>${ccTargetName(l.target)}</em>`);
}
$('learn').addEventListener('click', () => setLearn(learn ? null : { armed: true }));
$('cc-reset').addEventListener('click', () => { S.ccMap = null; save(); setLearn(null); detail('knobs: back to the Bass Station 2 map'); });
document.addEventListener('pointerdown', (e) => {
  if (!learn) return;
  const el = e.target.closest('[data-learn]');
  if (!el) return;
  const t = JSON.parse(el.dataset.learn);
  if (t.t === 'zlevel') t.s = S.sel;
  setLearn({ target: t });
}, true);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && learn) setLearn(null); });

// for testing without a controller: afx.noteOn(channel, note, velocity) and afx.cc(number, value) from the console
window.afx = { noteOn: (ch, note, vel = 100) => noteOn(ch, note, vel), cc: (cc, val) => onCC(cc, val) };

// ---------------------------------------------------------------------------------------------------------------
// the last note
// ---------------------------------------------------------------------------------------------------------------
let lastT = 0;
function showLastText(t) {
  $('last-text').textContent = t;
  const box = $('last'); box.classList.add('hit'); clearTimeout(lastT); lastT = setTimeout(() => box.classList.remove('hit'), 90);
}
function showLast(sound, note, vel, st) {
  const p = note === SOUNDS[sound].zone.base ? 'BASE' : (st >= 0 ? '+' : '−') + Math.abs(st).toFixed(1) + 'ST';
  showLastText(`${SOUNDS[sound].name} · ${noteName(note)} #${note} · V${vel} · ${p}`);
  const led = soundBtns[sound].querySelector('i');
  led.classList.add('on'); clearTimeout(led._t); led._t = setTimeout(() => led.classList.remove('on'), 120);
}
// the master compressor's gain reduction: a segment per dB (up to 24), held a moment and falling back
let grShown = 0;
function showGr(db) {
  grShown = Math.max(db, grShown * 0.8);
  const n = Math.round(Math.min(24, grShown));
  document.querySelectorAll('.grm .segs i').forEach((x, i) => x.classList.toggle('on', i < n));
  const o = document.querySelector('.grm output'); if (o) o.textContent = (grShown >= 0.05 ? '-' + grShown.toFixed(1) : '0') + ' dB';
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
    const r = track.getBoundingClientRect(), len = o.len || (axis === 'x' ? r.width : r.height);
    // a press off the bar's end jumps there (not on a knob: it turns from where it is)
    const at = axis === 'x' ? (e.clientX - r.left) / r.width : (r.bottom - e.clientY) / r.height;
    const f = (o.get() - o.min) / (o.max - o.min);
    if (!o.len && Math.abs(at - f) * len > 8) o.put(o.min + clamp(at, 0, 1) * (o.max - o.min));
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
  if (o.learn) el.dataset.learn = JSON.stringify(o.learn);
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

// ---- level and the randomiser's amount ----
const levelPar = () => PAR['VOL' + (SOUNDS[S.sel].engineVoice + 1)];
const randDraws = [
  hbar($('rand-bars'), 'AMOUNT', { min: 0, max: 100, get: () => S.rand.amount, set: (v) => { S.rand.amount = v; save(); }, show: P, dflt: 30 }),
];
$('wild').checked = S.rand.wild;
$('wild').addEventListener('change', () => { S.rand.wild = $('wild').checked; save(); });

// ---------------------------------------------------------------------------------------------------------------
// the zone's keys, one row each: its note, the sound it plays, and whether it's locked or edited. A click picks the key
// and plays it (drawKeymap keeps its old name: everything that changes a key calls it)
// ---------------------------------------------------------------------------------------------------------------
function drawKeymap() { /* the key list is gone: the strip on top shows the keys */ drawStrip(); }
window.addEventListener('resize', drawKeymap);

// ---------------------------------------------------------------------------------------------------------------
// the seven sounds
// ---------------------------------------------------------------------------------------------------------------
const soundBtns = SOUNDS.map((s, i) => {
  const b = document.createElement('button');
  b.className = 'btn snd'; b.type = 'button'; b.setAttribute('role', 'tab');
  b.innerHTML = `<i></i><span>${s.name}</span><span class="ch">${noteName(s.zone.lo)}-${noteName(s.zone.hi)}</span>`;
  b.title = `${s.name}: keys ${noteName(s.zone.lo)} to ${noteName(s.zone.hi)} on MIDI channel 1, base ${noteName(s.zone.base)} (key ${i + 1})`;
  b.addEventListener('click', () => select(i, 'synth'));
  $('sounds').append(b);
  return b;
});

function select(i, view) {
  S.sel = i; if (view) S.view = view; save();
  soundBtns.forEach((b, k) => b.setAttribute('aria-selected', k === i));
  buildFaders(); drawSide(); drawEditKey();
}
function drawSide() {
  const s = SOUNDS[S.sel];
  $('rand-name').textContent = s.name;
  randDraws.forEach((d) => d());
  drawLocks(); drawKeymap();
}

// ---------------------------------------------------------------------------------------------------------------
// the editor: every parameter of the selected sound, on five pages
// ---------------------------------------------------------------------------------------------------------------
let faderDraws = [];
function buildFaders() {
  soundBtns.forEach((b, k) => b.setAttribute('aria-selected', k === S.sel));
  // every section of the sound at once, in page order (tone, shape, filter, mod, mix)
  const box = $('faders'); box.innerHTML = ''; faderDraws = [];
  const voice = SOUNDS[S.sel].engineVoice;
  const entries = PAGES.flatMap((pg) => VOICE_SCHEMAS[voice].filter((e) => e.page === pg));
  // short sections share a row: velocity sits beside the mix, the LFO gets a row of its own
  const ORDER = ['osc', 'fm', 'amp', 'pitch', 'click', 'filter', 'velocity', 'mix', 'lfo', 'fx sends'], rank = (x) => (ORDER.indexOf(x) + 1 || 99);
  const sections = [...new Set(entries.map((e) => e.section))].sort((a, b) => rank(a) - rank(b));
  for (const sec of sections) {
    const list = entries.filter((e) => e.section === sec);
    const n = list.reduce((a, e) => a + (e.display.type === 'target' ? 2 : 1), 0);
    const el = document.createElement('div'); el.className = 'sect'; el.style.setProperty('--n', n);
    el.innerHTML = `<h3>${sec}</h3><div class="row"></div>`;
    const row = el.querySelector('.row');
    for (const e of list) row.append(e.display.type === 'target' ? targetSelect(e, voice) : vfader(e));
    box.append(el);
  }
  // the right: the three effects (each key's sends are its FX SENDS knobs, with the rest of its knobs)
  buildFx();
  drawFaders();
}
function drawFaders() { faderDraws.forEach((d) => d()); }

// ---- the FX page: the three send effects every key feeds (each key's sends are its FX SENDS knobs) ----
function gknob(label, o) {
  const el = document.createElement('div'); el.className = 'vf';
  el.innerHTML = `<output></output><div class="knob" role="slider" tabindex="0">${KNOB_SVG}</div><span class="lab"></span>`;
  el.querySelector('.lab').textContent = label;
  const tr = el.querySelector('.knob'), out = el.querySelector('output'), ticks = tr.querySelectorAll('.tk'), ptr = tr.querySelector('.ptr');
  tr.setAttribute('aria-label', label);
  const draw = () => {
    const v = o.get(), f = v / o.max, lit = Math.round(f * (KNOB_N - 1));
    ticks.forEach((t, i) => t.classList.toggle('on', i <= lit && (v > 0 || i === 0)));
    ptr.setAttribute('transform', `rotate(${(KNOB_A0 + f * KNOB_SWEEP) * 180 / Math.PI} 32 32)`);
    out.textContent = o.show ? o.show(v) : String(v); tr.setAttribute('aria-valuenow', v);
  };
  const put = (v) => { v = clamp(Math.round(v), 0, o.max); if (v !== o.get()) { o.set(v); draw(); } };
  dragger(tr, 'y', { min: 0, max: o.max, len: 160, get: o.get, put, held: (h) => el.classList.toggle('held', h) });
  const reset = () => put(o.dflt); el.querySelector('.lab').addEventListener('dblclick', reset); tr.addEventListener('dblclick', reset);
  faderDraws.push(draw);
  return el;
}
const sendFx = () => { send({ type: 'fx', fx: S.fx }); save(); };
const FX_PAGE = [
  ['echo', 'ECHO', [['time', 127, (v) => echoMs(v) + ' ms'], ['feedback', 127], ['tone', 127], ['pingpong', 1, (v) => (v ? 'ping-pong' : 'normal'), 'mode'], ['level', 100, (v) => v + '%', 'return']]],
  ['reverb', 'REVERB', [['size', 127], ['decay', 127], ['tone', 127], ['early', 127], ['level', 100, (v) => v + '%', 'return']]],
  ['dist', 'DISTORTION', [['type', 2, (v) => ['tube', 'fold', 'rat'][v]], ['drive', 127], ['color', 127], ['tone', 127], ['volume', 127], ['level', 100, (v) => v + '%', 'return']]],
  // the master: everything (dry and the FX returns) through a distortion, then the compressor, then the level
  ['master', 'MASTER · DIST + LEVEL', [['type', 2, (v) => ['tube', 'fold', 'rat'][v]], ['drive', 127], ['tone', 127], ['mix', 100, (v) => (v ? v + '%' : 'off')], ['level', 100, (v) => v + '%']]],
  ['master', 'MASTER · COMPRESSOR', [['thresh', 40, (v) => (v ? '-' + v + ' dB' : 'off'), 'threshold'], ['ratio', 200, (v) => (Math.max(10, v) / 10).toFixed(1) + ':1'],
    ['attack', 100, (v) => Math.max(1, v) + ' ms'], ['release', 1000, (v) => Math.max(10, v) + ' ms'], ['knee', 24, (v) => v + ' dB'], ['makeup', 24, (v) => '+' + v + ' dB']]],
];
function buildFx() {
  const box = $('fxglobal'); box.innerHTML = '';
  for (const [id, name, knobs] of FX_PAGE) {
    const el = document.createElement('div'); el.className = 'sect'; el.style.setProperty('--n', knobs.length);
    el.innerHTML = `<h3>${name}</h3><div class="row"></div>`;
    for (const [k, max, show, label] of knobs)
      el.querySelector('.row').append(gknob(label || k, { max, show, get: () => S.fx[id][k], set: (v) => { S.fx[id][k] = v; sendFx(); }, dflt: FX_DEFAULTS[id][k] }));
    box.append(el);
  }
  // under the compressor: its gain reduction
  const gm = document.createElement('div'); gm.className = 'grm';
  gm.innerHTML = `<span class="dim">GR</span><div class="segs">${'<i></i>'.repeat(24)}</div><output>0 dB</output>`;
  box.lastChild.append(gm);
}
// a knob in the LCD look: a ring of segments (lit up to the value), a pointer, and a notch outside the ring for the
// base (editing a key) or the last key's morph (editing every key). Drag up or down, scroll, arrow keys; Shift is fine
const KNOB_N = 25, KNOB_A0 = Math.PI * 0.75, KNOB_SWEEP = Math.PI * 1.5;
const KNOB_SVG = (() => {
  let t = '';
  for (let i = 0; i < KNOB_N; i++) {
    const a = KNOB_A0 + i / (KNOB_N - 1) * KNOB_SWEEP, c = Math.cos(a), s = Math.sin(a);
    t += `<line class="tk" x1="${(32 + 20 * c).toFixed(2)}" y1="${(32 + 20 * s).toFixed(2)}" x2="${(32 + 28 * c).toFixed(2)}" y2="${(32 + 28 * s).toFixed(2)}"/>`;
  }
  return `<svg viewBox="0 0 64 64" aria-hidden="true">${t}<line class="ptr" x1="32" y1="32" x2="46" y2="32"/><line class="notch" x1="61" y1="32" x2="64" y2="32"/></svg>`;
})();
function vfader(e) {
  const el = document.createElement('div'); el.className = 'vf';
  el.innerHTML = `<output></output><div class="knob" role="slider" tabindex="0">${KNOB_SVG}</div><span class="lab"></span><button class="lock" type="button">LOCK</button>`;
  el.querySelector('.lab').textContent = e.label;
  const tr = el.querySelector('.knob'), out = el.querySelector('output'), lock = el.querySelector('.lock');
  const ticks = tr.querySelectorAll('.tk'), ptr = tr.querySelector('.ptr'), notch = tr.querySelector('.notch');
  tr.setAttribute('aria-label', e.label); tr.setAttribute('aria-valuemin', 0); tr.setAttribute('aria-valuemax', e.max);
  lock.title = `Lock ${e.label}: the randomisers leave it alone`;
  const draw = () => {
    const v = valueNow(e.par);
    const f = e.max ? v / e.max : 0, lit = Math.round(f * (KNOB_N - 1));
    ticks.forEach((t, i) => t.classList.toggle('on', i <= lit && (v > 0 || i === 0)));
    ptr.setAttribute('transform', `rotate(${(KNOB_A0 + f * KNOB_SWEEP) * 180 / Math.PI} 32 32)`);
    out.textContent = showValue(e, v);
    tr.setAttribute('aria-valuenow', v); tr.setAttribute('aria-valuetext', showValue(e, v));
    // the notch: editing a key, where the base is; editing every key, where the last key played moved it
    const lm = lastMorph[S.sel], mv = editing() ? S.values[e.par] : lm && lm.values.get(e.par);
    tr.classList.toggle('morphed', mv !== undefined && mv !== v);
    if (mv !== undefined) notch.setAttribute('transform', `rotate(${(KNOB_A0 + mv / (e.max || 1) * KNOB_SWEEP) * 180 / Math.PI} 32 32)`);
    el.classList.toggle('changed', !editing() && v !== S.defaults[e.par]);
    el.classList.toggle('keyed', editing() && keyEdited(e.par));
    lock.setAttribute('aria-pressed', S.locks.has(e.par));
  };
  const put = (x) => {
    x = clamp(Math.round(x), 0, e.max);
    if (x === valueNow(e.par)) return;
    editValue(e.par, x); draw();

    detail(`${SOUNDS[S.sel].name} ${editing() ? noteName(editKey[S.sel]) + ' ' : 'ALL KEYS '}${e.label.toUpperCase()} <em>${showValue(e, x)}</em>`);
  };
  dragger(tr, 'y', { min: 0, max: e.max, len: 160, get: () => valueNow(e.par), put, held: (h) => el.classList.toggle('held', h) });
  // double-click: a key's edit goes (back to its morph); on every key, back to the kit's value
  const reset = () => {
    if (editing() && keyLocked(S.sel, editKey[S.sel])) { lockedMsg(); return; }
    if (editing()) { const ed = S.keyEdits[S.sel][editKey[S.sel]]; if (ed) { delete ed[e.par]; if (!editCount(ed)) clearKey(S.sel, editKey[S.sel]); save(); draw(); drawKeymap(); drawEditKey(); } }
    else put(S.defaults[e.par]);
  };
  el.querySelector('.lab').addEventListener('dblclick', reset); tr.addEventListener('dblclick', reset);
  el.dataset.learn = JSON.stringify({ t: 'par', label: [e.label] });
  tr.addEventListener('focus', () => detail(`${SOUNDS[S.sel].name} ${e.label.toUpperCase()} <em>${showValue(e, valueNow(e.par))}</em>`));
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
    editValue(e.par, Number(s.value));
    if (e.display.anyVoice) editValue(PAR.VOICE_LFO1 + voice, voiceOfTarget(Number(s.value)) + 1);
    detail(`${SOUNDS[S.sel].name} ${e.label.toUpperCase()} <em>${s.selectedOptions[0].text}</em>`);
  });
  el.append(s);
  faderDraws.push(() => { s.value = valueNow(e.par); el.classList.toggle('keyed', editing() && keyEdited(e.par)); });
  return el;
}

// ---- what the editor edits: the last key (KEY) or every key (ALL KEYS); clearing a key's edits ----
function setEditAll(all) { S.editAll = all; save(); drawEditKey(); drawFaders(); }
function drawEditKey() {
  const note = editKey[S.sel], edits = S.keyEdits[S.sel], n = Object.keys(edits).length;
  const here = editCount(edits[note]), from = edits[note] && edits[note]._kit;
  $('edit-key').setAttribute('aria-pressed', !S.editAll); $('edit-all').setAttribute('aria-pressed', S.editAll);
  const locked = keyLocked(S.sel, note), nl = Object.values(edits).filter((e) => e._lock).length;
  $('edit-key').textContent = 'THIS KEY';
  $('edit-info').textContent = locked ? `${noteName(note)} is locked` : S.editAll ? 'every key of the zone (locked keys stay)' : `${noteName(note)} only`;
  $('clear-key').disabled = !here || locked; $('clear-keys').disabled = n === nl;
  $('lock-key').setAttribute('aria-pressed', locked); $('lock-key').querySelector('span').textContent = locked ? 'LOCKED' : 'LOCK KEY';
  $('rand-key').disabled = locked; $('alter-key').disabled = locked; $('paste-key').disabled = locked || !clip;
  // the key header: the key, its engine, and what it plays
  const what = locked ? `locked${from && from !== 'kept' ? ' · ' + from : ''}` : from ? (from === 'kept' ? 'its own sound' : from) :
    here ? `base + ${here} edit${here === 1 ? '' : 's'}` : `the ${SOUNDS[S.sel].name.toLowerCase()} base sound`;
  $('kh-note').textContent = noteName(note); $('kh-num').textContent = '#' + note;
  $('kh-engine').textContent = SOUNDS[S.sel].name; $('kh-info').textContent = what;
  $('screen').classList.toggle('keylocked', locked);
  drawStrip();
}
$('edit-key').addEventListener('click', () => setEditAll(false));
$('edit-all').addEventListener('click', () => setEditAll(true));
$('clear-key').addEventListener('click', () => { clearKey(S.sel, editKey[S.sel]); drawFaders(); drawKeymap(); drawEditKey(); detail(`${SOUNDS[S.sel].name} ${noteName(editKey[S.sel])}: back to the engine's base sound`); });
$('lock-key').addEventListener('click', () => lockKey(S.sel, editKey[S.sel]));
$('alter-key').addEventListener('click', () => alterKey());

// ---- copy and paste a key's sound: copy takes everything the key plays now (its pitch too); paste puts it on the
// current key as that key's own sound. Onto another engine it maps by control name (pitch, decay, filter, ...), as the
// randomisers map kit voices; what the other engine doesn't have stays as the key had it. The level stays the zone's ----
var clip = null; // var: drawEditKey reads it before this line runs
function copyKey() {
  const sound = S.sel, note = editKey[sound], m = keyPatch(sound, note), ed = S.keyEdits[sound][note];
  clip = { sound, voice: SOUNDS[sound].engineVoice, vals: [...m.vals], st: m.semitones,
    label: `${ed?._kit && ed._kit !== 'kept' ? ed._kit : SOUNDS[sound].name.toLowerCase() + ' ' + noteName(note)}` };
  $('paste-key').disabled = false; $('paste-key').title = `Paste ${clip.label} onto this key (Cmd+V / Ctrl+V)`;
  detail(`copied <em>${SOUNDS[sound].name} ${noteName(note)}</em> · pick a key and paste (Cmd+V / Ctrl+V)`);
}
function pasteKey() {
  if (!clip) { detail('nothing copied yet: COPY (Cmd+C / Ctrl+C) a key first'); return; }
  const sound = S.sel, note = editKey[sound], v = SOUNDS[sound].engineVoice;
  if (keyLocked(sound, note)) { lockedMsg(); return; }
  let pairs = clip.vals;
  if (clip.voice !== v) { const arr = S.values.slice(); for (const [p, x] of clip.vals) arr[p] = x; pairs = mapVoice(arr, clip.voice, v); }
  const level = PAR.VOL1 + v, now = keyPatch(sound, note).vals;
  const ed = { _kit: clip.label, _st: clip.st };
  for (const [p, x] of now) if (p !== level) ed[p] = x;
  for (const [p, x] of pairs) if (p !== level && now.has(p)) ed[p] = x;
  randChange(() => { S.keyEdits[sound][note] = ed; if (S.editAll) setEditAll(false); },
    `pasted <em>${clip.label}</em> onto ${SOUNDS[sound].name} ${noteName(note)}${clip.voice !== v ? ' (mapped to ' + SOUNDS[sound].name.toLowerCase() + ')' : ''} · UNDO takes it back`)
    .then(() => { drawKeymap(); play(sound, note, 100); });
}
$('copy-key').addEventListener('click', copyKey);
$('paste-key').addEventListener('click', pasteKey);

// ---- the key strip: every key of the layout, grouped by engine; click picks the key and plays it ----
const stripKeys = [];
function buildStrip() {
  const box = $('keystrip'); box.innerHTML = ''; stripKeys.length = 0;
  SOUNDS.forEach((s, i) => {
    const g = document.createElement('div'); g.className = 'kgroup';
    g.innerHTML = `<span class="kz">${s.name}</span><div class="keys"></div>`;
    for (let note = s.zone.lo; note <= s.zone.hi; note++) {
      const k = document.createElement('button'); k.type = 'button'; k.className = 'k' + ([1, 3, 6, 8, 10].includes(note % 12) ? ' blk' : '');
      k.title = `${s.name} ${noteName(note)} #${note}`;
      k.innerHTML = '<svg viewBox="0 0 16 18" aria-hidden="true"><path d="M4 8V5a4 4 0 0 1 8 0v3"/><rect x="1.5" y="8" width="13" height="9" rx="1"/></svg>';
      k.addEventListener('click', () => { startAudio().then(() => play(i, note, 100)); });
      g.querySelector('.keys').append(k); stripKeys.push({ k, sound: i, note });
    }
    box.append(g);
  });
}
function drawStrip() {
  for (const { k, sound, note } of stripKeys) {
    const ed = S.keyEdits[sound][note];
    k.classList.toggle('sel', sound === S.sel && note === editKey[sound]);
    k.classList.toggle('locked', !!ed?._lock);
    k.classList.toggle('own', !!ed && !ed._lock);
    k.classList.toggle('base', note === SOUNDS[sound].zone.base);
  }
}

// ---- the RANDOM menu ----
function openMenu(open) { $('menu-panel').hidden = !open; $('menu-btn').setAttribute('aria-expanded', open); }
$('menu-btn').addEventListener('click', () => openMenu($('menu-panel').hidden));
document.addEventListener('pointerdown', (e) => { if (!$('menu-panel').hidden && !e.target.closest('#menu')) openMenu(false); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') openMenu(false); });
$('clear-keys').addEventListener('click', () => randChange(() => scatter(S.sel), `${SOUNDS[S.sel].name}: every key a fresh kit sound (locked keys stay)`));

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
    setValue(e.par, vary(e, home.get(e.par), depth, wild), { quiet: true });
  }
}
// one control's value moved around h by depth: within its drum-safe range, or its whole range when wild
function vary(e, h, depth, wild) {
  const range = wild || e.rand === 'lock' ? [0, e.max] : e.rand; // an unlocked 'lock' control moves over its whole range
  let v = h;
  if (range === 'pitch') v = Math.round(h + (rnd() * 2 - 1) * depth * 12); // up to an octave either way
  else if (e.max < 20) { if (rnd() < depth) v = range[0] + Math.floor(rnd() * (Math.min(e.max, range[1]) - range[0] + 1)); }
  else {
    const lo = Math.min(range[0], h), hi = Math.max(range[1], h); // the home always stays reachable
    v = clamp(Math.round(h + (rnd() * 2 - 1) * depth * (hi - lo)), lo, hi);
  }
  return clamp(v, 0, e.max);
}
// alter each key of a sound that has its own sound (scattered or edited): every unlocked control of that key, moved a
// little around what the key plays now, kept as the key's edits
function alterKeys(sound, depth) {
  const sc = VOICE_SCHEMAS[SOUNDS[sound].engineVoice];
  for (const k in S.keyEdits[sound]) {
    if (S.keyEdits[sound][k]._lock) continue;
    const note = Number(k), now = keyPatch(sound, note).vals, ed = S.keyEdits[sound][k];
    for (const e of sc) {
      if (S.locks.has(e.par) || e.display.type === 'target') continue;
      const v = vary(e, now.get(e.par), depth, false);
      if (v !== now.get(e.par) || ed[e.par] !== undefined) ed[e.par] = v;
    }
  }
}
// a sound from a random built-in kit: one of the kit's voices of the same engine type (any of its three drums; its cymbal
// or its hi-hat), mapped onto this sound. Its level and pan and any locked control stay. Then, if vary, randomised
// around that by the amount
function pickVoice(sound, vary) {
  const def = SOUNDS[sound], v = def.engineVoice;
  const k = kits[Math.floor(rnd() * kits.length)].kit, src = def.sources[Math.floor(rnd() * def.sources.length)];
  const keep = new Set([PAR.VOL1 + v, PAR.PAN1 + v]);
  for (const [par, x] of mapVoice(k, src, v)) if (!keep.has(par) && !S.locks.has(par)) { setValue(par, x, { quiet: true }); S.defaults[par] = x; }
  delete homes[v];
  if (vary) { randomiseVoice(v, vary, S.rand.wild); delete homes[v]; }
}
const alterVoice = (v) => { delete homes[v]; randomiseVoice(v, 0.1, false); delete homes[v]; };
// ALTER: the sound's base and every key with its own sound
// ALTER KEY: this key's sound nudged a little (10%) around what it plays now, kept as its own edits
function alterOne(sound, note, depth) {
  const sc = VOICE_SCHEMAS[SOUNDS[sound].engineVoice], now = keyPatch(sound, note).vals, ed = S.keyEdits[sound][note] || {};
  for (const e of sc) {
    if (S.locks.has(e.par) || e.display.type === 'target') continue;
    const v = vary(e, now.get(e.par), depth, false);
    if (v !== now.get(e.par) || ed[e.par] !== undefined) ed[e.par] = v;
  }
  if (editCount(ed)) S.keyEdits[sound][note] = ed;
}
function alterKey() {
  const sound = S.sel, note = editKey[sound];
  if (keyLocked(sound, note)) { lockedMsg(); return; }
  randChange(() => { alterOne(sound, note, 0.1); if (S.editAll) setEditAll(false); }, `${SOUNDS[sound].name} ${noteName(note)} altered <em>10%</em> (UNDO takes it back)`)
    .then(() => { drawKeymap(); play(sound, note, 100); });
}
const alterSound = (i) => { alterVoice(SOUNDS[i].engineVoice); alterKeys(i, 0.1); };
async function randChange(fn, what) {
  await startAudio();
  undoValues = S.values.slice(); undoKeys = structuredClone(S.keyEdits); $('undo').disabled = false;
  fn();
  for (const s of lastMorph.keys()) lastMorph[s] = null;
  save(); drawFaders(); drawSide(); drawEditKey();
  detail(what);
}
const selVoice = () => SOUNDS[S.sel].engineVoice;
let undoKeys = null;

// ---- scatter: every voice of a sound's type from all the kits (every drum 1-3 for the drum, every snare, every cymbal
// and hi-hat for the metal), the same sound only once, dealt at random one per key across the sound's zone. Each key
// then plays its kit sound as it is (no morph), kept as that key's edits, so it can still be edited or cleared. The
// level and pan stay the sound's own. Repeats only if a type has fewer distinct sounds than the zone has keys ----
const pools = SOUNDS.map(() => null);
function pool(sound) {
  if (pools[sound]) return pools[sound];
  const def = SOUNDS[sound], v = def.engineVoice, skip = new Set([PAR.VOL1 + v, PAR.PAN1 + v]), seen = new Set(), out = [];
  for (const { name, kit } of kits) for (const src of def.sources) {
    const vals = mapVoice(kit, src, v).filter(([p]) => !skip.has(p));
    const sig = vals.map(([p, x]) => x).join(',');
    if (seen.has(sig)) continue;
    seen.add(sig);
    out.push({ label: `${name} ${['drum 1', 'drum 2', 'drum 3', 'snare', 'cymbal', 'hihat'][src]}`, vals });
  }
  return (pools[sound] = out);
}
function scatter(sound) {
  const z = SOUNDS[sound].zone, p = pool(sound), order = [];
  for (let note = z.lo; note <= z.hi; note++) {
    if (!order.length) { order.push(...p.keys()); for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; } }
    if (keyLocked(sound, note)) continue;
    const s = p[order.pop()];
    S.keyEdits[sound][note] = { _kit: s.label, ...Object.fromEntries(s.vals) };
  }
}
// NEW SOUND: one key (the last played, or picked on the key map) gets a different kit sound of its type, as SCATTER
// deals; every other key stays. Locked controls keep what the key plays now. It plays the key so you hear it
function randKey() {
  if (keyLocked(S.sel, editKey[S.sel])) { lockedMsg(); return; }
  const sound = S.sel, note = editKey[sound], p = pool(sound), cur = S.keyEdits[sound][note]?._kit;
  let s; do s = p[Math.floor(rnd() * p.length)]; while (p.length > 1 && s.label === cur);
  const now = keyPatch(sound, note).vals;
  randChange(() => {
    const ed = { _kit: s.label, ...Object.fromEntries(s.vals) };
    for (const [p, x] of now) if (p >= NUM_PARAMS) ed[p] = x; // the key keeps its sends
    for (const par of S.locks) if (par in ed) ed[par] = now.get(par);
    S.keyEdits[sound][note] = ed;
    if (S.editAll) setEditAll(false);
  }, `${SOUNDS[sound].name} ${noteName(note)}: <em>${s.label}</em> (UNDO takes it back)`).then(() => { drawKeymap(); play(sound, note, 100); });
}
$('rand-key').addEventListener('click', () => { if (!learn) randKey(); });
$('rand-key').dataset.learn = JSON.stringify({ t: 'randkey' });
$('scatter').addEventListener('click', () => randChange(() => scatter(S.sel), `${SOUNDS[S.sel].name}: a kit sound on every key (from ${pool(S.sel).length})`));
$('kit-scatter').addEventListener('click', () => randChange(() => SOUNDS.forEach((_, i) => scatter(i)), 'all three zones: a kit sound on every key'));
$('rand').addEventListener('click', () => randChange(() => pickVoice(S.sel, S.rand.amount / 100),
  `${SOUNDS[S.sel].name}: a variant from the kits <em>${S.rand.amount}%${S.rand.wild ? ' wild' : ''}</em>`));
$('vary').addEventListener('click', () => randChange(() => randomiseVoice(selVoice(), S.rand.amount / 100, S.rand.wild),
  `${SOUNDS[S.sel].name} varied <em>${S.rand.amount}%${S.rand.wild ? ' wild' : ''}</em>`));
$('alter').addEventListener('click', () => randChange(() => alterSound(S.sel), `${SOUNDS[S.sel].name} altered <em>10%</em>, and each of its own keys`));
$('kit-rand').addEventListener('click', () => randChange(() => { for (let i = 0; i < SOUNDS.length; i++) pickVoice(i, S.rand.amount / 100); }, 'all three sounds: variants from the kits'));
$('kit-alter').addEventListener('click', () => randChange(() => SOUNDS.forEach((_, i) => alterSound(i)), 'every sound altered <em>10%</em>, and each key with its own sound'));
$('kit-init').addEventListener('click', () => randChange(() => {
  for (let p = 0; p < NUM_PARAMS; p++) setValue(p, INIT_VALUES[p], { quiet: true });
  S.defaults = INIT_VALUES.slice(); for (const k in homes) delete homes[k];
}, 'the init kit'));
$('undo').addEventListener('click', () => {
  if (!undoValues) return;
  for (let p = 0; p < ALL_PARAMS; p++) setValue(p, undoValues[p], { quiet: true });
  if (undoKeys) { // a key locked now stays as it is
    S.keyEdits.forEach((ks, i) => { for (const k in ks) if (ks[k]._lock) undoKeys[i][k] = ks[k]; });
    S.keyEdits = undoKeys;
  }
  drawKeymap();
  undoValues = null; undoKeys = null; $('undo').disabled = true; save(); drawEditKey();
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
  // Cmd+C / Cmd+V (Ctrl on a PC): copy and paste a key's sound, unless a text field or a selection has them
  if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && (e.key === 'c' || e.key === 'v')) {
    if (e.target.closest('input, select, textarea, [contenteditable]') || String(getSelection())) return;
    e.preventDefault(); if (e.key === 'c') copyKey(); else pasteKey(); return;
  }
  if (e.target.closest('select') || e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key >= '1' && e.key <= String(SOUNDS.length)) select(Number(e.key) - 1);
  else if (e.key === 'k' || e.key === 'K') randKey();
  else if (e.key === 'a' || e.key === 'A') alterKey();
  else if (e.key === 'l' || e.key === 'L') lockKey(S.sel, editKey[S.sel]);
});

// ---------------------------------------------------------------------------------------------------------------
// start
// ---------------------------------------------------------------------------------------------------------------
$('start-btn').addEventListener('click', async () => {
  $('start').hidden = true;
  await startAudio();
  startMidi();
});
// with no morph, keys with nothing of their own all play the base: a zone with no key sounds starts scattered
SOUNDS.forEach((_, i) => { if (!Object.keys(S.keyEdits[i]).length) scatter(i); });
buildStrip();
select(clamp(S.sel, 0, SOUNDS.length - 1));
// the layout: three zones up from the lowest key, moved by octaves with LOW KEY (the keys' edits move with them)
function drawZones() {
  const zoneText = (s) => `${s.name} ${noteName(s.zone.lo)}-${noteName(s.zone.hi)}`;
  $('zones').textContent = 'CH 1 · ' + SOUNDS.map(zoneText).join(' · ') + ' · C3 = #60';
  $('low-key').textContent = `${noteName(S.zoneStart)} #${S.zoneStart}`;
  soundBtns.forEach((b, i) => { b.querySelector('.ch').textContent = `${noteName(SOUNDS[i].zone.lo)}-${noteName(SOUNDS[i].zone.hi)}`; });
  $('low-down').disabled = S.zoneStart - 12 < 0; $('low-up').disabled = S.zoneStart + 12 + 24 > 127;
}
function moveZones(by) {
  const to = S.zoneStart + by;
  if (to < 0 || to + 24 > 127) return;
  S.zoneStart = to; setZoneStart(to);
  S.keyEdits = S.keyEdits.map((k) => Object.fromEntries(Object.entries(k).map(([n, e]) => [Number(n) + by, e])));
  SOUNDS.forEach((s, i) => { editKey[i] += by; lastMorph[i] = null; });
  save(); buildStrip(); drawZones(); drawSide(); drawFaders(); drawEditKey();
  detail(`lowest key <em>${noteName(to)} #${to}</em>`);
}
$('low-down').addEventListener('click', () => moveZones(-12));
$('low-up').addEventListener('click', () => moveZones(12));
drawZones();
$('start-text').textContent = `MIDI channel 1: ${SOUNDS.map((s) => `${s.name.toLowerCase()} on ${noteName(s.zone.lo)}-${noteName(s.zone.hi)}`).join(', ')}, all three at once. `
  + `Each zone's base key (${SOUNDS.map((s) => noteName(s.zone.base)).join(', ')}) plays its sound as you made it; the other keys are variants of it.`;
if (new URLSearchParams(location.search).has('nostart')) $('start').hidden = true; // screenshots

// ---------------------------------------------------------------------------------------------------------------
// fit the screen to small windows (a MacBook Air's browser with its toolbar and the dock): below 1264x784 inside the
// bezel the whole screen is laid out at that size and scaled down, so every knob stays visible and nothing scrolls
// ---------------------------------------------------------------------------------------------------------------
const FIT_W = 1264, FIT_H = 850;
// the engine buttons sit right under their key groups in the strip above, FX under the key's buttons
function alignEngines() {
  const row = $('sounds'), sc = $('screen'), k = sc.getBoundingClientRect().width / sc.offsetWidth || 1;
  const base = row.getBoundingClientRect().left;
  const place = (b, el) => { const r = el.getBoundingClientRect(); Object.assign(b.style, { left: `${(r.left - base) / k}px`, width: `${r.width / k}px` }); };
  document.querySelectorAll('#keystrip .kgroup').forEach((g, i) => place(soundBtns[i], g));
  const tag = row.querySelector('.tag'); tag.style.left = `${parseFloat(soundBtns[0].style.left) - tag.offsetWidth - 12}px`;
}
function fitScreen() {
  const sc = $('screen'), vw = innerWidth - 16, vh = innerHeight - 16, s = Math.min(1, vw / FIT_W, vh / FIT_H);
  if (s < 1) Object.assign(sc.style, { width: `${vw / s}px`, height: `${vh / s}px`, maxWidth: 'none', margin: '0', transform: `scale(${s})`, transformOrigin: '0 0' });
  else sc.removeAttribute('style');
  drawKeymap(); alignEngines();
}
window.addEventListener('resize', fitScreen);
fitScreen();
document.fonts?.ready.then(alignEngines);
window.afxReady = true; // index.html's load check
