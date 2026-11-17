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
//   display  { type: 'num' } | { type: 'pm', centre } (shown signed around centre) | { type: 'menu', names }
//            | { type: 'target', voices } (a modulation target menu)
//   morph    how the key morph treats it: 'timbre' (moved around the base), or null (never morphed)
//   weight   timbre morph: how far it may move, as a fraction of its rand range at full depth
//   rand     drum-safe randomiser range: [lo, hi], 'pitch' (semitones around the base) or 'lock' (locked by default)
import { PAR, INIT_KIT } from '../engine/lxr-tables.js';
import { PARAM_DTYPES, VOICE_PAGES, MOD_TARGETS, MOD_TARGET_VOICE_RANGES } from '../engine/lxr-ui-data.js';
import { OSC_WAVE_NAMES, FILTER_TYPE_NAMES, LFO_SYNC_NAMES } from '../engine/lxr.js';
import { EXTRA_CLICK_NAMES } from '../engine/lxr-clicks.js';

export { PAR, MOD_TARGETS, MOD_TARGET_VOICE_RANGES };
export const NUM_PARAMS = PAR.END_OF_SOUND_PARAMETERS;

// AFX mode: three sounds, one per engine type, each on its own zone of the keyboard (MIDI channel 1), no overlap, all
// three able to sound at once. The zones run up from the lowest key, ZONE_SIZES keys each, in this order, to fit the
// 25 keys of a Bass Station 2 at its default octave; each zone's base key is its middle key. The lowest key can be moved
// by octaves on the page (setZoneStart)
export const ZONE_SIZES = [8, 8, 9];
export const DEFAULT_ZONE_START = 48; // the Bass Station 2's lowest key at its default octave (C2 with C3 = MIDI 60)
function zonesFrom(start) {
  let lo = start;
  return ZONE_SIZES.map((n) => { const z = { lo, hi: lo + n - 1, base: lo + Math.floor(n / 2) }; lo += n; return z; });
}
const zone = (i) => zonesFrom(DEFAULT_ZONE_START)[i];
// engineVoice: which of the engine's six voice instances makes it; trigger: the note-on index; sources: the kit voices
// of the same engine type that the randomiser draws from
export const SOUNDS = [
  { id: 'drum', name: 'DRUM', engineVoice: 0, trigger: 0, sources: [0, 1, 2], zone: zone(0) },
  { id: 'snare', name: 'SNARE', engineVoice: 3, trigger: 3, sources: [3], zone: zone(1) },
  { id: 'metal', name: 'METAL', engineVoice: 4, trigger: 4, sources: [4, 5], zone: zone(2) },
];
// move every zone so the lowest starts on start (a MIDI note)
export function setZoneStart(start) { zonesFrom(start).forEach((z, i) => Object.assign(SOUNDS[i].zone, z)); }
// the sound whose zone holds a note, or -1
export const soundOfNote = (note) => SOUNDS.findIndex((s) => note >= s.zone.lo && note <= s.zone.hi);

// the firmware's init kit as parameter values
export const INIT_VALUES = new Uint8Array(NUM_PARAMS);
for (let i = 8; i < NUM_PARAMS; i++) INIT_VALUES[i - 8] = INIT_KIT[i];

const TRANSIENT_NAMES = ['snap', 'offset', 'click', 'click 2', 'tick', 'kick', 'rim', 'drop', 'hat', 'clap', 'kick 2', 'snare',
  'tom', 'snap 2', ...EXTRA_CLICK_NAMES];
const LFO_WAVES = ['sin', 'tri', 'saw up', 'saw dn', 'square', 'random', 'exp up', 'exp dn'];
const AROUND_60 = new Set(['COARSE1', 'COARSE2', 'COARSE3', 'COARSE4', 'COARSE5', 'COARSE6', 'FM_FREQ1', 'FM_FREQ2', 'FM_FREQ3',
  'MOD_OSC_F1_CYM', 'MOD_OSC_F2_CYM', 'MOD_OSC_F1', 'MOD_OSC_F2']);

// range and display of a parameter, from the firmware's parameter_dtypes table
function displayOf(key) {
  const t = PARAM_DTYPES[PAR[key]] || '0B127';
  const menu = (names) => ({ max: names.length - 1, display: { type: 'menu', names } });
  switch (t) {
    case 'PM63': return { max: 127, display: { type: 'pm', centre: AROUND_60.has(key) ? 60 : 63 } };
    case 'ON_OFF': case '0b1': return menu(['off', 'on']);
    case 'menu:WAVEFORM': return menu(OSC_WAVE_NAMES.map((s) => s.toLowerCase()));
    case 'menu:FILTER': return menu(FILTER_TYPE_NAMES.map((s) => s.toLowerCase()));
    case 'menu:TRANS': return menu(TRANSIENT_NAMES);
    case 'menu:LFO_WAVES': return menu(LFO_WAVES);
    case 'menu:SYNC_RATES': return menu(LFO_SYNC_NAMES.map((s) => s.toLowerCase()));
    case 'menu:RETRIGGER': return menu(['off', 'v1', 'v2', 'v3', 'v4', 'v5', 'v6']);
    case 'menu:MIX_FM': return menu(['fm', 'mix']);
    case 'TARGET_SELECTION_VELO': case 'TARGET_SELECTION_LFO': return { max: MOD_TARGETS.length - 1, display: { type: 'target' } };
    default: return { max: 127, display: { type: 'num' } };
  }
}

// the randomiser's drum-safe ranges (elixir-desktop app/randomise.js), by front-panel name
const SAFE = {
  WAVEFORM: 'lock', PWM: 'lock', REPEAT: 'lock', MODE: 'lock', FILTER_TYPE: 'lock', PAN: 'lock', SAMPLE_RATE: 'lock',
  VEL_AMT: 'lock', VEL_MOD_VOL: 'lock', VEL_DEST: 'lock', VOLUME: 'lock',
  FREQ_LFO: 'lock', SYNC_LFO: 'lock', MOD_LFO: 'lock', WAVE_LFO: 'lock', RETRIGGER_LFO: 'lock', OFFSET_LFO: 'lock', TARGET_LFO: 'lock',
  COARSE: 'pitch', FINE: [48, 78], ATTACK: [0, 6], EG_SLOPE: [0, 127], NOISE: [0, 127], MIX: [0, 127],
  PITCH_DECAY: [2, 80], MOD_AMOUNT: [0, 110], FM_AMOUNT: [0, 50], FM_FREQ: [0, 127],
  MOD_OSC1_FREQ: [0, 127], MOD_OSC2_FREQ: [0, 127], MOD_OSC1_GAIN: [0, 127], MOD_OSC2_GAIN: [0, 127],
  TRANSIENT_WAVE: [0, 13], TRANSIENT_VOLUME: [0, 100], TRANSIENT_FREQ: [0, 127],
  FILTER_F: [45, 127], FILTER_RESO: [0, 60], FILTER_DRIVE: [0, 50], DRIVE: [30, 95],
};
// decay ranges differ per voice: kick/tom/snare, cymbal
const DECAY = { 0: [3, 55], 1: [3, 55], 2: [3, 55], 3: [3, 50], 4: [20, 110] };
function randRange(text, voice, key) {
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
  };
}

function buildSchema(voice) {
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

// the schema of each engine voice (index 0..5); a sound's schema is its engine voice's
export const VOICE_SCHEMAS = [0, 1, 2, 3, 4, 5].map(buildSchema);
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

// text for a value of a parameter entry
export function showValue(e, v) {
  const d = e.display;
  if (d.type === 'pm') { const x = v - d.centre; return (x > 0 ? '+' : '') + x; }
  if (d.type === 'menu') return d.names[v] ?? String(v);
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
  return { name, kit };
}

// one voice's sound taken from a kit voice of the same engine type (another drum, or the hi-hat for the metal): its
// values mapped control by control (by front-panel name, in order), and its modulation targets moved to the same
// controls of the new voice. Returns [[parameter, value], ...] for dst; controls the source doesn't have are left out
const ALIAS = { DECAY_OPEN: 'DECAY' }; // the open hat's decay is the cymbal's decay; the closed one has no match
export function mapVoice(kit, src, dst) {
  const key = (sc) => { const seen = {}; return sc.map((e) => { const t = ALIAS[e.text] || e.text; seen[t] = (seen[t] || 0) + 1; return t + '#' + seen[t]; }); };
  const S = VOICE_SCHEMAS[src], D = VOICE_SCHEMAS[dst], ks = key(S), kd = key(D);
  const parMap = new Map(); // source parameter -> destination parameter
  S.forEach((e, i) => { const j = kd.indexOf(ks[i]); if (j >= 0 && !(e.text === 'DECAY_CLOSED')) parMap.set(e.par, D[j].par); });
  const target = (i) => { // a modulation target index from the source voice's to the destination's
    if (!i) return 0;
    const p = MOD_TARGETS[i] && MOD_TARGETS[i][1], q = parMap.get(p);
    if (voiceOfTarget(i) !== src) return i; // aimed at another voice: as it is
    if (q === undefined) return 0;
    const [a, b] = MOD_TARGET_VOICE_RANGES[dst];
    for (let k = a; k <= b; k++) if (MOD_TARGETS[k][1] === q) return k;
    return 0;
  };
  const out = [];
  for (const [p, q] of parMap) {
    const e = S.find((x) => x.par === p);
    out.push([q, e.display.type === 'target' ? target(kit[p]) : kit[p]]);
  }
  out.push([PAR.VOICE_LFO1 + dst, voiceOfTarget(kit[PAR.TARGET_LFO1 + src]) === src ? dst + 1 : kit[PAR.VOICE_LFO1 + src]]);
  return out;
}
