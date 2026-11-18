// LXR-AFX: the page. Seven sounds on MIDI channels 1 to 7; every key from C1 to C5 plays a morph of its sound (C3 plays
// the base). The editor changes the base; the morphs follow from it. The sound engine is in sound/ (no UI here).
import { SOUNDS, VOICE_SCHEMAS, INIT_VALUES, PAGES, PAR, PAN_RANGE, MOD_TARGETS, MOD_TARGET_VOICE_RANGES, NUM_PARAMS, ALL_PARAMS,
  voiceOwned, voiceOfTarget, showValue, parseSnd, seqOnPar, seqPatPar, soundOfNote, mapVoice, setZoneStart, kindSchema, kindPar, setEngines, zoneSizes, engineOn, MAX_ENGINES, DEFAULT_ENGINES, DEFAULT_ZONE_START, trimPar, trimDb, TRIM_ZERO, sendPar,
  POS_RULE, valuesToPositions, editsToPositions } from '../sound/schema.js?v=mwlur07d';
import { presetName } from './names.js?v=mwlur07d';
import { autoTrim, measure, LEVEL_TARGET_DB } from '../sound/level.js?v=mwlur07d';
import { MAKERS, recipe, recipesFor, blend } from '../sound/makers.js?v=mwlur07d';
import { breed, isDud } from '../sound/breed.js?v=mwlur07d';
import { morphKey, combinedAmount, newSeed, pitchOffset, keyDistance, BASE_NOTE } from '../sound/morph.js?v=mwlur07d';
import { KIT_FILES } from '../sound/kits.js?v=mwlur07d';
import { FX_DEFAULTS, echoMs, ECHO_DIVS } from '../sound/instrument.js?v=mwlur07d';
import { DIRT_DEFAULTS, dirtHz, scHz, decayMs, volDb, pregainDb, bassDb } from '../sound/dirt.js?v=mwlur07d';

const $ = (id) => document.getElementById(id);
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const noteName = (n) => NOTE_NAMES[n % 12] + (Math.floor(n / 12) - 2); // C3 = 60
const hex = (s) => (s >>> 0).toString(16).toUpperCase().padStart(8, '0');

// ---------------------------------------------------------------------------------------------------------------
// state, kept in this browser
// ---------------------------------------------------------------------------------------------------------------
const STORE = 'lxr-afx-v3'; // v3: AFX mode, three zones on the Bass Station 2's 25 keys
// an engine voice's pan (not PAN1 + voice: the firmware's pans 4-6 sit two further on)
const panPar = (v) => PAR['PAN' + (v + 1)], PAN_PARS = new Set([0, 1, 2, 3, 4, 5].map(panPar));
// a pan for a randomised sound of an engine voice, anywhere in its range (PAN_RANGE: the drum centred, the snare within
// 20%, the metal anywhere)
const randPan = (v) => { const [lo, hi] = PAN_RANGE[v]; return lo + Math.floor(rnd() * (hi - lo + 1)); };
const S = {
  values: INIT_VALUES.slice(), // the kit: every sound's base
  defaults: INIT_VALUES.slice(), // what a double-click resets to (the last kit loaded)
  global: { depth: 100, pitch: 100, timbre: 100 },
  sounds: SOUNDS.map(() => ({ depth: 50, pitch: 50, timbre: 50, seed: newSeed() })),
  locks: new Set(), // the controls with a closed padlock: nothing random changes them (none as it comes)
  // alter: how far ALTER moves a control (%); rhythms: the share of keys (%) that play a running sequence; autoLevel:
  // the randomisers level each sound they deal or alter; source: where NEW SOUND, RANDOM and INIT PATCH get a sound,
  // 'kit' (a kit sound as it is) or 'breed' (two kit sounds crossed, sound/breed.js)
  rand: { alter: 10, wild: false, rhythms: 0, autoLevel: true, source: 'kit' }, // (rhythms: always 0, the sequencer is gone)
  sel: 0, page: 0,
  // per-key edits: keyEdits[sound][note] = { parameter: value }, laid over that key's morph
  keyEdits: SOUNDS.map(() => ({})),
  editAll: false,
  ccMap: null, // knob map, CC number -> target; null: the Bass Station 2 default
  fx: structuredClone(FX_DEFAULTS), // the three send effects' settings (the FX page)
  view: 'synth', // the editor shows the engine's knobs ('synth') or the effects ('fx')
  preset: { id: null, name: '' }, // the patch's name, and the saved preset it is (null: not saved yet)
  engines: DEFAULT_ENGINES, // ENGINES: how many mono engines share the keys, 1 to 6 (Johnny, 2026-11-17)
  zoneStart: DEFAULT_ZONE_START, // the layout's lowest key (moved by octaves with LOW KEY) // the editor edits the last key pressed (false) or the base of every key (true)
};
try {
  const d = JSON.parse(localStorage.getItem(STORE));
  if (d && d.values && d.values.length >= NUM_PARAMS) {
    if (d.posRule !== POS_RULE) { valuesToPositions(d.values); if (d.defaults) valuesToPositions(d.defaults); (d.keyEdits || []).forEach(editsToPositions); } // (kept while the waves, filter types and FM/MIX were menus)
    const fit = (a) => { const o = INIT_VALUES.slice(); o.set(a.slice(0, ALL_PARAMS)); return o; };
    S.values = fit(d.values); S.defaults = fit(d.defaults || d.values);
    if (d.fx) for (const k in S.fx) Object.assign(S.fx[k], d.fx[k]);
    Object.assign(S.global, d.global); d.sounds.forEach((s, i) => Object.assign(S.sounds[i], s));
    if (!d.panRule) d.locks = d.locks.filter((p) => !PAN_PARS.has(p)); // pan used to be locked by default: the randomisers now place it
    if (d.lockRule !== 2) { const was = new Set(VOICE_SCHEMAS.flat().filter((e) => e.rand === 'still' || e.rand === 'mix').map((e) => e.par)); d.locks = d.locks.filter((p) => !was.has(p)); } // (these used to be locked as they came)
    S.locks = new Set(d.locks); Object.assign(S.rand, d.rand); S.rand.rhythms = 0; /* (no sequencer any more: Johnny, 2026-11-17) */ S.sel = d.sel | 0; S.page = d.page | 0;
    if (d.keyEdits) d.keyEdits.forEach((k, i) => { S.keyEdits[i] = k || {}; }); S.editAll = false; /* (the knobs edit the key played, always: Johnny, 2026-11-17) */ if (d.zoneStart) S.zoneStart = d.zoneStart; if (d.engines) S.engines = clamp(d.engines | 0, 1, MAX_ENGINES); S.ccMap = d.ccMap || null;
    if (d.preset && typeof d.preset.name === 'string') S.preset = { id: d.preset.id || null, name: d.preset.name };
  }
} catch (e) { /* first visit, or storage blocked */ }
let saveT = 0;
const save = () => {
  clearTimeout(saveT);
  saveT = setTimeout(() => {
    try {
      localStorage.setItem(STORE, JSON.stringify({ values: [...S.values], defaults: [...S.defaults], global: S.global, sounds: S.sounds,
        locks: [...S.locks], rand: S.rand, sel: S.sel, page: S.page, keyEdits: S.keyEdits, editAll: S.editAll, zoneStart: S.zoneStart, engines: S.engines, ccMap: S.ccMap, fx: S.fx, panRule: 1, lockRule: 2, posRule: POS_RULE, preset: S.preset }));
    } catch (e) { /* storage blocked: it just isn't kept */ }
    drawPreset(); // (the name's mark: changed since it was saved)
  }, 300);
};

setEngines(S.engines); setZoneStart(S.zoneStart);
// the engines in use, in order (the others have no keys)
const onSounds = () => SOUNDS.map((_, i) => i).filter(engineOn);
// (drums: each kit drum's own name, from kits/names.json)
const kits = KIT_FILES.map((k) => ({ ...parseSnd(Uint8Array.from(atob(k.data), (c) => c.charCodeAt(0))), drums: k.drums || [] }));

// ---------------------------------------------------------------------------------------------------------------
// audio
// ---------------------------------------------------------------------------------------------------------------
let ctx = null, node = null;
const send = (m) => { if (node) node.port.postMessage(m); };
async function startAudio() {
  if (ctx) { if (ctx.state !== 'running') await ctx.resume(); return; }
  ctx = new AudioContext({ latencyHint: 'interactive' });
  await ctx.audioWorklet.addModule(new URL('../sound/worklet.js?v=mwlur07d', import.meta.url));
  node = new AudioWorkletNode(ctx, 'lxr-afx', { numberOfInputs: 0, outputChannelCount: [2] });
  node.port.onmessage = (e) => { if (e.data.type === 'peaks') { showPeaks(e.data.peaks); showGr(e.data.gr || 0); showSc(e.data.sc || 0); if (e.data.steps) showSteps(e.data.steps); } };
  node.connect(ctx.destination);
  send({ type: 'kit', values: S.values });
  send({ type: 'fx', fx: S.fx });
  send({ type: 'engines', n: S.engines });
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
    vals.set(seqOnPar(v), 0); // (no key runs a rhythm: the sequencer is gone, Johnny 2026-11-17)
    return { note: BASE_NOTE + Math.round(ed._st || 0), vals, semitones: ed._st || 0 };
  }
  // a scattered key (a kit sound dealt onto it) plays that sound as it is: no morph under it
  if (ed && ed._kit) { for (const [p] of m.params) vals.set(p, S.values[p]); }
  if (ed) for (const p in ed) if (p[0] !== '_') vals.set(Number(p), ed[p]);
  vals.set(seqOnPar(v), 0);
  return ed && ed._kit ? { note: BASE_NOTE + Math.round(ed._st || 0), vals, semitones: ed._st || 0 } : { note: m.note, vals, semitones: m.semitones };
}
// how many parameters a key's edits set (its labels, _kit and _src, aren't parameters)
const editCount = (ed) => (ed ? Object.keys(ed).filter((k) => k[0] !== '_').length : 0);
// a sound on a key, and that key becomes the one the editor edits
const lastMorph = SOUNDS.map(() => null);
const editKey = SOUNDS.map((s) => s.zone.base);
// hold: a key held down (on the keyboard or the strip), so an ACTIVE sequence plays until it's let go; otherwise (a
// randomiser auditioning a key) it plays once. back: the zone going back to an earlier held key (see noteOff)
function play(sound, note, vel, { hold = false, back = false } = {}) {
  const m = keyPatch(sound, note);
  if (ctx && ctx.state !== 'running') ctx.resume();
  send({ type: back ? 'back' : 'play', sound, note: m.note, vel, params: [...m.vals], hold });
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

// ---- UNDO: every change to the sounds (a knob turned, a randomiser, NEW SOUND, PASTE, CLEAR, the RHYTHMS slider) can be
// taken back, the last 40 of them, newest first. A whole drag of a knob is one step (merge: the same control again
// within 1.2 s), and so is anything that changes several controls at once (within 60 ms). The effects and the master
// aren't sounds: UNDO leaves them ----
const undoStack = [];
function snapshot(what, merge, whole) { // whole: a new patch is coming (a preset, INIT PATCH), so the effects and the patch's name are kept too
  const now = performance.now(), top = undoStack[undoStack.length - 1], all = () => (whole ? { fx: structuredClone(S.fx), preset: { ...S.preset } } : {});
  if (top && (now - top.t0 < 60 || (merge && top.merge === merge && now - top.t < 1200))) { top.t = now; if (whole && !top.fx) Object.assign(top, all()); return; }
  undoStack.push({ what, merge, t: now, t0: now, engines: S.engines, values: S.values.slice(), keys: structuredClone(S.keyEdits), ...all() });
  if (undoStack.length > 40) undoStack.shift();
  drawUndo();
}
function drawUndo() {
  const b = $('undo'), top = undoStack[undoStack.length - 1];
  b.disabled = !top; b.title = top ? `Take back: ${top.what} (Z, or Cmd+Z / Ctrl+Z); ${undoStack.length} step${undoStack.length === 1 ? '' : 's'} kept` : 'Nothing to take back yet';
}
const parLabel = (par) => VOICE_SCHEMAS[SOUNDS[S.sel].engineVoice].find((e) => e.par === par)?.label.toUpperCase() || 'a control';
// an edit in the editor: to the last key pressed (kept as that key's own value), or to the base of every key
const editing = () => !S.editAll;
function valueNow(par) { return editing() ? keyPatch(S.sel, editKey[S.sel]).vals.get(par) : S.values[par]; }
// a control changed by hand on a key: the value it had as dealt is kept (ed._o), so its label lights, the notch
// outside its ring shows where it was, and a double-click puts it back. Turned back to that value, it's no longer
// an edit. A new sound on the key (NEW SOUND, RANDOM, PASTE) starts again with none
function handEdit(ed, par, was, v) {
  const o = (ed._o ||= {});
  if (!(par in o)) o[par] = was;
  if (o[par] === v) delete o[par];
  if (!Object.keys(o).length) delete ed._o;
}
function editValue(par, v) {
  if (!editing()) { // ALL KEYS: the engine's base and every key of the zone that has its own sound (locked keys stay)
    snapshot(`${SOUNDS[S.sel].name} ALL KEYS ${parLabel(par)}`, `all/${S.sel}/${par}`);
    const k = S.keyEdits[S.sel], base = S.values[par];
    setValue(par, v);
    for (const n in k) if (!k[n]._lock) { handEdit(k[n], par, k[n][par] ?? base, v); k[n][par] = v; }
    send({ type: 'param', par, value: v }); save(); drawKeymap(); return;
  }
  const note = editKey[S.sel], k = S.keyEdits[S.sel];
  if (keyLocked(S.sel, note)) { lockedMsg(); drawFaders(); return; }
  snapshot(`${SOUNDS[S.sel].name} ${noteName(note)} ${parLabel(par)}`, `key/${S.sel}/${note}/${par}`);
  const was = keyPatch(S.sel, note).vals.get(par);
  handEdit(k[note] ||= {}, par, was, v); k[note][par] = v;
  send({ type: 'param', par, value: v }); // heard on what's still ringing
  save(); drawKeymap(); drawEditKey();
}
const keyEdited = (par) => { const o = S.keyEdits[S.sel][editKey[S.sel]]?._o; return !!o && par in o; };
const handEdits = (ed) => (ed?._o ? Object.keys(ed._o).length : 0);
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
    if (ed && ed._o) snap._o = ed._o;
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
  if ((st & 0xf0) === 0x80 || ((st & 0xf0) === 0x90 && !vel)) { if (ch === 1) noteOff(note); return; } // a key let go
  if ((st & 0xf0) !== 0x90) return;
  noteOn(ch, note, vel);
}
// each zone is mono, last-note priority: the keys held down in it, oldest first. A new key takes over; letting go of
// the newest key while an earlier one is still held takes the zone back to that one (its sound and its sequence),
// which plays again on the next step of the BPM grid (RETURN: now, or the next 1/32, 1/16, 1/8 or 1/4). Letting go
// of a key that isn't the newest changes nothing; letting go of the last one stops the zone's sequence. The three zones
// don't affect each other
const held = SOUNDS.map(() => []);
function keyDown(sound, note, vel) {
  const st = held[sound], i = st.findIndex((k) => k.note === note);
  if (i >= 0) st.splice(i, 1);
  st.push({ note, vel });
  play(sound, note, vel, { hold: true });
}
function noteOff(note) {
  const sound = soundOfNote(note); if (sound < 0) return;
  const st = held[sound], i = st.findIndex((k) => k.note === note);
  if (i < 0) return;
  st.splice(i, 1);
  if (i < st.length) return; // not the newest key: the zone stays on the newest
  if (!st.length) { send({ type: 'release', sound }); return; }
  const prev = st[st.length - 1];
  play(sound, prev.note, prev.vel, { hold: true, back: true });
}
// MIDI all notes off / all sound off: every zone let go
function allOff() { held.forEach((st, sound) => { if (st.length) { st.length = 0; send({ type: 'release', sound }); } }); }
function noteOn(ch, note, vel) {
  if (ch !== 1) { showLastText(`CH ${ch} · ${noteName(note)} · only channel 1 plays`); return; }
  const sound = soundOfNote(note);
  if (sound < 0) { showLastText(`${noteName(note)} #${note} · outside the zones (${noteName(SOUNDS[0].zone.lo)}-${noteName(SOUNDS[S.engines - 1].zone.hi)})`); return; }
  keyDown(sound, note, vel);
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
  114: { t: 'par', label: ['drive'], name: 'overdrive' }, 85: { t: 'par', label: ['pitch amt'], name: 'mod env depth' },
  90: { t: 'par', label: ['attack'], name: 'amp attack' }, 91: { t: 'par', label: ['decay'], name: 'amp decay' },
  103: { t: 'par', label: ['pitch dec'], name: 'mod env decay' }, 94: { t: 'par', label: ['a gain'], name: 'distortion' },
  27: { t: 'par', label: ['coarse'], name: 'osc 1 coarse' }, 26: { t: 'par', label: ['fine'], name: 'osc 1 fine' },
  18: { t: 'par', label: ['echo'], name: 'lfo 1 speed' }, 5: { t: 'par', label: ['reverb'], name: 'portamento' },
  20: { t: 'zlevel', s: 0, name: 'osc 1 level' }, 21: { t: 'zlevel', s: 1, name: 'osc 2 level' }, 22: { t: 'zlevel', s: 2, name: 'sub osc level' },
};
const ccMap = () => S.ccMap || CC_DEFAULT;
// the controls' names before the merged voice, for knobs LEARN mapped then
const OLD_LABELS = { 'fm amt': 'a gain', 'fm freq': 'a freq', 'fm wave': 'a wave', 'fm mode': 'a mode', 'mod1 freq': 'a freq', 'mod2 freq': 'b freq',
  'mod1 gain': 'a gain', 'mod2 gain': 'b gain', 'mod1 wave': 'a wave', 'mod2 wave': 'b wave', 'noise mix': 'noise' };
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
  if (cc === 120 || cc === 123) { allOff(); return; }
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
    const e = t.label.map((l) => sc.find((x) => x.label === (OLD_LABELS[l] || l))).find(Boolean);
    if (!e) { showLastText(`CC${cc} · ${SOUNDS[S.sel].name} has no ${t.label[0]}`); return; }
    let v = Math.round(val / 127 * e.max);
    if (e.display.type === 'detent') { const k = Math.round(v / e.display.step) * e.display.step; if (Math.abs(v - k) <= 2) v = Math.min(k, e.max); } // (a dial's settings catch the knob)
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
window.afx = { noteOn: (ch, note, vel = 100) => noteOn(ch, note, vel), noteOff: (note) => noteOff(note), cc: (cc, val) => onCC(cc, val),
  seqPars: (v) => [seqOnPar(v), seqPatPar(v)], keyEdits: () => S.keyEdits, base: (par) => S.values[par], rhythms: (v) => setRhythms(v), rand: () => S.rand,
  active: (sound, note) => keyPatch(sound, note).vals.get(seqOnPar(SOUNDS[sound].engineVoice)), sounds: SOUNDS,
  pan: (sound, note) => keyPatch(sound, note).vals.get(panPar(SOUNDS[sound].engineVoice)), patch: (sound, note) => [...keyPatch(sound, note).vals],
  trim: (sound, note) => trimDb(keyPatch(sound, note).vals.get(trimPar(SOUNDS[sound].engineVoice))), fx: () => S.fx, fxDefaults: FX_DEFAULTS, locks: () => [...S.locks], setFx: (fx) => applyFx(fx), sendPars: (v) => [sendPar(v, 0), sendPar(v, 1)] }; // a key's AUTO LEVEL correction, dB

// ---------------------------------------------------------------------------------------------------------------
// the last note
// ---------------------------------------------------------------------------------------------------------------
let lastT = 0;
function showLastText(t) {
  $('last-text').textContent = t;
  const box = $('last'); box.classList.add('hit'); clearTimeout(lastT); lastT = setTimeout(() => box.classList.remove('hit'), 90);
}
function showLast(sound, note, vel, st) {
  showLastText(`${SOUNDS[sound].name} · ${noteName(note)} #${note} · V${vel}`);
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
// the distortion's sidechain envelope: how far it's turning its target, a segment per twelfth
let scShown = 0;
function showSc(v) {
  scShown = Math.max(v, scShown * 0.8);
  const n = Math.round(Math.min(1, scShown) * 12);
  document.querySelectorAll('.envm .segs i').forEach((x, i) => x.classList.toggle('on', i < n));
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
// a drag changes a value from where it was; Shift is fine. Only a press and drag changes a control: the scroll wheel,
// the trackpad and the arrow keys never do, and nothing marks a control after it's let go (Johnny: no selection
// circle), so passing the pointer over one is safe
function dragger(track, axis, o) {
  let d = null;
  track.addEventListener('pointerdown', (e) => {
    if (e.button) return;
    track.setPointerCapture(e.pointerId); e.preventDefault();
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
}
function hbar(box, label, o) {
  const el = document.createElement('div'); el.className = 'hb';
  el.innerHTML = `<span class="lab"></span><div class="htrack" role="slider"><i></i></div><output></output>`;
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
  hbar($('rand-bars'), 'ALTER', { min: 1, max: 100, get: () => S.rand.alter, set: (v) => { S.rand.alter = v; save(); }, show: P, dflt: 10 }),
];
$('wild').checked = S.rand.wild;
$('wild').addEventListener('change', () => { S.rand.wild = $('wild').checked; save(); });
$('auto-on').checked = S.rand.autoLevel;
$('auto-on').addEventListener('change', () => { S.rand.autoLevel = $('auto-on').checked; save();
  detail(S.rand.autoLevel ? 'AUTO LEVEL <em>on</em>: NEW SOUND, RANDOM and ALTER bring each key to its engine\'s level' : 'AUTO LEVEL <em>off</em>: a dealt sound plays as loud as its kit made it'); });

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
  buildFaders(); drawSide(); drawEditKey(); drawView();
}
// the tab showing: the engine's knobs ('synth') or FX + MASTER ('fx', F)
function drawView() {
  const fx = S.view === 'fx';
  $('fxside').hidden = !fx; document.querySelector('.editor').hidden = fx;
  soundBtns.forEach((b, k) => b.setAttribute('aria-selected', !fx && k === S.sel));
  $('fx-tab').setAttribute('aria-selected', fx);
}
$('fx-tab').addEventListener('click', () => { S.view = S.view === 'fx' ? 'synth' : 'fx'; save(); drawView(); });
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
// ---- NEW SOUND: the dice at the top right of the synth block (the key's own two columns: the dice, its FX sends, its
// LEVEL). A press, or K, deals the key another kit sound of its engine and rolls the dice: it turns once while its
// face changes a few times, a third of a second. Flat, like the rest of the panel: seven pips, the lit ones the face ----
const DICE_PIPS = { tl: [5, 5], tr: [19, 5], ml: [5, 12], mr: [19, 12], bl: [5, 19], br: [19, 19], c: [12, 12] };
const DICE_FACES = [[], ['c'], ['tl', 'br'], ['tl', 'c', 'br'], ['tl', 'tr', 'bl', 'br'], ['tl', 'tr', 'c', 'bl', 'br'], ['tl', 'tr', 'ml', 'mr', 'bl', 'br']];
const diceBtn = document.createElement('button');
diceBtn.type = 'button'; diceBtn.className = 'dicebtn'; diceBtn.id = 'rand-key';
diceBtn.title = 'NEW SOUND (K): a different kit sound on this key only. UNDO takes it back; LEARN can put it on a button';
diceBtn.setAttribute('aria-label', 'New sound on this key');
diceBtn.innerHTML = `<span class="die"><svg viewBox="0 0 28 28" aria-hidden="true">${Object.entries(DICE_PIPS).map(([k, [x, y]]) => `<rect class="pip" data-p="${k}" x="${x}" y="${y}" width="4" height="4"/>`).join('')}</svg></span>`;
let diceFace = 0, diceT = 0;
$('pv-die').innerHTML = diceBtn.querySelector('.die').innerHTML; // the phone view's dice: the same face
const dice = [diceBtn, $('pv-dice')];
function showDice(n) { diceFace = n; diceBtn.dataset.face = n; for (const d of dice) for (const r of d.querySelectorAll('.pip')) r.classList.toggle('on', DICE_FACES[n].includes(r.dataset.p)); }
function rollDice() {
  clearInterval(diceT);
  const next = () => { let n; do n = 1 + Math.floor(Math.random() * 6); while (n === diceFace); showDice(n); };
  next();
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return; // no turning: the face just changes
  for (const d of dice) { d.classList.remove('roll'); void d.offsetWidth; d.classList.add('roll'); } // (the turn starts again)
  let left = 3; diceT = setInterval(() => { next(); if (!--left) clearInterval(diceT); }, 80);
}
showDice(5);
for (const d of dice) d.addEventListener('animationend', () => d.classList.remove('roll'));
// the synth panel's rows of sections, and its grid: the widest row (the metal's osc and fm; every engine's filter,
// velocity and mix) fills 11 cells
// the merged voice: every engine has every section (Johnny, 2026-11-17); FX and MASTER have a tab of their own
const ROWS = [['osc', 'mod a', 'mod b', 'noise'], ['amp', 'pitch', 'click'], ['filter in', 'filter', 'velocity'], ['lfo', 'mix']];
const GRID_COLS = 14;
// a part that's silent now (its level at zero): its section is greyed, its knobs still turn
const PART_LEVEL = { 'mod a': 'again', 'mod b': 'bgain', noise: 'nmix', pitch: 'pamt', click: 'clickvol' };
function buildFaders() {
  // every section of the sound at once, in page order (tone, shape, filter, mod, mix)
  const box = $('faders'); box.innerHTML = ''; faderDraws = [];
  const voice = SOUNDS[S.sel].engineVoice;
  const lvl = PAR.VOL1 + voice; // the level gets a big knob of its own, bottom right
  const entries = PAGES.flatMap((pg) => VOICE_SCHEMAS[voice].filter((e) => e.page === pg && e.par !== lvl && !e.hidden));
  // one grid for the whole panel: four rows, and columns of equal cells, one knob to a cell (a menu takes two), so
  // every knob lines up with the knobs above and below it. Each row's sections follow on from cell 1; a row that
  // doesn't fill the width ends in an empty filler (so the row rules run the whole way). The last two columns are
  // the key's own: its FX sends in row 2, directly above its big LEVEL across rows 3 and 4
  const cell = (el, r0, r1, c0, c1) => { el.style.gridArea = `${r0} / ${c0} / ${r1} / ${c1}`; return el; };
  ROWS.forEach((secs, r) => {
    let col = 1;
    const sect = (n, cls) => { const el = document.createElement('div'); el.className = 'sect' + (cls || '') + (r ? ' rt' : '') + (col > 1 ? ' sep' : ''); el.style.setProperty('--n', n); cell(el, r + 1, r + 2, col, col + n); col += n; box.append(el); return el; };
    for (const sec of secs) {
      const list = entries.filter((e) => e.section === sec);
      if (!list.length) continue;
      if (sec === 'seq') { seqPanel(sect(GRID_COLS + 1 - col, ' seq'), voice); continue; }
      const el = sect(list.reduce((a, e) => a + (e.display.type === 'target' ? 2 : 1), 0));
      el.innerHTML = `<h3>${sec}</h3><div class="row"></div>`;
      const row = el.querySelector('.row');
      for (const e of list) row.append(e.display.type === 'target' ? targetSelect(e, voice) : vfader(e));
      const lv = PART_LEVEL[sec] && VOICE_SCHEMAS[voice].find((e) => e.ukey === PART_LEVEL[sec]);
      if (lv) faderDraws.push(() => el.classList.toggle('off', !valueNow(lv.par)));
    }
    if (col <= GRID_COLS) { const n = GRID_COLS + 1 - col; if (r === 1 && n >= 3) makePanel(sect(n, ' make')); else sect(n, ' fill'); } // (row 2's free cells: the MAKE buttons)
  });
  const sends = entries.filter((e) => e.section === 'fx sends');
  const el = cell(document.createElement('div'), 2, 3, GRID_COLS + 1, GRID_COLS + 3); el.className = 'sect sends rt sep'; el.style.setProperty('--n', 2);
  el.innerHTML = '<h3>fx sends</h3><div class="row"></div>';
  for (const e of sends) el.querySelector('.row').append(vfader(e));
  box.append(el);
  const dice = cell(document.createElement('div'), 1, 2, GRID_COLS + 1, GRID_COLS + 3); dice.className = 'sect dice sep'; dice.style.setProperty('--n', 2);
  dice.innerHTML = '<h3><span class="dice-src"></span><kbd>K</kbd></h3>'; dice.append(diceBtn); drawSource();
  box.append(dice);
  const big = cell(vfader(VOICE_SCHEMAS[voice].find((e) => e.par === lvl)), 3, 5, GRID_COLS + 1, GRID_COLS + 3); big.classList.add('big', 'rt', 'sep');
  box.append(big);
  // AUTO LEVEL's correction of the key, at the head of the LEVEL cell: lit when the key has one. A press measures the
  // key as it plays now and levels it again (it never switches it off)
  const auto = document.createElement('button'); auto.type = 'button'; auto.className = 'btn sm hdb auto'; auto.id = 'auto-level';
  auto.addEventListener('click', autoPress); big.append(auto);
  faderDraws.push(() => drawAuto(auto));
  // the right: the three effects (each key's sends are its FX SENDS knobs, with the rest of its knobs)
  buildFx();
  drawFaders();
}
function drawFaders() { faderDraws.forEach((d) => d()); }

// ---- the key's 8-step sequencer: while the key is held and ACTIVE is on, it plays the lit steps in 1/16s on the BPM
// grid, from the next 1/16 after the press, round and round; ACTIVE off, the key plays once as usual. RANDOM deals a
// new pattern (and switches it on). One LOCK keeps NEW SOUND off both ----
const randomPattern = () => { let p = 1; for (let i = 1; i < 8; i++) if (rnd() < (i === 4 ? 0.6 : 0.38)) p |= 1 << i; return p; };
let seqSteps = [];
function seqPanel(el, voice) {
  const on = seqOnPar(voice), pat = seqPatPar(voice);
  el.innerHTML = `<h3><span class="t">seq</span></h3><div class="steps"></div><button class="lock" type="button" aria-label="Lock the sequencer">${LOCK_SVG}</button>`;
  const h = el.querySelector('h3'), steps = el.querySelector('.steps'), lock = el.querySelector('.lock');
  const hb = (text, title, fn) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'btn sm hdb'; b.textContent = text; b.title = title; b.addEventListener('click', fn); h.append(b); return b; };
  const act = hb('ACTIVE', 'Play the steps while the key is held (off: the key plays once)', () => {
    editValue(on, valueNow(on) ? 0 : 1); drawFaders(); detail(`${SOUNDS[S.sel].name} ${noteName(editKey[S.sel])} SEQ <em>${valueNow(on) ? 'ACTIVE' : 'OFF'}</em>`); });
  hb('RANDOM', 'A new random pattern for this key, switched on', () => {
    editValue(pat, randomPattern()); editValue(on, 1); drawFaders(); detail(`${SOUNDS[S.sel].name} ${noteName(editKey[S.sel])} SEQ <em>a new pattern</em>`); });
  h.append(lock); // at the end of the heading, after ACTIVE and RANDOM
  seqSteps = [];
  for (let i = 0; i < 8; i++) {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'st' + (i % 4 === 0 ? ' beat' : ''); b.textContent = i + 1;
    b.title = `Step ${i + 1}`;
    b.addEventListener('click', () => { editValue(pat, valueNow(pat) ^ (1 << i)); drawFaders(); });
    steps.append(b); seqSteps.push(b);
  }
  lock.title = 'Lock the sequencer: the dice, RANDOM and the RHYTHMS slider leave its steps and ACTIVE alone, on every key';
  lock.addEventListener('click', () => {
    const l = !S.locks.has(pat); for (const p of [on, pat]) if (l) S.locks.add(p); else S.locks.delete(p); save(); drawFaders(); drawLocks();
    detail(l ? `${SOUNDS[S.sel].name} SEQ <em>locked</em>: the dice, RANDOM and RHYTHMS leave every ${SOUNDS[S.sel].name.toLowerCase()} key's steps as they are` : `${SOUNDS[S.sel].name} SEQ <em>unlocked</em>`);
  });
  faderDraws.push(() => {
    const p = valueNow(pat), a = valueNow(on);
    seqSteps.forEach((b, i) => b.setAttribute('aria-pressed', !!((p >> i) & 1)));
    act.setAttribute('aria-pressed', !!a); el.classList.toggle('off', !a);
    h.classList.toggle('keyed', editing() && (keyEdited(on) || keyEdited(pat)));
    lock.setAttribute('aria-pressed', S.locks.has(pat));
  });
}
// the step playing now, on the key being edited (the worklet says which step each zone's sequence is on)
function showSteps(steps) {
  const st = held[S.sel], playing = st.length && st[st.length - 1].note === editKey[S.sel] ? steps[S.sel] : -1;
  seqSteps.forEach((b, i) => b.classList.toggle('now', i === playing));
}

// ---- the FX page: the three send effects every key feeds (each key's sends are its FX SENDS knobs) ----
function gknob(label, o) {
  const el = document.createElement('div'); el.className = 'vf';
  el.innerHTML = `<output></output><div class="knob" role="slider">${KNOB_SVG}</div><span class="lab"></span>`;
  el.querySelector('.lab').textContent = label;
  const tr = el.querySelector('.knob'), out = el.querySelector('output'), ticks = tr.querySelectorAll('.tk'), ptr = tr.querySelector('.ptr');
  tr.setAttribute('aria-label', label);
  const draw = () => {
    const v = o.get();
    lightRing(ticks, v, o.max, o.centre);
    ptr.setAttribute('transform', `rotate(${knobDeg(v, o.max, o.centre)} 32 32)`);
    out.textContent = o.show ? o.show(v) : String(v); tr.setAttribute('aria-valuenow', v);
  };
  const put = (v) => { v = clamp(Math.round(v), 0, o.max); if (v !== o.get()) { o.set(v); draw(); } };
  dragger(tr, 'y', { min: 0, get max() { return o.max; }, len: 160, get: o.get, put, held: (h) => el.classList.toggle('held', h) });
  const reset = () => put(o.dflt); el.querySelector('.lab').addEventListener('dblclick', reset); tr.addEventListener('dblclick', reset);
  faderDraws.push(draw);
  return el;
}
const sendFx = () => { send({ type: 'fx', fx: S.fx }); save(); };
// the right-hand column: the send effects (each key feeds them at its ECHO and REVERB knobs), then the master that
// everything (dry and the effects' returns) goes through: distortion, compressor, level. A string is a heading
// the echo's TIME: milliseconds, or with SYNC on a note length at the BPM (1/32 .. 1/2, triplets and dotted), which
// follows the BPM. Each keeps its own setting, so SYNC off goes back to the time it had
const E = () => S.fx.echo;
const ECHO_TIME = {
  get max() { return E().sync ? ECHO_DIVS.length - 1 : 127; },
  get: () => (E().sync ? E().div : E().time),
  set: (v) => { E()[E().sync ? 'div' : 'time'] = v; sendFx(); },
  show: (v) => (E().sync ? ECHO_DIVS[v][0] : echoMs(v) + ' ms'),
  get dflt() { return FX_DEFAULTS.echo[E().sync ? 'div' : 'time']; },
};
// a switch in a knob's cell: a button that steps through its settings, named on the button, lit away from the first
function gswitch(label, names, title, get, set) {
  const el = document.createElement('div'); el.className = 'vf vsw';
  el.innerHTML = '<output></output><button class="swb" type="button"></button><span class="lab"></span>';
  el.querySelector('.lab').textContent = label;
  const b = el.querySelector('.swb'); b.title = title;
  const draw = () => { b.textContent = names[get()] ?? names[0]; b.setAttribute('aria-pressed', get() > 0); };
  b.addEventListener('click', () => { set((get() + 1) % names.length); faderDraws.forEach((d) => d()); });
  faderDraws.push(draw);
  return el;
}
const FX_PAGE = [
  ['echo', 'ECHO', [['time', ECHO_TIME], ['sync', 'switch', ['OFF', 'ON'], 'Sync: TIME in note lengths at the BPM (1/32 to 1/2, triplets and dotted), following the BPM', (v) => {
    E().sync = v; sendFx(); detail(v ? `ECHO SYNC <em>ON</em>: TIME ${ECHO_DIVS[E().div][0]} at ${S.fx.tempo.bpm} BPM` : `ECHO SYNC <em>OFF</em>: TIME ${echoMs(E().time)} ms`);
  }], ['feedback', 127], ['tone', 127], ['pingpong', 'switch', ['OFF', 'ON'], 'Ping-pong: each repeat on the other side', (v) => {
    E().pingpong = v; sendFx(); detail(`ECHO PING-PONG <em>${v ? 'ON' : 'OFF'}</em>`); }, 'p-pong']]],
  ['reverb', 'REVERB', [['size', 127], ['decay', 127], ['tone', 127], ['early', 127]]],
  'MASTER',
  'DIRT', // the distortion and its sidechain: buildDirt
  ['master', 'COMPRESSOR', [['thresh', 40, (v) => (v ? '-' + v + 'dB' : 'off')], ['ratio', 200, (v) => (Math.max(10, v) / 10).toFixed(1) + ':1'],
    ['attack', 100, (v) => Math.max(1, v) + 'ms'], ['release', 1000, (v) => Math.max(10, v) + 'ms'], ['knee', 24, (v) => v + 'dB'], ['makeup', 24, (v) => '+' + v + 'dB']]],
  ['master', 'OUTPUT', [['level', 100, (v) => v + '%']]],
];
function buildFx() {
  // the FX + MASTER tab: three columns, the send effects, the master's distortion, then its compressor and output
  const top = $('fxglobal'); top.innerHTML = '';
  const cols = [0, 1, 2].map(() => { const c = document.createElement('div'); c.className = 'fxcol'; top.append(c); return c; });
  let box = cols[0];
  box.innerHTML = '<h2>SEND FX <span class="dim">EACH KEY\'S ECHO + REVERB</span></h2>';
  for (const item of FX_PAGE) {
    if (item === 'DIRT') { box.append(...buildDirt()); continue; }
    if (typeof item === 'string') { box = cols[1]; const h = document.createElement('h2'); h.innerHTML = `${item} <span class="dim">EVERYTHING GOES THROUGH</span>`; box.append(h); continue; }
    const [id, name, knobs] = item;
    if (name === 'COMPRESSOR') { box = cols[2]; const h = document.createElement('h2'); h.innerHTML = '&nbsp;'; box.append(h); }
    const el = document.createElement('div'); el.className = 'sect'; el.style.setProperty('--n', knobs.length);
    el.innerHTML = `<h3>${name}</h3><div class="row"></div>`;
    for (const [k, max, show, label, set, name] of knobs)
      el.querySelector('.row').append(typeof max === 'object' ? gknob(k, max) // a knob of its own (the echo's TIME)
        : max === 'switch' ? gswitch(name || k, show, label, () => S.fx[id][k], set)
          : gknob(label || k, { max, show, get: () => S.fx[id][k], set: (v) => { S.fx[id][k] = v; sendFx(); }, dflt: FX_DEFAULTS[id][k] }));
    box.append(el);
  }
  // beside the output level: the compressor's gain reduction
  const gm = document.createElement('div'); gm.className = 'grm';
  gm.innerHTML = `<span class="dim">GAIN REDUCTION</span><div class="segs">${'<i></i>'.repeat(24)}</div><output>0 dB</output>`;
  box.lastChild.querySelector('.row').append(gm); box.lastChild.classList.add('mout');
}
// ---- the master distortion (sound/dirt.js): a dual-path bass drive. Its input stage, clip stages, tone and the two
// path volumes on two rows; the sidechain under it, its header reading as a sentence (SIDECHAIN ON TURNS CUTOFF UP).
// A section that's switched off is greyed, but its knobs still turn ----
const hz = (f) => (f < 1000 ? Math.round(f) + 'Hz' : (f / 1000).toFixed(f < 9950 ? 1 : 0) + 'k');
const sdb = (d) => (d > 0 ? '+' : '') + Math.round(d) + 'dB';
let dirtSects = [];
function drawDirt() { dirtSects.forEach(([el, k]) => el.classList.toggle('off', !S.fx.dirt[k])); }
function buildDirt() {
  const D = S.fx.dirt, say = (what) => detail(`MASTER DISTORTION ${what}`);
  const knob = (k, label, max, show, centre) => gknob(label, { max, show, centre, get: () => D[k], dflt: DIRT_DEFAULTS[k],
    set: (v) => { D[k] = v; sendFx(); say(`${label.toUpperCase()} <em>${show ? show(v) : v}</em>`); } });
  // a switch: a button that steps through its settings, named on the button
  // (lit when it's away from its first setting, like the pedal's switch lights; a choice in the header isn't lit)
  const cycle = (b, k, names, label, lit = true) => {
    const draw = () => { b.textContent = names[D[k]] ?? names[0]; if (lit) b.setAttribute('aria-pressed', D[k] > 0); };
    b.addEventListener('click', () => { D[k] = (D[k] + 1) % names.length; sendFx(); draw(); drawDirt(); say(`${label ? label + ' ' : ''}<em>${names[D[k]]}</em>`); });
    faderDraws.push(draw); return b;
  };
  const sw = (k, label, names, title) => {
    const el = document.createElement('div'); el.className = 'vf vsw';
    el.innerHTML = '<output></output><button class="swb" type="button"></button><span class="lab"></span>';
    el.querySelector('.lab').textContent = label; el.querySelector('.swb').title = title;
    cycle(el.querySelector('.swb'), k, names, label.toUpperCase());
    return el;
  };
  const hbtn = (k, names, label, title) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'btn sm hdb'; b.title = title; return cycle(b, k, names, label, names[0] === 'OFF'); };
  const sect = (n, rows) => {
    const el = document.createElement('div'); el.className = 'sect dirt'; el.style.setProperty('--n', n);
    el.innerHTML = '<h3></h3>';
    for (const items of rows) { const r = document.createElement('div'); r.className = 'row'; r.append(...items); el.append(r); }
    return el;
  };
  const dist = sect(6, [
    [knob('pregain', 'pregain', 48, (v) => sdb(pregainDb(v)), 24), knob('cutoff', 'cutoff', 127, (v) => hz(dirtHz(v))),
      sw('swap', 'filter', ['HP', 'LP'], 'The filter before the distortion: high-pass (the lows stay out of it) or low-pass'),
      sw('xover', 'xover', ['OFF', 'ON'], 'Crossover: the half the filter takes away goes to the clean path (HP: distorted highs, clean lows; LP: the other way round)'),
      knob('gain', 'gain', 127), sw('clip', 'clip', ['DIODE', 'LED'], 'Clipping: diodes clip early and hard; LEDs later, louder and more open')],
    [knob('bass', 'bass', 24, (v) => sdb(bassDb(v)), 12), knob('tone', 'tone', 127, (v) => (v === 64 ? 'scoop' : (v > 64 ? '+' : '') + (v - 64)), 64),
      knob('dirty', 'dirty', 127, (v) => (v ? sdb(volDb(v)) : 'off')), knob('clean', 'clean', 127, (v) => (v ? sdb(volDb(v)) : 'off'))],
  ]);
  dist.querySelector('h3').append(Object.assign(document.createElement('span'), { className: 't', textContent: 'DISTORTION' }),
    hbtn('on', ['OFF', 'ON'], '', 'Switch the master distortion in or out'));
  const env = document.createElement('div'); env.className = 'envm';
  env.innerHTML = `<output></output><div class="segs">${'<i></i>'.repeat(12)}</div><span class="lab">env</span>`;
  const side = sect(6, [[sw('src', 'source', ['MIX', 'ENG 1', 'ENG 2', 'ENG 3'], 'What the sidechain listens to: the whole mix, or one engine on its own'),
    sw('scfilt', 'filter', ['LP', 'BP', 'HP'], "The sidechain's filter: low-pass, band-pass or high-pass at FREQ"),
    knob('freq', 'freq', 127, (v) => hz(scHz(v))), knob('sens', 'sens', 127), knob('decay', 'decay', 127, (v) => { const ms = decayMs(v); return ms < 1000 ? Math.round(ms) + 'ms' : (ms / 1000).toFixed(1) + 's'; }), env]]);
  const h = side.querySelector('h3');
  h.append(Object.assign(document.createElement('span'), { className: 't', textContent: 'SIDECHAIN' }),
    hbtn('sc', ['OFF', 'ON'], 'SIDECHAIN', 'Let the sidechain turn a knob of the distortion'),
    Object.assign(document.createElement('span'), { className: 'dim', textContent: 'TURNS' }),
    hbtn('target', ['PREGAIN', 'CUTOFF', 'TONE'], 'SIDECHAIN TURNS', 'The knob the sidechain turns'),
    hbtn('dir', ['UP', 'DOWN'], 'SIDECHAIN DIRECTION', 'Which way it turns it: up to the top of its range, or down to the bottom'));
  dirtSects = [[dist, 'on'], [side, 'sc']];
  faderDraws.push(drawDirt);
  return [dist, side];
}
// a knob in the LCD look: a ring of segments (lit up to the value), a pointer, and a notch outside the ring for the
// base (editing a key) or the last key's morph (editing every key). Drag up or down; Shift is fine
const KNOB_N = 25, KNOB_A0 = Math.PI * 0.75, KNOB_SWEEP = Math.PI * 1.5;
const KNOB_SVG = (() => {
  let t = '';
  for (let i = 0; i < KNOB_N; i++) {
    const a = KNOB_A0 + i / (KNOB_N - 1) * KNOB_SWEEP, c = Math.cos(a), s = Math.sin(a);
    t += `<line class="tk" x1="${(32 + 20 * c).toFixed(2)}" y1="${(32 + 20 * s).toFixed(2)}" x2="${(32 + 28 * c).toFixed(2)}" y2="${(32 + 28 * s).toFixed(2)}"/>`;
  }
  return `<svg viewBox="0 0 64 64" aria-hidden="true">${t}<line class="ptr" x1="32" y1="32" x2="46" y2="32"/><line class="notch" x1="61" y1="32" x2="64" y2="32"/></svg>`;
})();
// a plus-minus knob (centre given: pan, coarse, fine, pregain, bass, tone) has its centre at the top, each half of its
// range on its own side, and its ring lit from the top out to the value; any other knob lights from the bottom left
const knobF = (v, max, c) => (c === undefined ? (max ? v / max : 0) : v <= c ? 0.5 * v / (c || 1) : 0.5 + 0.5 * (v - c) / ((max - c) || 1));
const knobDeg = (v, max, c) => (KNOB_A0 + knobF(v, max, c) * KNOB_SWEEP) * 180 / Math.PI;
function lightRing(ticks, v, max, c) {
  const lit = Math.round(knobF(v, max, c) * (KNOB_N - 1)), mid = (KNOB_N - 1) / 2;
  if (c === undefined) ticks.forEach((t, i) => t.classList.toggle('on', i <= lit && (v > 0 || i === 0)));
  else { const a = Math.min(lit, mid), b = Math.max(lit, mid); ticks.forEach((t, i) => t.classList.toggle('on', i >= a && i <= b)); }
}
// a control's lock: a small padlock beside it (faint: open to the randomisers; solid: locked)
const LOCK_SVG = '<svg viewBox="0 0 16 18" aria-hidden="true"><path d="M4 8V5a4 4 0 0 1 8 0v3"/><rect x="1.5" y="8" width="13" height="9" rx="1"/></svg>';
// a pan knob's L and R, at the two ends of its ring
const LR_SVG = '<text class="lr" x="3" y="66">L</text><text class="lr" x="61" y="66">R</text>';
function vfader(e) {
  const el = document.createElement('div'); el.className = 'vf';
  el.innerHTML = `<output></output><div class="knob" role="slider">${KNOB_SVG}</div><span class="lab"></span><button class="lock" type="button" aria-label="Lock ${e.label}">${LOCK_SVG}</button>`;
  el.querySelector('.lab').textContent = e.label;
  const tr = el.querySelector('.knob'), out = el.querySelector('output'), lock = el.querySelector('.lock');
  const ticks = tr.querySelectorAll('.tk'), ptr = tr.querySelector('.ptr'), notch = tr.querySelector('.notch');
  tr.setAttribute('aria-label', e.label); tr.setAttribute('aria-valuemin', 0); tr.setAttribute('aria-valuemax', e.max);
  const c = e.display.type === 'pm' ? e.display.centre : undefined;
  if (e.display.lr) tr.querySelector('svg').insertAdjacentHTML('beforeend', LR_SVG);
  const draw = () => {
    const v = valueNow(e.par);
    lightRing(ticks, v, e.max, c);
    ptr.setAttribute('transform', `rotate(${knobDeg(v, e.max, c)} 32 32)`);
    out.textContent = showValue(e, v);
    tr.setAttribute('aria-valuenow', v); tr.setAttribute('aria-valuetext', showValue(e, v));
    // the notch: editing a key, where the control was before you changed it; editing every key, where the last key
    // played has it
    const lm = lastMorph[S.sel], mv = editing() ? S.keyEdits[S.sel][editKey[S.sel]]?._o?.[e.par] : lm && lm.values.get(e.par);
    tr.classList.toggle('morphed', mv !== undefined && mv !== v);
    if (mv !== undefined) notch.setAttribute('transform', `rotate(${knobDeg(mv, e.max, c)} 32 32)`);
    el.classList.toggle('changed', !editing() && v !== S.defaults[e.par]);
    el.classList.toggle('keyed', editing() && keyEdited(e.par));
    const locked = S.locks.has(e.par);
    lock.setAttribute('aria-pressed', locked);
    lock.title = locked ? `${e.label.toUpperCase()} is locked: the dice, RANDOM and ALTER leave it as it is, on every key. Click to unlock` : `Lock ${e.label.toUpperCase()}: the dice, RANDOM and ALTER then leave it as it is, on every key`;
  };
  const step = e.display.type === 'detent' ? e.display.step : 0;
  const put = (x) => {
    x = clamp(Math.round(x), 0, e.max);
    if (step) { const k = Math.round(x / step) * step; if (Math.abs(x - k) <= 2) x = Math.min(k, e.max); } // (a morphable switch: its settings catch the knob)
    if (x === valueNow(e.par)) return;
    editValue(e.par, x); draw();

    detail(`${SOUNDS[S.sel].name} ${editing() ? noteName(editKey[S.sel]) + ' ' : 'ALL KEYS '}${e.label.toUpperCase()} <em>${showValue(e, x)}</em>`);
  };
  dragger(tr, 'y', { min: 0, max: e.max, len: 160, get: () => valueNow(e.par), put, held: (h) => el.classList.toggle('held', h) });
  // double-click: on a key, the control goes back to where it was before you changed it; on every key, back to the
  // kit's value
  const reset = () => {
    if (editing() && keyLocked(S.sel, editKey[S.sel])) { lockedMsg(); return; }
    if (editing()) { const was = S.keyEdits[S.sel][editKey[S.sel]]?._o?.[e.par]; if (was !== undefined) put(was); }
    else put(S.defaults[e.par]);
  };
  el.querySelector('.lab').addEventListener('dblclick', reset); tr.addEventListener('dblclick', reset);
  el.dataset.learn = JSON.stringify({ t: 'par', label: [e.label] });
  tr.addEventListener('focus', () => detail(`${SOUNDS[S.sel].name} ${e.label.toUpperCase()} <em>${showValue(e, valueNow(e.par))}</em>`));
  lock.addEventListener('click', () => {
    const on = !S.locks.has(e.par); if (on) S.locks.add(e.par); else S.locks.delete(e.par); save(); draw(); drawLocks();
    detail(on ? `${SOUNDS[S.sel].name} ${e.label.toUpperCase()} <em>locked</em>: the dice, RANDOM and ALTER leave it as it is, on every ${SOUNDS[S.sel].name.toLowerCase()} key` : `${SOUNDS[S.sel].name} ${e.label.toUpperCase()} <em>unlocked</em>`);
  });
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
  const locked = keyLocked(S.sel, note), nl = Object.values(edits).filter((e) => e._lock).length;
  $('clear-key').disabled = !here || locked;
  $('lock-key').setAttribute('aria-pressed', locked); $('lock-key').querySelector('span').textContent = locked ? 'LOCKED' : 'LOCK KEY';
  diceBtn.disabled = locked; $('alter-key').disabled = locked; $('paste-key').disabled = locked || !clip;
  // the key header: the key, its engine, and what it plays
  const he = handEdits(edits[note]), hand = he ? ` · ${he} edit${he === 1 ? '' : 's'}` : '';
  const what = locked ? `locked${from && from !== 'kept' ? ' · ' + from : ''}` : from ? (from === 'kept' ? 'its own sound' : from) + hand :
    here ? `its own sound${hand}` : `the ${SOUNDS[S.sel].name.toLowerCase()} base sound`;
  $('kh-note').textContent = noteName(note); $('kh-num').textContent = '#' + note;
  $('kh-engine').textContent = SOUNDS[S.sel].name; $('kh-info').textContent = what;
  $('screen').classList.toggle('keylocked', locked);
  drawStrip();
}
$('clear-key').addEventListener('click', () => { if (!keyLocked(S.sel, editKey[S.sel])) snapshot(`${SOUNDS[S.sel].name} ${noteName(editKey[S.sel])} CLEAR`); clearKey(S.sel, editKey[S.sel]); drawFaders(); drawKeymap(); drawEditKey(); detail(`${SOUNDS[S.sel].name} ${noteName(editKey[S.sel])}: back to the engine's base sound`); });
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
  const ed = { _kit: clip.voice !== v && !/\(as \w+\)$/.test(clip.label) ? `${clip.label} (as ${SOUNDS[sound].name.toLowerCase()})` : clip.label, _st: clip.st };
  for (const [p, x] of now) if (p !== level) ed[p] = x;
  for (const [p, x] of pairs) if (p !== level && now.has(p)) ed[p] = x;
  randChange(() => { S.keyEdits[sound][note] = ed; if (clip.voice !== v) levelKey(sound, note, true); if (S.editAll) setEditAll(false); },
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
    if (!engineOn(i)) return;
    const g = document.createElement('div'); g.className = 'kgroup';
    g.innerHTML = `<span class="kz">${s.name}</span><div class="keys"></div>`;
    for (let note = s.zone.lo; note <= s.zone.hi; note++) {
      const k = document.createElement('button'); k.type = 'button'; k.className = 'k' + ([1, 3, 6, 8, 10].includes(note % 12) ? ' blk' : '');
      k.title = `${s.name} ${noteName(note)} #${note}`;
      k.innerHTML = '<svg viewBox="0 0 16 18" aria-hidden="true"><path d="M4 8V5a4 4 0 0 1 8 0v3"/><rect x="1.5" y="8" width="13" height="9" rx="1"/></svg>';
      // held down, it plays like a key on the keyboard (an ACTIVE sequence plays until it's let go)
      k.addEventListener('pointerdown', (e) => { k.setPointerCapture(e.pointerId); startAudio().then(() => keyDown(i, note, 100)); });
      const up = () => noteOff(note); k.addEventListener('pointerup', up); k.addEventListener('pointercancel', up);
      g.querySelector('.keys').append(k); stripKeys.push({ k, sound: i, note });
    }
    box.append(g);
  });
}
let drawPhone = () => {}; // (the phone view's pads and controls: set where the phone view is built, below)
function drawStrip() {
  drawPhone();
  for (const { k, sound, note } of stripKeys) {
    const ed = S.keyEdits[sound][note];
    k.classList.toggle('sel', sound === S.sel && note === editKey[sound]);
    k.classList.toggle('locked', !!ed?._lock);
    const run = !!keyPatch(sound, note).vals.get(seqOnPar(SOUNDS[sound].engineVoice));
    k.classList.toggle('own', handEdits(ed) > 0 && !ed._lock); // a dot: you changed this key by hand
    k.classList.toggle('run', run); // a dashed foot: it plays a rhythm while held
    k.title = `${SOUNDS[sound].name} ${noteName(note)} #${note}${ed?._kit && ed._kit !== 'kept' ? ' · ' + ed._kit : ''}${ed?._lock ? ' · locked' : ''}${run ? ' · plays a rhythm' : ''}${handEdits(ed) ? ' · edited' : ''}`;
  }
}

// a menu (LFO DEST, VEL DEST) doesn't change under the scroll wheel either (some browsers step a focused one)
document.addEventListener('wheel', (e) => { if (e.target.closest && e.target.closest('select')) e.preventDefault(); }, { passive: false, capture: true });

// ---- the RANDOM menu ----
function openMenu(open) { $('menu-panel').hidden = !open; $('menu-btn').setAttribute('aria-expanded', open); if (initArmed) disarmInit(); else drawInit(); if (open) { openPresets(false); openSettings(false); } }
$('menu-btn').addEventListener('click', () => openMenu($('menu-panel').hidden));
// ---- SETTINGS: the things set once and left (LOW KEY, RETURN, the hardware knobs' LEARN and BS2 MAP), out of the way ----
// SCREEN COLOURS: the screen is drawn in two colours, a panel and an ink (css/lcd.css derives every other shade from
// them). A few looks to pick, or your own two; kept in this browser (not in presets). A dark panel loses the LCD's
// backlight glow and shades towards black
const COLOURS_STORE = 'lxr-afx-colours';
const THEMES = [['LCD', '#a7b58c', '#17200e'], ['BLUE LCD', '#9cb6c6', '#0c1a28'], ['PAPER', '#e2ded0', '#1e1c18'],
  ['AMBER', '#1c1408', '#ffaa32'], ['GREEN CRT', '#08140a', '#6eff8c'], ['NIGHT', '#14285a', '#e6eeff']];
let colours = { panel: THEMES[0][1], ink: THEMES[0][2] };
try { const c = JSON.parse(localStorage.getItem(COLOURS_STORE)); if (c && /^#[0-9a-f]{6}$/i.test(c.panel) && /^#[0-9a-f]{6}$/i.test(c.ink)) colours = c; } catch (e) { /* the LCD */ }
function applyColours(keep) {
  const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.substr(i, 2), 16)), p = rgb(colours.panel), st = document.documentElement.style;
  const dark = (0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2]) / 255 < 0.4;
  st.setProperty('--panel-rgb', p.join(' ')); st.setProperty('--ink-rgb', rgb(colours.ink).join(' '));
  st.setProperty('--shade-rgb', dark ? '0 0 0' : 'var(--ink-rgb)'); st.setProperty('--glow', dark ? 0 : 1);
  $('col-panel').value = colours.panel; $('col-ink').value = colours.ink;
  for (const b of $('themes').children) b.setAttribute('aria-pressed', b.dataset.panel === colours.panel && b.dataset.ink === colours.ink);
  if (keep) { try { localStorage.setItem(COLOURS_STORE, JSON.stringify(colours)); } catch (e) { /* not kept */ } }
}
for (const [name, panel, ink] of THEMES) {
  const b = document.createElement('button'); b.type = 'button'; b.className = 'btn theme'; b.textContent = name; b.dataset.panel = panel; b.dataset.ink = ink;
  b.style.setProperty('--tp', panel); b.style.setProperty('--ti', ink); b.title = `The screen in ${name.toLowerCase()} colours`;
  b.addEventListener('click', () => { colours = { panel, ink }; applyColours(true); detail(`screen colours: <em>${name}</em>`); });
  $('themes').append(b);
}
for (const [id, k] of [['col-panel', 'panel'], ['col-ink', 'ink']]) $(id).addEventListener('input', (e) => { colours = { ...colours, [k]: e.target.value.toLowerCase() }; applyColours(true); });
$('col-reset').addEventListener('click', () => { colours = { panel: THEMES[0][1], ink: THEMES[0][2] }; applyColours(true); detail('screen colours: back to the <em>LCD</em>'); });
applyColours(false);
function openSettings(open) { $('settings-panel').hidden = !open; $('settings-btn').setAttribute('aria-expanded', open); if (open) { openMenu(false); openPresets(false); } }
$('settings-btn').addEventListener('click', () => openSettings($('settings-panel').hidden));
$('learn').addEventListener('click', () => { if (learn) openSettings(false); }); // (armed, the menu gets out of the way of the control to click)
document.addEventListener('pointerdown', (e) => {
  if (!$('menu-panel').hidden && !e.target.closest('#menu')) openMenu(false);
  if (!$('preset-panel').hidden && !e.target.closest('#pmenu')) openPresets(false);
  if (!$('settings-panel').hidden && !e.target.closest('#smenu')) openSettings(false);
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { openMenu(false); openPresets(false); openSettings(false); } });

// ---------------------------------------------------------------------------------------------------------------
// randomisers (the logic of Elixir Desktop's, plus locks): every press starts from the voice's home (what it was before
// the first randomise since the last edit), so repeated presses vary one sound instead of drifting. Drum-safe ranges
// unless WILD; a locked control never moves
// ---------------------------------------------------------------------------------------------------------------
let rngState = (Date.now() ^ 0x9e3779b9) >>> 0 || 1;
const rnd = () => { rngState ^= rngState << 13; rngState >>>= 0; rngState ^= rngState >>> 17; rngState ^= rngState << 5; rngState >>>= 0; return rngState / 4294967296; };
// what ALTER moves: not a locked control, a modulation target, the sequencer, LEVEL or a send ('mix'), and not a
// switch or setting the kit sound brought ('still': waveforms, modes, the LFO, velocity, sample rate) unless WILD
const alters = (e, wild = S.rand.wild) => !(S.locks.has(e.par) || e.display.type === 'target' || e.seq || e.rand === 'mix' || (e.rand === 'still' && !wild));
function randomiseVoice(voice, depth, wild) {
  const sc = kindSchema(voice, S.values[kindPar(voice)]);
  if (!homes[voice]) homes[voice] = new Map(sc.map((e) => [e.par, S.values[e.par]]));
  const home = homes[voice];
  for (const e of sc) {
    if (!alters(e, wild)) continue;
    setValue(e.par, vary(e, home.get(e.par), depth, wild), { quiet: true });
  }
}
// one control's value moved around h by depth: within its drum-safe range, or its whole range when wild
function vary(e, h, depth, wild) {
  if (e.strict) { const [lo, hi] = e.rand; return clamp(Math.round(clamp(h, lo, hi) + (rnd() * 2 - 1) * depth * (hi - lo)), lo, hi); } // pan: always inside its range
  const range = wild || e.rand === 'still' ? [0, e.max] : e.rand; // (a control with no drum range moves over its whole range)
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
  const v0 = SOUNDS[sound].engineVoice;
  for (const k in S.keyEdits[sound]) {
    if (S.keyEdits[sound][k]._lock) continue;
    const note = Number(k), now = keyPatch(sound, note).vals, ed = S.keyEdits[sound][k];
    for (const e of kindSchema(v0, now.get(kindPar(v0)))) { // (the ranges of the kind of sound the key plays)
      if (!alters(e)) continue;
      const v = vary(e, now.get(e.par), depth, S.rand.wild);
      if (v !== now.get(e.par) || ed[e.par] !== undefined) ed[e.par] = v;
    }
    levelKey(sound, note);
  }
}
// ALTER: every key of the zone nudged around what it plays now by the ALTER amount (the RANDOM menu's slider, 10% as it
// comes; WILD lets a control leave its drum-safe range), and the engine's base (what CLEAR gives a key) with them
// ALTER KEY: the same for one key
const alterDepth = () => clamp(S.rand.alter, 1, 100) / 100;
const alterVoice = (v) => { delete homes[v]; randomiseVoice(v, alterDepth(), S.rand.wild); delete homes[v]; };
function alterOne(sound, note, depth) {
  const v0 = SOUNDS[sound].engineVoice, now = keyPatch(sound, note).vals, ed = S.keyEdits[sound][note] || {};
  for (const e of kindSchema(v0, now.get(kindPar(v0)))) {
    if (!alters(e)) continue;
    const v = vary(e, now.get(e.par), depth, S.rand.wild);
    if (v !== now.get(e.par) || ed[e.par] !== undefined) ed[e.par] = v;
  }
  if (editCount(ed)) S.keyEdits[sound][note] = ed;
  levelKey(sound, note);
}
function alterKey() {
  const sound = S.sel, note = editKey[sound];
  if (keyLocked(sound, note)) { lockedMsg(); return; }
  randChange(() => { alterOne(sound, note, alterDepth()); if (S.editAll) setEditAll(false); }, `${SOUNDS[sound].name} ${noteName(note)} altered <em>${S.rand.alter}%${wildly()}</em>${keptNote([sound])} (UNDO takes it back)`)
    .then(() => { drawKeymap(); play(sound, note, 100); });
}
const alterSound = (i) => { alterVoice(SOUNDS[i].engineVoice); alterKeys(i, alterDepth()); };
async function randChange(fn, what, whole) {
  await startAudio();
  snapshot(what.replace(/<[^>]+>/g, '').replace(/\s*(\(| · )UNDO takes it back\)?/, ''), undefined, whole);
  fn();
  for (const s of lastMorph.keys()) lastMorph[s] = null;
  save(); drawFaders(); drawSide(); drawEditKey();
  detail(what);
}
const selVoice = () => SOUNDS[S.sel].engineVoice;

// ---- AUTO LEVEL: the kits' sounds are of very different loudness, so each sound a randomiser deals or alters is
// played offline and measured (sound/level.js), and its key gets a TRIM: a gain of its own, beside LEVEL, that brings
// it to its engine's target (LEVEL_TARGET_DB: the middle loudness of that engine's kit sounds). The LEVEL knob and the
// zone levels stay yours, and LEVEL's lock has no say here: AUTO LEVEL in the RANDOM menu switches it. Off, a newly
// dealt sound (fresh) plays as its kit made it and an altered one keeps the trim it had. Locked keys are left alone ----
function levelKey(sound, note, fresh) {
  const ed = S.keyEdits[sound][note];
  if (!ed || ed._lock) return;
  const t = trimPar(SOUNDS[sound].engineVoice);
  if (S.rand.autoLevel) { const m = keyPatch(sound, note); ed[t] = autoTrim(sound, S.values, m.vals, m.note); }
  else if (fresh) ed[t] = TRIM_ZERO;
}
const trimText = (x) => { const db = trimDb(x); return `${db > 0 ? '+' : ''}${db.toFixed(1)}dB`; };
// the zone's keys that aren't locked, and those of them with a correction
function autoKeys(sound) {
  const z = SOUNDS[sound].zone, t = trimPar(SOUNDS[sound].engineVoice), keys = [];
  for (let n = z.lo; n <= z.hi; n++) if (!keyLocked(sound, n)) keys.push(n);
  return { keys, on: keys.filter((n) => keyPatch(sound, n).vals.get(t) !== TRIM_ZERO) };
}
// the AUTO chip at the head of the LEVEL cell
function drawAuto(b) {
  const sound = S.sel, name = SOUNDS[sound].name, t = trimPar(SOUNDS[sound].engineVoice), target = `the ${name} level (${LEVEL_TARGET_DB[sound]} dB)`;
  if (editing()) {
    const x = valueNow(t), on = x !== TRIM_ZERO, db = trimDb(x);
    b.textContent = `AUTO ${on ? trimText(x) : '0dB'}`; b.setAttribute('aria-pressed', on);
    b.title = on ? `AUTO LEVEL turned this key ${db > 0 ? 'up' : 'down'} ${Math.abs(db).toFixed(1)} dB, to ${target}. Press to measure the key as it plays now and level it again`
      : `This key is at ${target}. Press to measure it as it plays now and level it again`;
  } else {
    const { keys, on } = autoKeys(sound);
    b.textContent = `AUTO ${on.length}/${keys.length}`; b.setAttribute('aria-pressed', on.length > 0);
    b.title = on.length ? `${on.length} of the zone's ${keys.length} keys are levelled to ${target}. Press to take the corrections off`
      : `No key of the zone is levelled. Press to bring every key to ${target}`;
  }
}
// LEVEL and LEVEL ALL (the RANDOM menu): every key of a zone measured as it plays now and brought to its engine's
// target, its sound untouched, whether AUTO LEVEL is on or not (locked keys stay)
function levelZone(sound) {
  const t = trimPar(SOUNDS[sound].engineVoice);
  for (const note of autoKeys(sound).keys) { const m = keyPatch(sound, note); (S.keyEdits[sound][note] ||= {})[t] = autoTrim(sound, S.values, m.vals, m.note); }
}
// the trim of the key on screen, to what's still ringing
const sendTrim = () => { const t = trimPar(selVoice()); send({ type: 'param', par: t, value: keyPatch(S.sel, editKey[S.sel]).vals.get(t) }); };
function autoPress() {
  const sound = S.sel, name = SOUNDS[sound].name, t = trimPar(SOUNDS[sound].engineVoice);
  // level a key (measured as it plays now), or take its correction off
  const set = (note, on) => {
    if (!on && !S.keyEdits[sound][note]) return TRIM_ZERO;
    const m = keyPatch(sound, note), ed = (S.keyEdits[sound][note] ||= {});
    return (ed[t] = on ? autoTrim(sound, S.values, m.vals, m.note) : TRIM_ZERO);
  };
  if (editing()) {
    const note = editKey[sound], key = `${name} ${noteName(note)}`;
    if (keyLocked(sound, note)) { lockedMsg(); return; }
    snapshot(`${key} AUTO LEVEL`);
    const x = set(note, true); // (a press always measures and levels the key again, never takes it off: Johnny, 2026-11-17)
    detail(x === TRIM_ZERO ? `${key} is at the ${name} level already` : `${key} levelled again: <em>${trimText(x)}</em>`);
  } else {
    const { keys, on } = autoKeys(sound);
    snapshot(`${name} ALL KEYS AUTO LEVEL`);
    for (const n of keys) set(n, !on.length);
    detail(on.length ? `${name}: no auto level on any key (locked keys stay)` : `${name}: every key levelled to <em>${LEVEL_TARGET_DB[sound]} dB</em> (locked keys stay)`);
  }
  sendTrim();
  save(); drawFaders(); drawKeymap(); drawEditKey();
}

// ---- scatter: every voice of a sound's type from all the kits (every drum 1-3 for the drum, every snare, every cymbal
// and hi-hat for the metal), the same sound only once, dealt at random one per key across the sound's zone. Each key
// then plays its kit sound as it is (no morph), kept as that key's edits, so it can still be edited or cleared. The
// level stays the sound's own; each key gets a pan in its range (unless pan is locked). Repeats only if a type has
// fewer distinct sounds than the zone has keys ----
const pools = SOUNDS.map(() => null);
function pool(sound) {
  if (pools[sound]) return pools[sound];
  const def = SOUNDS[sound], v = def.engineVoice, skip = new Set([PAR.VOL1 + v, panPar(v)]), seen = new Set(), out = [];
  for (const { name, kit, drums } of kits) for (const src of [0, 1, 2, 3, 4, 5]) { // (every kit voice: any engine plays any kit sound)
    const vals = mapVoice(kit, src, v).filter(([p]) => !skip.has(p));
    const sig = vals.map(([p, x]) => x).join(',');
    if (seen.has(sig)) continue;
    seen.add(sig);
    out.push({ label: `${drums[src] || name} ${['drum 1', 'drum 2', 'drum 3', 'snare', 'cymbal', 'hihat'][src]}`, vals }); // ("NEXUNE drum 3": the type last, as RECIPES look for it)
  }
  return (pools[sound] = out);
}
// a new sound on a key leaves its locked controls as the key plays them now (now: the key's values before), and its
// sends, which are part of the mix, not of the sound
function keepLocked(ed, now) { for (const par of S.locks) if (now.has(par) && now.get(par) !== (ed[par] ?? S.values[par])) ed[par] = now.get(par); }
// ---- BREED (NEW SOUNDS FROM in the RANDOM menu): instead of a kit sound as it is, two different kit sounds of the
// engine's type crossed section by section and nudged a little (sound/breed.js). Each child is played offline first
// (level.js) and a dud (nearly silent, or still ringing at full after 1.5 s) is thrown away for another, up to
// 8 tries; the last one stands if every try is a dud. NEW SOUND, RANDOM, RANDOM ALL and INIT PATCH all follow it ----
function bredSound(sound) {
  const p = pool(sound), v = SOUNDS[sound].engineVoice;
  let s;
  for (let i = 0; i < 8; i++) { // (BREED_TRIES: 8)
    const a = p[Math.floor(rnd() * p.length)];
    let b; do b = p[Math.floor(rnd() * p.length)]; while (p.length > 1 && b === a);
    s = { label: `${a.label} × ${b.label}`, vals: breed({ schema: VOICE_SCHEMAS[v], a: a.vals, b: b.vals, rnd }).vals };
    if (!isDud(measure(sound, S.values, s.vals), LEVEL_TARGET_DB[sound])) break;
  }
  return s;
}
// ---- NEW SOUNDS FROM (the RANDOM menu): where the dice, RANDOM, RANDOM ALL and INIT PATCH get each new sound. KIT
// deals a kit sound as it is; BREED crosses two (bredSound); MORPH, KIT-STYLE, FREE and RECIPE are sound/makers.js,
// each made from the engine's kit sounds (pool) and, like BREED, played offline first so a dud is skipped (8 tries) ----
const SOURCES = {
  kit: { name: 'KIT', dice: 'new sound', made: 'a new kit sound', cap: 'A KIT SOUND AS IT IS' },
  breed: { name: 'BREED', dice: 'breed', made: 'a new bred sound', cap: 'TWO KIT SOUNDS CROSSED, SECTION BY SECTION' },
  morph: { name: 'MORPH', dice: 'morph', made: 'a new morphed sound', cap: 'TWO KIT SOUNDS BLENDED, 25 TO 75% OF THE WAY' },
  kitstyle: { name: 'KIT-STYLE', dice: 'kit-style', made: 'a new kit-style sound', cap: 'EVERY KNOB FROM A DIFFERENT KIT SOUND' },
  free: { name: 'FREE', dice: 'free', made: 'a new free sound', cap: 'EVERY KNOB ANYWHERE IN ITS DRUM RANGE' },
  recipe: { name: 'RECIPE', dice: 'recipe', made: 'a new recipe sound', cap: 'KICK, TOM, SNARE, CLAP, RIM, HATS, CYMBAL, COWBELL, ZAP' },
};
const source = () => (SOURCES[S.rand.source] ? S.rand.source : 'kit');
// a new sound for a key of this engine by the chosen method (KIT: null, the caller deals from the pool as it always did)
function newSound(sound) {
  const src = source();
  if (src === 'kit') return null;
  if (src === 'breed') return bredSound(sound);
  const v = SOUNDS[sound].engineVoice, make = MAKERS[src];
  let s;
  for (let i = 0; i < 8; i++) {
    s = make({ schema: VOICE_SCHEMAS[v], pool: pool(sound), rnd, base: S.values });
    if (!isDud(measure(sound, S.values, s.vals), LEVEL_TARGET_DB[sound])) break;
  }
  return s;
}
// a recipe's sound (the MAKE buttons on the knob panel), through the dud filter like the rest
function typeSound(sound, name) {
  const v = SOUNDS[sound].engineVoice;
  let s;
  for (let i = 0; i < 8; i++) {
    s = recipe({ schema: VOICE_SCHEMAS[v], pool: pool(sound), rnd, name });
    if (!isDud(measure(sound, S.values, s.vals), LEVEL_TARGET_DB[sound])) break;
  }
  return s;
}
// the MAKE buttons: one press makes the key on screen that type of sound, a new one each press. A type needs a kit
// sound of its kind in the engine's pool (until every engine draws from every kit voice, a hat needs the metal)
const MAKE_TYPES = [['kick', 'KICK'], ['tom', 'TOM'], ['mid perc', 'PERC'], ['zap', 'ZAP'], ['snare', 'SNARE'], ['clap', 'CLAP'], ['rim', 'RIM'],
  ['cowbell', 'BELL'], ['closed hat', 'C HAT'], ['open hat', 'O HAT'], ['cymbal', 'CYMBAL']];
function makePanel(el) {
  el.innerHTML = '<h3>make this key</h3><div class="mk"></div>';
  const box = el.querySelector('.mk');
  for (const [name, text] of MAKE_TYPES) {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'btn sm'; b.textContent = text; b.dataset.type = name;
    b.addEventListener('click', () => { if (!learn) randKey(name); });
    box.append(b);
  }
  const any = document.createElement('button'); any.type = 'button'; any.className = 'btn sm'; any.textContent = 'ANY'; any.dataset.type = '';
  any.addEventListener('click', () => { if (!learn) { const ok = recipesFor(pool(S.sel)); if (ok.length) randKey(ok[Math.floor(rnd() * ok.length)]); } });
  box.append(any);
  faderDraws.push(() => {
    const ok = new Set(recipesFor(pool(S.sel))), locked = keyLocked(S.sel, editKey[S.sel]);
    for (const b of box.children) {
      const can = b.dataset.type ? ok.has(b.dataset.type) : ok.size > 0;
      b.disabled = locked || !can;
      b.title = !can ? `No kit sound of that kind on this engine yet` : locked ? 'This key is locked' : `Make this key ${b.dataset.type ? 'a ' + b.dataset.type : 'a sound of any type'}: a new one each press (UNDO takes it back)`;
    }
  });
}
const madeText = () => SOURCES[source()].made;
function drawSource() {
  const src = source(), d = SOURCES[src];
  for (const b of document.querySelectorAll('.srcrow .btn')) b.setAttribute('aria-pressed', b.dataset.src === src);
  for (const el of document.querySelectorAll('.dice-src')) el.textContent = d.dice;
  const cap = $('src-cap'); if (cap) cap.textContent = d.cap;
  diceBtn.title = src === 'kit' ? 'NEW SOUND (K): a different kit sound on this key only. UNDO takes it back; LEARN can put it on a button'
    : `${d.name} (K): a new sound on this key only (${d.cap.toLowerCase()}). UNDO takes it back; LEARN can put it on a button`;
  const sc = $('scatter-cap'); if (sc) sc.innerHTML = src === 'kit' ? 'NEW KIT SOUND<br>ON EVERY KEY' : `NEW ${d.name} SOUND<br>ON EVERY KEY`;
}
function setSource(src) {
  S.rand.source = src; save(); drawSource();
  detail(`NEW SOUNDS FROM <em>${SOURCES[src].name}</em>: ${SOURCES[src].cap.toLowerCase()} (the dice, RANDOM and INIT PATCH)`);
}
for (const b of document.querySelectorAll('.srcrow .btn')) b.addEventListener('click', () => setSource(b.dataset.src));
function keepSends(ed, now, v) { for (const k of [0, 1]) { const q = sendPar(v, k); if (now.get(q) !== (ed[q] ?? S.values[q])) ed[q] = now.get(q); } }
// the padlocks that are holding something back on these engines, by name, for the message line
function keptNote(sounds) {
  const names = [];
  for (const s of sounds) { const v = SOUNDS[s].engineVoice;
    for (const e of VOICE_SCHEMAS[v]) if (S.locks.has(e.par) && !e.seq) names.push(e.label.toUpperCase());
    if (S.locks.has(seqPatPar(v))) names.push('SEQ'); }
  const u = [...new Set(names)];
  return !u.length ? '' : u.join(', ').length <= 16 ? ` · locked <em>${u.join(', ')}</em> kept` : ` · <em>${u.length} locked knobs</em> kept`; // (short: the line must fit)
}
function scatter(sound, blankOnly) { // blankOnly: only keys with no sound of their own yet (ENGINES)
  const z = SOUNDS[sound].zone, p = pool(sound), order = [];
  for (let note = z.lo; note <= z.hi; note++) {
    if (!order.length) { order.push(...p.keys()); for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; } }
    if (keyLocked(sound, note) || (blankOnly && S.keyEdits[sound][note])) continue;
    const now = keyPatch(sound, note).vals, v = SOUNDS[sound].engineVoice;
    const s = newSound(sound) || p[order.pop()], ed = S.keyEdits[sound][note] = { _kit: s.label, ...Object.fromEntries(s.vals) };
    ed._r = rnd(); ed[seqPatPar(v)] = randomPattern(); ed[panPar(v)] = randPan(v);
    keepSends(ed, now, v); keepLocked(ed, now);
    levelKey(sound, note, true);
  }
  applyRhythms(sound); // and rhythms on the slider's share of the keys
}
// ---- RHYTHMS (in the RANDOM menu): the share of keys that play a running sequence. Each key draws a number (kept
// with its edits as _r); in each zone the keys with the lowest numbers, as many as the slider's share, play a rhythm.
// Moving the slider up switches more keys on (each keeping its pattern, or dealt a random one), down switches them
// off, always the same keys in the same order. RANDOM and RANDOM ALL deal every key a new number and
// pattern; NEW SOUND deals its one key a rhythm at the slider's chance. Locked keys, and a zone whose SEQ is locked,
// are left alone ----
const blankRank = (sound, note) => { const r = (Math.sin(note * 12.9898 + sound * 78.233) * 43758.5453) % 1; return r < 0 ? r + 1 : r; };
function dealRhythm(sound, ed, fresh) { // one key, at the slider's chance (NEW SOUND)
  const v = SOUNDS[sound].engineVoice, on = seqOnPar(v), pat = seqPatPar(v);
  if (!ed || ed._lock || S.locks.has(pat)) return;
  if (fresh) { ed._r = rnd(); ed[pat] = randomPattern(); }
  ed[on] = ed._r < S.rand.rhythms / 100 ? 1 : 0;
}
function applyRhythms(sound) { // a whole zone, at exactly the slider's share
  const def = SOUNDS[sound], v = def.engineVoice, on = seqOnPar(v), pat = seqPatPar(v), eds = S.keyEdits[sound];
  if (S.locks.has(pat)) return;
  const keys = [];
  for (let note = def.zone.lo; note <= def.zone.hi; note++) { const ed = eds[note]; if (!ed?._lock) keys.push({ note, ed, r: ed?._r ?? blankRank(sound, note) }); }
  keys.sort((a, b) => a.r - b.r);
  const n = Math.round(S.rand.rhythms / 100 * keys.length);
  keys.forEach(({ note, ed, r }, i) => {
    const want = i < n ? 1 : 0;
    if (!ed) { if (!want && !S.values[on]) return; ed = eds[note] = { _r: r }; } // a key with no sound of its own gets edits only to switch on
    if (ed._r === undefined) ed._r = r;
    ed[on] = want;
    if (want && ed[pat] === undefined) ed[pat] = randomPattern();
  });
}
function setRhythms(pc, press) { // press: a button's name (the phone's menu), not the slider
  const was = S.rand.rhythms;
  snapshot(press || 'RHYTHMS', press ? undefined : 'rhythms'); // one UNDO for a whole drag of the slider
  const top = undoStack[undoStack.length - 1]; if (top && top.rhythms === undefined) top.rhythms = was; // (UNDO puts the share back too)
  S.rand.rhythms = pc;
  let n = 0, all = 0;
  SOUNDS.forEach((def, sound) => {
    applyRhythms(sound);
    const on = seqOnPar(def.engineVoice);
    for (let note = def.zone.lo; note <= def.zone.hi; note++) { all++; if (keyPatch(sound, note).vals.get(on)) n++; }
  });
  save(); drawFaders(); drawKeymap(); drawEditKey(); randDraws.forEach((d) => d());
  if (!press) detail(`RHYTHMS <em>${pc}%</em>: ${n} of ${all} keys play a rhythm (locked keys stay as they are)`);
  else if (pc) detail(`rhythms on <em>${n} of ${all}</em> keys: they run while the key is held`);
  else detail(n ? `rhythms removed, but <em>${n} locked key${n === 1 ? ' keeps its' : 's keep their'}</em> rhythm · new sounds come without one`
    : `<em>all rhythms removed</em>: no key runs one, and new sounds come without one · UNDO takes it back`);
}
// NEW SOUND: one key (the last played, or picked on the key map) gets a different kit sound of its type, as RANDOM
// deals; every other key stays. Locked controls keep what the key plays now. It plays the key so you hear it
function randKey(type) { // type: a recipe's name (the MAKE buttons), else the NEW SOUNDS FROM method
  if (keyLocked(S.sel, editKey[S.sel])) { lockedMsg(); return; }
  const sound = S.sel, note = editKey[sound], p = pool(sound), cur = S.keyEdits[sound][note]?._kit;
  let s = type ? typeSound(sound, type) : newSound(sound); if (!s) do s = p[Math.floor(rnd() * p.length)]; while (p.length > 1 && s.label === cur);
  const now = keyPatch(sound, note).vals;
  rollDice();
  randChange(() => {
    const ed = { _kit: s.label, ...Object.fromEntries(s.vals) };
    for (const [p, x] of now) if (p >= NUM_PARAMS) ed[p] = x; // the key keeps its sends
    dealRhythm(sound, ed, true); // and a rhythm, or none, as the RHYTHMS slider deals them
    ed[panPar(SOUNDS[sound].engineVoice)] = randPan(SOUNDS[sound].engineVoice); // and a pan in its range (a lock keeps the old one)
    keepLocked(ed, now);
    S.keyEdits[sound][note] = ed;
    levelKey(sound, note, true);
    if (S.editAll) setEditAll(false);
  }, `${SOUNDS[sound].name} ${noteName(note)}: <em>${s.label}</em>${keptNote([sound])} (UNDO takes it back)`).then(() => { drawKeymap(); play(sound, note, 100); });
}
diceBtn.addEventListener('click', () => { if (!learn) randKey(); });
diceBtn.dataset.learn = JSON.stringify({ t: 'randkey' });
const levelled = () => (S.rand.autoLevel ? ' · levelled' : '');
$('scatter').addEventListener('click', () => randChange(() => scatter(S.sel), `${SOUNDS[S.sel].name}: ${madeText()} on every key (from ${pool(S.sel).length})${levelled()}${keptNote([S.sel])}`));
$('kit-scatter').addEventListener('click', () => randChange(() => onSounds().forEach((i) => scatter(i)), `all engines: ${madeText()} on every key${levelled()}${keptNote(onSounds())}`));
const wildly = () => (S.rand.wild ? ' wild' : '');
$('alter').addEventListener('click', () => randChange(() => alterSound(S.sel), `${SOUNDS[S.sel].name}: every key altered <em>${S.rand.alter}%${wildly()}</em>${levelled()}${keptNote([S.sel])}`));
$('kit-alter').addEventListener('click', () => randChange(() => onSounds().forEach((i) => alterSound(i)), `all engines: every key altered <em>${S.rand.alter}%${wildly()}</em>${levelled()}${keptNote(onSounds())}`));
$('level').addEventListener('click', () => randChange(() => levelZone(S.sel), `${SOUNDS[S.sel].name}: every key levelled to <em>${LEVEL_TARGET_DB[S.sel]} dB</em> (locked keys stay)`).then(sendTrim));
$('kit-level').addEventListener('click', () => randChange(() => onSounds().forEach((i) => levelZone(i)), 'all zones: <em>every key levelled</em> to its engine\'s level (locked keys stay)').then(sendTrim));
// ---- INIT PATCH (the RANDOM menu): a new patch in one press. Every key of all zones gets a fresh kit sound as
// RANDOM ALL deals them (levelled, panned and given rhythms the same way), locked keys and hand edits included. Then
// the effects: INIT_REVERB % of the keys get a reverb send and INIT_ECHO % an echo send (which keys is random, and a
// key can have both), the rest none. BPM, the effects and the master go back to their starting settings. A control
// with a closed padlock keeps what each key has, the sends too. With locked keys it asks first (a second press within
// a few seconds); UNDO takes it back, locks and all ----
const INIT_REVERB = 30, INIT_ECHO = 20, INIT_SEND = { echo: [40, 85], reverb: [45, 95] };
function initPatch() {
  const keys = [];
  SOUNDS.forEach((def, sound) => { // (the key locks come off: every key gets a new sound; the hand edits go with the old sounds)
    for (const n in S.keyEdits[sound]) delete S.keyEdits[sound][n]._lock;
    scatter(sound); for (let n = def.zone.lo; n <= def.zone.hi; n++) keys.push([sound, n]); });
  // exactly the share of the keys, whichever they are
  const some = (pc) => { const a = keys.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return new Set(a.slice(0, Math.round(pc / 100 * a.length))); };
  const amount = ([lo, hi]) => lo + Math.floor(rnd() * (hi - lo + 1)), rev = some(INIT_REVERB), ech = some(INIT_ECHO);
  for (const k of keys) {
    const [sound, n] = k, v = SOUNDS[sound].engineVoice, ed = S.keyEdits[sound][n];
    if (!S.locks.has(sendPar(v, 0))) ed[sendPar(v, 0)] = ech.has(k) ? amount(INIT_SEND.echo) : 0; // (a locked send keeps what the key had)
    if (!S.locks.has(sendPar(v, 1))) ed[sendPar(v, 1)] = rev.has(k) ? amount(INIT_SEND.reverb) : 0;
  }
  const sent = (i) => keys.filter(([sound, n]) => keyPatch(sound, n).vals.get(sendPar(SOUNDS[sound].engineVoice, i)) > 0).length;
  return { keys: keys.length, reverb: sent(1), echo: sent(0) };
}
// a new patch starts from the effects as they come: BPM, the echo, the reverb, the distortion, the compressor and the
// output level back to their starting settings (RETURN is how the keys play, not part of the sound: it stays)
function resetFx() { const d = structuredClone(FX_DEFAULTS); applyFx({ ...d, tempo: { bpm: d.tempo.bpm } }); }
let initArmed = 0;
const lockedKeys = () => S.keyEdits.reduce((a, ks) => a + Object.values(ks).filter((e) => e._lock).length, 0);
function drawInit() {
  const nl = lockedKeys();
  $('init-patch').setAttribute('aria-pressed', !!initArmed);
  $('init-info').innerHTML = initArmed ? `REPLACES ${nl} LOCKED KEY${nl === 1 ? '' : 'S'}<br>PRESS AGAIN TO GO` : `FRESH KIT SOUNDS ON EVERY KEY<br>${INIT_REVERB}% REVERB · ${INIT_ECHO}% ECHO<br>BPM, FX + MASTER RESET`;
}
function disarmInit() { clearTimeout(initArmed); initArmed = 0; drawInit(); }
$('init-patch').addEventListener('click', () => {
  const nl = lockedKeys();
  if (nl && !initArmed) { // locked keys are the ones you kept on purpose: asked once
    initArmed = setTimeout(disarmInit, 4000); drawInit();
    detail(`INIT PATCH replaces every key, the <em>${nl} locked</em> too: press it again to go ahead`); return;
  }
  disarmInit();
  let n;
  randChange(() => { n = initPatch(); resetFx(); S.preset = { id: null, name: newName() }; if (S.editAll) setEditAll(false); }, 'INIT PATCH', true).then(() => {
    drawKeymap(); sendTrim(); drawPreset();
    detail(`new patch <em>${S.preset.name}</em>: reverb on ${n.reverb}, echo on ${n.echo} · BPM, FX, master reset${keptNote(onSounds())}`);
  });
});
drawInit();
// ---- MORPH KEYS (the RANDOM menu, under INIT PATCH): sounds on a few keys of the keyboard (the stops: the lowest
// and highest key, or more spread evenly between them) and every key between two stops a step of the way from one to
// the other (sound/makers.js blend), across every engine's zone. MORPH KEYS keeps the two end keys as they are (so you
// can set them first) and only deals a kit sound to an end with no sound of its own. NEW ENDS makes a kick on the
// lowest key and something else (MORPH_TOPS) on the highest; KICK > HAT makes a kick, a snare, a perc and a closed
// hat on four evenly spread keys (Johnny, 2026-11-18). Each made sound is a RECIPE sound (sound/makers.js), dud
// filtered. Locked keys stay, and so do knobs with a closed padlock; each key keeps its sends, its pan stays in its
// engine's range, and AUTO LEVEL levels it as RANDOM does. UNDO takes it back ----
const MORPH_TOPS = ['snare', 'clap', 'rim', 'mid perc', 'cowbell', 'closed hat', 'open hat', 'cymbal'];
const MORPH_RUN = ['kick', 'snare', 'mid perc', 'closed hat'];
function dealStop(sound, note, type, not) {
  const p = pool(sound), now = keyPatch(sound, note).vals, v = SOUNDS[sound].engineVoice;
  let s;
  if (type) s = typeSound(sound, type);
  else do s = p[Math.floor(rnd() * p.length)]; while (p.length > 1 && s.label === not);
  const ed = { _kit: s.label, ...Object.fromEntries(s.vals) };
  ed[panPar(v)] = randPan(v); keepSends(ed, now, v); keepLocked(ed, now);
  S.keyEdits[sound][note] = ed; levelKey(sound, note, true);
}
function morphKeys(types) { // types: a recipe per stop (spread evenly), or none: keep the two ends
  const keys = [];
  for (const sound of onSounds()) { const z = SOUNDS[sound].zone; for (let n = z.lo; n <= z.hi; n++) keys.push([sound, n]); }
  keys.sort((x, y) => x[1] - y[1]);
  const N = keys.length - 1, label = ([s, n]) => S.keyEdits[s][n]?._kit;
  const at = types ? types.map((_, j) => Math.round(j * N / (types.length - 1))) : [0, N];
  if (types) at.forEach((i, j) => { if (!keyLocked(...keys[i])) dealStop(...keys[i], types[j]); }); // (a locked stop keeps its sound)
  else for (const [i, o] of [[0, N], [N, 0]]) if (!keyLocked(...keys[i]) && !S.keyEdits[keys[i][0]][keys[i][1]]) dealStop(...keys[i], null, label(keys[o]));
  // each stop as a whole kit (every parameter, by number), so mapVoice can put it on any engine's voice
  const stop = ([s, n]) => { const m = keyPatch(s, n), kit = Uint8Array.from(S.values); for (const [p, x] of m.vals) kit[p] = x;
    return { kit, v: SOUNDS[s].engineVoice, st: m.semitones || 0, name: label([s, n]) || 'base', on: [] }; };
  const E = at.map((i) => stop(keys[i])), stops = new Set(at);
  const inVoice = (e, v) => (e.on[v] ||= new Map(mapVoice(e.kit, e.v, v)));
  let done = 0;
  keys.forEach(([sound, note], i) => {
    if (stops.has(i) || keyLocked(sound, note)) return;
    const j = at.findIndex((x, k) => x < i && at[k + 1] > i), A = E[j], B = E[j + 1], t = (i - at[j]) / (at[j + 1] - at[j]);
    const v = SOUNDS[sound].engineVoice, now = keyPatch(sound, note).vals;
    const vals = blend({ schema: VOICE_SCHEMAS[v], a: inVoice(A, v), b: inVoice(B, v), t, base: S.values });
    const ed = { _kit: `${A.name} ~ ${B.name} ${Math.round(t * 100)}%`, _st: Math.round(A.st + t * (B.st - A.st)), ...Object.fromEntries(vals) };
    const [plo, phi] = PAN_RANGE[v], pp = panPar(v); if (ed[pp] !== undefined) ed[pp] = clamp(ed[pp], plo, phi);
    keepSends(ed, now, v); keepLocked(ed, now);
    S.keyEdits[sound][note] = ed; levelKey(sound, note, true); done++;
  });
  return { done, stops: at.map((i, j) => `<em>${E[j].name}</em> (${noteName(keys[i][1])})`) };
}
const morphPress = (what, types) => () => {
  let r;
  randChange(() => { r = morphKeys(types && types()); if (S.editAll) setEditAll(false); }, what).then(() => {
    drawKeymap(); sendTrim();
    detail(`${r.stops.join(' to ')}: ${r.done} keys between morphed${levelled()}${keptNote(onSounds())}`);
  });
};
$('morph-keys').addEventListener('click', morphPress('MORPH KEYS'));
$('morph-ends').addEventListener('click', morphPress('NEW ENDS + MORPH KEYS', () => ['kick', MORPH_TOPS[Math.floor(rnd() * MORPH_TOPS.length)]]));
$('morph-run').addEventListener('click', morphPress('KICK > HAT', () => MORPH_RUN));
function undo() {
  const u = undoStack.pop();
  if (!u) { detail('nothing to undo'); return; }
  for (let p = 0; p < ALL_PARAMS; p++) setValue(p, u.values[p], { quiet: true });
  if (!u.fx) S.keyEdits.forEach((ks, i) => { for (const k in ks) if (ks[k]._lock) u.keys[i][k] = ks[k]; }); // a key locked now stays as it is
  S.keyEdits = u.keys;
  if (u.engines !== undefined) showEngines(u.engines);
  if (u.rhythms !== undefined) { S.rand.rhythms = u.rhythms; randDraws.forEach((d) => d()); } // the RHYTHMS share, where it was
  if (u.fx) { applyFx(u.fx); S.preset = u.preset; drawPreset(); } // a whole patch back: its effects and its name too
  for (const s of lastMorph.keys()) lastMorph[s] = null;
  for (const k in homes) delete homes[k];
  save(); drawUndo(); drawKeymap(); drawEditKey(); drawFaders(); drawSide();
  // the key on screen, as it is again, sent to what's still ringing
  for (const [par, x] of keyPatch(S.sel, editKey[S.sel]).vals) send({ type: 'param', par, value: x });
  detail(`undone: <em>${u.what}</em>${undoStack.length ? ` · ${undoStack.length} more` : ''}`);
}
$('undo').addEventListener('click', undo);
// the knob padlocks, all engines': how many are closed (the sequencer's two parts count as one), and UNLOCK ALL
const lockCount = () => VOICE_SCHEMAS.flat().filter((e) => S.locks.has(e.par) && !/^SEQ_ON/.test(e.key)).length;
function drawLocks() {
  const n = lockCount();
  $('lock-count').textContent = n ? `${n} LOCKED` : 'NONE LOCKED'; $('lock-none').disabled = !n;
}
$('lock-none').addEventListener('click', () => {
  const n = lockCount(); S.locks.clear(); save(); drawFaders(); drawLocks();
  detail(`<em>${n}</em> knob${n === 1 ? '' : 's'} unlocked: everything is open to the dice, RANDOM and ALTER again`);
});

// ---------------------------------------------------------------------------------------------------------------
// the computer's keys: [ and ] (or the left and right arrows) step to the key before or after and play it, Space plays
// the key again, K a new sound, A alter, L lock, Z undo, 1-3 pick an engine, Cmd/Ctrl+C and V copy and paste
// ---------------------------------------------------------------------------------------------------------------
function stepKey(by) {
  const i = stripKeys.findIndex((k) => k.sound === S.sel && k.note === editKey[S.sel]);
  const to = stripKeys[(Math.max(0, i) + by + stripKeys.length) % stripKeys.length];
  startAudio().then(() => play(to.sound, to.note, 100));
}
document.addEventListener('keydown', (e) => {
  // Cmd+C / Cmd+V (Ctrl on a PC): copy and paste a key's sound, unless a text field or a selection has them
  if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && (e.key === 'c' || e.key === 'v')) {
    if (e.target.closest('input, select, textarea, [contenteditable]') || String(getSelection())) return;
    e.preventDefault(); if (e.key === 'c') copyKey(); else pasteKey(); return;
  }
  if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key === 'z') { if (e.target.closest('input, textarea, [contenteditable]')) return; e.preventDefault(); undo(); return; }
  if (e.target.closest('select, input[type="text"]') || e.metaKey || e.ctrlKey || e.altKey) return; // (typing a name)
  if (e.key >= '1' && e.key <= String(S.engines)) select(Number(e.key) - 1);
  else if (e.key === 'z' || e.key === 'Z') undo();
  else if (e.key === '[' || e.key === ']') stepKey(e.key === ']' ? 1 : -1);
  else if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !e.target.closest('input, [role="slider"]')) { e.preventDefault(); stepKey(e.key === 'ArrowRight' ? 1 : -1); }
  else if (e.key === ' ' && !e.target.closest('input, textarea') && (!e.target.closest('button') || e.target.closest('.k'))) {
    e.preventDefault(); startAudio().then(() => play(S.sel, editKey[S.sel], 100)); // (on any other button, Space presses it)
  }
  else if (e.key === 'k' || e.key === 'K') randKey();
  else if (e.key === 'a' || e.key === 'A') alterKey();
  else if (e.key === 'l' || e.key === 'L') lockKey(S.sel, editKey[S.sel]);
  else if (e.key === 'f' || e.key === 'F') $('fx-tab').click();
});

// ---------------------------------------------------------------------------------------------------------------
// start
// ---------------------------------------------------------------------------------------------------------------
$('start-btn').addEventListener('click', async () => {
  $('start').hidden = true;
  await startAudio();
  // on a phone the pads are the keys: it isn't asked for MIDI there (a keyboard still plays if MIDI was allowed before)
  if (!phoneOn) startMidi();
  else if (navigator.permissions) navigator.permissions.query({ name: 'midi' }).then((s) => { if (s.state === 'granted') startMidi(); }).catch(() => {});
});
// ---------------------------------------------------------------------------------------------------------------
// PRESETS: the whole patch (every key's sound, edits, lock, sequence and sends, the engines' base, the effects, the
// master and the BPM) kept under a name in this browser (localStorage). A new patch gets a made-up name (names.js);
// NEW NAME rolls another, or type one. SAVE keeps the patch under its name (again: over the saved one), SAVE AS NEW
// keeps a copy under a new name, REVERT goes back to the saved version. A press on a saved preset loads it (UNDO goes
// back to what was there, effects and all); its X, pressed twice, deletes it. EXPORT writes every saved preset to a
// file and IMPORT reads one back, so nothing depends on this browser's storage alone.
// The keys are kept by their place in the layout (0..24), so a preset loads wherever LOW KEY has put the keys. The
// control locks, the knob map, LOW KEY and the RANDOM menu's settings are the instrument's, not a patch's
// ---------------------------------------------------------------------------------------------------------------
const PRESET_STORE = 'lxr-afx-presets-v1';
const FX_MAX = { echo: { time: 127, feedback: 127, tone: 127, pingpong: 1, level: 127, sync: 1, div: ECHO_DIVS.length - 1 },
  reverb: { size: 127, decay: 127, tone: 127, early: 127, level: 127 }, tempo: { bpm: 240, ret: 4 },
  dirt: { on: 1, pregain: 48, cutoff: 127, swap: 1, xover: 1, gain: 127, clip: 1, bass: 24, tone: 127, dirty: 127, clean: 127, sc: 1, src: 3, scfilt: 2, freq: 127, sens: 127, decay: 127, dir: 1, target: 2 },
  master: { thresh: 40, ratio: 200, attack: 100, release: 1000, knee: 24, makeup: 24, level: 100 } };
const cleanName = (s) => String(s ?? '').toUpperCase().replace(/[^A-Z0-9 .+#-]/g, '').replace(/\s+/g, ' ').trim().slice(0, 18);
const cleanLabel = (s) => String(s ?? '').replace(/[<>&\u0000-\u001f]/g, '').slice(0, 48); // (labels are shown as HTML)
const intIn = (x, lo, hi) => clamp(Math.round(Number(x)) || 0, lo, hi);
// a preset from storage or a file, checked and tidied: only what a patch can hold gets in (null: not a preset)
function tidyPreset(p) {
  const d = p && p.data;
  if (!d || !Array.isArray(d.values) || d.values.length < NUM_PARAMS || !Array.isArray(d.keys)) return null;
  const values = [...INIT_VALUES]; d.values.slice(0, ALL_PARAMS).forEach((x, i) => { values[i] = intIn(x, 0, 255); });
  const old = d.pos !== POS_RULE; // (saved while the waves, filter types and FM/MIX were menus: their menu numbers become knob positions)
  if (old) valuesToPositions(values);
  const engines = intIn(d.engines || DEFAULT_ENGINES, 1, MAX_ENGINES), sizes = zoneSizes(engines); // (older presets: 3)
  const keys = SOUNDS.map((def, i) => {
    const lo = sizes.slice(0, i).reduce((a, b) => a + b, 0), hi = i < engines ? lo + sizes[i] - 1 : -1;
    const out = {}, src = d.keys[i] && typeof d.keys[i] === 'object' ? d.keys[i] : {};
    for (const k in src) {
      const rel = Number(k), e = src[k], o = {};
      if (!Number.isInteger(rel) || rel < lo || rel > hi || !e || typeof e !== 'object') continue;
      for (const f in e) {
        if (f === '_kit') o._kit = cleanLabel(e._kit);
        else if (f === '_lock') { if (e._lock) o._lock = true; }
        else if (f === '_st' || f === '_r') o[f] = Number(e[f]) || 0;
        else if (f === '_o' && e._o && typeof e._o === 'object') { const h = {}; for (const q in e._o) if (/^\d+$/.test(q) && Number(q) < ALL_PARAMS) h[q] = intIn(e._o[q], 0, 255); if (Object.keys(h).length) o._o = h; }
        else if (/^\d+$/.test(f) && Number(f) < ALL_PARAMS) o[f] = intIn(e[f], 0, 255);
      }
      out[rel] = o;
    }
    return old ? editsToPositions(out) : out;
  });
  const fx = {};
  for (const k in FX_MAX) { fx[k] = {}; for (const f in FX_MAX[k]) if (d.fx && d.fx[k] && Number.isFinite(Number(d.fx[k][f]))) fx[k][f] = intIn(d.fx[k][f], k === 'tempo' && f === 'bpm' ? 40 : 0, FX_MAX[k][f]); }
  return { id: /^[a-z0-9]{6,24}$/.test(p.id) ? p.id : newId(), name: cleanName(p.name) || 'UNNAMED', t: Number(p.t) || 0, data: { values, keys, fx, pos: POS_RULE, engines } };
}
const newId = () => Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36).padStart(4, '0');
let presets = [];
try { const a = JSON.parse(localStorage.getItem(PRESET_STORE)); if (Array.isArray(a)) presets = a.map(tidyPreset).filter(Boolean); } catch (e) { /* none kept, or storage blocked */ }
// the list kept in the browser; false if it couldn't be (storage full or blocked)
function storePresets() { try { localStorage.setItem(PRESET_STORE, JSON.stringify(presets)); return true; } catch (e) { return false; } }
const storeOr = (said) => { if (!storePresets()) said += ' · <em>the browser would not keep it</em> (storage full or blocked): EXPORT writes a file'; detail(said); };
// the patch as a preset keeps it: the keys by their place in the layout
const shiftKeys = (ks, by) => ks.map((k) => Object.fromEntries(Object.entries(k || {}).map(([n, e]) => [Number(n) + by, structuredClone(e)])));
const patchData = () => ({ values: [...S.values], keys: shiftKeys(S.keyEdits, -S.zoneStart), fx: structuredClone(S.fx), pos: POS_RULE, engines: S.engines });
// the same patch, whatever order its parts were written in
const canon = (x) => (Array.isArray(x) ? '[' + x.map(canon).join() + ']' : x && typeof x === 'object' ? '{' + Object.keys(x).sort().map((k) => k + ':' + canon(x[k])).join() + '}' : JSON.stringify(x));
const presetSaved = () => presets.find((p) => p.id === S.preset.id);
const presetDirty = () => { const p = presetSaved(); return !p || canon(p.data) !== canon(patchData()); };
const newName = () => presetName(Math.random, new Set([...presets.map((p) => p.name), S.preset.name]));
// the effects as given (a preset's, or an UNDO's), shown and sent
function applyFx(fx) {
  for (const k in S.fx) if (fx[k]) Object.assign(S.fx[k], fx[k]);
  $('bpm').textContent = S.fx.tempo.bpm; drawRet(); sendFx(); drawFaders();
}
function applyPatch(d) {
  d.values.forEach((x, p) => { if (p < ALL_PARAMS) setValue(p, x, { quiet: true }); });
  S.keyEdits = shiftKeys(d.keys, S.zoneStart);
  while (S.keyEdits.length < SOUNDS.length) S.keyEdits.push({});
  showEngines(clamp(d.engines || DEFAULT_ENGINES, 1, MAX_ENGINES)); // a patch keeps its ENGINES (older ones had 3)
  for (const k in homes) delete homes[k];
  applyFx(d.fx);
}
// the key on screen as it is now, to what's still ringing
const sendKey = () => { for (const [par, x] of keyPatch(S.sel, editKey[S.sel]).vals) send({ type: 'param', par, value: x }); };
function loadPreset(id, what) {
  const p = presets.find((x) => x.id === id);
  if (!p) return;
  randChange(() => { applyPatch(p.data); S.preset = { id: p.id, name: p.name }; if (S.editAll) setEditAll(false); }, `${what || 'loaded'} <em>${p.name}</em> (UNDO takes it back)`, true)
    .then(() => { drawKeymap(); drawPreset(); sendKey(); });
}
function savePreset(asNew) {
  let p = asNew ? null : presetSaved();
  if (asNew) S.preset = { id: null, name: newName() };
  if (p) { p.data = patchData(); p.name = S.preset.name; p.t = Date.now(); }
  else { p = { id: newId(), name: S.preset.name, t: Date.now(), data: patchData() }; presets.push(p); S.preset.id = p.id; }
  save(); drawPreset();
  storeOr(`saved <em>${p.name}</em>${asNew ? ' as a new preset' : ''} · ${presets.length} preset${presets.length === 1 ? '' : 's'} kept in this browser`);
}
function renamePreset(name) {
  name = cleanName(name);
  if (!name || name === S.preset.name) { drawPreset(); return; }
  S.preset.name = name;
  const p = presetSaved();
  if (p) p.name = name;
  save(); drawPreset();
  if (p) storeOr(`preset renamed <em>${name}</em>`); else detail(`this patch is <em>${name}</em>: SAVE keeps it`);
}
let delArmed = null, delT = 0;
function deletePreset(id) {
  const p = presets.find((x) => x.id === id);
  if (!p) return;
  clearTimeout(delT);
  if (delArmed !== id) { delArmed = id; delT = setTimeout(() => { delArmed = null; drawPreset(); }, 4000); drawPreset(); detail(`delete <em>${p.name}</em>? Press its X again (it can't be undone)`); return; }
  delArmed = null;
  presets = presets.filter((x) => x.id !== id);
  if (S.preset.id === id) S.preset.id = null; // the patch on screen stays, not saved any more
  save(); drawPreset(); storeOr(`deleted <em>${p.name}</em>`);
}
function exportPresets() {
  if (!presets.length) { detail('nothing saved yet: SAVE keeps this patch, then EXPORT writes the list to a file'); return; }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify({ app: 'lxr-afx', kind: 'presets', version: 1, presets }, null, 1)], { type: 'application/json' }));
  a.download = `lxr-afx-presets-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  detail(`exported <em>${presets.length}</em> preset${presets.length === 1 ? '' : 's'} to ${a.download}`);
}
// presets from a file's text, added to the list: one already here (the same patch under the same id) is skipped, one
// with the same id but another patch comes in beside it
function importPresets(text) {
  let list;
  try { const j = JSON.parse(text); list = Array.isArray(j) ? j : j && j.presets; } catch (e) { list = null; }
  if (!Array.isArray(list)) { detail('that file has no LXR-AFX presets in it'); return 0; }
  let added = 0, had = 0;
  for (const raw of list) {
    const p = tidyPreset(raw);
    if (!p) continue;
    const old = presets.find((x) => x.id === p.id);
    if (old && canon(old.data) === canon(p.data)) { had++; continue; }
    if (old) p.id = newId();
    if (!p.t) p.t = Date.now();
    presets.push(p); added++;
  }
  drawPreset();
  storeOr(added ? `imported <em>${added}</em> preset${added === 1 ? '' : 's'}${had ? ` (${had} already here)` : ''}` : had ? `nothing new: all ${had} are already here` : 'that file has no LXR-AFX presets in it');
  return added;
}
function drawPreset() {
  const p = presetSaved(), dirty = presetDirty();
  $('preset-name').textContent = S.preset.name; $('preset-mark').textContent = dirty ? '*' : '';
  $('preset-btn').title = `${S.preset.name}: ${!p ? 'not saved yet' : dirty ? 'changed since it was saved' : 'saved'}. Save, load, rename and delete presets, and write them to a file`;
  if ($('preset-panel').hidden) return;
  $('preset-state').textContent = !p ? 'NOT SAVED YET' : dirty ? 'CHANGED SINCE SAVED' : 'SAVED';
  if (document.activeElement !== $('preset-input')) $('preset-input').value = S.preset.name;
  $('preset-save').disabled = !!p && !dirty; $('preset-save-new').disabled = !p; $('preset-revert').disabled = !p || !dirty;
  $('preset-count').textContent = presets.length ? String(presets.length) : '';
  const list = $('preset-list'); list.innerHTML = '';
  if (!presets.length) { list.innerHTML = '<p class="dim">NOTHING SAVED YET<br>SAVE KEEPS THIS PATCH IN THIS BROWSER</p>'; return; }
  for (const x of [...presets].sort((a, b) => b.t - a.t)) {
    const row = document.createElement('div'); row.className = 'prow'; if (x.id === S.preset.id) row.setAttribute('aria-current', 'true');
    const b = document.createElement('button'); b.type = 'button'; b.className = 'pload'; b.textContent = x.name; b.title = `Load ${x.name} (UNDO goes back to this patch)`;
    b.addEventListener('click', () => loadPreset(x.id));
    const del = document.createElement('button'); del.type = 'button'; del.className = 'pdel'; del.textContent = delArmed === x.id ? 'SURE?' : 'X';
    del.title = `Delete ${x.name}: press twice`; del.setAttribute('aria-label', `Delete ${x.name}`); del.setAttribute('aria-pressed', delArmed === x.id);
    del.addEventListener('click', () => deletePreset(x.id));
    row.append(b, del); list.append(row);
  }
}
function openPresets(open) {
  $('preset-panel').hidden = !open; $('preset-btn').setAttribute('aria-expanded', open);
  if (open) { openMenu(false); openSettings(false); drawPreset(); } else if (delArmed) { clearTimeout(delT); delArmed = null; }
}
$('preset-btn').addEventListener('click', () => openPresets($('preset-panel').hidden));
$('preset-input').addEventListener('change', () => renamePreset($('preset-input').value));
$('preset-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('preset-input').blur(); });
$('preset-roll').addEventListener('click', () => renamePreset(newName()));
$('preset-save').addEventListener('click', () => savePreset(false));
$('preset-save-new').addEventListener('click', () => savePreset(true));
$('preset-revert').addEventListener('click', () => loadPreset(S.preset.id, 'back to the saved'));
$('preset-export').addEventListener('click', exportPresets);
$('preset-import').addEventListener('click', () => $('preset-file').click());
$('preset-file').addEventListener('change', async () => { const f = $('preset-file').files[0]; if (f) importPresets(await f.text()); $('preset-file').value = ''; });
S.preset = { id: typeof S.preset.id === 'string' ? S.preset.id : null, name: cleanName(S.preset.name) || newName() }; // (as the browser kept it, tidied)
if (S.preset.id && !presetSaved()) S.preset.id = null; // (its preset was deleted somewhere else)
drawPreset();
window.afx.presets = { list: () => presets, now: () => S.preset, dirty: presetDirty, import: importPresets, name: newName };

// with no morph, keys with nothing of their own all play the base: a zone with no key sounds starts scattered
onSounds().forEach((i) => { if (!Object.keys(S.keyEdits[i]).length) scatter(i); });
buildStrip();
select(clamp(S.sel, 0, S.engines - 1));
// the layout: three zones up from the lowest key, moved by octaves with LOW KEY (the keys' edits move with them)
function drawZones() {
  const zoneText = (s) => `${s.name} ${noteName(s.zone.lo)}-${noteName(s.zone.hi)}`;
  $('zones').textContent = 'MIDI CH 1 · C3 = #60'; $('zones').title = onSounds().map((i) => zoneText(SOUNDS[i], i)).join(' · ');
  soundBtns.forEach((b, i) => { b.hidden = !engineOn(i); b.title = `${SOUNDS[i].name}: keys ${noteName(SOUNDS[i].zone.lo)} to ${noteName(SOUNDS[i].zone.hi)} on MIDI channel 1 (key ${i + 1})`; });
  $('engines').textContent = S.engines; $('eng-down').disabled = S.engines <= 1; $('eng-up').disabled = S.engines >= MAX_ENGINES;
  $('low-key').textContent = `${noteName(S.zoneStart)} #${S.zoneStart}`;
  soundBtns.forEach((b, i) => { b.querySelector('.ch').textContent = `${noteName(SOUNDS[i].zone.lo)}-${noteName(SOUNDS[i].zone.hi)}`; });
  $('low-down').disabled = S.zoneStart - 12 < 0; $('low-up').disabled = S.zoneStart + 12 + 24 > 127;
}
// the tempo (for the sequencers and the synced echo): - and + by 1 (Shift: 10), double-click for 120
function setBpm(v) { S.fx.tempo.bpm = clamp(Math.round(v), 40, 240); $('bpm').textContent = S.fx.tempo.bpm; sendFx(); }
$('bpm-down').addEventListener('click', (e) => setBpm(S.fx.tempo.bpm - (e.shiftKey ? 10 : 1)));
$('bpm-up').addEventListener('click', (e) => setBpm(S.fx.tempo.bpm + (e.shiftKey ? 10 : 1)));
$('bpm').addEventListener('dblclick', () => setBpm(120));
$('bpm').textContent = S.fx.tempo.bpm;
// RETURN: when a zone goes back to an earlier held key, it plays it again now or on the next step of the grid
const RETURNS = ['NOW', '1/32', '1/16', '1/8', '1/4'];
const drawRet = () => { $('ret').textContent = RETURNS[S.fx.tempo.ret] ?? '1/16'; };
$('ret').addEventListener('click', (e) => { S.fx.tempo.ret = (S.fx.tempo.ret + (e.shiftKey ? RETURNS.length - 1 : 1)) % RETURNS.length; drawRet(); sendFx();
  detail(`RETURN <em>${RETURNS[S.fx.tempo.ret]}</em>: let go of the newest key in a zone and the earlier held key comes back ${S.fx.tempo.ret ? 'on the next ' + RETURNS[S.fx.tempo.ret] : 'at once'}`); });
drawRet();
function moveZones(by) {
  const to = S.zoneStart + by;
  if (to < 0 || to + 24 > 127) return;
  S.zoneStart = to; setZoneStart(to);
  const moved = (ks) => ks.map((k) => Object.fromEntries(Object.entries(k).map(([n, e]) => [Number(n) + by, e])));
  S.keyEdits = moved(S.keyEdits); undoStack.forEach((u) => { u.keys = moved(u.keys); });
  SOUNDS.forEach((s, i) => { editKey[i] += by; lastMorph[i] = null; });
  save(); buildStrip(); drawZones(); drawSide(); drawFaders(); drawEditKey();
  detail(`lowest key <em>${noteName(to)} #${to}</em>`);
}
// ENGINES: how many mono engines share the 25 keys, 1 to 6, each on an even zone side by side (Johnny, 2026-11-17).
// Every key that changes engine starts with a new kit sound of its engine; keys that stay keep theirs (UNDO takes it back)
// switch to n engines as they are (a patch or UNDO brings its own keys)
function showEngines(n) {
  if (n === S.engines) return;
  allOff(); S.engines = n; setEngines(n); send({ type: 'engines', n });
  if (S.sel >= n) S.sel = n - 1;
  for (const i of onSounds()) { const z = SOUNDS[i].zone; editKey[i] = clamp(editKey[i], z.lo, z.hi); lastMorph[i] = null; }
  buildStrip(); buildPads(); drawZones(); select(S.sel); fitScreen();
}
function setEngineCount(n) {
  n = clamp(n, 1, MAX_ENGINES); if (n === S.engines) return;
  snapshot(`ENGINES ${S.engines} → ${n}`);
  showEngines(n);
  // a key that left an engine's zone leaves its sound behind (UNDO brings it back), and a key new to one gets a kit sound
  S.keyEdits.forEach((ks, i) => { const z = SOUNDS[i].zone; for (const k in ks) if (!(k >= z.lo && k <= z.hi)) delete ks[k]; });
  for (const i of onSounds()) scatter(i, true);
  save(); drawKeymap(); drawFaders(); drawSide(); drawEditKey();
  detail(`ENGINES <em>${n}</em>: ${onSounds().map((i) => `${SOUNDS[i].name} ${noteName(SOUNDS[i].zone.lo)}-${noteName(SOUNDS[i].zone.hi)}`).join(' · ')}`);
}
$('eng-down').addEventListener('click', () => setEngineCount(S.engines - 1));
$('eng-up').addEventListener('click', () => setEngineCount(S.engines + 1));
$('low-down').addEventListener('click', () => moveZones(-12));
$('low-up').addEventListener('click', () => moveZones(12));
drawZones();
$('start-text').textContent = `MIDI channel 1: ${onSounds().map((i) => SOUNDS[i]).map((s) => `${s.name.toLowerCase()} on ${noteName(s.zone.lo)}-${noteName(s.zone.hi)}`).join(', ')}, ${S.engines === 1 ? 'one engine' : 'all at once'}. `
  + 'Every key has its own sound: play one and the screen shows it, ready to edit.';
if (new URLSearchParams(location.search).has('nostart')) $('start').hidden = true; // screenshots

// ---------------------------------------------------------------------------------------------------------------
// PHONE: on a phone held upright (or with ?phone in the address) the page is a simpler instrument: a pad for each of
// the 25 keys (pressed and held like a key), NEW SOUND (the dice) and ALTER for the pad pressed last, its ECHO and
// REVERB sends, LOCK, INIT PATCH, RANDOM ALL and UNDO. The same patch, engine and rules as the big screen: its
// buttons press the big screen's own. ?desktop keeps the big screen on a phone
// ---------------------------------------------------------------------------------------------------------------
const asked = new URLSearchParams(location.search);
// (the phone's own size, not only the window's: a wide page makes a phone's browser zoom out and report it wider)
const wantPhone = () => (asked.has('desktop') ? false : asked.has('phone') || ((Math.min(screen.width, screen.height) <= 700 || innerWidth <= 700) && innerHeight > innerWidth));
let phoneOn = false;
const pads = [];
function buildPads() {
$('pv-pads').innerHTML = ''; pads.length = 0;
SOUNDS.forEach((s, i) => {
  if (!engineOn(i)) return;
  for (let j = 0; j <= s.zone.hi - s.zone.lo; j++) {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'pad e' + i;
    b.innerHTML = `<b></b><span>${s.name}</span><svg viewBox="0 0 16 18" aria-hidden="true"><path d="M4 8V5a4 4 0 0 1 8 0v3"/><rect x="1.5" y="8" width="13" height="9" rx="1"/></svg>`;
    let down; // the note this pad is holding
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault(); try { b.setPointerCapture(e.pointerId); } catch (err) { /* the pointer is gone already */ }
      const note = down = SOUNDS[i].zone.lo + j; b.classList.add('down');
      startAudio().then(() => { if (down === note) keyDown(i, note, 100); });
    });
    const up = () => { if (down === undefined) return; noteOff(down); down = undefined; b.classList.remove('down'); };
    for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) b.addEventListener(ev, up);
    b.addEventListener('contextmenu', (e) => e.preventDefault()); // (a long press holds the key: no menu)
    $('pv-pads').append(b); pads.push({ b, i, j });
  }
});
}
buildPads();
// a send of the pad pressed last: the bar follows the finger
const sendBars = [['pv-echo', 0, 'ECHO'], ['pv-reverb', 1, 'REVERB']].map(([id, k, name]) => {
  const el = $(id), track = el.querySelector('.track'), fill = track.querySelector('i'), out = el.querySelector('output'), par = () => sendPar(selVoice(), k);
  const at = (e) => { const r = track.getBoundingClientRect(); return clamp(Math.round((e.clientX - r.left - 4) / (r.width - 8) * 127), 0, 127); };
  const put = (x) => {
    if (x === valueNow(par())) return;
    editValue(par(), x); draw();
    if (!keyLocked(S.sel, editKey[S.sel])) detail(`${SOUNDS[S.sel].name} ${noteName(editKey[S.sel])} ${name} send <em>${x}</em>`);
  };
  let on = false;
  track.addEventListener('pointerdown', (e) => { e.preventDefault(); try { track.setPointerCapture(e.pointerId); } catch (err) { /* gone */ } on = true; put(at(e)); });
  track.addEventListener('pointermove', (e) => { if (on) put(at(e)); });
  for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) track.addEventListener(ev, () => { on = false; });
  track.addEventListener('keydown', (e) => { const d = { ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1 }[e.key]; if (d) { e.preventDefault(); put(clamp(valueNow(par()) + d * (e.shiftKey ? 10 : 1), 0, 127)); } });
  const draw = () => { const v = valueNow(par()) || 0; fill.style.width = `${v / 127 * 100}%`; out.textContent = v; track.setAttribute('aria-valuenow', v); };
  return draw;
});
for (const [id, to] of [['pv-alter', 'alter-key'], ['pv-lock', 'lock-key'], ['pv-init', 'init-patch'], ['pv-random', 'kit-scatter'], ['pv-undo', 'undo']]) $(id).addEventListener('click', () => $(to).click());
$('pv-dice').addEventListener('click', () => diceBtn.click());
// the phone's menu (MENU, top right; the same button closes it): the presses of the
// RANDOM menu that the pads' screen has no button for. A press does its thing and closes the menu, so the pads show it
function phoneMenu(open) {
  $('pv-menu').hidden = !open; $('pv-menu-btn').setAttribute('aria-expanded', open); $('pv-menu-btn').textContent = open ? 'CLOSE' : 'MENU';
  if (open) drawPhone();
}
$('pv-menu-btn').addEventListener('click', () => phoneMenu($('pv-menu').hidden));
for (const [id, fn] of [['pv-rand-eng', () => $('scatter').click()], ['pv-alter-eng', () => $('alter').click()], ['pv-alter-all', () => $('kit-alter').click()]])
  $(id).addEventListener('click', () => { phoneMenu(false); fn(); });
// what the big screen says and shows, said and shown here too: the message line, UNDO there to press, INIT PATCH asking
const mirror = (el, opts, fn) => { new MutationObserver(fn).observe(el, opts); fn(); };
mirror($('undo'), { attributes: true, attributeFilter: ['disabled'] }, () => { $('pv-undo').disabled = $('undo').disabled; });
mirror($('init-patch'), { attributes: true, attributeFilter: ['aria-pressed'] }, () => { const a = $('init-patch').getAttribute('aria-pressed') === 'true'; $('pv-init').setAttribute('aria-pressed', a); $('pv-init').textContent = a ? 'PRESS AGAIN' : 'INIT PATCH'; });
new MutationObserver(() => { $('pv-msg').innerHTML = $('detail').innerHTML; }).observe($('detail'), { childList: true, characterData: true, subtree: true });
drawPhone = () => {
  if (!phoneOn) return;
  let runs = 0;
  for (const { b, i, j } of pads) {
    const note = SOUNDS[i].zone.lo + j, ed = S.keyEdits[i][note], run = !!keyPatch(i, note).vals.get(seqOnPar(SOUNDS[i].engineVoice));
    b.firstChild.textContent = noteName(note); b.setAttribute('aria-label', `${SOUNDS[i].name} ${noteName(note)}`);
    b.classList.toggle('sel', i === S.sel && note === editKey[i]); b.classList.toggle('locked', !!ed?._lock);
    b.classList.toggle('run', run); if (run) runs++; // (a dashed foot: held, it plays a rhythm)
  }
  { const z = SOUNDS[S.sel].zone, keys = `${z.hi - z.lo + 1} ${SOUNDS[S.sel].name} KEYS`; // the menu, as things are
    $('pv-rand-eng').textContent = `RANDOM: ${SOUNDS[S.sel].name} KEYS`; $('pv-rand-eng-cap').textContent = `A NEW KIT SOUND ON EACH OF THE ${keys}`;
    $('pv-alter-eng').textContent = `ALTER: ${SOUNDS[S.sel].name} KEYS`; $('pv-alter-eng-cap').textContent = `NUDGE THE SOUNDS OF THE ${keys}`; }
  const note = editKey[S.sel], locked = keyLocked(S.sel, note), kit = S.keyEdits[S.sel][note]?._kit;
  $('pv-key').textContent = noteName(note);
  $('pv-what').textContent = `${SOUNDS[S.sel].name} · ${locked ? 'locked' + (kit && kit !== 'kept' ? ' · ' + kit : '') : kit && kit !== 'kept' ? kit : 'its own sound'}`;
  $('pv-lock').setAttribute('aria-pressed', locked); $('pv-lock').textContent = locked ? 'LOCKED' : 'LOCK';
  $('pv-dice').disabled = locked; $('pv-alter').disabled = locked;
  $('pv-name').textContent = S.preset.name;
  sendBars.forEach((d) => d());
};
function setPhone() {
  const on = wantPhone(); if (on === phoneOn) return;
  phoneOn = on; document.documentElement.classList.toggle('phone', on);
  if (on && S.editAll) setEditAll(false); // (a pad's sends are its own)
  drawPhone();
}

// ---------------------------------------------------------------------------------------------------------------
// fit the screen to small windows (a MacBook Air's browser with its toolbar and the dock): below 1264x784 inside the
// bezel the whole screen is laid out at that size and scaled down, so every knob stays visible and nothing scrolls
// ---------------------------------------------------------------------------------------------------------------
const FIT_W = 1264, FIT_H = 850;
// the engine buttons sit right under their key groups in the strip above, FX under the key's buttons
function alignEngines() {
  const row = $('sounds'), sc = $('screen'), k = sc.getBoundingClientRect().width / sc.offsetWidth || 1;
  const base = row.getBoundingClientRect().left;
  const place = (b, el) => { const r = el.getBoundingClientRect(); Object.assign(b.style, { left: `${(r.left - base) / k}px`, width: `${r.width / k}px` }); b.classList.toggle('narrow', r.width / k < 150); };
  document.querySelectorAll('#keystrip .kgroup').forEach((g, i) => place(soundBtns[i], g));
  const tag = row.querySelector('.tag'); tag.style.left = `${parseFloat(soundBtns[0].style.left) - tag.offsetWidth - 12}px`;
}
function fitScreen() {
  const sc = $('screen'), vw = innerWidth - 16, vh = innerHeight - 16, s = Math.min(1, vw / FIT_W, vh / FIT_H);
  setPhone();
  if (phoneOn) { sc.removeAttribute('style'); drawKeymap(); return; } // (the phone view lays itself out)
  if (s < 1) Object.assign(sc.style, { width: `${vw / s}px`, height: `${vh / s}px`, maxWidth: 'none', margin: '0', transform: `scale(${s})`, transformOrigin: '0 0' });
  else sc.removeAttribute('style');
  drawKeymap(); alignEngines();
}
window.addEventListener('resize', fitScreen);
fitScreen();
document.fonts?.ready.then(alignEngines);
window.afxReady = true; // index.html's load check
