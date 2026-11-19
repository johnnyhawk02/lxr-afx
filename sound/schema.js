// The seven sounds and the parameter schema of each, built from the firmware's front-panel data.
// Data only: no audio, no DOM. The editor, the randomisers and the key morph are all generated from it.
//
// A parameter entry:
//   key      the firmware's parameter name (PAR key), e.g. 'FILTER_FREQ_1'
//   par      its parameter number (index into a kit's values)
//   label    short name for the editor
//   page     editor page: 'tone' | 'shape' | 'filter' | 'mod' | 'mix'
//   section  the firmware menu section it comes from
//   min,max  integer range (min is always 0)
//   def      default value (the firmware's init kit)
//   display  { type: 'num' } | { type: 'pm', centre, lr? } (shown signed around centre, or as L/C/R for a pan; its knob
//            has the centre at the top) | { type: 'menu', names }
//            | { type: 'target', voices } (a modulation target menu)
//            | { type: 'detent', names, step } (a morphable switch: a knob with names[k] at k * step, blends between)
//   morph    how the key morph treats it: 'timbre' (moved around the base), or null (never morphed)
//   weight   timbre morph: how far it may move, as a fraction of its rand range at full depth
//   rand     drum-safe randomiser range: [lo, hi], 'pitch' (semitones around the base), 'still' (a switch or a setting
//            the kit sound brings: ALTER leaves it alone unless WILD) or 'mix' (LEVEL and the sends: part of the mix,
//            not of the sound, so ALTER never moves them)
import { PAR, INIT_KIT } from '../engine/lxr-tables.js';
import { PARAM_DTYPES, VOICE_PAGES, MOD_TARGETS, MOD_TARGET_VOICE_RANGES } from '../engine/lxr-ui-data.js';
import { LFO_SYNC_NAMES, MOD_SOURCES, EXTRA_DEST, EXTRAS, EX, VOICE_KINDS, KINDS, extraDefaults, kitToPositions, WAVE_STEP, WAVE_MAX, WAVE_DETENT_NAMES,
  FILTER_STEP, FILTER_MAX, FILTER_DETENT_NAMES, MODE_MAX, wavePos, modePos } from '../engine/lxr.js?v=mwmugadb';
import { toneKnob, lenKnob } from '../engine/click.js?v=mwmugadb';
import { CLICK_MAP } from './click-map.js?v=mwmugadb';
import { TABLE_NAMES, classicPlace } from './tables.js?v=mwmugadb';

export { PAR, MOD_TARGETS, MOD_TARGET_VOICE_RANGES };
export const NUM_PARAMS = PAR.END_OF_SOUND_PARAMETERS;

// AFX mode: up to six engines, each a monophonic merged voice on its own zone of the keyboard (MIDI channel 1), no
// overlap, all able to sound at once. ENGINES (1 to 6, setEngines) splits the 25 keys of a Bass Station 2 at its
// default octave into that many even zones, side by side from the lowest key (any keys left over go one each to the
// last zones: three engines are 8, 8 and 9 keys); each zone's base key is its middle key. The lowest key can be moved
// by octaves on the page (setZoneStart). An engine not in use has no keys (lo > hi)
export const NUM_KEYS = 25, MAX_ENGINES = 6, DEFAULT_ENGINES = 3;
export const DEFAULT_ZONE_START = 48; // the Bass Station 2's lowest key at its default octave (C2 with C3 = MIDI 60)
export const zoneSizes = (n) => Array.from({ length: n }, (_, i) => Math.floor(NUM_KEYS / n) + (i >= n - NUM_KEYS % n ? 1 : 0));
export let ZONE_SIZES = zoneSizes(DEFAULT_ENGINES);
let zoneStart = DEFAULT_ZONE_START;
function zonesFrom(start) {
  let lo = start;
  const z = ZONE_SIZES.map((n) => { const z = { lo, hi: lo + n - 1, base: lo + Math.floor(n / 2) }; lo += n; return z; });
  while (z.length < MAX_ENGINES) z.push({ lo: start + NUM_KEYS, hi: start + NUM_KEYS - 1, base: start }); // (not in use)
  return z;
}
// engineVoice: which of the engine's six voice instances makes it; trigger: the note-on index; sources: the kit voices
// the randomiser draws from; level: its AUTO LEVEL target's type (sound/level.js LEVEL_TARGET_DB). The first three are
// the drum, snare and metal they always were (saved keys hold their voices' parameters); then a second of each
export const SOUNDS = [
  { id: 'drum', name: 'ENGINE 1', engineVoice: 0, trigger: 0, sources: [0, 1, 2], type: 0 },
  { id: 'snare', name: 'ENGINE 2', engineVoice: 3, trigger: 3, sources: [3], type: 1 },
  { id: 'metal', name: 'ENGINE 3', engineVoice: 4, trigger: 4, sources: [4, 5], type: 2 },
  { id: 'drum2', name: 'ENGINE 4', engineVoice: 1, trigger: 1, sources: [0, 1, 2], type: 0 },
  { id: 'snare2', name: 'ENGINE 5', engineVoice: 2, trigger: 2, sources: [3], type: 1 },
  { id: 'metal2', name: 'ENGINE 6', engineVoice: 5, trigger: 5, sources: [4, 5], type: 2 },
];
zonesFrom(DEFAULT_ZONE_START).forEach((z, i) => { SOUNDS[i].zone = z; });
// move every zone so the lowest starts on start (a MIDI note)
export function setZoneStart(start) { zoneStart = start; zonesFrom(start).forEach((z, i) => Object.assign(SOUNDS[i].zone, z)); }
// how many engines are in use (1 to 6): the keys split again between them
export let ENGINES = DEFAULT_ENGINES;
export function setEngines(n) { ENGINES = Math.max(1, Math.min(MAX_ENGINES, n | 0)); ZONE_SIZES = zoneSizes(ENGINES); setZoneStart(zoneStart); }
export const engineOn = (sound) => sound < ENGINES;
// the sound whose zone holds a note, or -1
export const soundOfNote = (note) => SOUNDS.findIndex((s) => note >= s.zone.lo && note <= s.zone.hi);

// the firmware's init kit as parameter values
// after the firmware's parameters, three of LXR-AFX's own per voice: its sends to the echo, the reverb and the distortion
// (not engine parameters: the instrument keeps them, see instrument.js). A key keeps them like any other parameter
// (three slots per voice; the third, a distortion send, was dropped: its slot stays so saved kits still line up)
export const SEND_BASE = NUM_PARAMS, SEND_FX = ['echo', 'reverb'];
export const sendPar = (voice, k) => SEND_BASE + voice * 3 + k;
// after the sends, six slots that held the dropped note repeat (kept empty so saved kits still line up), then each
// voice's 8-step sequencer: ACTIVE (0, 1) and its pattern (a bit a step, bit 0 = step 1), played in 1/16s while the key
// is held
export const REPEAT_BASE = NUM_PARAMS + 18;
export const SEQ_ON_BASE = NUM_PARAMS + 24, SEQ_PAT_BASE = NUM_PARAMS + 30;
export const seqOnPar = (voice) => SEQ_ON_BASE + voice, seqPatPar = (voice) => SEQ_PAT_BASE + voice;
// then each voice's TRIM: AUTO LEVEL's correction of a key's loudness (sound/level.js), a gain of its own beside the
// LEVEL knob: quarter-dB steps around TRIM_ZERO (no correction), so 0..127 is -16 .. +15.75 dB
export const TRIM_BASE = NUM_PARAMS + 36, TRIM_ZERO = 64, TRIM_STEP_DB = 0.25;
export const trimPar = (voice) => TRIM_BASE + voice;
export const trimDb = (v) => (v - TRIM_ZERO) * TRIM_STEP_DB;
// then each voice's extras (engine/lxr.js EXTRAS, setExtra): the merged voice's controls that its firmware voice has no
// parameter for, and its kind. A voice uses only the ones its firmware voice lacks (extraLive)
export const EXTRA_BASE = NUM_PARAMS + 42, NUM_EXTRAS = EXTRAS.length;
export const extraPar = (voice, k) => EXTRA_BASE + voice * NUM_EXTRAS + k;
// then each voice's modulation: for every control that can be modulated (MOD_DIALS, by merged name) its source
// (MOD_SOURCES: 0 off, 1 the voice's LFO, 2 velocity, 3 the amp envelope, 4 the pitch envelope) and its amount (0..254,
// MOD_AMT_ZERO none: -127 .. +127, a firmware amount a is MOD_AMT_ZERO + a). Right-click a knob to set them
export { MOD_SOURCES };
export const MOD_DIALS = ['coarse', 'fine', 'wave', 'pwm', 'afreq', 'again', 'awave', 'amode', 'fmenv', 'bfreq', 'bgain', 'bwave',
  'ncolour', 'nmix', 'attack', 'decay', 'repeat', 'aslope', 'pdecay', 'pslope', 'pamt', 'click', 'clickvol', 'clickfreq',
  'cutoff', 'reso', 'ftype', 'fdrive', 'velvol', 'lfofreq', 'lfosync', 'lfowave', 'lforetrig', 'lfooffset', 'level', 'pan',
  'rate', 'drive'];
export const NUM_MOD = MOD_DIALS.length, MOD_BASE = EXTRA_BASE + 6 * NUM_EXTRAS, MOD_AMT_ZERO = 127, MOD_AMT_MAX = 254;
export const modSrcPar = (voice, i) => MOD_BASE + (voice * NUM_MOD + i) * 2;
export const modAmtPar = (voice, i) => modSrcPar(voice, i) + 1;
// then each voice's TABLE: the wavetable its tone plays (sound/tables.js: 0 CLASSIC, the firmware's waves). Last, so
// every parameter number before it stays as it was (a store or preset saved before it plays CLASSIC)
export const TABLE_BASE = MOD_BASE + 6 * NUM_MOD * 2;
// then MOD A's and MOD B's wavetables (2 a voice, after the tone's 6, so older saves still line up). which: 0 the tone,
// 1 MOD A, 2 MOD B
export const MODTABLE_BASE = TABLE_BASE + 6;
export const tablePar = (voice, which = 0) => (which ? MODTABLE_BASE + voice * 2 + which - 1 : TABLE_BASE + voice);
// then the click's LENGTH and DIRECT (2 a voice: engine/click.js; its SHAPE, LEVEL and TONE are the firmware's click
// wave, volume and freq parameters, given new meanings on 2026-11-19). k: 0 LENGTH, 1 DIRECT
export const CLICK_BASE = MODTABLE_BASE + 12;
export const clickPar = (voice, k) => CLICK_BASE + voice * 2 + k;
export const ALL_PARAMS = CLICK_BASE + 12;
// a knob's value kept to two decimal places (100 steps between whole numbers: finer than anyone hears, and files stay short)
export const dec2 = (x) => Math.round(x * 100) / 100;
export const INIT_VALUES = new Float64Array(ALL_PARAMS); // (a knob's value may be a decimal)
for (let v = 0; v < 6; v++) for (let i = 0; i < NUM_MOD; i++) INIT_VALUES[modAmtPar(v, i)] = MOD_AMT_ZERO;
{ const k = new Uint8Array(NUM_PARAMS); for (let i = 8; i < NUM_PARAMS; i++) k[i - 8] = INIT_KIT[i]; INIT_VALUES.set(kitToPositions(k)); }
for (let v = 0; v < 6; v++) INIT_VALUES.set(extraDefaults(VOICE_KINDS[v]), extraPar(v, 0));
for (let v = 0; v < 6; v++) INIT_VALUES[seqPatPar(v)] = 0b00010001; // steps 1 and 5, ready for ACTIVE
for (let v = 0; v < 6; v++) INIT_VALUES[trimPar(v)] = TRIM_ZERO;
// (INIT_VALUES' own LFO and velocity targets become routes once the schemas are made: see the end of this file)

const TRANSIENT_NAMES = ['snap', 'offset', 'click', 'click 2', 'tick', 'kick', 'rim', 'drop', 'hat', 'clap', 'kick 2', 'snare',
  'tom', 'snap 2']; // (the firmware's click samples: the click is engine/click.js's now)
// the morphable switches' dials (engine/lxr.js WAVE_STEP)
const WAVE_DIAL = { names: WAVE_DETENT_NAMES, step: WAVE_STEP, max: WAVE_MAX };
const FILTER_DIAL = { names: FILTER_DETENT_NAMES, step: FILTER_STEP, max: FILTER_MAX };
const MODE_DIAL = { names: ['fm', 'mix'], step: MODE_MAX, max: MODE_MAX };
const LFO_WAVES = ['sin', 'tri', 'saw up', 'saw dn', 'square', 'random', 'exp up', 'exp dn'];
const AROUND_60 = new Set(['COARSE1', 'COARSE2', 'COARSE3', 'COARSE4', 'COARSE5', 'COARSE6', 'FM_FREQ1', 'FM_FREQ2', 'FM_FREQ3',
  'MOD_OSC_F1_CYM', 'MOD_OSC_F2_CYM', 'MOD_OSC_F1', 'MOD_OSC_F2']);

// range and display of a parameter, from the firmware's parameter_dtypes table
function displayOf(key) {
  const t = PARAM_DTYPES[PAR[key]] || '0B127';
  const menu = (names) => ({ max: names.length - 1, display: { type: 'menu', names } });
  const dial = (d) => ({ max: d.max, display: { type: 'detent', names: d.names, step: d.step } });
  switch (t) {
    case 'PM63': return { max: 127, display: { type: 'pm', centre: AROUND_60.has(key) ? 60 : 63, ...(key.startsWith('PAN') ? { lr: true } : {}) } };
    case 'ON_OFF': case '0b1': return menu(['off', 'on']);
    case 'menu:WAVEFORM': return dial(WAVE_DIAL);
    case 'menu:FILTER': return dial(FILTER_DIAL);
    case 'menu:TRANS': return menu(TRANSIENT_NAMES);
    case 'menu:LFO_WAVES': return menu(LFO_WAVES);
    case 'menu:SYNC_RATES': return menu(LFO_SYNC_NAMES.map((s) => s.toLowerCase()));
    case 'menu:RETRIGGER': return menu(['off', 'v1', 'v2', 'v3', 'v4', 'v5', 'v6']);
    case 'menu:MIX_FM': return dial(MODE_DIAL);
    case 'TARGET_SELECTION_VELO': case 'TARGET_SELECTION_LFO': return { max: MOD_TARGETS.length - 1, display: { type: 'target' } };
    default: return { max: 127, display: { type: 'num' } };
  }
}

// the randomiser's drum-safe ranges (elixir-desktop app/randomise.js), by front-panel name
const SAFE = {
  WAVEFORM: 'still', PWM: 'still', REPEAT: 'still', MODE: 'still', FILTER_TYPE: 'still', SAMPLE_RATE: 'still',
  VEL_AMT: 'still', VEL_MOD_VOL: 'still', VEL_DEST: 'still', VOLUME: 'mix',
  FREQ_LFO: 'still', SYNC_LFO: 'still', MOD_LFO: 'still', WAVE_LFO: 'still', RETRIGGER_LFO: 'still', OFFSET_LFO: 'still', TARGET_LFO: 'still',
  COARSE: 'pitch', FINE: [48, 78], ATTACK: [0, 6], EG_SLOPE: [0, 127], NOISE: [0, 127], MIX: [0, 127],
  PITCH_DECAY: [2, 80], MOD_AMOUNT: [0, 110], FM_AMOUNT: [0, 50], FM_FREQ: [0, 127],
  MOD_OSC1_FREQ: [0, 127], MOD_OSC2_FREQ: [0, 127], MOD_OSC1_GAIN: [0, 127], MOD_OSC2_GAIN: [0, 127],
  TRANSIENT_WAVE: [0, 13], TRANSIENT_VOLUME: [0, 100], TRANSIENT_FREQ: [0, 127],
  FILTER_F: [45, 127], FILTER_RESO: [0, 60], FILTER_DRIVE: [0, 50], DRIVE: [30, 95],
};
// decay ranges differ per voice: kick/tom/snare, cymbal
const DECAY = { 0: [3, 55], 1: [3, 55], 2: [3, 50], 3: [3, 50], 4: [20, 110], 5: [20, 110] }; // (voice 2: SNARE 2, 5: METAL 2)
// where the randomisers may put a sound's pan (63 is the centre): the drums always centre, the snare up to 20% left or
// right, the metal anywhere. Strict: a randomiser always lands inside it, even WILD (a hand-set pan can go anywhere)
export const PAN_RANGE = { 0: [63, 63], 1: [63, 63], 2: [51, 76], 3: [51, 76], 4: [0, 127], 5: [0, 127] }; // snare: L19 .. R20 (voice 2: SNARE 2)
function randRange(text, voice, key) {
  if (text === 'PAN') return PAN_RANGE[voice];
  if (key.startsWith('PITCH_SLOPE')) return [0, 90]; // steep pitch curves end up inaudible
  if (key.startsWith('VOL_SLOPE')) return [0, 80]; // very slow amp slopes ring on
  if (text === 'DECAY') return DECAY[voice] || [3, 70];
  if (text === 'DECAY_CLOSED') return [2, 30];
  if (text === 'DECAY_OPEN') return [8, 70];
  return SAFE[text] || [0, 127];
}

// the key morph: which parameters move with timbre, and how far (a fraction of the rand range at full depth).
// Pitch is morphed separately, by the note (see morph.js). Menus, levels, pan, LFO and velocity routing never move.
const TIMBRE = {
  DECAY: 0.45, DECAY_CLOSED: 0.45, DECAY_OPEN: 0.45, ATTACK: 0.5, EG_SLOPE: 0.35,
  PITCH_DECAY: 0.5, MOD_AMOUNT: 0.5, FM_AMOUNT: 0.6, FM_FREQ: 0.4,
  MOD_OSC1_FREQ: 0.4, MOD_OSC2_FREQ: 0.4, MOD_OSC1_GAIN: 0.5, MOD_OSC2_GAIN: 0.5,
  TRANSIENT_VOLUME: 0.5, TRANSIENT_FREQ: 0.6, NOISE: 0.5, MIX: 0.4,
  FILTER_F: 0.6, FILTER_RESO: 0.5, FILTER_DRIVE: 0.5, DRIVE: 0.35,
};

const LABELS = {
  COARSE: 'coarse', FINE: 'fine', WAVEFORM: 'wave', PWM: 'pwm', ATTACK: 'attack', DECAY: 'decay', DECAY_CLOSED: 'decay cl',
  DECAY_OPEN: 'decay op', REPEAT: 'repeat', NOISE: 'noise', MIX: 'noise mix',
  PITCH_DECAY: 'pitch dec', MOD_AMOUNT: 'pitch amt', VEL_DEST: 'vel dest', VEL_AMT: 'vel amt', VEL_MOD_VOL: 'vel vol',
  FM_AMOUNT: 'fm amt', FM_FREQ: 'fm freq', MODE: 'fm mode', MOD_OSC1_FREQ: 'mod1 freq', MOD_OSC2_FREQ: 'mod2 freq',
  MOD_OSC1_GAIN: 'mod1 gain', MOD_OSC2_GAIN: 'mod2 gain', TRANSIENT_WAVE: 'click', TRANSIENT_VOLUME: 'click vol',
  TRANSIENT_FREQ: 'click freq', FILTER_F: 'cutoff', FILTER_RESO: 'reso', FILTER_TYPE: 'type', FILTER_DRIVE: 'flt drive',
  FREQ_LFO: 'lfo freq', SYNC_LFO: 'lfo sync', MOD_LFO: 'lfo amt', WAVE_LFO: 'lfo wave', RETRIGGER_LFO: 'retrigger',
  OFFSET_LFO: 'lfo offset', TARGET_LFO: 'lfo dest', VOLUME: 'level', PAN: 'pan', SAMPLE_RATE: 'sample rate', DRIVE: 'drive',
};
// firmware sections -> editor pages and section names
const SECTION = { 'Oscillator': ['tone', 'osc'], 'FM': ['tone', 'fm'], 'Amp EG': ['shape', 'amp'], 'transient sample': ['shape', 'click'],
  'filter': ['filter', 'filter'], 'LFO': ['mod', 'lfo'], 'MIX': ['mix', 'mix'] };
export const PAGES = ['tone', 'shape', 'filter', 'mod', 'mix'];

function entry(text, key, voice, page, section) {
  const { max, display } = displayOf(key);
  const rand = randRange(text, voice, key);
  return {
    key, par: PAR[key], label: LABELS[text] || text.toLowerCase().replace(/_/g, ' '), text, page, section, min: 0, max,
    def: INIT_VALUES[PAR[key]], display, morph: TIMBRE[text] !== undefined ? 'timbre' : null, weight: TIMBRE[text] || 0, rand,
    ...(text === 'PAN' ? { strict: true } : {}),
  };
}

function firmwareSchema(voice) {
  const out = [];
  const fmWaves = [];
  for (const g of VOICE_PAGES[voice].groups) {
    const name = g.name.replace(/ \(.*\)/, '');
    for (const [text, key] of g.params) {
      if (name === 'Modulation') {
        // the pitch envelope goes on the shape page, velocity on the mod page
        if (text.startsWith('VEL_')) out.push(entry(text, key, voice, 'mod', 'velocity'));
        else out.push(entry(text, key, voice, 'shape', 'pitch'));
        continue;
      }
      const [page, section] = SECTION[name] || ['mix', 'mix'];
      const e = entry(text, key, voice, page, section);
      if (section === 'fm' && text === 'WAVEFORM') { e.label = 'fm wave'; fmWaves.push(e); }
      out.push(e);
    }
    if (name === 'LFO') {
      const key = 'TARGET_LFO' + (voice + 1);
      const e = entry('TARGET_LFO', key, voice, 'mod', 'lfo');
      e.display = { type: 'target', anyVoice: true };
      out.push(e);
    }
  }
  // two waves on the cymbal's and hi-hat's fm: one for each mod oscillator
  if (fmWaves.length === 2) { fmWaves[0].label = 'mod1 wave'; fmWaves[1].label = 'mod2 wave'; }
  for (const e of out) if (e.display.type === 'target' && !e.display.anyVoice) e.display.voices = [voice];
  return out;
}

// ---- the merged voice: every engine voice has the same controls, in the same order and sections. Each control is
// its firmware voice's parameter where it has one, else one of its extras. ukey: the control's name in the merged
// voice; firmware: which firmware controls (section:TEXT, the nth of that name) it is; extra: its extra
const ONOFF = ['off', 'on'];
// the click's knobs that were the firmware's transient: now plain 0..127 knobs (randomised over METAMORF's useful ranges)
const CLICK_KNOBS = {
  clickvol: { rand: [0, 76], morph: 'timbre', weight: 0.5 },
  click: { max: 127, display: { type: 'num' }, rand: [0, 127], morph: 'timbre', weight: 0.4 },
  clickfreq: { rand: [45, 127], morph: 'timbre', weight: 0.6 },
};
const dialOf = (d) => ({ type: 'detent', names: d.names, step: d.step, max: d.max });
export const MERGED = [
  // [ukey, page, section, label, firmware names, extra, display of the extra]
  ['coarse', 'tone', 'osc', 'coarse', ['osc:COARSE']],
  ['fine', 'tone', 'osc', 'fine', ['osc:FINE']],
  ['wave', 'tone', 'osc', 'wave', ['osc:WAVEFORM']],
  ['pwm', 'tone', 'osc', 'pwm', ['osc:PWM']],
  ['afreq', 'tone', 'mod a', 'a freq', ['fm:FM_FREQ', 'fm:MOD_OSC1_FREQ'], 'A_FREQ', { type: 'pm', centre: 60 }],
  ['again', 'tone', 'mod a', 'a gain', ['fm:FM_AMOUNT', 'fm:MOD_OSC1_GAIN'], 'A_GAIN'],
  ['awave', 'tone', 'mod a', 'a wave', ['fm:WAVEFORM'], 'A_WAVE', dialOf(WAVE_DIAL)],
  ['amode', 'tone', 'mod a', 'a mode', ['fm:MODE'], 'A_MODE', dialOf(MODE_DIAL)],
  ['fmenv', 'tone', 'mod a', 'fm env', [], 'FM_ENV'],
  ['bfreq', 'tone', 'mod b', 'b freq', ['fm:MOD_OSC2_FREQ'], 'B_FREQ', { type: 'pm', centre: 60 }],
  ['bgain', 'tone', 'mod b', 'b gain', ['fm:MOD_OSC2_GAIN'], 'B_GAIN'],
  ['bwave', 'tone', 'mod b', 'b wave', ['fm:WAVEFORM#2'], 'B_WAVE', dialOf(WAVE_DIAL)],
  ['ncolour', 'tone', 'noise', 'colour', ['osc:NOISE'], 'NOISE_COLOUR'],
  ['nmix', 'tone', 'noise', 'noise', ['osc:MIX'], 'NOISE_MIX'],
  ['attack', 'shape', 'amp', 'attack', ['amp:ATTACK']],
  ['decay', 'shape', 'amp', 'decay', ['amp:DECAY', 'amp:DECAY_CLOSED']],
  ['repeat', 'shape', 'amp', 'repeat', ['amp:REPEAT'], 'REPEAT'],
  ['aslope', 'shape', 'amp', 'eg slope', ['amp:EG_SLOPE']],
  ['pdecay', 'shape', 'pitch', 'pitch dec', ['pitch:PITCH_DECAY'], 'PITCH_DECAY'],
  ['pslope', 'shape', 'pitch', 'pitch slope', ['pitch:EG_SLOPE'], 'PITCH_SLOPE'],
  ['pamt', 'shape', 'pitch', 'pitch amt', ['pitch:MOD_AMOUNT'], 'PITCH_AMOUNT'],
  // the click (engine/click.js, METAMORF's): LEVEL, SHAPE (0 pulse, 63.5 chirp, 127 noise burst), TONE, LENGTH, DIRECT
  ['clickvol', 'shape', 'click', 'click lvl', ['click:TRANSIENT_VOLUME']],
  ['click', 'shape', 'click', 'shape', ['click:TRANSIENT_WAVE']],
  ['clickfreq', 'shape', 'click', 'tone', ['click:TRANSIENT_FREQ']],
  ['rtone', 'filter', 'filter in', 'tone in', [], 'ROUTE_TONE', { type: 'menu', names: ONOFF }],
  ['rnoise', 'filter', 'filter in', 'noise in', [], 'ROUTE_NOISE', { type: 'menu', names: ONOFF }],
  ['rclick', 'filter', 'filter in', 'click in', [], 'ROUTE_CLICK', { type: 'menu', names: ONOFF }], // (gone: the click's DIRECT)
  ['cutoff', 'filter', 'filter', 'cutoff', ['filter:FILTER_F']],
  ['reso', 'filter', 'filter', 'reso', ['filter:FILTER_RESO']],
  ['ftype', 'filter', 'filter', 'type', ['filter:FILTER_TYPE']],
  ['fdrive', 'filter', 'filter', 'flt drive', ['filter:FILTER_DRIVE']],
  // (the firmware's one velocity target and one LFO target, and their amounts, are gone: every knob takes a source of
  // its own on a right-click, MOD_DIALS. They stay, unseen, so the parameter numbers stay as they were)
  ['velvol', 'shape', 'amp', 'vel vol', ['velocity:VEL_MOD_VOL']], // (velocity on the level: with the amp envelope)
  ['lfofreq', 'mod', 'lfo', 'lfo freq', ['lfo:FREQ_LFO']],
  ['lfosync', 'mod', 'lfo', 'lfo sync', ['lfo:SYNC_LFO']],
  ['lfowave', 'mod', 'lfo', 'lfo wave', ['lfo:WAVE_LFO']],
  ['lforetrig', 'mod', 'lfo', 'retrigger', ['lfo:RETRIGGER_LFO']],
  ['lfooffset', 'mod', 'lfo', 'lfo offset', ['lfo:OFFSET_LFO']],
  ['level', 'mix', 'mix', 'level', ['mix:VOLUME']],
  ['pan', 'mix', 'mix', 'pan', ['mix:PAN']],
  ['rate', 'mix', 'mix', 'sample rate', ['mix:SAMPLE_RATE']],
  ['drive', 'mix', 'mix', 'drive', ['mix:DRIVE']],
  ['kind', 'mix', 'kind', 'kind', [], 'KIND', { type: 'menu', names: KINDS }], // (not shown: what the sound's firmware voice was)
];
// the extras a voice uses: the merged controls its firmware voice has no parameter for
const fwName = (e, n) => `${e.section}:${e.text}${n > 1 ? '#' + n : ''}`;
function buildSchema(voice) {
  const fw = firmwareSchema(voice), byName = new Map(), seen = {};
  for (const e of fw) { const k = e.section + ':' + e.text; seen[k] = (seen[k] || 0) + 1; byName.set(fwName(e, seen[k]), e); }
  const out = [];
  for (const [ukey, page, section, label, names, extra, disp] of MERGED) {
    const f = names.map((n) => byName.get(n)).find(Boolean);
    if (f) { out.push({ ...f, ukey, page, section, label, ...(ukey === 'pwm' ? { hidden: true } : {}), ...(CLICK_KNOBS[ukey] || {}) }); continue; } // (PWM: the pulse is a place on BASIC now)
    const k = EX[extra], par = extraPar(voice, k), menu = disp && disp.type === 'menu';
    out.push({ key: extra + (voice + 1), par, ukey, label, text: extra, page, section, min: 0, max: menu ? disp.names.length - 1 : disp && disp.max !== undefined ? disp.max : 127,
      def: INIT_VALUES[par], display: disp || { type: 'num' }, morph: null, weight: 0, rand: 'still', extra: k, ...(ukey === 'kind' || ukey === 'rclick' ? { hidden: true } : {}) });
  }
  // a firmware control with no place in the merged voice (the hi-hat's open decay) stays, unseen, so a key keeps it
  const used = new Set(out.map((e) => e.par));
  for (const e of fw) if (!used.has(e.par)) out.push({ ...e, ukey: e.text.toLowerCase(), hidden: true });
  SEND_FX.forEach((name, k) => out.push({ key: 'SEND_' + name.toUpperCase() + (voice + 1), par: sendPar(voice, k), label: name, text: 'SEND_' + name.toUpperCase(),
    page: 'mix', section: 'fx sends', min: 0, max: 127, def: 0, display: { type: 'num' }, morph: null, weight: 0, rand: 'mix' }));
  // the click's LENGTH and DIRECT (after its TONE)
  const at = out.findIndex((e) => e.ukey === 'clickfreq') + 1;
  out.splice(at, 0,
    { key: 'CLICK_LEN' + (voice + 1), par: clickPar(voice, 0), ukey: 'clicklen', label: 'length', text: 'CLICK_LEN', page: 'shape', section: 'click', min: 0, max: 127,
      def: INIT_VALUES[clickPar(voice, 0)], display: { type: 'num' }, morph: 'timbre', weight: 0.4, rand: [13, 101], own: true },
    { key: 'CLICK_DIRECT' + (voice + 1), par: clickPar(voice, 1), ukey: 'clickdir', label: 'direct', text: 'CLICK_DIRECT', page: 'shape', section: 'click', min: 0, max: 127,
      def: INIT_VALUES[clickPar(voice, 1)], display: { type: 'num' }, morph: 'timbre', weight: 0.2, rand: [0, 127], own: true });
  // the sequencer (the editor draws it as a strip of steps; the randomisers leave it to NEW SOUND and its RANDOM)
  out.push({ key: 'SEQ_ON' + (voice + 1), par: seqOnPar(voice), label: 'active', text: 'SEQ_ON', page: 'mix', section: 'seq', min: 0, max: 1,
    def: 0, display: { type: 'menu', names: ['off', 'on'] }, morph: null, weight: 0, rand: 'seq', seq: true });
  out.push({ key: 'SEQ_PAT' + (voice + 1), par: seqPatPar(voice), label: 'steps', text: 'SEQ_PAT', page: 'mix', section: 'seq', min: 0, max: 255,
    def: 0b00010001, display: { type: 'num' }, morph: null, weight: 0, rand: 'seq', seq: true });
  // AUTO LEVEL's trim (shown beside the LEVEL knob, set by the randomisers when they deal a sound; never randomised)
  out.push({ key: 'TRIM' + (voice + 1), par: trimPar(voice), label: 'auto level', text: 'TRIM', page: 'mix', section: 'auto', min: 0, max: 127,
    def: TRIM_ZERO, display: { type: 'num' }, morph: null, weight: 0, rand: 'seq', seq: true });
  // each knob's modulation (unseen as knobs: a right-click on the knob sets them). Part of the sound (a kit sound brings
  // its own, MORPH KEYS and BREED carry them), but ALTER and the drum-safe randomisers leave them alone ('mix')
  MOD_DIALS.forEach((u, i) => {
    const d = out.find((e) => e.ukey === u), dest = d ? (d.extra !== undefined ? EXTRA_DEST + d.extra : d.par) : -1;
    const base = { page: 'mod', section: 'mod', min: 0, morph: null, weight: 0, rand: 'mix', hidden: true, mod: { dial: u, dest } };
    out.push({ ...base, key: 'MODSRC_' + u + (voice + 1), par: modSrcPar(voice, i), ukey: 'modsrc:' + u, label: (d ? d.label : u) + ' mod', text: 'MOD_SRC',
      max: MOD_SOURCES.length - 1, def: 0, display: { type: 'menu', names: MOD_SOURCES } });
    out.push({ ...base, key: 'MODAMT_' + u + (voice + 1), par: modAmtPar(voice, i), ukey: 'modamt:' + u, label: (d ? d.label : u) + ' mod amt', text: 'MOD_AMT',
      max: MOD_AMT_MAX, def: MOD_AMT_ZERO, display: { type: 'pm', centre: MOD_AMT_ZERO } });
  });
  // the tone's wavetable (chosen in the OSC section's heading, not a knob: section 'table' has no place in the grid).
  // Part of the sound; ALTER leaves it alone unless WILD
  out.push({ key: 'TABLE' + (voice + 1), par: tablePar(voice), ukey: 'table', label: 'table', text: 'TABLE', page: 'tone', section: 'table', min: 1,
    max: TABLE_NAMES.length - 1, def: 0, display: { type: 'menu', names: TABLE_NAMES }, morph: null, weight: 0, rand: 'still', table: true });
  // MOD A's and MOD B's (in their headings): on a table their WAVE knobs move along it, as the tone's does
  for (const [which, ab] of [[1, 'a'], [2, 'b']]) {
    out.push({ key: ab.toUpperCase() + 'TABLE' + (voice + 1), par: tablePar(voice, which), ukey: ab + 'table', label: ab + ' table', text: ab.toUpperCase() + '_TABLE', page: 'tone', section: 'table', min: 1,
      max: TABLE_NAMES.length - 1, def: 0, display: { type: 'menu', names: TABLE_NAMES }, morph: null, weight: 0, rand: 'still', table: true });
  }
  return out;
}

// the schema of each engine voice (index 0..5); a sound's schema is its engine voice's
export const VOICE_SCHEMAS = [0, 1, 2, 3, 4, 5].map(buildSchema);
// a voice's controls as the randomisers treat a sound of another kind on it (any kit voice can be dealt to any engine):
// each control's range is the one it has on the kit voice that kind comes from (a cymbal's mod B moves on a drum's
// voice as it does on the cymbal's; a drum's pitch envelope stays still on a cymbal). Pan, sends and the rest keep the
// voice's own
const NATIVE_VOICE = { drum: 0, snare: 3, cym: 4, hat: 5 };
const kindSchemas = new Map();
export function kindSchema(voice, kind) {
  const name = KINDS[kind] || VOICE_KINDS[voice], key = voice * 8 + KINDS.indexOf(name);
  if (!kindSchemas.has(key)) {
    const nat = VOICE_SCHEMAS[NATIVE_VOICE[name]];
    kindSchemas.set(key, VOICE_SCHEMAS[voice].map((e) => {
      if (!e.ukey || e.strict || e.rand === 'mix' || e.seq) return e;
      const n = nat.find((x) => x.ukey === e.ukey);
      return n && n.rand !== e.rand ? { ...e, rand: n.rand } : e;
    }));
  }
  return kindSchemas.get(key);
}
export const kindPar = (voice) => extraPar(voice, EX.KIND);
// the extras a voice uses (the instrument passes only these to the engine: the others shadow a firmware parameter)
export const EXTRA_LIVE = new Set(VOICE_SCHEMAS.flat().filter((e) => e.extra !== undefined).map((e) => e.par));
// a voice's control by its merged name
export const ukeyPar = (voice, ukey) => VOICE_SCHEMAS[voice].find((e) => e.ukey === ukey)?.par;
export const schemaOf = (sound) => VOICE_SCHEMAS[SOUNDS[sound].engineVoice];
// the parameters an engine voice owns (including the mixer's routing and LFO voice, which the editor doesn't show)
export function voiceOwned(voice) {
  const s = new Set(VOICE_SCHEMAS[voice].map((e) => e.par));
  for (const n of ['AUDIO_OUT1', 'VOICE_LFO1']) if (PAR[n] !== undefined) s.add(PAR[n] + voice);
  return [...s];
}
// coarse and fine of an engine voice (the pitch morph adds to them)
export const pitchPars = (voice) => ({ coarse: PAR['COARSE' + (voice + 1)], fine: PAR['FINE' + (voice + 1)] });
// which engine voice a modulation target (index into MOD_TARGETS) belongs to
export const voiceOfTarget = (i) => Math.max(0, MOD_TARGET_VOICE_RANGES.findIndex(([a, b]) => i >= a && i <= b));

// a dial's setting's short name, for between two (so both fit over the knob)
const SHORT = { sine: 'sin', noise: 'nse', 'unity bp': 'ubp', notch: 'ntc', peak: 'pk' };
// a knob's number: a whole number as it is, a decimal to one place (41.53 shows 41.5)
const num = (v) => (Number.isInteger(v) ? String(v) : v.toFixed(1));
// text for a value of a parameter entry
export function showValue(e, v) {
  const d = e.display;
  if (d.type === 'pm' && d.lr) { const x = v - d.centre; return x ? (x < 0 ? 'L' + Math.round(-x / d.centre * 100) : 'R' + Math.round(x / (127 - d.centre) * 100)) : 'C'; } // pan: L100 .. C .. R100
  if (d.type === 'pm') { const x = v - d.centre; return (x > 0 ? '+' : '') + num(x); }
  if (d.type === 'menu') return d.names[v] ?? String(v);
  if (d.type === 'detent') { // a name on a detent; between two, both (short) and how far along, in % (tri>saw 40)
    const k = Math.floor(v / d.step), t = v - k * d.step, sh = (n) => SHORT[n] || n;
    return t && d.names[k + 1] ? `${sh(d.names[k])}>${sh(d.names[k + 1])} ${Math.round(t / d.step * 100)}` : d.names[Math.min(k, d.names.length - 1)];
  }
  if (d.type === 'target') { const t = MOD_TARGETS[v]; return t && v ? t[0].toLowerCase().replace(/_/g, ' ') : 'none'; }
  return num(v);
}

// one voice's sound taken from a kit voice (any voice: the merged voice has every control): its values mapped control by
// control (by merged name), its modulation with them, and its kind. kit: every parameter's value (a voice with no extras set
// takes the voice's own
// setting as it comes, a part switched off). Returns [[parameter, value], ...] for dst; the sends, the sequencer and the trim are left out
export function mapVoice(kit, src, dst) {
  const S = VOICE_SCHEMAS[src], D = VOICE_SCHEMAS[dst];
  const val = (p) => (p < kit.length ? kit[p] : INIT_VALUES[p]);
  const parMap = new Map(); // source parameter -> destination parameter
  for (const e of S) {
    if (e.hidden && e.ukey !== 'kind' && !e.mod) continue;
    if (e.par >= NUM_PARAMS && e.extra === undefined && !e.mod && !e.table && !e.own) continue; // (sends, sequencer, trim)
    const d = D.find((x) => x.ukey === e.ukey);
    if (d) parMap.set(e.par, d.par);
  }
  const out = [];
  for (const [p, q] of parMap) {
    const e = S.find((x) => x.par === p);
    // the hi-hat's decay: its open one (as the cymbal's decay; the closed one is a different sound)
    let v = src === 5 && e.ukey === 'decay' ? val(PAR.VELOD6_OPEN) : val(p);
    if (e.ukey === 'kind' && KINDS[v] === 'hat') v = KINDS.indexOf('cym'); // (a hi-hat plays as the cymbal, as it always did here)
    out.push([q, v]);
  }
  return out;
}

// a value kept before the waves, filter types and FM/MIX modes were knobs (a menu index) as the knob's position
const POS_OF = new Map();
for (const sc of VOICE_SCHEMAS) for (const e of sc) {
  if (e.display.type !== 'detent') continue;
  POS_OF.set(e.par, e.display.names === WAVE_DETENT_NAMES ? wavePos : e.display.names === FILTER_DETENT_NAMES ? (r) => FILTER_STEP * FILTER_DETENT_NAMES.indexOf(OLD_FILTER[Math.min(r, 7)]) : modePos);
}
const OLD_FILTER = ['lp', 'hp', 'bp', 'unity bp', 'notch', 'peak', 'lp2', 'off'];
export const POS_RULE = 1; // what a store or preset made since then says it holds (pos: POS_RULE)
export const oldToPosition = (par, v) => (POS_OF.has(par) ? POS_OF.get(par)(v) : v);
// a store's or preset's values (an array by parameter) and its keys' edits ({ parameter: value, _o: { ... } }), kept
// before then, as knob positions (in place)
export function valuesToPositions(values) { for (const p of POS_OF.keys()) if (p < values.length) values[p] = oldToPosition(p, values[p]); return values; }
export function editsToPositions(edits) {
  for (const k in edits || {}) {
    const e = edits[k]; if (!e || typeof e !== 'object') continue;
    for (const f in e) if (/^\d+$/.test(f)) e[f] = oldToPosition(Number(f), e[f]);
    if (e._o) for (const f in e._o) if (/^\d+$/.test(f)) e._o[f] = oldToPosition(Number(f), e._o[f]);
  }
  return edits;
}

// ---- the firmware's modulation as routes. A firmware voice had one velocity target and one LFO target (VEL_DEST,
// TARGET_LFO: an index into MOD_TARGETS) with an amount each; now every knob has its own source and amount. A voice's
// old targets become routes on the same knobs at the same amounts (an exact match: the engine moves a routed knob as
// the firmware moved its target). Left out, as they did nothing to the sound: an LFO aimed at another voice (each key
// plays one voice's sound on its own) and a target with no knob (the firmware's FX, the hi-hat's open decay, the old
// amounts and targets themselves). An amount of 0 is kept (re-sent, a knob can land a step away). With both on one knob, the LFO's (the firmware re-sent the LFO's
// after the velocity's, so only the LFO's was heard) ----
const OLD_MOD = (v) => ({ vd: PAR.VEL_DEST_1 + v, va: PAR['VELO_MOD_AMT_' + (v + 1)], ld: PAR['TARGET_LFO' + (v + 1)], la: PAR['AMOUNT_LFO' + (v + 1)] });
const DIAL_OF_PAR = VOICE_SCHEMAS.map((sc) => new Map(MOD_DIALS.map((u, i) => [sc.find((e) => e.ukey === u), i]).filter(([e]) => e && e.extra === undefined).map(([e, i]) => [e.par, i])));
// voice v's routes from its old targets (get: a parameter's value): [[parameter, value], ...] for every knob of the voice
export function routesFromOld(get, v) {
  const o = OLD_MOD(v), r = new Map();
  const dial = (i) => (i && i < MOD_TARGETS.length && voiceOfTarget(i) === v ? DIAL_OF_PAR[v].get(MOD_TARGETS[i][1]) : undefined);
  const vd = dial(get(o.vd)), ld = dial(get(o.ld));
  if (vd !== undefined) r.set(vd, [2, get(o.va)]);
  if (ld !== undefined) r.set(ld, [1, get(o.la)]);
  const out = [];
  for (let i = 0; i < NUM_MOD; i++) { const x = r.get(i); out.push([modSrcPar(v, i), x ? x[0] : 0], [modAmtPar(v, i), MOD_AMT_ZERO + (x ? x[1] : 0)]); }
  return out;
}
export const MOD_RULE = 1; // what a store or preset made since then says (mod: MOD_RULE)
const OLD_TARGETS = (v) => { const o = OLD_MOD(v); return [o.vd, o.va, o.ld, o.la]; };
// a sound's values (an array by parameter: a kit, a store's, a preset's) with its old targets as routes, in place, and
// its keys' edits with it (keys: per sound, { note: { parameter: value, _o: { ... } } }: a key that set a target or an
// amount of its own gets the routes that made, where they differ from the base's). A voice with no old target is left
// as it is, so it can be run again
export function upgradeMod(values, keys) {
  const base = Array.from(values);
  if (keys) SOUNDS.forEach((def, s) => {
    const v = def.engineVoice, olds = OLD_TARGETS(v), ks = keys[s];
    if (!ks) return;
    const baseR = new Map(routesFromOld((p) => base[p], v));
    for (const n in ks) {
      const ed = ks[n]; if (!ed || typeof ed !== 'object') continue;
      const o = ed._o && typeof ed._o === 'object' ? ed._o : null;
      if (olds.some((p) => p in ed) || (o && olds.some((p) => p in o))) {
        const now = routesFromOld((p) => ed[p] ?? base[p], v);
        const was = o ? routesFromOld((p) => o[p] ?? ed[p] ?? base[p], v) : now;
        now.forEach(([p, x], j) => { if (ed._lock || x !== baseR.get(p)) ed[p] = x; if (o && was[j][1] !== x) o[p] = was[j][1]; });
      }
      for (const p of olds) { delete ed[p]; if (o) delete o[p]; }
      if (o && !Object.keys(o).length) delete ed._o;
    }
  });
  for (let v = 0; v < 6; v++) {
    const o = OLD_MOD(v);
    if (!base[o.vd] && !base[o.ld]) continue;
    for (const [p, x] of routesFromOld((p) => base[p], v)) values[p] = x;
    values[o.vd] = 0; values[o.ld] = 0;
  }
  return values;
}
upgradeMod(INIT_VALUES);
// a route's parameter: { voice, dest (the engine's: a parameter number, or EXTRA_DEST + an extra), src (true: its source,
// false: its amount) }, or null
const ROUTES = new Map(VOICE_SCHEMAS.flatMap((sc, voice) => sc.filter((e) => e.mod).map((e) => [e.par, { voice, dest: e.mod.dest, src: e.text === 'MOD_SRC' }])));
export const routeOf = (par) => ROUTES.get(par) || null;
// a knob's modulation parameters ({ src, amt }), by its merged name, or null if it can't be modulated
export function modOf(voice, ukey) { const i = MOD_DIALS.indexOf(ukey); return i < 0 ? null : { src: modSrcPar(voice, i), amt: modAmtPar(voice, i) }; }

// ---- CLASSIC is gone (2026-11-19: wavetables only): a patch saved while the tone, MOD A or MOD B could play the
// firmware's waves (TABLE 0) has each of them moved onto its table at the place that plays its wave (tables.js
// classicPlace: BASIC, or NOISE for the noise), the base values and every key's edits (and their _o) alike. Saved
// patches carry TABLE_RULE; older ones are upgraded once ----
export const TABLE_RULE = 1;
const WAVE_UKEYS = ['wave', 'awave', 'bwave'];
export function upgradeTables(values, keys) {
  const base = Array.from(values);
  for (let v = 0; v < 6; v++) {
    const pw = ukeyPar(v, 'pwm');
    WAVE_UKEYS.forEach((u, which) => {
      const w = ukeyPar(v, u), t = tablePar(v, which);
      if (!base[t]) [values[t], values[w]] = classicPlace(base[w] || 0, base[pw] || 0);
    });
  }
  if (keys) SOUNDS.forEach((def, s) => {
    const v = def.engineVoice, pw = ukeyPar(v, 'pwm'), ks = keys[s];
    if (!ks) return;
    for (const n in ks) {
      const ed = ks[n]; if (!ed || typeof ed !== 'object') continue;
      const layers = [ed]; if (ed._o && typeof ed._o === 'object') layers.push(ed._o);
      WAVE_UKEYS.forEach((u, which) => {
        const w = ukeyPar(v, u), t = tablePar(v, which);
        layers.forEach((o, k) => {
          const get = (p) => (k ? o[p] ?? ed[p] : ed[p]) ?? base[p];
          if (!(ed._lock || w in o || t in o || pw in o)) return; // (it plays the base's, moved above)
          if (!get(t)) [o[t], o[w]] = classicPlace(get(w) || 0, get(pw) || 0);
        });
      });
    }
  });
  return values;
}
// the starting values: on tables too
upgradeTables(INIT_VALUES);

// ---- the click (2026-11-19): METAMORF's in place of the firmware's sampled transients. A patch or sound from before
// has its click (wave, volume, freq, and whether it went into the filter) moved to the nearest new click (oldClick).
// Saved patches carry CLICK_RULE; older ones are upgraded once ----
export const CLICK_RULE = 1;
/** an old click (wave 0..35, volume and freq 0..127, into the filter 0/1) as a new click near it in kind (not chasing
 *  closeness: the old samples can't be matched) at a lowish level, the new click's five knobs, 0..127:
 *  { clickvol (LEVEL), click (SHAPE), clickfreq (TONE), clicklen (LENGTH), clickdir (DIRECT) } */
export function oldClick(wave, vol, freq, into) {
  const rate = Math.max(0.05, 1 + freq / 33.9 - 0.75), w = Math.round(wave) | 0, v = Math.max(0, Math.min(1, vol / 127));
  // snap (0): a quick upward blip of the tone's pitch; offset (1): the tone starting part way into its cycle (a step)
  const [shape, hz, ms] = w === 0 ? [0.5, 2000, 7.25 / rate] : w === 1 ? [0, 4000, 1] : CLICK_MAP[w - 2] || [0, 2000, 3];
  const k = (x) => dec2(Math.max(0, Math.min(127, x)));
  if (!v) return { clickvol: 0, click: 0, clickfreq: k(toneKnob(2000)), clicklen: k(lenKnob(3)), clickdir: into ? 0 : 127 }; // (off: METAMORF's default)
  return { clickvol: k(127 * 0.3 * v), // (lowish, as Johnny asked: not a match for the old one's loudness)
     click: k(127 * shape), clickfreq: k(toneKnob(w <= 1 ? hz : hz * rate)),
    clicklen: k(lenKnob(w <= 1 ? ms : ms / rate)), clickdir: into ? 0 : 127 };
}
const CLICK_PARS = (v) => ({ clickvol: ukeyPar(v, 'clickvol'), click: ukeyPar(v, 'click'), clickfreq: ukeyPar(v, 'clickfreq'), clicklen: clickPar(v, 0), clickdir: clickPar(v, 1) });
export function upgradeClicks(values, keys) {
  const base = Array.from(values), put = (o, v, get) => {
    const P = CLICK_PARS(v), n = oldClick(get(P.click) || 0, get(P.clickvol) || 0, get(P.clickfreq) || 0, get(extraPar(v, EX.ROUTE_CLICK)));
    for (const u in n) o[P[u]] = n[u];
  };
  for (let v = 0; v < 6; v++) put(values, v, (p) => base[p]);
  if (keys) SOUNDS.forEach((def, s) => {
    const v = def.engineVoice, ks = keys[s], P = CLICK_PARS(v), rc = extraPar(v, EX.ROUTE_CLICK);
    if (!ks) return;
    for (const n in ks) {
      const ed = ks[n]; if (!ed || typeof ed !== 'object') continue;
      const layers = [ed]; if (ed._o && typeof ed._o === 'object') layers.push(ed._o);
      layers.forEach((o, k) => {
        if (!(ed._lock || P.click in o || P.clickvol in o || P.clickfreq in o || rc in o)) return; // (it plays the base's, moved above)
        put(o, v, (p) => (k ? o[p] ?? ed[p] : ed[p]) ?? base[p]);
      });
    }
  });
  return values;
}
upgradeClicks(INIT_VALUES);
for (const sc of VOICE_SCHEMAS) for (const e of sc) if (['clickvol', 'click', 'clickfreq', 'clicklen', 'clickdir'].includes(e.ukey)) e.def = INIT_VALUES[e.par];
/** a bucket sound saved before the new click (no clicklen) with its click moved over */
export function soundClicks(snd) {
  const p = snd.params || {};
  if (p.clicklen !== undefined) return snd;
  return { ...snd, params: { ...p, ...oldClick(p.click ?? 0, p.clickvol ?? 0, p.clickfreq ?? 0, p.rclick ?? (snd.voice < 3 ? 1 : 0)) } };
}
for (const sc of VOICE_SCHEMAS) for (const e of sc) {
  if (e.table || WAVE_UKEYS.includes(e.ukey)) e.def = INIT_VALUES[e.par];
  if (WAVE_UKEYS.includes(e.ukey)) e.display = { type: 'num' }; // (a place along the table: no detents, no wave names)
}

