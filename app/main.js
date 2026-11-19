// LXR-AFX: the page. Seven sounds on MIDI channels 1 to 7; every key from C1 to C5 plays a morph of its sound (C3 plays
// the base). The editor changes the base; the morphs follow from it. The sound engine is in sound/ (no UI here).
import { SOUNDS, VOICE_SCHEMAS, INIT_VALUES, PAGES, PAR, PAN_RANGE, MOD_TARGETS, MOD_TARGET_VOICE_RANGES, NUM_PARAMS, ALL_PARAMS,
  voiceOwned, voiceOfTarget, showValue, seqOnPar, seqPatPar, soundOfNote, mapVoice, setZoneStart, kindSchema, kindPar, setEngines, zoneSizes, engineOn, MAX_ENGINES, DEFAULT_ENGINES, DEFAULT_ZONE_START, trimPar, trimDb, TRIM_ZERO, sendPar,
  POS_RULE, valuesToPositions, editsToPositions, MOD_RULE, upgradeMod, pairsToDepths, stepTimesFromHit, modOf, MOD_SOURCES, MOD_AMT_ZERO, MOD_AMT_MAX, NUM_SRC, stepPar, NUM_STEPS, stepTimePar, stepSlewPar, STEP_TIMES, slewMs, routeOf, ukeyPar, dec2, TABLE_BASE, tablePar } from '../sound/schema.js?v=mwnt2hql';
import { TABLE_NAMES, tableId, tableFor, waveShape, WAVE_TOP, BASIC, classicOnBasic } from '../sound/tables.js?v=mwnt2hql';
import { presetName, jumble } from './names.js?v=mwnt2hql';
import { autoTrim, measure, LEVEL_TARGET_DB } from '../sound/level.js?v=mwnt2hql';
import { MAKERS, recipe, recipesFor, blend } from '../sound/makers.js?v=mwnt2hql';
import { breed, isDud } from '../sound/breed.js?v=mwnt2hql';
import { morphKey, combinedAmount, newSeed, pitchOffset, keyDistance, BASE_NOTE } from '../sound/morph.js?v=mwnt2hql';
import { BUCKET } from '../sound/bucket-sounds.js?v=mwnt2hql';
import { toVoice, fromVoice, labelOf, tidy as tidySound } from '../sound/bucket.js?v=mwnt2hql';
import { FX_DEFAULTS, echoMs, ECHO_DIVS } from '../sound/instrument.js?v=mwnt2hql';
import { DIRT_DEFAULTS, dirtHz, scHz, decayMs, volDb, pregainDb, bassDb } from '../sound/dirt.js?v=mwnt2hql';

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
  // 'kit' (a bucket sound as it is) or 'breed' (two bucket sounds crossed, sound/breed.js)
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
    if (d.modRule !== MOD_RULE && d.modRule !== 2) {
      if (d.modRule !== 1) { upgradeMod(S.defaults); upgradeMod(S.values, S.keyEdits); } // (kept with the firmware's one LFO and one velocity target: now routes on the knobs)
      pairsToDepths(S.defaults); pairsToDepths(S.values, S.keyEdits); // (kept with one source a knob: now a depth from each)
    }
    if (d.modRule === 2) { const had = d.values.length > stepTimePar(5); stepTimesFromHit(S.defaults, null, had); stepTimesFromHit(S.values, S.keyEdits, had); } // (kept while STEP TIME had HIT)
  }
} catch (e) { /* first visit, or storage blocked */ }
let saveT = 0;
const save = () => {
  clearTimeout(saveT);
  saveT = setTimeout(() => {
    try {
      localStorage.setItem(STORE, JSON.stringify({ values: [...S.values], defaults: [...S.defaults], global: S.global, sounds: S.sounds,
        locks: [...S.locks], rand: S.rand, sel: S.sel, page: S.page, keyEdits: S.keyEdits, editAll: S.editAll, zoneStart: S.zoneStart, engines: S.engines, ccMap: S.ccMap, fx: S.fx, panRule: 1, lockRule: 2, posRule: POS_RULE, modRule: MOD_RULE, preset: S.preset }));
    } catch (e) { /* storage blocked: it just isn't kept */ }
    drawPreset(); // (the name's mark: changed since it was saved)
  }, 300);
};

setEngines(S.engines); setZoneStart(S.zoneStart);
// the engines in use, in order (the others have no keys)
const onSounds = () => SOUNDS.map((_, i) => i).filter(engineOn);
// the SOUND BUCKET (sound/bucket.js): every sound of every kit, taken out one by one, and the sounds saved in the SOUND
// BLENDER (kept in this browser until they're added to the repo's bucket/). Every new sound is made from these
const BLEND_STORE = 'lxr-afx-blends-v1';
let savedSounds = [];
try { savedSounds = (JSON.parse(localStorage.getItem(BLEND_STORE)) || []).map(tidySound).filter(Boolean); } catch (e) { /* none */ }
const inRepo = new Set(BUCKET.map((s) => s.name));
const bucket = () => [...BUCKET, ...savedSounds.filter((s) => !inRepo.has(s.name))];

// ---------------------------------------------------------------------------------------------------------------
// audio
// ---------------------------------------------------------------------------------------------------------------
let ctx = null, node = null;
const send = (m) => { if (node) { postTables(m); node.port.postMessage(m); } };
// a wavetable a message is about to use is made here and posted first (the AudioWorklet never makes one while it plays;
// messages arrive in order, so it holds the table before the TABLE that asks for it). Made once, posted once
const postedTables = new Set();
function postTables(m) {
  const want = (par, x) => { if (par >= TABLE_BASE && par < TABLE_BASE + 6 && x > 0) { const id = tableId(x); if (id && !postedTables.has(id)) { postedTables.add(id); node.port.postMessage({ type: 'table', t: tableFor(x) }); } } };
  if (m.type === 'kit') for (let v = 0; v < 6; v++) want(TABLE_BASE + v, m.values[TABLE_BASE + v]);
  else if (m.type === 'param') want(m.par, m.value);
  else if (m.params) for (const [par, x] of m.params) want(par, x);
}
async function startAudio() {
  if (ctx) { if (ctx.state !== 'running') await ctx.resume(); return; }
  ctx = new AudioContext({ latencyHint: 'interactive' });
  await ctx.audioWorklet.addModule(new URL('../sound/worklet.js?v=mwnt2hql', import.meta.url));
  node = new AudioWorkletNode(ctx, 'lxr-afx', { numberOfInputs: 0, outputChannelCount: [2] });
  node.port.onmessage = (e) => { if (e.data.type === 'peaks') { showPeaks(e.data.peaks); showGr(e.data.gr || 0); if (e.data.out) showOut(e.data.out); showSc(e.data.sc || 0); if (e.data.steps) showSteps(e.data.steps); if (e.data.waves) showWaves(e.data.waves); if (e.data.mods) modLive(e.data.mods, e.data.stepAt); } };
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
  // a scattered key (a bucket sound dealt onto it) plays that sound as it is: no morph under it
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
function editValue(par, v, undo) { // undo: [what, merge] for UNDO, so one gesture (a paint, a STEP SEQ shape) is one step back
  if (!editing()) { // ALL KEYS: the engine's base and every key of the zone that has its own sound (locked keys stay)
    snapshot(undo ? undo[0] : `${SOUNDS[S.sel].name} ALL KEYS ${parLabel(par)}`, undo ? undo[1] : `all/${S.sel}/${par}`);
    const k = S.keyEdits[S.sel], base = S.values[par];
    setValue(par, v);
    for (const n in k) if (!k[n]._lock) { handEdit(k[n], par, k[n][par] ?? base, v); k[n][par] = v; }
    send({ type: 'param', par, value: v }); save(); drawKeymap(); return;
  }
  const note = editKey[S.sel], k = S.keyEdits[S.sel];
  if (keyLocked(S.sel, note)) { lockedMsg(); drawFaders(); return; }
  snapshot(undo ? undo[0] : `${SOUNDS[S.sel].name} ${noteName(note)} ${parLabel(par)}`, undo ? undo[1] : `key/${S.sel}/${note}/${par}`);
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
// the MIDI lamp beside the logo: lit while an input is connected, what it says in its tooltip
function midiStatus(text, live) { const el = $('midi-status'); el.classList.toggle('live', !!live); el.title = text; el.setAttribute('aria-label', text); }
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
    let v = val / 127 * e.max; // (a decimal: a BS2 knob's 128 steps spread over the control's range)
    if (e.display.type === 'detent' && !(e.ukey === 'wave' && tableNow(SOUNDS[S.sel].engineVoice) > 0)) { v = Math.round(v); const k = Math.round(v / e.display.step) * e.display.step; if (Math.abs(v - k) <= 2) v = Math.min(k, e.max); } // (a dial's settings catch the knob; not on a wavetable)
    else if (e.max < 20 || e.display.type === 'menu' || e.display.type === 'target') v = Math.round(v); // (a menu or a count stays whole)
    else v = dec2(v);
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
// the LAST box is gone from the top bar (Johnny, 2026-11-19: "this info is a bit redundant"): the key panel shows the
// key played, and what MIDI did that played nothing (a CC, another channel, a key outside the zones) goes to the status line
function showLastText(t) { detail(t.replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' })[c])); }
function showLast(sound, note) {
  const sk = stripKeys.find((x) => x.sound === sound && x.note === note); // the key lights while it sounds
  if (sk) { sk.k.classList.add('hit'); clearTimeout(sk.k._t); sk.k._t = setTimeout(() => sk.k.classList.remove('hit'), 160); }
  const led = soundBtns[sound].querySelector('i');
  led.classList.add('on'); clearTimeout(led._t); led._t = setTimeout(() => led.classList.remove('on'), 120);
}
// the master compressor's gain reduction on a VU meter (Johnny): the needle rests at 0 on the right and swings left as
// the compressor pulls the level down, to 20 dB, easing like a real needle (about 300 ms to settle)
const VU_MAX = 20, VU_ANG = 45; // dB at full swing; degrees each side of upright
const vuAng = (db) => VU_ANG - 2 * VU_ANG * Math.pow(Math.min(VU_MAX, Math.max(0, db)) / VU_MAX, 0.6);
let grShown = 0, grNeedle = 0;
function showGr(db) {
  grShown = Math.max(db, grShown * 0.8);
  grNeedle += (grShown - grNeedle) * 0.3;
  const n = document.querySelector('.vu .needle'); if (n) n.setAttribute('transform', `rotate(${vuAng(grNeedle).toFixed(2)} 60 82)`);
  const o = document.querySelector('.vu output'); if (o) o.textContent = grShown >= 0.05 ? '-' + grShown.toFixed(1) : '0.0';
}
function vuFace() {
  const at = (deg, r) => { const a = deg * Math.PI / 180; return [(60 + r * Math.sin(a)).toFixed(1), (82 - r * Math.cos(a)).toFixed(1)]; };
  const [x0, y0] = at(-VU_ANG, 60), [x1, y1] = at(VU_ANG, 60), [h0, k0] = at(vuAng(3), 60);
  let marks = '';
  for (const d of [0, 1, 2, 3, 5, 7, 10, 15, 20]) {
    const big = [0, 3, 5, 10, 20].includes(d), g = vuAng(d), [ax, ay] = at(g, 60), [bx, by] = at(g, big ? 53 : 56);
    marks += `<line x1="${ax}" y1="${ay}" x2="${bx}" y2="${by}"/>`;
    if (big) { const [tx, ty] = at(g, 69); marks += `<text x="${tx}" y="${ty}">${d}</text>`; }
  }
  return `<svg viewBox="0 0 120 66" aria-hidden="true"><path class="arc" d="M${x0} ${y0} A60 60 0 0 1 ${x1} ${y1}"/>`
    + `<path class="hot" d="M${h0} ${k0} A60 60 0 0 1 ${x1} ${y1}"/>${marks}<text class="vul" x="60" y="46">GAIN RED.</text>`
    + `<line class="needle" x1="60" y1="82" x2="60" y2="18" transform="rotate(${VU_ANG} 60 82)"/></svg>`;
}
// the output meter: what goes out of the page, each side's peak on a bar from -48 to 0 dB (a segment per 3 dB, falling
// back about 27 dB a second), the highest held a moment and read out in dB; CLIP lights for 3 s when the mix goes over
// full scale (the last soft limit squashing it), or until it's pressed
const METER_LO = -48, METER_SEGS = 16, METER_HOLD = 1500, CLIP_HOLD = 3000;
const meter = [0, 1].map(() => ({ db: -120, pk: -120, pkAt: 0 }));
let clipAt = -1e9;
function showOut([l, r, cl, cr]) {
  const now = performance.now();
  if (cl || cr) clipAt = now;
  const rows = document.querySelectorAll('.outm .mrow');
  [l, r].forEach((v, c) => {
    const m = meter[c], db = v > 1e-6 ? 20 * Math.log10(v) : -120;
    m.db = Math.max(db, m.db - 0.9);
    if (db >= m.pk) { m.pk = db; m.pkAt = now; } else if (now - m.pkAt > METER_HOLD) m.pk = Math.max(m.db, m.pk - 0.9);
    const row = rows[c]; if (!row) return;
    const n = Math.round((m.db - METER_LO) / (-METER_LO / METER_SEGS)), hold = Math.ceil((m.pk - METER_LO) / (-METER_LO / METER_SEGS)) - 1;
    row.querySelectorAll('.segs i').forEach((x, i) => { x.classList.toggle('on', i < n); x.classList.toggle('pk', i === hold && i >= n); });
    row.querySelector('output').textContent = m.pk > -60 ? m.pk.toFixed(1) : '-\u221e';
  });
  const cb = document.querySelector('.outm .clip'); if (cb) cb.setAttribute('aria-pressed', now - clipAt < CLIP_HOLD);
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
// mouse and pen moves carry the buttons held; a touch is pressed for as long as it moves
const stillPressed = (e) => e.pointerType === 'touch' || (e.buttons & 1) === 1;
// leaving the page (another window, tab or app) lets go of the control being dragged
let dragEnd = null;
const endDrags = () => { if (dragEnd) dragEnd(); };
window.addEventListener('blur', endDrags);
document.addEventListener('visibilitychange', () => { if (document.hidden) endDrags(); });
const FINE_SPEED = 0.1;
function dragger(track, axis, o) {
  let d = null;
  track.addEventListener('pointerdown', (e) => {
    if (e.button) return;
    try { track.setPointerCapture(e.pointerId); } catch (err) { /* the pointer is gone already */ } e.preventDefault();
    const r = track.getBoundingClientRect(), len = o.len || (axis === 'x' ? r.width : r.height);
    // a press off the bar's end jumps there (not on a knob: it turns from where it is)
    const at = axis === 'x' ? (e.clientX - r.left) / r.width : (r.bottom - e.clientY) / r.height;
    const f = (o.get() - o.min) / (o.max - o.min);
    if (!o.len && Math.abs(at - f) * len > 8) o.put(o.min + clamp(at, 0, 1) * (o.max - o.min));
    d = { id: e.pointerId, last: axis === 'x' ? e.clientX : e.clientY, acc: o.get(), len };
    o.held && o.held(true); dragEnd = end;
  });
  track.addEventListener('pointermove', (e) => {
    if (!d || e.pointerId !== d.id) return;
    // a drag lives only while the button is down: if the release was missed (let go outside the window, a context
    // menu, a tab switch), the next plain mouse move ends it instead of turning the control under the pointer
    if (!stillPressed(e)) { end(); return; }
    const p = axis === 'x' ? e.clientX : e.clientY, dp = axis === 'x' ? p - d.last : d.last - p;
    d.last = p; d.acc = clamp(d.acc + dp / d.len * (o.max - o.min) * (e.shiftKey ? FINE_SPEED : 1), o.min, o.max);
    o.put(d.acc, e.shiftKey); // (held SHIFT: fine, a tenth of the speed; a knob then takes tenths of a step)
  });
  function end() { if (dragEnd === end) dragEnd = null; if (d) { d = null; o.held && o.held(false); } }
  for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) track.addEventListener(ev, end);
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
// ---- NEW SOUND: the dice in the key's row of buttons (beside ALTER KEY and LOCK KEY). A press, or K, deals the key another bucket sound of its engine and rolls the dice: it turns once while its
// face changes a few times, a third of a second. Flat, like the rest of the panel: seven pips, the lit ones the face ----
const DICE_PIPS = { tl: [5, 5], tr: [19, 5], ml: [5, 12], mr: [19, 12], bl: [5, 19], br: [19, 19], c: [12, 12] };
const DICE_FACES = [[], ['c'], ['tl', 'br'], ['tl', 'c', 'br'], ['tl', 'tr', 'bl', 'br'], ['tl', 'tr', 'c', 'bl', 'br'], ['tl', 'tr', 'ml', 'mr', 'bl', 'br']];
const diceBtn = document.createElement('button');
diceBtn.type = 'button'; diceBtn.className = 'dicebtn'; diceBtn.id = 'rand-key';
diceBtn.title = 'NEW SOUND (K): a different bucket sound on this key only. UNDO takes it back; LEARN can put it on a button';
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
$('keyacts').prepend(diceBtn);
for (const d of dice) d.addEventListener('animationend', () => d.classList.remove('roll'));
// the synth panel's rows of sections, and its grid: the widest row (the metal's osc and fm; every engine's filter,
// velocity and mix) fills 11 cells
// the merged voice: every engine has every section (Johnny, 2026-11-17); FX and MASTER have a tab of their own
// in the order the sound flows: the oscillator, its pitch and the other sources; then the FM pair side by side into the
// filter; then the amp, the LFO and the mix (Johnny, 2026-11-19: "the whole top section is a mess")
const ROWS = [['osc', 'pitch', 'noise', 'click'], ['mod a', 'mod b', 'filter in', 'filter'], ['amp', 'lfo', 'mix']]; // (row 4: modStrip)
const GRID_COLS = 16;
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
      const el = sect(list.length + (sec === 'osc' ? 2 : 0)); // (the OSC section: its wave display two cells of its own, after its knobs)
      el.innerHTML = `<h3>${sec}</h3><div class="row"></div>`;
      const row = el.querySelector('.row');
      for (const e of list) row.append(vfader(e));
      if (sec === 'osc') tablePicker(el.querySelector('h3'), voice, row);
      const lv = PART_LEVEL[sec] && VOICE_SCHEMAS[voice].find((e) => e.ukey === PART_LEVEL[sec]);
      if (lv) faderDraws.push(() => el.classList.toggle('off', !valueNow(lv.par)));
    }
    if (col <= GRID_COLS) { const n = GRID_COLS + 1 - col; sect(n, ' fill'); }
  });
  const sends = entries.filter((e) => e.section === 'fx sends');
  const el = cell(document.createElement('div'), 1, 2, GRID_COLS + 1, GRID_COLS + 3); el.className = 'sect sends sep'; el.style.setProperty('--n', 2);
  el.innerHTML = '<h3>fx sends</h3><div class="row"></div>';
  for (const e of sends) el.querySelector('.row').append(vfader(e));
  box.append(el);
  modStrip(box, cell, voice);
  drawSource(); // (the dice sits in the key's row of buttons, above)
  makePanel($('make')); // (and the MAKE buttons under them)
  const big = cell(vfader(VOICE_SCHEMAS[voice].find((e) => e.par === lvl), true), 2, 5, GRID_COLS + 1, GRID_COLS + 3); big.classList.add('big', 'rt', 'sep');
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
// the tone's TABLE, in the OSC heading: CLASSIC (the firmware's waves on the WAVE dial) or one of METAMORF's wavetables,
// which the WAVE knob then moves along. A dropdown: the button opens the list, a click on one picks it
const tableNow = (voice) => Math.round(valueNow(tablePar(voice)) || 0);
function openTableMenu(open) { const m = document.querySelector('.tblmenu'); if (!m) return; m.hidden = !open; m.previousSibling.setAttribute('aria-expanded', open); }
function tablePicker(h3, voice, row) {
  const dd = document.createElement('span'); dd.className = 'tdd'; h3.classList.add('withbtn'); h3.append(dd);
  const b = document.createElement('button'); b.type = 'button'; b.className = 'btn sm hdb tbl'; b.setAttribute('aria-haspopup', 'listbox'); b.setAttribute('aria-expanded', 'false');
  const menu = document.createElement('div'); menu.className = 'tblmenu'; menu.hidden = true; menu.setAttribute('role', 'listbox');
  dd.append(b, menu);
  b.addEventListener('click', () => openTableMenu(menu.hidden));
  const items = TABLE_NAMES.map((name, k) => {
    const it = document.createElement('button'); it.type = 'button'; it.className = 'btn sm'; it.textContent = name.toUpperCase(); it.setAttribute('role', 'option');
    it.title = k ? `${name.toUpperCase()}: the WAVE knob moves along it, smoothly` : 'CLASSIC: the WAVE knob picks sine, tri, saw, rec, pwm or noise';
    it.addEventListener('click', () => {
      openTableMenu(false); editValue(tablePar(voice), k); drawFaders();
      detail(`${SOUNDS[S.sel].name} ${editing() ? noteName(editKey[S.sel]) + ' ' : 'ALL KEYS '}TABLE <em>${name.toUpperCase()}</em>${k ? ': the WAVE knob moves along it' : ': the classic waves'}`);
    });
    menu.append(it); return it;
  });
  faderDraws.push(() => {
    const i = tableNow(voice);
    b.textContent = TABLE_NAMES[i].toUpperCase() + ' \u25be'; b.classList.toggle('on', i > 0);
    b.title = `The tone's oscillator: ${i ? 'the ' + TABLE_NAMES[i].toUpperCase() + ' wavetable, the WAVE knob moving along it' : 'CLASSIC, the WAVE knob picking sine, tri, saw, rec, pwm or noise'}. Click to choose another`;
    items.forEach((it, k) => { it.classList.toggle('on', k === i); it.setAttribute('aria-selected', k === i); });
  });
  // the wave display, two cells of its own, the picture twice a knob's width: the table as a slanted stack of its frames
  // (a waterfall: the start of the WAVE knob at the front, its end at the back), the frame the tone plays now drawn
  // over it in black (the ink), the others grey. It follows the WAVE knob, and while a key sounds, where modulation has it now. A 2D
  // canvas: the stack is drawn once per table (and PWM, look, size), each move only puts the one frame over it
  const vc = document.createElement('div'); vc.className = 'vf wvcell'; vc.innerHTML = '<output></output><div class="wvbox"></div><span class="lab">shape</span>';
  row.append(vc);
  const cv = document.createElement('canvas'); cv.className = 'wv'; cv.setAttribute('aria-hidden', 'true');
  vc.querySelector('.wvbox').append(cv);
  if (window.ResizeObserver) new ResizeObserver(() => drawWave(null)).observe(cv);
  faderDraws.push(() => { vc.querySelector('output').textContent = TABLE_NAMES[tableNow(voice)]; });
  wave.cv = cv; wave.voice = voice; wave.last = ''; wave.stackKey = '';
  faderDraws.push(() => drawWave(null));
}
// the wave display's state: its canvas, the voice, the stack drawn (an offscreen canvas and what it shows), what's drawn
// now, when the last live frame was drawn (moves under modulation are capped: 30 a second, 15 on a phone)
const wave = { cv: null, voice: 0, stack: null, stackKey: '', last: '', liveAt: 0, pend: null, timer: 0 };
const WV_GAP = matchMedia('(pointer: coarse)').matches ? 66 : 33;
const WV_SLANT = [0.3, 0.5]; // (how far back the last frame sits: of the width, of the height)
// where frame t (0 front .. 1 back) of the waterfall sits on a w x h canvas: its left end, its centre line, its width, its height
function wvPlace(t, w, h) {
  const p = 2, dx = (w - 2 * p) * WV_SLANT[0], dy = (h - 2 * p) * WV_SLANT[1], fw = w - 2 * p - dx, fh = h - 2 * p - dy;
  return { x: p + t * dx, y: h - p - fh / 2 - t * dy, fw, a: fh / 2 * 0.92 };
}
function wvLine(g, pts, q) { g.beginPath(); for (let j = 0; j <= pts.length; j++) { const x = q.x + j / pts.length * q.fw, y = q.y - pts[j % pts.length] * q.a; j ? g.lineTo(x, y) : g.moveTo(x, y); } }
function drawWave(live) {
  const { cv, voice } = wave; if (!cv || !cv.isConnected) return;
  const now = performance.now();
  if (live !== null) { // under modulation: no more than one frame each WV_GAP ms, the newest kept for the next
    const wait = wave.liveAt + WV_GAP - now;
    if (wait > 0) { wave.pend = live; if (!wave.timer) wave.timer = setTimeout(() => { wave.timer = 0; const x = wave.pend; wave.pend = null; if (x !== null) drawWave(x); }, wait); return; }
    wave.liveAt = now;
  }
  const i = tableNow(voice), knob = valueNow(ukeyPar(voice, 'wave')) || 0, pwm = valueNow(ukeyPar(voice, 'pwm')) || 0;
  const at = live ?? knob, css = getComputedStyle(cv), ink = css.getPropertyValue('--ink').trim() || '#000', panel = css.getPropertyValue('--panel').trim() || '#fff';
  const hot = ink, ratio = Math.min(window.devicePixelRatio || 1, 2);
  const w = cv.clientWidth, h = cv.clientHeight; if (!w || !h) return;
  const W = Math.round(w * ratio), H = Math.round(h * ratio);
  const sk = `${i}/${pwm}/${W}x${H}/${ink}/${panel}`;
  const key = `${sk}/${hot}/${at.toFixed(2)}`;
  if (key === wave.last) return; wave.last = key;
  if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
  // the stack, drawn back to front, each frame filled below its line with the panel colour so it hides the ones behind
  if (sk !== wave.stackKey) {
    const s = wave.stack || (wave.stack = document.createElement('canvas')); s.width = W; s.height = H;
    const g = s.getContext('2d'); g.setTransform(ratio, 0, 0, ratio, 0, 0); g.lineJoin = 'round';
    const t = tableFor(i, true), n = t ? Math.min(Math.max(t.frames, 2), 24) : 21;
    // the floor: the front and back centre lines and the sides joining them, faint
    const f0 = wvPlace(0, w, h), f1 = wvPlace(1, w, h);
    g.strokeStyle = ink; g.globalAlpha = 0.2; g.lineWidth = 1; g.beginPath();
    g.moveTo(f0.x, f0.y); g.lineTo(f0.x + f0.fw, f0.y); g.lineTo(f1.x + f1.fw, f1.y); g.lineTo(f1.x, f1.y); g.closePath(); g.stroke();
    for (let f = n - 1; f >= 0; f--) {
      const tt = f / (n - 1), q = wvPlace(tt, w, h), pts = waveShape(i, tt * WAVE_TOP, pwm, 64);
      wvLine(g, pts, q); g.lineTo(q.x + q.fw, q.y + q.a + 1); g.lineTo(q.x, q.y + q.a + 1); g.closePath();
      g.globalAlpha = 0.82; g.fillStyle = panel; g.fill();
      wvLine(g, pts, q); g.globalAlpha = 0.32; g.strokeStyle = ink; g.lineWidth = 1; g.stroke();
    }
    wave.stackKey = sk;
  }
  const g = cv.getContext('2d'); g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = 1; g.clearRect(0, 0, W, H); g.drawImage(wave.stack, 0, 0);
  // the frame the tone plays, at its place in the stack
  g.setTransform(ratio, 0, 0, ratio, 0, 0); g.lineJoin = 'round';
  const tt = Math.min(Math.max(at / WAVE_TOP, 0), 1), q = wvPlace(tt, w, h);
  wvLine(g, waveShape(i, at, pwm, 96), q); g.strokeStyle = hot; g.lineWidth = 2.2; g.stroke();
}
// from the audio: where each voice's dial is now; drawn while it moves (modulation), back to the knob when it stops
function showWaves(w) {
  const x = w[wave.voice]; if (x === undefined) return;
  drawWave(x);
}

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
  const tr = el.querySelector('.knob'), out = el.querySelector('output'), ticks = tr.querySelectorAll('.tk'), ptr = tr.querySelector('.rot');
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
// the echo's DUCK: how far the echoes go down while the dry sound plays, swelling back up in the gaps (0: off)
const ECHO_DUCK = { max: 127, get: () => E().duck || 0, set: (v) => { E().duck = v; sendFx(); detail(`ECHO DUCK <em>${v ? Math.round(v / 1.27) + '%' : 'OFF'}</em>`); },
  show: (v) => (v ? Math.round(v / 1.27) + '%' : 'off'), dflt: 0 };
const TOG_SVG = '<svg viewBox="0 0 64 64" aria-hidden="true">'
  + '<rect class="rbez" x="14" y="7" width="36" height="50" rx="2.5"/><rect class="rbz2" x="16.5" y="9.5" width="31" height="45" rx="1.5"/>'
  + '<rect class="rgap" x="19" y="12" width="26" height="40" rx="1"/>'
  + '<rect class="rface" x="20" y="13" width="24" height="38" rx="1.5"/>'
  + '<rect class="rup" x="20" y="13" width="24" height="19"/><rect class="rdn" x="20" y="32" width="24" height="19"/>'
  + '<rect class="rsh rsh-up" x="20" y="13" width="24" height="3.2"/><rect class="rsh rsh-dn" x="20" y="47.8" width="24" height="3.2"/>'
  + '<line class="rhl rhl-up" x1="21.5" y1="13.9" x2="42.5" y2="13.9"/><line class="rhl rhl-dn" x1="21.5" y1="50.1" x2="42.5" y2="50.1"/>'
  + '<circle class="rmk" cx="32" cy="22.5" r="4.3"/><line class="rmk" x1="32" y1="37.5" x2="32" y2="45.5"/>'
  + '<line class="mrange" x1="55" y1="12" x2="55" y2="12"/><circle class="mdot" cx="55" cy="52" r="3"/></svg>';
// a two-way FX switch (SYNC, P-PONG, the distortion's FILTER, XOVER and CLIP) is drawn as a rocker switch too (vtoggle):
// its I end pressed for its second setting, its name over it
function togDraw(b, out, names, get) {
  b.classList.add('tog'); b.setAttribute('role', 'switch'); b.innerHTML = TOG_SVG; b.setAttribute('aria-label', b.title);
  return () => { const v = get() ? 1 : 0; b.setAttribute('aria-checked', v === 1); out.textContent = names[v]; };
}
// a switch in a knob's cell: a button that steps through its settings, named on the button, lit away from the first
function gswitch(label, names, title, get, set) {
  const el = document.createElement('div'); el.className = 'vf vsw';
  el.innerHTML = '<output></output><button class="swb" type="button"></button><span class="lab"></span>';
  el.querySelector('.lab').textContent = label;
  const b = el.querySelector('.swb'); b.title = title;
  const draw = names.length === 2 ? togDraw(b, el.querySelector('output'), names, get)
    : () => { b.textContent = names[get()] ?? names[0]; b.setAttribute('aria-pressed', get() > 0); };
  b.addEventListener('click', () => { set((get() + 1) % names.length); faderDraws.forEach((d) => d()); });
  faderDraws.push(draw);
  return el;
}
const FX_PAGE = [
  ['echo', 'ECHO', [['time', ECHO_TIME], ['sync', 'switch', ['OFF', 'ON'], 'Sync: TIME in note lengths at the BPM (1/32 to 1/2, triplets and dotted), following the BPM', (v) => {
    E().sync = v; sendFx(); detail(v ? `ECHO SYNC <em>ON</em>: TIME ${ECHO_DIVS[E().div][0]} at ${S.fx.tempo.bpm} BPM` : `ECHO SYNC <em>OFF</em>: TIME ${echoMs(E().time)} ms`);
  }], ['feedback', 127], ['tone', 127], ['pingpong', 'switch', ['OFF', 'ON'], 'Ping-pong: each repeat on the other side', (v) => {
    E().pingpong = v; sendFx(); detail(`ECHO PING-PONG <em>${v ? 'ON' : 'OFF'}</em>`); }, 'p-pong'], ['duck', ECHO_DUCK]]],
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
  // OUTPUT: the LEVEL knob in the first cell, the output's L and R bars (showOut) over their dB scale on cells 2 to 4,
  // each with its name on the left and its held peak on the right, and the compressor's gain reduction VU meter
  // (showGr) on cells 5 and 6. CLIP sits in the header
  const out = box.lastChild; out.classList.add('mout', 'outm');
  const clip = document.createElement('button'); clip.type = 'button'; clip.className = 'btn sm hdb clip'; clip.textContent = 'CLIP';
  clip.setAttribute('aria-pressed', 'false'); clip.title = 'Lights when the output goes over full scale (the last soft limit squashing it); press to clear';
  clip.addEventListener('click', () => { clipAt = -1e9; clip.setAttribute('aria-pressed', 'false'); });
  const h3 = out.querySelector('h3'); h3.innerHTML = '<span class="t">OUTPUT</span>'; h3.append(clip);
  const ticks = [-48, -24, -12, -6, 0].map((d) => `<span style="left:${(d - METER_LO) / -METER_LO * 100}%">${d}</span>`).join('');
  const bars = document.createElement('div'); bars.className = 'meters';
  bars.innerHTML = ['L', 'R'].map((c) => `<div class="mrow"><span class="ch">${c}</span><div class="segs">${'<i></i>'.repeat(METER_SEGS)}</div><output>-\u221e</output></div>`).join('')
    + `<div class="mscale"><span></span><div class="scale">${ticks}</div><span class="ch">dB</span></div>`;
  const vu = document.createElement('div'); vu.className = 'vu'; vu.title = 'The compressor\'s gain reduction: the needle swings left as it turns the level down';
  vu.innerHTML = vuFace() + '<output>0.0</output>';
  out.querySelector('.row').append(bars, vu);
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
  const cycle = (b, k, names, label, lit = true, out = null) => {
    const draw = out ? togDraw(b, out, names, () => D[k]) : () => { b.textContent = names[D[k]] ?? names[0]; if (lit) b.setAttribute('aria-pressed', D[k] > 0); };
    b.addEventListener('click', () => { D[k] = (D[k] + 1) % names.length; sendFx(); draw(); drawDirt(); say(`${label ? label + ' ' : ''}<em>${names[D[k]]}</em>`); });
    faderDraws.push(draw); return b;
  };
  const sw = (k, label, names, title) => {
    const el = document.createElement('div'); el.className = 'vf vsw';
    el.innerHTML = '<output></output><button class="swb" type="button"></button><span class="lab"></span>';
    el.querySelector('.lab').textContent = label; el.querySelector('.swb').title = title;
    cycle(el.querySelector('.swb'), k, names, label.toUpperCase(), true, names.length === 2 ? el.querySelector('output') : null);
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
  // the GREY look's printed scale and chicken-head knob (css/grey.css shows them, the LCD look hides them): a fine
  // tick at each of 11 steps, a round skirt, and the head, a pointer with a white line along it, turned with the value
  let sc = '';
  for (let i = 0; i <= 10; i++) {
    const a = KNOB_A0 + i / 10 * KNOB_SWEEP, c = Math.cos(a), s = Math.sin(a), r0 = i % 5 ? 25.5 : 24;
    sc += `<line class="sc" x1="${(32 + r0 * c).toFixed(2)}" y1="${(32 + r0 * s).toFixed(2)}" x2="${(32 + 28.5 * c).toFixed(2)}" y2="${(32 + 28.5 * s).toFixed(2)}"/>`;
  }
  const head = '<circle class="skirt" cx="32" cy="32" r="15.5"/><circle class="skirt-top" cx="32" cy="32" r="13.5"/>'
    + '<path class="chh" d="M54 32C47 35 40 39.5 33 42.6A11 11 0 1 1 33 21.4C40 24.5 47 29 54 32Z"/><line class="chl" x1="35" y1="32" x2="51.5" y2="32"/>';
  // the other KNOB STYLEs, flat (css/grey.css shows the chosen one): ROUND (the skirt, a black cap, a white line), RIBBED
  // (a black ribbed cylinder, a white line), RUBBER (a matte dome, a white dot)
  let ribs = '';
  for (let i = 0; i < 28; i++) { const a = i / 28 * Math.PI * 2; ribs += `<line class="rbr" x1="${(32 + 12.4 * Math.cos(a)).toFixed(2)}" y1="${(32 + 12.4 * Math.sin(a)).toFixed(2)}" x2="${(32 + 14.2 * Math.cos(a)).toFixed(2)}" y2="${(32 + 14.2 * Math.sin(a)).toFixed(2)}"/>`; }
  const others = '<circle class="rdc" cx="32" cy="32" r="12.6"/><line class="rdl" x1="34.5" y1="32" x2="43.5" y2="32"/>'
    + `<circle class="rbb" cx="32" cy="32" r="14.4"/>${ribs}<circle class="rbt" cx="32" cy="32" r="12"/><line class="rbl" x1="34" y1="32" x2="43.5" y2="32"/>`
    + '<circle class="rub" cx="32" cy="32" r="14.8"/><circle class="rut" cx="32" cy="32" r="10.5"/><circle class="rud" cx="40.6" cy="32" r="1.8"/>';
  // (the printed scale and the markers sit in .ring, which css/grey.css pulls in snug round a smaller knob: RIBBED)
  return `<svg viewBox="0 0 64 64" aria-hidden="true"><g class="ring">${t}${sc}<path class="mrange"/><line class="notch" x1="61" y1="32" x2="64" y2="32"/><circle class="mdot" cx="62" cy="32" r="2.6"/></g><g class="rot"><g class="body">${head}${others}<line class="ptr" x1="32" y1="32" x2="46" y2="32"/></g></g></svg>`;
})();
// LEVEL's fader (Johnny, 2026-11-19: "make LEVEL into a fader"): a mixer-style slider in a 40 x 200 box. The cap's
// middle travels the box's full height (0 at the bottom, full at the top), so a press on the slot lands where it
// points; a printed scale both sides of a dark slot, the cap (group .cap, moved with the value), the modulation's range
// as a bar to its right and its live dot, the notch at the left where it was before you changed it
const FADER_SVG = (() => {
  let sc = '';
  for (let i = 0; i <= 10; i++) { const y = 200 - i * 20, w = i % 5 ? 5 : 8; sc += `<line class="fs" x1="${11 - w}" y1="${y}" x2="11" y2="${y}"/><line class="fs" x1="29" y1="${y}" x2="${29 + w}" y2="${y}"/>`; }
  return `<svg viewBox="0 0 40 200" aria-hidden="true">${sc}<rect class="slot" x="17" y="-3" width="6" height="206" rx="3"/><path class="mrange"/>`
    + `<g class="cap"><rect class="fcap" x="5" y="-12" width="30" height="24" rx="3"/><line class="fcl" x1="7.5" y1="0" x2="32.5" y2="0"/></g>`
    + `<line class="notch" x1="-6" y1="0" x2="2" y2="0"/><circle class="mdot" cx="38" cy="0" r="2.6"/></svg>`;
})();
const faderY = (v, max) => 200 * (1 - (max ? clamp(v, 0, max) / max : 0));
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
// a rocker switch: a control with only two settings (on/off, A/B) in a knob's cell, the same size as a knob (Johnny,
// 2026-11-19: "turn any dials with 2 states into switches", then rocker switches "more like this kind of switch", a
// black KCD1 rocker). O is printed on its top end and I on its bottom end; ON (its second setting) has the I end pressed
// in and the O end raised, as on the real switch. The GREY look draws a matte black rocker in a black bezel (with the
// three.js panel on, app/panel3d.js builds it in 3D, tilted, with real shading and shadow); the LCD look fills the
// pressed half. A modulated one (VEL VOL) shows the swing its sources give it as a bar beside the rocker (top: off,
// bottom: on, the middle being where it flips), and a dot at the end the engine has it at now
// the swing bar and the live dot on a switch (v: 0 or 1; lo, hi: how far its sources move it, in its 0..1 range)
const togY = (x) => 12 + 40 * clamp(x, 0, 1);
function drawTogMod(b, v, lo, hi) {
  const r = b.querySelector('.mrange');
  r.setAttribute('y1', togY(v + lo)); r.setAttribute('y2', togY(v + hi));
}
function vtoggle(e) {
  const el = document.createElement('div'); el.className = 'vf vtog';
  el.innerHTML = `<output></output><button class="tog" type="button" role="switch">${TOG_SVG}</button><span class="lab"></span><button class="lock" type="button" aria-label="Lock ${e.label}">${LOCK_SVG}</button>`;
  el.querySelector('.lab').textContent = e.label;
  const b = el.querySelector('.tog'), out = el.querySelector('output'), lock = el.querySelector('.lock');
  b.setAttribute('aria-label', e.label); b.title = 'Click to flip';
  const mod = e.ukey && modOf(SOUNDS[S.sel].engineVoice, e.ukey);
  if (mod) {
    el._ukey = e.ukey;
    el.addEventListener('contextmenu', (ev) => { ev.preventDefault(); selectModDial(e); });
    b.addEventListener('pointerdown', () => selectModDial(e));
  }
  const on = () => (valueNow(e.par) >= 0.5 ? 1 : 0);
  const draw = () => {
    const v = on();
    b.setAttribute('aria-checked', v === 1); out.textContent = showValue(e, v);
    el.classList.toggle('changed', !editing() && valueNow(e.par) !== S.defaults[e.par]);
    el.classList.toggle('keyed', editing() && keyEdited(e.par));
    if (mod) { const [lo, hi] = modSpan(mod); el.classList.toggle('modded', !!(lo || hi)); drawTogMod(b, v, lo, hi); }
    const locked = S.locks.has(e.par);
    lock.setAttribute('aria-pressed', locked);
    lock.title = locked ? `${e.label.toUpperCase()} is locked: the dice, RANDOM and ALTER leave it as it is, on every key. Click to unlock` : `Lock ${e.label.toUpperCase()}: the dice, RANDOM and ALTER then leave it as it is, on every key`;
  };
  const put = (x) => {
    if (x === valueNow(e.par)) return;
    editValue(e.par, x); draw();
    detail(`${SOUNDS[S.sel].name} ${editing() ? noteName(editKey[S.sel]) + ' ' : 'ALL KEYS '}${e.label.toUpperCase()} <em>${showValue(e, x)}</em>`);
  };
  b.addEventListener('click', () => { if (!learn) put(1 - on()); });
  // double-click on the name: back to where it was before you changed it (on a key), or the kit's value
  el.querySelector('.lab').addEventListener('dblclick', () => {
    if (editing() && keyLocked(S.sel, editKey[S.sel])) { lockedMsg(); return; }
    if (editing()) { const was = S.keyEdits[S.sel][editKey[S.sel]]?._o?.[e.par]; if (was !== undefined) put(was); }
    else put(S.defaults[e.par]);
  });
  el.dataset.learn = JSON.stringify({ t: 'par', label: [e.label] });
  lock.addEventListener('click', () => {
    const l = !S.locks.has(e.par); if (l) S.locks.add(e.par); else S.locks.delete(e.par); save(); draw(); drawLocks();
    detail(l ? `${SOUNDS[S.sel].name} ${e.label.toUpperCase()} <em>locked</em>: the dice, RANDOM and ALTER leave it as it is, on every ${SOUNDS[S.sel].name.toLowerCase()} key` : `${SOUNDS[S.sel].name} ${e.label.toUpperCase()} <em>unlocked</em>`);
  });
  faderDraws.push(draw);
  if (mod) modDots.push({ tr: b, el, e, mod, tog: true });
  return el;
}
function vfader(e, fader) {
  if (e.max === 1 && e.display.type === 'menu') return vtoggle(e); // (two settings: a switch)
  const el = document.createElement('div'); el.className = 'vf';
  el.innerHTML = `<output></output><div class="knob${fader ? ' fslide' : ''}" role="slider">${fader ? FADER_SVG : KNOB_SVG}</div><span class="lab"></span><button class="lock" type="button" aria-label="Lock ${e.label}">${LOCK_SVG}</button>`;
  el.querySelector('.lab').textContent = e.label;
  const tr = el.querySelector('.knob'), out = el.querySelector('output'), lock = el.querySelector('.lock');
  // its modulation (a right-click sets each source's depth): the
  // range they can move it over as an arc outside the ring, and a dot where they have it now (modLive)
  const mod = e.ukey && modOf(SOUNDS[S.sel].engineVoice, e.ukey);
  if (mod) {
    el._ukey = e.ukey;
    el.addEventListener('contextmenu', (ev) => { ev.preventDefault(); selectModDial(e); });
    tr.addEventListener('pointerdown', () => selectModDial(e)); // (the bottom row's MODULATION follows the dial last touched)
  }
  const ticks = tr.querySelectorAll('.tk'), ptr = tr.querySelector(fader ? '.cap' : '.rot'), notch = tr.querySelector('.notch');
  const at = (x) => (fader ? `translate(0 ${faderY(x, e.max).toFixed(2)})` : `rotate(${knobDeg(x, e.max, c)} 32 32)`);
  tr.setAttribute('aria-label', e.label); tr.setAttribute('aria-valuemin', 0); tr.setAttribute('aria-valuemax', e.max);
  tr.title = 'Drag up or down. Hold Shift for fine: tenths of a step';
  const c = e.display.type === 'pm' ? e.display.centre : undefined;
  // the tone's WAVE on a wavetable (TABLE not CLASSIC): POSITION along it, in % (no detents)
  const onTable = () => e.ukey === 'wave' && e.par < NUM_PARAMS && tableNow(SOUNDS[S.sel].engineVoice) > 0;
  const shown = (v) => (onTable() ? Math.round(v / e.max * 100) + '%' : showValue(e, v));
  if (e.display.lr) tr.querySelector('.ring').insertAdjacentHTML('beforeend', LR_SVG);
  const draw = () => {
    const v = valueNow(e.par);
    lightRing(ticks, v, e.max, c);
    ptr.setAttribute('transform', at(v));
    out.textContent = shown(v); if (e.ukey === 'wave') el.querySelector('.lab').textContent = onTable() ? 'position' : e.label;
    tr.setAttribute('aria-valuenow', v); tr.setAttribute('aria-valuetext', shown(v));
    // the notch: editing a key, where the control was before you changed it; editing every key, where the last key
    // played has it
    const lm = lastMorph[S.sel], mv = editing() ? S.keyEdits[S.sel][editKey[S.sel]]?._o?.[e.par] : lm && lm.values.get(e.par);
    tr.classList.toggle('morphed', mv !== undefined && mv !== v);
    if (mv !== undefined) notch.setAttribute('transform', at(mv));
    el.classList.toggle('changed', !editing() && v !== S.defaults[e.par]);
    el.classList.toggle('keyed', editing() && keyEdited(e.par));
    if (mod) {
      const on = modDepths(mod).map((a, s) => (a && s ? s : 0)).filter(Boolean);
      el.classList.toggle('modded', on.length > 0);
      drawModRange(tr, v, e.max, c, mod);
    }
    const locked = S.locks.has(e.par);
    lock.setAttribute('aria-pressed', locked);
    lock.title = locked ? `${e.label.toUpperCase()} is locked: the dice, RANDOM and ALTER leave it as it is, on every key. Click to unlock` : `Lock ${e.label.toUpperCase()}: the dice, RANDOM and ALTER then leave it as it is, on every key`;
  };
  const step = e.display.type === 'detent' ? e.display.step : 0;
  const put = (x, fine) => {
    x = clamp(fine ? Math.round(x * 10) / 10 : Math.round(x), 0, e.max); // (SHIFT held: tenths of a step)
    if (step && !fine && !onTable()) { const k = Math.round(x / step) * step; if (Math.abs(x - k) <= 2) x = Math.min(k, e.max); } // (a morphable switch: its settings catch the knob)
    if (x === valueNow(e.par)) return;
    editValue(e.par, x); draw();

    detail(`${SOUNDS[S.sel].name} ${editing() ? noteName(editKey[S.sel]) + ' ' : 'ALL KEYS '}${e.label.toUpperCase()} <em>${shown(x)}</em>`);
  };
  // (a fader follows the pointer along its slot, and a press on the slot away from the cap jumps there)
  dragger(tr, 'y', { min: 0, max: e.max, len: fader ? 0 : 160, get: () => valueNow(e.par), put, held: (h) => el.classList.toggle('held', h) });
  // double-click: on a key, the control goes back to where it was before you changed it; on every key, back to the
  // kit's value
  const reset = () => {
    if (editing() && keyLocked(S.sel, editKey[S.sel])) { lockedMsg(); return; }
    if (editing()) { const was = S.keyEdits[S.sel][editKey[S.sel]]?._o?.[e.par]; if (was !== undefined) put(was); }
    else put(S.defaults[e.par]);
  };
  el.querySelector('.lab').addEventListener('dblclick', reset); tr.addEventListener('dblclick', reset);
  el.dataset.learn = JSON.stringify({ t: 'par', label: [e.label] });
  tr.addEventListener('focus', () => detail(`${SOUNDS[S.sel].name} ${e.label.toUpperCase()} <em>${shown(valueNow(e.par))}</em>`));
  lock.addEventListener('click', () => {
    const on = !S.locks.has(e.par); if (on) S.locks.add(e.par); else S.locks.delete(e.par); save(); draw(); drawLocks();
    detail(on ? `${SOUNDS[S.sel].name} ${e.label.toUpperCase()} <em>locked</em>: the dice, RANDOM and ALTER leave it as it is, on every ${SOUNDS[S.sel].name.toLowerCase()} key` : `${SOUNDS[S.sel].name} ${e.label.toUpperCase()} <em>unlocked</em>`);
  });
  faderDraws.push(draw);
  if (mod) modDots.push({ tr, el, e, mod, c, fader });
  return el;
}
// ---- a knob's modulation: a right-click on a knob opens its DEPTHS, for the key being edited. Every source is always
// on, each with a depth of its own (0 to start: the knob stays where it's set), either way from the middle: the LFO,
// the key's VELOCITY, the AMP ENV, the PITCH ENV and STEP SEQ, eight levels of the key's own (one each hit, in turn;
// every knob of the key that STEP SEQ moves follows the same steps). A knob that's modulated shows
// the range they swing it over outside the ring, and a dot where they have it now ----
const MOD_NAMES = ['OFF', 'LFO', 'VELOCITY', 'AMP ENV', 'PITCH ENV', 'STEP SEQ'];
const MOD_SAYS = ['', 'Swings it either way of where it is set, at the LFO SPEED, WAVE and SYNC', 'Hits harder than halfway push it up, softer ones down',
  'Follows the amp envelope: the depth at its peak, back as the sound dies away', 'Follows the pitch envelope: the depth at the hit, back as the pitch settles',
  'Each hit takes the next step: the step\'s level times the depth, held until the next hit'];
// a knob's depths now (-1..1 by source, MOD_SOURCES index; 0 unused)
const modDepths = (mod) => mod.depths.map((p, s) => (s ? ((valueNow(p) ?? MOD_AMT_ZERO) - MOD_AMT_ZERO) / 127 : 0));
// how far the sources can move a knob, in its 0..1 range: [down, up] (the LFO and velocity either way, the others one way)
function modSpan(mod) {
  let lo = 0, hi = 0;
  modDepths(mod).forEach((a, s) => { if (!s || !a) return; if (s <= 2) { lo -= Math.abs(a); hi += Math.abs(a); } else if (a < 0) lo += a; else hi += a; });
  return [lo, hi];
}
// the range arc, just outside the ring
function drawModRange(tr, v, max, c, mod) {
  const path = tr.querySelector('.mrange'), [lo, hi] = modSpan(mod);
  if (!lo && !hi) { path.setAttribute('d', ''); return; }
  if (tr.classList.contains('fslide')) { const y0 = faderY(v + hi * max, max), y1 = faderY(v + lo * max, max); path.setAttribute('d', y1 - y0 < 0.5 ? '' : `M38 ${y0.toFixed(2)}V${y1.toFixed(2)}`); return; }
  const at = (x) => KNOB_A0 + knobF(clamp(x, 0, max), max, c) * KNOB_SWEEP, R = 31;
  const a0 = at(v + lo * max), a1 = at(v + hi * max), pt = (a) => `${(32 + R * Math.cos(a)).toFixed(2)} ${(32 + R * Math.sin(a)).toFixed(2)}`;
  path.setAttribute('d', a1 - a0 < 0.02 ? '' : `M${pt(a0)} A${R} ${R} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${pt(a1)}`);
}
// the dots: where the engine has each modulated knob now (the worklet's mods, about 30 times a second)
let modDots = [], modNow = null, stepAt = null;
function modLive(mods, steps) {
  modNow = mods; stepAt = steps;
  const voice = SOUNDS[S.sel].engineVoice, m = new Map(mods[voice] || []);
  modDots = modDots.filter((k) => k.el.isConnected);
  for (const k of modDots) {
    const d = m.get(k.mod.dest), dot = k.tr.querySelector('.mdot');
    k.el.classList.toggle('modlive', d !== undefined);
    if (d === undefined) continue;
    if (k.tog) { dot.setAttribute('cy', valueNow(k.e.par) + d >= 0.5 ? 52 : 12); continue; } // (a switch: the end it's at)
    const v = clamp(valueNow(k.e.par) + d * k.e.max, 0, k.e.max);
    dot.setAttribute('transform', k.fader ? `translate(0 ${faderY(v, k.e.max).toFixed(2)})` : `rotate(${knobDeg(v, k.e.max, k.c)} 32 32)`);
  }
  if (stripSteps) stripSteps(steps ? steps[voice] : -1);
}
// ---- the bottom row: MODULATION, the selected dial's depth from every source (a press or a right-click on a
// modulatable dial selects it), and the key's STEP SEQ: its eight steps, STEP TIME and SLEW. One cell each, on the grid
// (Johnny, 2026-11-19: "bottom row shows sequencer and modulations so we dont need the popup") ----
let modDial = 'cutoff', stripSteps = null;
// a depth: a bar up and down from its middle, in a cell of its own (0..254, MOD_AMT_ZERO none)
function depthBar(o) {
  const el = document.createElement('div'); el.className = 'vd';
  el.innerHTML = '<output></output><div class="dtrack" role="slider"><i></i><b></b></div><span class="lab"></span>';
  el.querySelector('.lab').textContent = o.label; el.title = o.title;
  const tr = el.querySelector('.dtrack'), fill = tr.querySelector('i'), out = el.querySelector('output');
  tr.setAttribute('aria-label', o.label + ' depth'); tr.setAttribute('aria-valuemin', -127); tr.setAttribute('aria-valuemax', 127);
  const draw = () => {
    const v = o.get(), f = v / MOD_AMT_MAX, h = MOD_AMT_ZERO / MOD_AMT_MAX, d = Math.round(v - MOD_AMT_ZERO);
    fill.style.setProperty('--b', (Math.min(f, h) * 100) + '%'); fill.style.setProperty('--t', ((1 - Math.max(f, h)) * 100) + '%');
    out.textContent = d > 0 ? '+' + d : d; tr.setAttribute('aria-valuenow', d); el.classList.toggle('on', d !== 0);
  };
  dragger(tr, 'y', { min: 0, max: MOD_AMT_MAX, get: o.get, put: (x) => { x = clamp(Math.round(x), 0, MOD_AMT_MAX); if (x !== o.get()) { o.set(x); draw(); } } });
  tr.addEventListener('dblclick', () => { if (o.get() !== MOD_AMT_ZERO) { o.set(MOD_AMT_ZERO); draw(); } });
  return { el, draw };
}
// STEP SEQ's shapes: SHAPES in the heading opens them; a press deals the key's eight steps that shape (the random ones
// differently each time). One UNDO takes it back
const STEP_CELLS = 4;
const rnd127 = () => Math.floor(Math.random() * 128);
const STEP_SHAPES = [
  ['random', () => Array.from({ length: 8 }, rnd127)],
  ['ramp up', () => Array.from({ length: 8 }, (_, k) => Math.round(k / 7 * 127))],
  ['ramp down', () => Array.from({ length: 8 }, (_, k) => Math.round((7 - k) / 7 * 127))],
  ['triangle', () => [0, 32, 64, 96, 127, 96, 64, 32]],
  ['alternate', () => { const hi = 90 + Math.floor(Math.random() * 38), lo = Math.floor(Math.random() * 40); return Array.from({ length: 8 }, (_, k) => (k % 2 ? lo : hi)); }],
  ['accents', () => { const v = Array(8).fill(0).map(() => Math.floor(Math.random() * 24)); v[0] = 127; for (let n = 1 + Math.floor(Math.random() * 2); n > 0; n--) v[1 + Math.floor(Math.random() * 7)] = 100 + Math.floor(Math.random() * 28); return v; }],
  ['smooth', () => { let x = rnd127(); return Array.from({ length: 8 }, () => (x = clamp(x + Math.round((Math.random() - 0.5) * 60), 0, 127))); }],
  ['flat', () => Array(8).fill(127)],
];
function stepShapes(h3, voice, deal) {
  const dd = document.createElement('span'); dd.className = 'tdd'; h3.classList.add('withbtn'); h3.append(dd);
  const b = document.createElement('button'); b.type = 'button'; b.className = 'btn sm hdb tbl'; b.textContent = 'SHAPES \u25be'; b.setAttribute('aria-haspopup', 'menu'); b.setAttribute('aria-expanded', 'false');
  const menu = document.createElement('div'); menu.className = 'tblmenu shapemenu'; menu.hidden = true; menu.setAttribute('role', 'menu');
  const open = (on) => { menu.hidden = !on; b.setAttribute('aria-expanded', on); };
  b.addEventListener('click', () => open(menu.hidden));
  for (const [name, make] of STEP_SHAPES) {
    const it = document.createElement('button'); it.type = 'button'; it.className = 'btn sm'; it.textContent = name.toUpperCase(); it.setAttribute('role', 'menuitem');
    it.addEventListener('click', () => { deal(make(), name.toUpperCase()); open(false); });
    menu.append(it);
  }
  const shut = (e) => { if (!dd.isConnected) { document.removeEventListener('pointerdown', shut); return; } if (!menu.hidden && !dd.contains(e.target)) open(false); };
  document.addEventListener('pointerdown', shut);
  dd.append(b, menu);
}
// the row, in the grid's bottom row (cells 1 to GRID_COLS); voice: the engine on screen
function modStrip(box, cell, voice) {
  const schema = VOICE_SCHEMAS[voice];
  const dialE = () => schema.find((e) => e.ukey === modDial) || schema.find((e) => e.ukey === 'cutoff');
  // MODULATION: one cell a source
  const ms = document.createElement('div'); ms.className = 'sect rt modsect'; ms.style.setProperty('--n', NUM_SRC); cell(ms, 4, 5, 1, 1 + NUM_SRC);
  ms.innerHTML = '<h3>modulate <span></span></h3><div class="row"></div>';
  const msRow = ms.querySelector('.row'), msName = ms.querySelector('h3 span'), bars = [];
  for (let s = 1; s <= NUM_SRC; s++) {
    const mod = () => modOf(voice, dialE().ukey);
    const b = depthBar({ label: MOD_SOURCES[s], title: MOD_SAYS[s],
      get: () => valueNow(mod().depths[s]) ?? MOD_AMT_ZERO,
      set: (x) => { editValue(mod().depths[s], x); drawFaders(); const d = Math.round(x - MOD_AMT_ZERO); detail(`${SOUNDS[S.sel].name} ${noteName(editKey[S.sel])} ${dialE().label.toUpperCase()} <em>${MOD_NAMES[s]} ${d > 0 ? '+' : ''}${d}</em>`); } });
    msRow.append(b.el); bars.push(b);
  }
  box.append(ms);
  // STEP SEQ: the eight steps side by side in four cells (paint them: press and drag across), then STEP TIME and SLEW
  // as dials; SHAPES in the heading deals the steps a shape
  const n = STEP_CELLS + 2, sq = document.createElement('div'); sq.className = 'sect rt sep seqsect'; sq.style.setProperty('--n', n); cell(sq, 4, 5, 1 + NUM_SRC, 1 + NUM_SRC + n);
  sq.innerHTML = '<h3>step seq</h3><div class="row"><div class="stepbox" role="group" aria-label="steps: press and drag to paint"></div></div>';
  const sqRow = sq.querySelector('.row'), sbox = sq.querySelector('.stepbox'), steps = [];
  sbox.style.gridColumn = `span ${STEP_CELLS}`;
  const stepGet = (k) => valueNow(stepPar(voice, k)) ?? 0;
  for (let k = 0; k < NUM_STEPS; k++) {
    const el = document.createElement('div'); el.className = 'stepd';
    el.innerHTML = `<output></output><div class="step"><i></i></div><span class="lab">${k + 1}</span>`;
    const b = el.querySelector('.step'), out = el.querySelector('output');
    const drawB = () => { const x = stepGet(k); b.style.setProperty('--f', x / 127); out.textContent = Math.round(x); };
    sbox.append(el); steps.push({ el, bar: b, draw: drawB });
  }
  // painting: the step under the pointer takes the pointer's height; a quick drag fills the steps it skipped
  const putStep = (k, x, stroke) => { x = clamp(Math.round(x), 0, 127); if (x === stepGet(k)) return; editValue(stepPar(voice, k), x, [`${SOUNDS[S.sel].name} ${noteName(editKey[S.sel])} STEPS`, stroke]); steps[k].draw(); };
  let paint = null;
  const at = (e) => { const r0 = steps[0].bar.getBoundingClientRect(), r7 = steps[NUM_STEPS - 1].bar.getBoundingClientRect();
    const k = clamp(Math.floor((e.clientX - r0.left) / ((r7.right - r0.left) / NUM_STEPS)), 0, NUM_STEPS - 1);
    return { k, x: clamp((r0.bottom - e.clientY) / r0.height, 0, 1) * 127 }; };
  const paintTo = (e) => {
    const p = at(e), from = paint.k ?? p.k, x0 = paint.x ?? p.x;
    for (let k = Math.min(from, p.k); k <= Math.max(from, p.k); k++) putStep(k, from === p.k ? p.x : x0 + (p.x - x0) * (k - from) / (p.k - from), paint.stroke);
    paint.k = p.k; paint.x = p.x;
    detail(`${SOUNDS[S.sel].name} ${noteName(editKey[S.sel])} <em>STEP ${p.k + 1} ${Math.round(p.x)}</em>`);
  };
  const endPaint = () => { if (dragEnd === endPaint) dragEnd = null; paint = null; };
  sbox.addEventListener('pointerdown', (e) => {
    if (e.button) return; e.preventDefault();
    try { sbox.setPointerCapture(e.pointerId); } catch (err) { /* gone */ }
    paint = { id: e.pointerId, stroke: 'paint/' + performance.now() }; dragEnd = endPaint; paintTo(e);
  });
  sbox.addEventListener('pointermove', (e) => { if (!paint || e.pointerId !== paint.id) return; if (!stillPressed(e)) { endPaint(); return; } paintTo(e); });
  for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) sbox.addEventListener(ev, endPaint);
  stepShapes(sq.querySelector('h3'), voice, (vals, name) => { const stroke = 'shape/' + performance.now(); vals.forEach((x, k) => putStep(k, x, stroke)); detail(`${SOUNDS[S.sel].name} ${noteName(editKey[S.sel])} <em>STEPS ${name}</em>`); });
  for (const par of [stepTimePar(voice), stepSlewPar(voice)]) {
    const e = schema.find((x) => x.par === par), f = vfader({ ...e, ukey: undefined, display: e.step === 'slew' ? { type: 'slew' } : e.display });
    f.classList.add('seqdial');
    f.querySelector('.lock').remove(); sqRow.append(f);
  }
  box.append(sq);
  if (GRID_COLS > NUM_SRC + n) { const fl = document.createElement('div'); fl.className = 'sect rt sep fill'; cell(fl, 4, 5, 1 + NUM_SRC + n, GRID_COLS + 1); box.append(fl); }
  stripSteps = (at) => steps.forEach((st, k) => st.el.classList.toggle('now', k === at));
  const draw = () => {
    const e = dialE(); msName.textContent = e.label;
    bars.forEach((b) => b.draw()); steps.forEach((st) => st.draw());
    document.querySelectorAll('.faders .vf.modsel').forEach((x) => x.classList.remove('modsel'));
    const sel = [...document.querySelectorAll('.faders .sect .vf')].find((x) => x._ukey === e.ukey); if (sel) sel.classList.add('modsel');
  };
  faderDraws.push(draw);
  stripSteps(stepAt ? stepAt[voice] : -1);
}
function selectModDial(e) { if (modDial === e.ukey) return; modDial = e.ukey; drawFaders(); }

// ---- what the editor edits: the last key (KEY) or every key (ALL KEYS); clearing a key's edits ----
function setEditAll(all) { S.editAll = all; save(); drawEditKey(); drawFaders(); }
function drawEditKey() {
  const note = editKey[S.sel], edits = S.keyEdits[S.sel], n = Object.keys(edits).length;
  const here = editCount(edits[note]), from = edits[note] && edits[note]._kit;
  const locked = keyLocked(S.sel, note), nl = Object.values(edits).filter((e) => e._lock).length;
  $('clear-key').disabled = !here || locked;
  $('lock-key').setAttribute('aria-pressed', locked); $('lock-key').querySelector('span').textContent = locked ? 'LOCKED' : 'LOCK KEY';
  $('key-btn-text').textContent = locked ? 'LOCKED' : 'KEY'; $('key-btn').classList.toggle('locked', locked); // (the KEY menu's button says so)
  $('key-panel-name').textContent = `${SOUNDS[S.sel].name} ${noteName(editKey[S.sel])}`;
  diceBtn.disabled = locked; $('alter-key').disabled = locked; $('paste-key').disabled = locked || !clip;
  // the key header: the key, its engine, and what it plays
  const he = handEdits(edits[note]), hand = he ? ` · ${he} edit${he === 1 ? '' : 's'}` : '';
  const what = locked ? `locked${from && from !== 'kept' ? ' · ' + from : ''}` : from ? (from === 'kept' ? 'its own sound' : from) + hand :
    here ? `its own sound${hand}` : `the ${SOUNDS[S.sel].name.toLowerCase()} base sound`;
  $('kh-note').textContent = noteName(note); $('kh-num').textContent = '#' + note;
  $('kh-engine').textContent = SOUNDS[S.sel].name; $('kh-info').textContent = what; $('kh-info').title = what;
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
// the keys as a piano keyboard (Johnny, 2026-11-19: "have piano keys with the engine as a square bracket kind of thing"):
// white keys side by side, black keys over their gaps; each engine a bracket over its keys, its name (the tab: a
// click shows that engine's knobs) on the bracket. Zones meet where a black key starts or a white key ends
const PIANO_W = 42, PIANO_B = 26; // a white key's width, a black key's
const isBlack = (note) => [1, 3, 6, 8, 10].includes(note % 12);
function buildStrip() {
  const box = $('keystrip'); box.innerHTML = ''; stripKeys.length = 0;
  const on = SOUNDS.map((s, i) => i).filter((i) => engineOn(i));
  SOUNDS.forEach((s, i) => { if (!engineOn(i)) $('sounds').append(soundBtns[i]); }); // (an engine not in use: its button waits, hidden)
  const lo = SOUNDS[on[0]].zone.lo, hi = SOUNDS[on[on.length - 1]].zone.hi, pos = {};
  let wi = 0;
  for (let n = lo; n <= hi; n++) {
    if (isBlack(n)) pos[n] = [wi * PIANO_W - PIANO_B / 2, wi * PIANO_W + PIANO_B / 2];
    else { pos[n] = [wi * PIANO_W, (wi + 1) * PIANO_W]; wi++; }
  }
  const edge = (a, b) => (isBlack(b) ? pos[b][0] : pos[a][1]); // (where note a's zone meets note b's)
  box.style.width = `${wi * PIANO_W}px`;
  const keys = document.createElement('div'); keys.className = 'piano';
  for (const i of on) {
    const s = SOUNDS[i];
    const x0 = s.zone.lo === lo ? pos[lo][0] : edge(s.zone.lo - 1, s.zone.lo), x1 = s.zone.hi === hi ? pos[hi][1] : edge(s.zone.hi, s.zone.hi + 1);
    const g = document.createElement('div'); g.className = 'kgroup';
    Object.assign(g.style, { left: `${x0 + 3}px`, width: `${x1 - x0 - 6}px` });
    g.append(soundBtns[i]); soundBtns[i].classList.toggle('narrow', x1 - x0 < 170);
    box.append(g);
    for (let note = s.zone.lo; note <= s.zone.hi; note++) {
      const k = document.createElement('button'); k.type = 'button'; k.className = 'k' + (isBlack(note) ? ' blk' : '');
      Object.assign(k.style, { left: `${pos[note][0]}px`, width: `${pos[note][1] - pos[note][0]}px` });
      k.title = `${s.name} ${noteName(note)} #${note}`;
      k.innerHTML = '<svg viewBox="0 0 16 18" aria-hidden="true"><path d="M4 8V5a4 4 0 0 1 8 0v3"/><rect x="1.5" y="8" width="13" height="9" rx="1"/></svg>';
      // held down, it plays like a key on the keyboard (an ACTIVE sequence plays until it's let go)
      k.addEventListener('pointerdown', (e) => { k.setPointerCapture(e.pointerId); startAudio().then(() => keyDown(i, note, 100)); });
      const up = () => noteOff(note); k.addEventListener('pointerup', up); k.addEventListener('pointercancel', up);
      keys.append(k); stripKeys.push({ k, sound: i, note });
    }
  }
  box.append(keys);
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
function openMenu(open) { $('menu-panel').hidden = !open; $('menu-btn').setAttribute('aria-expanded', open); if (initArmed) disarmInit(); else drawInit(); if (open) { openPresets(false); openSettings(false); openTools(false); } }
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
  st.setProperty('--shade-rgb', dark ? '0 0 0' : 'var(--ink-rgb)'); st.setProperty('--glow', dark ? 0 : 1); drawWave(null);
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
// LOOK: GREY (the default: a plain grey panel, chicken-head knobs, css/grey.css) or LCD (the screen colours above).
// Kept in this browser, like the colours. Johnny, 2026-11-19: "chicken feet knobs on a plain grey"
const LOOK_STORE = 'lxr-afx-look';
let panel3d = null;
function applyLook(look, keep) {
  document.documentElement.classList.toggle('look-grey', look === 'grey');
  for (const b of $('looks').children) b.setAttribute('aria-pressed', b.dataset.look === look);
  $('lcd-colours').hidden = look === 'grey';
  $('knob-style-row').hidden = look !== 'grey';
  $('lens-set').hidden = look !== 'grey';
  drawWave(null); // (the wave display takes the look's colours)
  // the GREY look's subtle depth: three.js, loaded the first time the look is GREY (app/panel3d.js turns itself off for
  // the LCD look and the phone). Without WebGL the flat drawing simply stays
  if (look === 'grey' && !panel3d) panel3d = import('./panel3d.js?v=mwnt2hql').catch((e) => console.warn('3D panel off:', e.message));
  if (keep) { try { localStorage.setItem(LOOK_STORE, look); } catch (e) { /* not kept */ } }
}
// LENS: the camera on the GREY look's 3D panel (app/panel3d.js reads html data-lens): FLAT (straight down, the default),
// TELE, WIDE or LOW. Kept in this browser. Johnny, 2026-11-19: "give a lens type or something on the camera"
const LENS_STORE = 'lxr-afx-lens', LENS_NAMES = ['flat', 'tele', 'wide', 'low'];
function applyLens(lens, keep) {
  if (!LENS_NAMES.includes(lens)) lens = 'flat';
  document.documentElement.dataset.lens = lens;
  for (const b of $('lenses').children) b.setAttribute('aria-pressed', b.dataset.lens === lens);
  if (keep) { try { localStorage.setItem(LENS_STORE, lens); } catch (e) { /* not kept */ } }
}
for (const b of $('lenses').children) b.addEventListener('click', () => { applyLens(b.dataset.lens, true); detail(`lens: <em>${b.textContent}</em>`); });
{ let l = 'flat'; try { l = localStorage.getItem(LENS_STORE) || 'flat'; } catch (e) { /* FLAT */ } applyLens(l, false); }
for (const b of $('looks').children) b.addEventListener('click', () => { applyLook(b.dataset.look, true); detail(`look: <em>${b.textContent}</em>`); });
applyLook(document.documentElement.classList.contains('look-grey') ? 'grey' : 'lcd', false);
// KNOB SIZE: the slider sets how wide each knob is, scale and all (--kd, in knob cells: css/lcd.css), from XL (the
// left end: what was XL+7, "the smallest the knobs should be") to MAX, nearly filling its cell. Its name and padlock
// move down with it. A transform, so the cells and the grid never move. Kept in this browser. Johnny, 2026-11-19:
// "give me more to the right, you seem scared of giving me big dials"
const KNOB_SIZE_STORE = 'lxr-afx-knob-kd', KNOB_KD = [0.87, 1.45];
const KNOB_SIZE_DEFAULT = 5;
const knobKd = (v) => KNOB_KD[0] + (KNOB_KD[1] - KNOB_KD[0]) * v / 10;
const knobSizeName = (v) => (v <= 0 ? 'XL' : v >= 10 ? 'MAX' : `XL+${v}`);
function applyKnobSize(v, keep) {
  v = Math.round(Math.min(10, Math.max(0, Number.isFinite(+v) ? +v : KNOB_SIZE_DEFAULT)));
  document.documentElement.style.setProperty('--kd', knobKd(v).toFixed(3));
  $('knob-size').value = v; $('knob-size-val').textContent = knobSizeName(v);
  if (keep) { try { localStorage.setItem(KNOB_SIZE_STORE, String(v)); } catch (e) { /* not kept */ } }
}
$('knob-size').addEventListener('input', (e) => { applyKnobSize(e.target.value, true); detail(`knob size: <em>${knobSizeName(+e.target.value)}</em>`); });
{ let v = KNOB_SIZE_DEFAULT; try { const k = localStorage.getItem(KNOB_SIZE_STORE); if (k !== null && k !== '') v = +k; } catch (e) { /* the default */ } applyKnobSize(v, false); }
// KNOB STYLE (the GREY look): CHICKEN head, ROUND, RIBBED or RUBBER, drawn flat (css/grey.css) and in 3D (app/panel3d.js).
// Kept in this browser. Johnny, 2026-11-19: "give me a choice of knobs"
const KNOB_STYLE_STORE = 'lxr-afx-knob-style', KNOB_STYLES = ['chicken', 'round', 'ribbed', 'rubber'], KNOB_STYLE_DEFAULT = 'ribbed'; // (Johnny: "i want these knobs by default")
function applyKnobStyle(style, keep) {
  if (!KNOB_STYLES.includes(style)) style = KNOB_STYLE_DEFAULT;
  for (const k of KNOB_STYLES) document.documentElement.classList.toggle('knob-' + k, k === style && k !== 'chicken');
  for (const b of $('knob-styles').children) b.setAttribute('aria-pressed', b.dataset.style === style);
  if (keep) { try { localStorage.setItem(KNOB_STYLE_STORE, style); } catch (e) { /* not kept */ } }
}
for (const b of $('knob-styles').children) b.addEventListener('click', () => { applyKnobStyle(b.dataset.style, true); detail(`knob style: <em>${b.textContent}</em>`); });
{ let st = KNOB_STYLE_DEFAULT; try { st = localStorage.getItem(KNOB_STYLE_STORE) || KNOB_STYLE_DEFAULT; } catch (e) { /* the default */ } applyKnobStyle(st, false); }
function openSettings(open) { $('settings-panel').hidden = !open; $('settings-btn').setAttribute('aria-expanded', open); if (open) { openMenu(false); openPresets(false); openTools(false); } }
$('settings-btn').addEventListener('click', () => openSettings($('settings-panel').hidden));
$('learn').addEventListener('click', () => { if (learn) openSettings(false); }); // (armed, the menu gets out of the way of the control to click)
document.addEventListener('pointerdown', (e) => {
  if (!$('menu-panel').hidden && !e.target.closest('#menu')) openMenu(false);
  if (!$('preset-panel').hidden && !e.target.closest('#pmenu')) openPresets(false);
  if (!$('settings-panel').hidden && !e.target.closest('#smenu')) openSettings(false);
  if (!$('tools-panel').hidden && !e.target.closest('#tmenu')) openTools(false);
  if (!$('key-panel').hidden && !e.target.closest('#kmenu')) openKeyMenu(false);
  if (!$('make-panel').hidden && !e.target.closest('#mkmenu')) openMake(false);
  if (!e.target.closest('.tdd')) openTableMenu(false);
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { openMenu(false); openPresets(false); openSettings(false); openTools(false); openKeyMenu(false); openMake(false); openTableMenu(false); } });
// THIS KEY's two menus (Johnny, 2026-11-19: "try and put these items into menus"): KEY (ALTER, LOCK, CLEAR, COPY, PASTE;
// their shortcuts still work with the menu shut) and MAKE (the key made a kick, a snare...). A press in either shuts it
function openKeyMenu(open) { $('key-panel').hidden = !open; $('key-btn').setAttribute('aria-expanded', open); if (open) openMake(false); }
function openMake(open) { $('make-panel').hidden = !open; $('make-btn').setAttribute('aria-expanded', open); if (open) openKeyMenu(false); }
$('key-btn').addEventListener('click', () => openKeyMenu($('key-panel').hidden));
$('make-btn').addEventListener('click', () => openMake($('make-panel').hidden));
$('key-panel').addEventListener('click', (e) => { if (e.target.closest('.btn') && !learn) openKeyMenu(false); });

// ---------------------------------------------------------------------------------------------------------------
// randomisers (the logic of Elixir Desktop's, plus locks): every press starts from the voice's home (what it was before
// the first randomise since the last edit), so repeated presses vary one sound instead of drifting. Drum-safe ranges
// unless WILD; a locked control never moves
// ---------------------------------------------------------------------------------------------------------------
let rngState = (Date.now() ^ 0x9e3779b9) >>> 0 || 1;
const rnd = () => { rngState ^= rngState << 13; rngState >>>= 0; rngState ^= rngState >>> 17; rngState ^= rngState << 5; rngState >>>= 0; return rngState / 4294967296; };
// what ALTER moves: not a locked control, a modulation target, the sequencer, LEVEL or a send ('mix'), and not a
// switch or setting the bucket sound brought ('still': waveforms, modes, the LFO, velocity, sample rate) unless WILD
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
    v = clamp(dec2(h + (rnd() * 2 - 1) * depth * (hi - lo)), lo, hi); // (a decimal: the nudge isn't cut to a whole step)
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

// ---- TOOLS: changes made to the whole key set at once ----
function openTools(open) { $('tools-panel').hidden = !open; $('tools-btn').setAttribute('aria-expanded', open); if (open) { openMenu(false); openPresets(false); openSettings(false); } }
$('tools-btn').addEventListener('click', () => openTools($('tools-panel').hidden));
// ALL KEYS TO WAVETABLE: every key on CLASSIC moved onto the BASIC table at the place that plays its wave (sine,
// triangle, saw, square, or the pulse of its PWM: sound/tables.js classicOnBasic), so it sounds as it did. A noise wave
// has no frame and stays on CLASSIC, and so do locked keys, keys already on a table, and an engine whose WAVE or TABLE
// knob is padlocked. The engine's base sound (what a key with no sound of its own plays) moves too. AUTO LEVEL on,
// each moved key is measured and levelled again. UNDO takes it back
function keysToTable(sound, n) {
  const v = SOUNDS[sound].engineVoice, w = ukeyPar(v, 'wave'), pw = ukeyPar(v, 'pwm'), t = tablePar(v), z = SOUNDS[sound].zone;
  if (S.locks.has(w) || S.locks.has(t)) { n.padlock++; return; }
  const moves = [], stay = [];
  for (let note = z.lo; note <= z.hi; note++) {
    const ed = S.keyEdits[sound][note];
    if (ed && ed._lock) { n.locked++; continue; }
    if (!ed) continue; // (plays the base sound, moved below)
    const now = keyPatch(sound, note).vals;
    if (now.get(t) !== 0) { n.table++; continue; }
    const x = classicOnBasic(now.get(w), now.get(pw));
    if (x === null) { n.noise++; stay.push(ed); } else moves.push([note, ed, x]);
  }
  const base = S.values[t] === 0 ? classicOnBasic(S.values[w], S.values[pw]) : null;
  if (base !== null) {
    S.values[w] = base; S.values[t] = BASIC;
    for (const ed of stay) ed[t] ??= 0; // (a key with a noise wave of its own stays on CLASSIC)
  }
  const plain = [];
  for (let note = z.lo; note <= z.hi; note++) if (!S.keyEdits[sound][note]) plain.push(note);
  if (base !== null) n.moved += plain.length; else if (S.values[t] !== 0) n.table += plain.length; else n.noise += plain.length;
  for (const [note, ed, x] of moves) { ed[w] = x; ed[t] = BASIC; levelKey(sound, note); n.moved++; }
}
async function allToTable() {
  const n = { moved: 0, noise: 0, locked: 0, table: 0, padlock: 0 };
  const left = () => [[n.noise, 'with a noise wave'], [n.table, 'on a table already'], [n.locked, 'locked']].filter(([k]) => k).map(([k, why]) => `${k} ${why}`);
  await randChange(() => onSounds().forEach((i) => keysToTable(i, n)), 'all keys to <em>BASIC</em>');
  drawKeymap();
  const rest = left();
  detail(n.moved ? `<em>${n.moved} key${n.moved === 1 ? '' : 's'}</em> moved onto the BASIC wavetable, each playing its wave as before${rest.length ? `; left on CLASSIC or as they were: ${rest.join(', ')}` : ''}${n.padlock ? `; ${n.padlock} engine${n.padlock === 1 ? '' : 's'} skipped (WAVE or TABLE padlocked)` : ''} (UNDO takes it back)`
    : `no key to move: ${rest.join(', ') || 'none on CLASSIC'}${n.padlock ? `, ${n.padlock} engine${n.padlock === 1 ? '' : 's'} padlocked` : ''}`);
  openTools(false);
}
$('to-table').addEventListener('click', () => allToTable());

// ---- AUTO LEVEL: the kits' sounds are of very different loudness, so each sound a randomiser deals or alters is
// played offline and measured (sound/level.js), and its key gets a TRIM: a gain of its own, beside LEVEL, that brings
// it to its engine's target (LEVEL_TARGET_DB: the middle loudness of that engine's bucket sounds). The LEVEL knob and the
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

// ---- scatter: every sound in the bucket (every kit's six voices, and the sounds saved in the SOUND BLENDER), the
// same sound only once, dealt at random one per key across the sound's zone. Each key then plays its sound as it is
// (no morph), kept as that key's edits, so it can still be edited or cleared. The level stays the sound's own; each key
// gets a pan in its range (unless pan is locked). Repeats only if there are fewer sounds than the zone has keys ----
const pools = SOUNDS.map(() => null);
function pool(sound) {
  if (pools[sound]) return pools[sound];
  const def = SOUNDS[sound], v = def.engineVoice, skip = new Set([PAR.VOL1 + v, panPar(v)]), seen = new Set(), out = [];
  for (const snd of bucket()) { // (any engine plays any bucket sound)
    const vals = toVoice(snd, v).filter(([p]) => !skip.has(p));
    const sig = vals.map(([p, x]) => x).join(',');
    if (seen.has(sig)) continue;
    seen.add(sig);
    out.push({ label: labelOf(snd), vals, snd }); // ("NEXUNE drum 3": the type last, as RECIPES look for it)
  }
  return (pools[sound] = out);
}
// a new sound on a key leaves its locked controls as the key plays them now (now: the key's values before), and its
// sends, which are part of the mix, not of the sound
function keepLocked(ed, now) { for (const par of S.locks) if (now.has(par) && now.get(par) !== (ed[par] ?? S.values[par])) ed[par] = now.get(par); }
// ---- BREED (NEW SOUNDS FROM in the RANDOM menu): instead of a bucket sound as it is, two different bucket sounds of the
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
// deals a bucket sound as it is; BREED crosses two (bredSound); MORPH, KIT-STYLE, FREE and RECIPE are sound/makers.js,
// each made from the engine's bucket sounds (pool) and, like BREED, played offline first so a dud is skipped (8 tries) ----
const SOURCES = {
  kit: { name: 'BUCKET', dice: 'new sound', made: 'a new bucket sound', cap: 'A BUCKET SOUND AS IT IS' },
  breed: { name: 'BREED', dice: 'breed', made: 'a new bred sound', cap: 'TWO BUCKET SOUNDS CROSSED, SECTION BY SECTION' },
  morph: { name: 'MORPH', dice: 'morph', made: 'a new morphed sound', cap: 'TWO BUCKET SOUNDS BLENDED, 25 TO 75% OF THE WAY' },
  kitstyle: { name: 'KIT-STYLE', dice: 'kit-style', made: 'a new kit-style sound', cap: 'EVERY KNOB FROM A DIFFERENT BUCKET SOUND' },
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
// the MAKE buttons (the key panel, under the key's buttons): one press makes the key on screen that type of sound, a new one each press. A type needs a kit
// sound of its kind in the engine's pool (until every engine draws from every kit voice, a hat needs the metal)
const MAKE_TYPES = [['kick', 'KICK'], ['tom', 'TOM'], ['mid perc', 'PERC'], ['zap', 'ZAP'], ['snare', 'SNARE'], ['clap', 'CLAP'], ['rim', 'RIM'],
  ['cowbell', 'BELL'], ['closed hat', 'C HAT'], ['open hat', 'O HAT'], ['cymbal', 'CYMBAL']];
function makePanel(el) {
  el.innerHTML = '<div class="mk"></div>';
  const box = el.querySelector('.mk');
  for (const [name, text] of MAKE_TYPES) {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'btn sm'; b.textContent = text; b.dataset.type = name;
    b.addEventListener('click', () => { if (!learn) { openMake(false); randKey(name); } });
    box.append(b);
  }
  const any = document.createElement('button'); any.type = 'button'; any.className = 'btn sm'; any.textContent = 'ANY'; any.dataset.type = '';
  any.addEventListener('click', () => { if (!learn) { openMake(false); const ok = recipesFor(pool(S.sel)); if (ok.length) randKey(ok[Math.floor(rnd() * ok.length)]); } });
  box.append(any);
  faderDraws.push(() => {
    const ok = new Set(recipesFor(pool(S.sel))), locked = keyLocked(S.sel, editKey[S.sel]);
    for (const b of box.children) {
      const can = b.dataset.type ? ok.has(b.dataset.type) : ok.size > 0;
      b.disabled = locked || !can;
      b.title = !can ? `No bucket sound of that kind on this engine yet` : locked ? 'This key is locked' : `Make this key ${b.dataset.type ? 'a ' + b.dataset.type : 'a sound of any type'}: a new one each press (UNDO takes it back)`;
    }
  });
}
const madeText = () => SOURCES[source()].made;
function drawSource() {
  const src = source(), d = SOURCES[src];
  for (const b of document.querySelectorAll('.srcrow .btn')) b.setAttribute('aria-pressed', b.dataset.src === src);
  for (const el of document.querySelectorAll('.dice-src')) el.textContent = d.dice;
  const cap = $('src-cap'); if (cap) cap.textContent = d.cap;
  diceBtn.title = src === 'kit' ? 'NEW SOUND (K): a different bucket sound on this key only. UNDO takes it back; LEARN can put it on a button'
    : `${d.name} (K): a new sound on this key only (${d.cap.toLowerCase()}). UNDO takes it back; LEARN can put it on a button`;
  const sc = $('scatter-cap'); if (sc) sc.innerHTML = src === 'kit' ? 'NEW BUCKET SOUND<br>ON EVERY KEY' : `NEW ${d.name} SOUND<br>ON EVERY KEY`;
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
// NEW SOUND: one key (the last played, or picked on the key map) gets a different bucket sound of its type, as RANDOM
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
// ---- INIT PATCH (the RANDOM menu): a new patch in one press. Every key of all zones gets a fresh bucket sound as
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
  $('init-info').innerHTML = initArmed ? `REPLACES ${nl} LOCKED KEY${nl === 1 ? '' : 'S'}<br>PRESS AGAIN TO GO` : `FRESH BUCKET SOUNDS ON EVERY KEY<br>${INIT_REVERB}% REVERB · ${INIT_ECHO}% ECHO<br>BPM, FX + MASTER RESET`;
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
// can set them first) and only deals a bucket sound to an end with no sound of its own. NEW ENDS makes a kick on the
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
  const stop = ([s, n]) => { const m = keyPatch(s, n), kit = S.values.slice(); for (const [p, x] of m.vals) kit[p] = x;
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
// the splash: a click anywhere on it, or any key, starts (the browser lets a page make sound only after one of those)
async function start() {
  if ($('start').hidden) return;
  $('start').hidden = true;
  await startAudio();
  // on a phone the pads are the keys: it isn't asked for MIDI there (a keyboard still plays if MIDI was allowed before)
  if (!phoneOn) startMidi();
  else if (navigator.permissions) navigator.permissions.query({ name: 'midi' }).then((s) => { if (s.state === 'granted') startMidi(); }).catch(() => {});
}
$('start').addEventListener('click', start);
// (first in line, so the key that starts doesn't also play or press anything)
window.addEventListener('keydown', (e) => {
  if ($('start').hidden || e.metaKey || e.ctrlKey || e.altKey || ['Shift', 'Meta', 'Control', 'Alt', 'Tab'].includes(e.key)) return;
  e.preventDefault(); e.stopImmediatePropagation(); start();
}, true);
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
const FX_MAX = { echo: { time: 127, feedback: 127, tone: 127, pingpong: 1, level: 127, sync: 1, div: ECHO_DIVS.length - 1, duck: 127 },
  reverb: { size: 127, decay: 127, tone: 127, early: 127, level: 127 }, tempo: { bpm: 240, ret: 4 },
  dirt: { on: 1, pregain: 48, cutoff: 127, swap: 1, xover: 1, gain: 127, clip: 1, bass: 24, tone: 127, dirty: 127, clean: 127, sc: 1, src: 3, scfilt: 2, freq: 127, sens: 127, decay: 127, dir: 1, target: 2 },
  master: { thresh: 40, ratio: 200, attack: 100, release: 1000, knee: 24, makeup: 24, level: 100 } };
const cleanName = (s) => String(s ?? '').toUpperCase().replace(/[^A-Z0-9 .+#-]/g, '').replace(/\s+/g, ' ').trim().slice(0, 18);
const cleanLabel = (s) => String(s ?? '').replace(/[<>&\u0000-\u001f]/g, '').slice(0, 48); // (labels are shown as HTML)
const intIn = (x, lo, hi) => clamp(Math.round(Number(x)) || 0, lo, hi);
const numIn = (x, lo, hi) => clamp(Math.round(Number(x) * 100) / 100 || 0, lo, hi); // (a knob's value: a decimal kept to two places)
// a preset from storage or a file, checked and tidied: only what a patch can hold gets in (null: not a preset)
function tidyPreset(p) {
  const d = p && p.data;
  if (!d || !Array.isArray(d.values) || d.values.length < NUM_PARAMS || !Array.isArray(d.keys)) return null;
  const values = [...INIT_VALUES]; d.values.slice(0, ALL_PARAMS).forEach((x, i) => { values[i] = numIn(x, 0, 255); });
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
        else if (f === '_o' && e._o && typeof e._o === 'object') { const h = {}; for (const q in e._o) if (/^\d+$/.test(q) && Number(q) < ALL_PARAMS) h[q] = numIn(e._o[q], 0, 255); if (Object.keys(h).length) o._o = h; }
        else if (/^\d+$/.test(f) && Number(f) < ALL_PARAMS) o[f] = numIn(e[f], 0, 255);
      }
      out[rel] = o;
    }
    return old ? editsToPositions(out) : out;
  });
  if (d.mod !== MOD_RULE && d.mod !== 2) {
    if (d.mod !== 1) upgradeMod(values, keys); // (saved with the firmware's one LFO and one velocity target: now routes on the knobs)
    pairsToDepths(values, keys); // (saved with one source a knob: now a depth from each)
  }
  if (d.mod === 2) stepTimesFromHit(values, keys, d.values.length > stepTimePar(5)); // (saved while STEP TIME had HIT)
  const fx = {};
  for (const k in FX_MAX) { fx[k] = {}; for (const f in FX_MAX[k]) if (d.fx && d.fx[k] && Number.isFinite(Number(d.fx[k][f]))) fx[k][f] = intIn(d.fx[k][f], k === 'tempo' && f === 'bpm' ? 40 : 0, FX_MAX[k][f]); }
  if (fx.echo.duck === undefined) fx.echo.duck = 0; // (saved before the echo had DUCK: off)
  return { id: /^[a-z0-9]{6,24}$/.test(p.id) ? p.id : newId(), name: cleanName(p.name) || 'UNNAMED', t: Number(p.t) || 0, data: { values, keys, fx, pos: POS_RULE, mod: MOD_RULE, engines } };
}
const newId = () => Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36).padStart(4, '0');
let presets = [];
try { const a = JSON.parse(localStorage.getItem(PRESET_STORE)); if (Array.isArray(a)) presets = a.map(tidyPreset).filter(Boolean); } catch (e) { /* none kept, or storage blocked */ }
// the list kept in the browser; false if it couldn't be (storage full or blocked)
function storePresets() { try { localStorage.setItem(PRESET_STORE, JSON.stringify(presets)); return true; } catch (e) { return false; } }
const storeOr = (said) => { if (!storePresets()) said += ' · <em>the browser would not keep it</em> (storage full or blocked): EXPORT writes a file'; detail(said); };
// the patch as a preset keeps it: the keys by their place in the layout
const shiftKeys = (ks, by) => ks.map((k) => Object.fromEntries(Object.entries(k || {}).map(([n, e]) => [Number(n) + by, structuredClone(e)])));
const patchData = () => ({ values: [...S.values], keys: shiftKeys(S.keyEdits, -S.zoneStart), fx: structuredClone(S.fx), pos: POS_RULE, mod: MOD_RULE, engines: S.engines });
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
  if (open) { openMenu(false); openSettings(false); openTools(false); drawPreset(); } else if (delArmed) { clearTimeout(delT); delArmed = null; }
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

// ---------------------------------------------------------------------------------------------------------------
// SOUND BLENDER (B, or BLENDER in the top bar): a popup that makes a new sound from two bucket sounds. Pick A and B
// (the list, the arrows, or the dice), slide BLEND from one to the other (MORPH KEYS' rules: knobs slide, switches
// flip halfway, a part that's off on one side fades in with the other side's settings), ALTER nudges the result by the
// ALTER amount (the RANDOM menu's), PLAY hears it on the engine on screen, PUT ON KEY puts it on the key on screen.
// SAVE keeps it under a made-up name: it joins the bucket at once (RANDOM, the dice and the blender all draw from it)
// and the SAVED list. EXPORT LIST writes the saved sounds to a file; tools/add-to-bucket.mjs adds that file to the
// repo's bucket/, so they stay a source for new sounds everywhere
// ---------------------------------------------------------------------------------------------------------------
const BL = { a: null, b: null, t: 50, alt: new Map(), mods: new Map(), modText: '', name: '' };
const blVoice = () => SOUNDS[S.sel].engineVoice;
const blBucket = () => bucket();
const blFind = (name) => blBucket().find((s) => s.name === name) || null;
const blPick = (not) => { const all = blBucket(); let s; do s = all[Math.floor(rnd() * all.length)]; while (all.length > 1 && s === not); return s; };
// the blend as the engine on screen plays it: a Map of parameter -> value (no LEVEL or pan: those stay the key's)
function blendNow() {
  const v = blVoice(), sc = VOICE_SCHEMAS[v], skip = new Set([PAR.VOL1 + v, panPar(v)]);
  const on = (s) => new Map(toVoice(s, v).filter(([p]) => !skip.has(p)));
  const out = blend({ schema: sc, a: on(BL.a), b: on(BL.b), t: BL.t / 100, base: S.values });
  for (const [p, d] of BL.alt) { const e = sc.find((x) => x.par === p); if (e && out.has(p)) out.set(p, clamp(out.get(p) + d, 0, e.max)); }
  for (const [p, x] of BL.mods) out.set(p, x);
  return out;
}
const blFrom = () => `${BL.a.name} ${100 - BL.t}% + ${BL.b.name} ${BL.t}%${BL.alt.size ? ' altered' : ''}${BL.mods.size ? ' + mods' : ''}`;
// a new A or B starts clean: no ALTER nudges, no RANDOM MODS
const blClean = () => { BL.alt.clear(); BL.mods.clear(); BL.modText = ''; };
// RANDOM MODS: 3 or 4 knobs, picked at random, each get a modulation source (LFO, velocity, amp env or pitch env) and an
// amount either way (20 to 80 of 127). Pressed again, a new set replaces it (the routes A and B came with stay under
// it). An LFO route on a sound whose LFO is too slow to hear gets the LFO sped up
const RAND_MOD_DIALS = ['coarse', 'fine', 'pwm', 'afreq', 'again', 'bfreq', 'bgain', 'ncolour', 'nmix', 'decay', 'aslope', 'pdecay', 'pamt',
  'clickvol', 'clickfreq', 'cutoff', 'reso', 'fdrive', 'rate', 'drive'];
function randomMods() {
  const v = blVoice(); BL.mods.clear();
  const pool = RAND_MOD_DIALS.filter((u) => modOf(v, u)), n = 3 + (rnd() < 0.5 ? 1 : 0), picked = [];
  while (picked.length < n && pool.length) picked.push(pool.splice(Math.floor(rnd() * pool.length), 1)[0]);
  const text = [];
  for (const u of picked) {
    const m = modOf(v, u), src = 1 + Math.floor(rnd() * 4), d = (rnd() < 0.5 ? -1 : 1) * (20 + Math.floor(rnd() * 61));
    for (let s = 1; s <= NUM_SRC; s++) BL.mods.set(m.depths[s], s === src ? MOD_AMT_ZERO + d : MOD_AMT_ZERO);
    text.push(`${VOICE_SCHEMAS[v].find((e) => e.ukey === u)?.label || u} ${MOD_SOURCES[src]} ${d > 0 ? '+' : ''}${d}`);
  }
  const f = ukeyPar(v, 'lfofreq');
  if ([...BL.mods].some(([p, x]) => x !== MOD_AMT_ZERO && routeOf(p)?.src === 1) && f !== undefined && blendNow().get(f) < 50) BL.mods.set(f, 50 + Math.floor(rnd() * 56));
  BL.modText = text.join(' · ');
}
// the key on screen's patch with the blend over it, levelled to its engine as AUTO LEVEL would
function blPatch(vals) {
  const sound = S.sel, v = blVoice(), m = keyPatch(sound, editKey[sound]).vals;
  for (const [p, x] of vals) m.set(p, x);
  m.set(trimPar(v), autoTrim(sound, S.values, m, BASE_NOTE));
  return m;
}
async function blPlay(vals = blendNow()) {
  await startAudio();
  send({ type: 'play', sound: S.sel, note: BASE_NOTE, vel: 100, params: [...blPatch(vals)], hold: false });
}
// one bucket sound on its own, on the engine on screen
const blPlayOne = (s) => blPlay(new Map(toVoice(s, blVoice()).filter(([p]) => p !== PAR.VOL1 + blVoice() && p !== panPar(blVoice()))));

// A and B: a list of every bucket sound (by type, the saved ones last), arrows, the dice and PLAY
const blSides = {};
for (const side of ['a', 'b']) {
  const box = $(`bl-${side}`);
  box.innerHTML = `<b class="bl-tag">${side.toUpperCase()}</b><select aria-label="Sound ${side.toUpperCase()}"></select>
    <button class="btn sm" data-go="-1" title="The sound before in the list">◀</button><button class="btn sm" data-go="1" title="The next sound in the list">▶</button>
    <button class="btn sm" data-go="dice" title="Any sound from the bucket">DICE</button><button class="btn sm" data-go="play" title="Hear ${side.toUpperCase()} on its own">PLAY</button>`;
  const sel = box.querySelector('select');
  blSides[side] = sel;
  sel.addEventListener('change', () => { BL[side] = blFind(sel.value); blClean(); drawBlender(); blPlay(); });
  box.addEventListener('click', (e) => {
    const go = e.target.closest('[data-go]')?.dataset.go; if (!go) return;
    if (go === 'play') { blPlayOne(BL[side]); return; }
    const all = blBucket();
    if (go === 'dice') BL[side] = blPick(BL[side === 'a' ? 'b' : 'a']);
    else { const i = all.indexOf(BL[side]); BL[side] = all[(i + Number(go) + all.length) % all.length]; }
    blClean(); drawBlender(); blPlay();
  });
}
function fillSides() {
  const all = blBucket(), groups = new Map();
  for (const s of all) { const g = inRepo.has(s.name) ? s.type : 'saved here'; if (!groups.has(g)) groups.set(g, []); groups.get(g).push(s); }
  const html = [...groups].map(([g, list]) => `<optgroup label="${g.toUpperCase()}">${list.map((s) => `<option value="${s.name}">${s.name}</option>`).join('')}</optgroup>`).join('');
  for (const side of ['a', 'b']) blSides[side].innerHTML = html;
}
const blDrawBar = hbar($('bl-bars'), 'BLEND', { min: 0, max: 100, get: () => BL.t, set: (v) => { BL.t = v; drawBlendNames(); }, show: (v) => `${v}%`, dflt: 50,
  held: (down) => { if (!down) blPlay(); } });
function drawBlendNames() { $('bl-an').textContent = `A ${BL.a.name} ${100 - BL.t}%`; $('bl-bn').textContent = `${BL.t}% B ${BL.b.name}`; }
function drawBlender() {
  if (!BL.a || !blFind(BL.a.name)) BL.a = blPick();
  if (!BL.b || !blFind(BL.b.name)) BL.b = blPick(BL.a);
  blSides.a.value = BL.a.name; blSides.b.value = BL.b.name;
  blDrawBar(); drawBlendNames();
  $('bl-eng').textContent = `${phoneOn ? '' : `PLAYS ON ${SOUNDS[S.sel].name} ${noteName(editKey[S.sel])} · `}${blBucket().length} SOUNDS IN THE BUCKET`;
  $('bl-alter').title = `Nudge the blend by the ALTER amount (${S.rand.alter}%${S.rand.wild ? ', WILD' : ''}, set in the RANDOM menu); press again to go further. A new A or B starts clean`;
  $('bl-modtext').textContent = $('bl-modtext').title = BL.modText ? `MODS: ${BL.modText}` : 'MODS: AS A AND B HAVE THEM';
  if (!BL.name) BL.name = blNewName();
  $('bl-name').value = BL.name;
  drawSaved();
}
function blNewName() { const taken = new Set(blBucket().map((s) => s.name)); let n; do n = jumble(Math.random, 5, 8).toUpperCase(); while (taken.has(n)); return n; }
function openBlender(open) {
  if (!open && phoneOn) return; // (on a phone the blender is the whole screen)
  $('blender').hidden = !open; $('blend-btn').setAttribute('aria-pressed', open);
  if (open) { openMenu(false); openPresets(false); openSettings(false); openTools(false); fillSides(); drawBlender(); }
}
$('blend-btn').addEventListener('click', () => openBlender($('blender').hidden));
$('bl-close').addEventListener('click', () => openBlender(false));
$('blender').addEventListener('pointerdown', (e) => { if (e.target === $('blender')) openBlender(false); });
document.addEventListener('keydown', (e) => {
  if ($('blender').hidden) { if ((e.key === 'b' || e.key === 'B') && !e.metaKey && !e.ctrlKey && !e.altKey && !e.target.closest('input, select, textarea')) openBlender(true); return; }
  if (e.key === 'Escape') openBlender(false);
});
$('bl-play').addEventListener('click', () => blPlay());
$('bl-pair').addEventListener('click', () => { BL.a = blPick(); BL.b = blPick(BL.a); blClean(); drawBlender(); blPlay(); });
$('bl-mods').addEventListener('click', () => { randomMods(); drawBlender(); blPlay(); });
// ALTER: every control ALTER may move, nudged around the blend as it is now; the nudges stay as the slider moves
$('bl-alter').addEventListener('click', () => {
  const v = blVoice(), now = blendNow(), base = (() => { const k = new Map(BL.alt); BL.alt.clear(); const b = blendNow(); BL.alt = k; return b; })();
  for (const e of kindSchema(v, now.get(kindPar(v)))) {
    if (!alters(e) || !now.has(e.par) || e.ukey === 'pan') continue;
    const x = vary(e, now.get(e.par), alterDepth(), S.rand.wild);
    if (x !== base.get(e.par)) BL.alt.set(e.par, x - base.get(e.par)); else BL.alt.delete(e.par);
  }
  drawBlender(); blPlay();
});
// PUT ON KEY: the blend on the key on screen (UNDO takes it back)
$('bl-key').addEventListener('click', () => {
  const sound = S.sel, note = editKey[sound], v = blVoice();
  if (keyLocked(sound, note)) { lockedMsg(); return; }
  const vals = blendNow(), label = blFrom();
  randChange(() => {
    const now = keyPatch(sound, note).vals, ed = { _kit: label, ...Object.fromEntries(vals) };
    ed[panPar(v)] = randPan(v); keepSends(ed, now, v); keepLocked(ed, now);
    S.keyEdits[sound][note] = ed; levelKey(sound, note, true);
  }, `${SOUNDS[sound].name} ${noteName(note)}: <em>${label}</em> (UNDO takes it back)`).then(() => { drawKeymap(); play(sound, note, 100); });
});
// SAVE: into the bucket (this browser) and the SAVED list
const blStore = () => { try { localStorage.setItem(BLEND_STORE, JSON.stringify(savedSounds)); } catch (e) { /* not kept */ } };
const blSig = (s) => `${s.voice}|${JSON.stringify(s.params)}`;
$('bl-roll').addEventListener('click', () => { BL.name = blNewName(); $('bl-name').value = BL.name; });
$('bl-name').addEventListener('input', () => { BL.name = $('bl-name').value.toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 12); });
$('bl-save').addEventListener('click', () => {
  const name = (BL.name || '').trim() || blNewName();
  if (blFind(name)) { detail(`<em>${name}</em> is in the bucket already: NEW NAME gives another`); return; }
  const s = fromVoice(blendNow(), blVoice(), { name, type: (BL.t < 50 ? BL.a : BL.b).type });
  const same = blBucket().find((x) => blSig(x) === blSig(s));
  if (same) { detail(`this sound is in the bucket already, as <em>${same.name}</em>`); return; }
  savedSounds.push(s); blStore(); pools.fill(null);
  BL.name = blNewName(); fillSides(); drawBlender();
  detail(`<em>${name}</em> saved: it's in the bucket now, and in the SAVED list for EXPORT`);
});
function drawSaved() {
  const n = savedSounds.length, fresh = savedSounds.filter((s) => !inRepo.has(s.name)).length;
  $('bl-count').textContent = n ? `${n} · ${fresh} NOT IN THE REPO YET` : 'NONE YET';
  $('bl-list').innerHTML = savedSounds.map((s, i) => `<div class="blitem"><button class="blload" data-i="${i}" title="Play it">${s.name} <span class="dim">${s.type}${inRepo.has(s.name) ? ' · IN REPO' : ''}</span></button>
    <button data-ab="a" data-i="${i}" title="Make it sound A">A</button><button data-ab="b" data-i="${i}" title="Make it sound B">B</button>
    <button data-del="${i}" title="Take it out of the list (press twice)">X</button></div>`).reverse().join('');
  // (EXPORT and COPY stay pressable with nothing saved: they say so)
}
$('bl-list').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  const s = savedSounds[Number(b.dataset.i ?? b.dataset.del)]; if (!s) return;
  if (b.dataset.del !== undefined) {
    if (b.textContent !== 'SURE?') { b.textContent = 'SURE?'; return; }
    savedSounds = savedSounds.filter((x) => x !== s); blStore(); pools.fill(null); fillSides(); drawBlender();
    detail(`<em>${s.name}</em> taken out of the saved list`); return;
  }
  if (b.dataset.ab) { BL[b.dataset.ab] = blFind(s.name) || s; blClean(); drawBlender(); blPlay(); return; }
  blPlayOne(s);
});
// EXPORT LIST: the saved sounds, as a file to hand over (tools/add-to-bucket.mjs adds it to bucket/)
// EXPORT LIST: the saved sounds as a file. On a phone the share sheet (save it to Files or Drive, AirDrop it, mail it,
// send it in a chat), as a .txt (Android's Chrome shares only a few kinds of file, and JSON isn't one of them; the
// add-to-bucket tool reads it all the same); if the phone can't share it, a download. COPY LIST puts the same text on
// the clipboard, to paste into a message. Each says what happened, a failure too
const blText = () => JSON.stringify({ app: 'lxr-afx', kind: 'sounds', version: 1, sounds: savedSounds }, null, 1);
const blCount = () => `<em>${savedSounds.length}</em> sound${savedSounds.length === 1 ? '' : 's'}`;
function blDownload(text, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'application/octet-stream' }));
  a.download = name;
  document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 60000);
  detail(`downloaded ${blCount()} as ${name}: hand it over to add them to the bucket (nothing came? COPY LIST and paste it into a message)`);
}
$('bl-export').addEventListener('click', async () => {
  if (!savedSounds.length) { detail('nothing saved yet: SAVE a sound first'); return; }
  const text = blText(), day = new Date().toISOString().slice(0, 10);
  if (phoneOn && navigator.share && typeof File === 'function') {
    const file = new File([text], `lxr-afx-new-sounds-${day}.txt`, { type: 'text/plain' });
    if (!navigator.canShare || navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: 'LXR-AFX new sounds' }); detail(`shared ${blCount()} as ${file.name}: hand it over to add them to the bucket`); return; }
      catch (e) { if (e && e.name === 'AbortError') { detail('not shared (cancelled)'); return; } } // (any other failure: a download instead)
    }
  }
  blDownload(text, `lxr-afx-new-sounds-${day}.json`);
});
// CLEAR LIST: the SAVED list emptied once it's handed over (press twice), so the next export holds only new sounds.
// The sounds already in the repo's bucket stay in the bucket; the others leave this browser's bucket with the list
$('bl-clear').addEventListener('click', () => {
  const b = $('bl-clear');
  if (!savedSounds.length) { detail('the SAVED list is empty already'); return; }
  if (b.textContent !== 'SURE?') { b.textContent = 'SURE?'; b.setAttribute('aria-pressed', 'true'); setTimeout(() => { b.textContent = 'CLEAR LIST'; b.setAttribute('aria-pressed', 'false'); }, 4000); return; }
  const n = savedSounds.length, out = savedSounds.filter((s) => !inRepo.has(s.name)).length;
  savedSounds = []; blStore(); pools.fill(null); b.textContent = 'CLEAR LIST'; b.setAttribute('aria-pressed', 'false'); fillSides(); drawBlender();
  detail(`SAVED list cleared (${n} sound${n === 1 ? '' : 's'})${out ? `: ${out} not in the repo's bucket yet left with it` : ''}`);
});
$('bl-copy').addEventListener('click', async () => {
  if (!savedSounds.length) { detail('nothing saved yet: SAVE a sound first'); return; }
  const text = blText();
  try { await navigator.clipboard.writeText(text); }
  catch (e) { // (no clipboard access: the old way, through a hidden text box)
    const t = document.createElement('textarea'); t.value = text; t.setAttribute('readonly', ''); t.style.position = 'fixed'; t.style.opacity = '0';
    document.body.append(t); t.select(); t.setSelectionRange(0, text.length);
    const ok = document.execCommand && document.execCommand('copy'); t.remove();
    if (!ok) { detail('the phone wouldn\'t let me copy: try EXPORT LIST'); return; }
  }
  detail(`copied ${blCount()}: paste it into a message to hand them over`);
});
// what the status line says, said in the blender too (on a phone, where the status line isn't shown)
new MutationObserver(() => { $('bl-msg').innerHTML = $('detail').innerHTML; }).observe($('detail'), { childList: true, characterData: true, subtree: true });
window.afx.blender = { open: openBlender, state: BL, now: blendNow, saved: () => savedSounds, bucket: blBucket };

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
// Every key that changes engine starts with a new bucket sound of its engine; keys that stay keep theirs (UNDO takes it back)
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
  // a key that left an engine's zone leaves its sound behind (UNDO brings it back), and a key new to one gets a bucket sound
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
  const end = () => { on = false; if (dragEnd === end) dragEnd = null; };
  track.addEventListener('pointerdown', (e) => { e.preventDefault(); try { track.setPointerCapture(e.pointerId); } catch (err) { /* gone */ } on = true; dragEnd = end; put(at(e)); });
  track.addEventListener('pointermove', (e) => { if (on && !stillPressed(e)) end(); if (on) put(at(e)); });
  for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) track.addEventListener(ev, end);
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
    $('pv-rand-eng').textContent = `RANDOM: ${SOUNDS[S.sel].name} KEYS`; $('pv-rand-eng-cap').textContent = `A NEW BUCKET SOUND ON EACH OF THE ${keys}`;
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
  // a phone only makes sounds for the bucket (Johnny, 2026-11-18): the blender is its whole screen
  if (on) openBlender(true); else openBlender(false);
  drawPhone();
}

// ---------------------------------------------------------------------------------------------------------------
// fit the screen to the window: the big screen is a fixed 16:8 panel, 1780 x 890 (Johnny, 2026-11-19: "make proportion
// 16:8"), laid out at that size always and scaled to fit the window, up or down, and centred; the dark surround fills
// what's left, so it never reflows and nothing scrolls. (index.html does the same before the first paint)
// ---------------------------------------------------------------------------------------------------------------
const FIT_W = 1780, FIT_H = 890;
function fitScreen() {
  const st = $('stage'), s = Math.min((innerWidth - 16) / FIT_W, (innerHeight - 16) / FIT_H);
  setPhone();
  if (phoneOn) { st.removeAttribute('style'); drawKeymap(); return; } // (the phone view lays itself out)
  Object.assign(st.style, { left: `${(innerWidth - FIT_W * s) / 2}px`, top: `${(innerHeight - FIT_H * s) / 2}px`, transform: `scale(${s})` });
  drawKeymap();
}
window.addEventListener('resize', fitScreen);
fitScreen();
window.afxReady = true; // index.html's load check
