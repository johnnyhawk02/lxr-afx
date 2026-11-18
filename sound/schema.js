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
import { LFO_SYNC_NAMES, EXTRAS, EX, VOICE_KINDS, KINDS, extraDefaults, kitToPositions, WAVE_STEP, WAVE_MAX, WAVE_DETENT_NAMES,
  FILTER_STEP, FILTER_MAX, FILTER_DETENT_NAMES, MODE_MAX, wavePos, modePos } from '../engine/lxr.js?v=mwlrkddp';
import { EXTRA_CLICK_NAMES } from '../engine/lxr-clicks.js';

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
export const ALL_PARAMS = EXTRA_BASE + 6 * NUM_EXTRAS;
export const INIT_VALUES = new Uint8Array(ALL_PARAMS);
{ const k = new Uint8Array(NUM_PARAMS); for (let i = 8; i < NUM_PARAMS; i++) k[i - 8] = INIT_KIT[i]; INIT_VALUES.set(kitToPositions(k)); }
for (let v = 0; v < 6; v++) INIT_VALUES.set(extraDefaults(VOICE_KINDS[v]), extraPar(v, 0));
for (let v = 0; v < 6; v++) INIT_VALUES[seqPatPar(v)] = 0b00010001; // steps 1 and 5, ready for ACTIVE
for (let v = 0; v < 6; v++) INIT_VALUES[trimPar(v)] = TRIM_ZERO;

const TRANSIENT_NAMES = ['snap', 'offset', 'click', 'click 2', 'tick', 'kick', 'rim', 'drop', 'hat', 'clap', 'kick 2', 'snare',
  'tom', 'snap 2', ...EXTRA_CLICK_NAMES];
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
  ['click', 'shape', 'click', 'click', ['click:TRANSIENT_WAVE']],
  ['clickvol', 'shape', 'click', 'click vol', ['click:TRANSIENT_VOLUME']],
  ['clickfreq', 'shape', 'click', 'click freq', ['click:TRANSIENT_FREQ']],
  ['rtone', 'filter', 'filter in', 'tone in', [], 'ROUTE_TONE', { type: 'menu', names: ONOFF }],
  ['rnoise', 'filter', 'filter in', 'noise in', [], 'ROUTE_NOISE', { type: 'menu', names: ONOFF }],
  ['rclick', 'filter', 'filter in', 'click in', [], 'ROUTE_CLICK', { type: 'menu', names: ONOFF }],
  ['cutoff', 'filter', 'filter', 'cutoff', ['filter:FILTER_F']],
  ['reso', 'filter', 'filter', 'reso', ['filter:FILTER_RESO']],
  ['ftype', 'filter', 'filter', 'type', ['filter:FILTER_TYPE']],
  ['fdrive', 'filter', 'filter', 'flt drive', ['filter:FILTER_DRIVE']],
  ['veldest', 'mod', 'velocity', 'vel dest', ['velocity:VEL_DEST']],
  ['velamt', 'mod', 'velocity', 'vel amt', ['velocity:VEL_AMT']],
  ['velvol', 'mod', 'velocity', 'vel vol', ['velocity:VEL_MOD_VOL']],
  ['lfofreq', 'mod', 'lfo', 'lfo freq', ['lfo:FREQ_LFO']],
  ['lfosync', 'mod', 'lfo', 'lfo sync', ['lfo:SYNC_LFO']],
  ['lfoamt', 'mod', 'lfo', 'lfo amt', ['lfo:MOD_LFO']],
  ['lfowave', 'mod', 'lfo', 'lfo wave', ['lfo:WAVE_LFO']],
  ['lforetrig', 'mod', 'lfo', 'retrigger', ['lfo:RETRIGGER_LFO']],
  ['lfooffset', 'mod', 'lfo', 'lfo offset', ['lfo:OFFSET_LFO']],
  ['lfodest', 'mod', 'lfo', 'lfo dest', ['lfo:TARGET_LFO']],
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
    if (f) { out.push({ ...f, ukey, page, section, label }); continue; }
    const k = EX[extra], par = extraPar(voice, k), menu = disp && disp.type === 'menu';
    out.push({ key: extra + (voice + 1), par, ukey, label, text: extra, page, section, min: 0, max: menu ? disp.names.length - 1 : disp && disp.max !== undefined ? disp.max : 127,
      def: INIT_VALUES[par], display: disp || { type: 'num' }, morph: null, weight: 0, rand: 'still', extra: k, ...(ukey === 'kind' ? { hidden: true } : {}) });
  }
  // a firmware control with no place in the merged voice (the hi-hat's open decay) stays, unseen, so a key keeps it
  const used = new Set(out.map((e) => e.par));
  for (const e of fw) if (!used.has(e.par)) out.push({ ...e, ukey: e.text.toLowerCase(), hidden: true });
  SEND_FX.forEach((name, k) => out.push({ key: 'SEND_' + name.toUpperCase() + (voice + 1), par: sendPar(voice, k), label: name, text: 'SEND_' + name.toUpperCase(),
    page: 'mix', section: 'fx sends', min: 0, max: 127, def: 0, display: { type: 'num' }, morph: null, weight: 0, rand: 'mix' }));
  // the sequencer (the editor draws it as a strip of steps; the randomisers leave it to NEW SOUND and its RANDOM)
  out.push({ key: 'SEQ_ON' + (voice + 1), par: seqOnPar(voice), label: 'active', text: 'SEQ_ON', page: 'mix', section: 'seq', min: 0, max: 1,
    def: 0, display: { type: 'menu', names: ['off', 'on'] }, morph: null, weight: 0, rand: 'seq', seq: true });
  out.push({ key: 'SEQ_PAT' + (voice + 1), par: seqPatPar(voice), label: 'steps', text: 'SEQ_PAT', page: 'mix', section: 'seq', min: 0, max: 255,
    def: 0b00010001, display: { type: 'num' }, morph: null, weight: 0, rand: 'seq', seq: true });
  // AUTO LEVEL's trim (shown beside the LEVEL knob, set by the randomisers when they deal a sound; never randomised)
  out.push({ key: 'TRIM' + (voice + 1), par: trimPar(voice), label: 'auto level', text: 'TRIM', page: 'mix', section: 'auto', min: 0, max: 127,
    def: TRIM_ZERO, display: { type: 'num' }, morph: null, weight: 0, rand: 'seq', seq: true });
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
// text for a value of a parameter entry
export function showValue(e, v) {
  const d = e.display;
  if (d.type === 'pm' && d.lr) { const x = v - d.centre; return x ? (x < 0 ? 'L' + Math.round(-x / d.centre * 100) : 'R' + Math.round(x / (127 - d.centre) * 100)) : 'C'; } // pan: L100 .. C .. R100
  if (d.type === 'pm') { const x = v - d.centre; return (x > 0 ? '+' : '') + x; }
  if (d.type === 'menu') return d.names[v] ?? String(v);
  if (d.type === 'detent') { // a name on a detent; between two, both (short) and how far along, in % (tri>saw 40)
    const k = Math.floor(v / d.step), t = v - k * d.step, sh = (n) => SHORT[n] || n;
    return t && d.names[k + 1] ? `${sh(d.names[k])}>${sh(d.names[k + 1])} ${Math.round(t / d.step * 100)}` : d.names[Math.min(k, d.names.length - 1)];
  }
  if (d.type === 'target') { const t = MOD_TARGETS[v]; return t && v ? t[0].toLowerCase().replace(/_/g, ' ') : 'none'; }
  return String(v);
}

// .SND kit files: the 8-character kit name followed by one byte per parameter (presetManager.c)
export function parseSnd(bytes) {
  if (bytes.length < 9) throw new Error('too short for a kit file');
  const name = String.fromCharCode(...bytes.slice(0, 8)).replace(/[^\x20-\x7e]/g, '').trim() || 'Empty';
  const kit = new Uint8Array(NUM_PARAMS);
  kit.set(bytes.slice(8, 8 + NUM_PARAMS));
  for (let i = 0; i < 6; i++) {
    // the firmware's own clean-up of out-of-range mod targets and LFO voices
    if (kit[PAR.VEL_DEST_1 + i] >= MOD_TARGETS.length) kit[PAR.VEL_DEST_1 + i] = 0;
    if (kit[PAR.TARGET_LFO1 + i] >= MOD_TARGETS.length) kit[PAR.TARGET_LFO1 + i] = 0;
    if (kit[PAR.VOICE_LFO1 + i] < 1 || kit[PAR.VOICE_LFO1 + i] > 6) kit[PAR.VOICE_LFO1 + i] = 1;
    // a transient that uses a user sample from the SD card gets a built-in wave instead
    const tw = PAR['TRANS' + (i + 1) + '_WAVE'];
    if (kit[tw] >= 14) kit[tw] %= 14;
  }
  return { name, kit: kitToPositions(kit) }; // (the waves, filter types and FM/MIX modes as knob positions)
}

// one voice's sound taken from a kit voice (any voice: the merged voice has every control): its values mapped control by
// control (by merged name), its modulation targets moved to the same controls of the new voice, and its kind. kit: a
// kit's values (a .SND kit has no extras: a control its voice lacks takes the voice's own setting as it comes, a part
// switched off). Returns [[parameter, value], ...] for dst; the sends, the sequencer and the trim are left out
export function mapVoice(kit, src, dst) {
  const S = VOICE_SCHEMAS[src], D = VOICE_SCHEMAS[dst];
  const val = (p) => (p < kit.length ? kit[p] : INIT_VALUES[p]);
  const parMap = new Map(); // source parameter -> destination parameter
  for (const e of S) {
    if (e.hidden && e.ukey !== 'kind') continue;
    if (e.par >= NUM_PARAMS && e.extra === undefined) continue; // (sends, sequencer, trim)
    const d = D.find((x) => x.ukey === e.ukey);
    if (d) parMap.set(e.par, d.par);
  }
  const target = (i) => { // a modulation target index from the source voice's to the destination's
    if (!i) return 0;
    const p = MOD_TARGETS[i] && MOD_TARGETS[i][1], q = parMap.get(p);
    if (voiceOfTarget(i) !== src || src === dst) return i; // aimed at another voice, or onto its own voice: as it is
    if (q === undefined || q >= NUM_PARAMS) return 0; // (an extra can't be modulated yet)
    const [a, b] = MOD_TARGET_VOICE_RANGES[dst];
    for (let k = a; k <= b; k++) if (MOD_TARGETS[k][1] === q) return k;
    return 0;
  };
  const out = [];
  for (const [p, q] of parMap) {
    const e = S.find((x) => x.par === p);
    // the hi-hat's decay: its open one (as the cymbal's decay; the closed one is a different sound)
    let v = src === 5 && e.ukey === 'decay' ? val(PAR.VELOD6_OPEN) : val(p);
    if (e.ukey === 'kind' && KINDS[v] === 'hat') v = KINDS.indexOf('cym'); // (a hi-hat plays as the cymbal, as it always did here)
    out.push([q, e.display.type === 'target' ? target(v) : v]);
  }
  out.push([PAR.VOICE_LFO1 + dst, voiceOfTarget(val(PAR.TARGET_LFO1 + src)) === src ? dst + 1 : val(PAR.VOICE_LFO1 + src)]);
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
