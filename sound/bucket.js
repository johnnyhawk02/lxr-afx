// The SOUND BUCKET: every sound the app plays and makes new sounds from. Every sound saved in the SOUND BLENDER joins
// it (tools/add-to-bucket.mjs), so new sounds become the source of newer ones. The files are bucket/*.json, one per
// sound; tools/build-bucket.mjs bundles them into sound/bucket-sounds.js for the page.
//
// A bucket sound: { name, type, voice, params: { control: value } }
//   name     its own name (made up by the preset namer)
//   type     drum 1, drum 2, drum 3, snare, cymbal or hihat: the kind of sound it is (or is mostly). It goes last in
//            the label the randomisers see, as RECIPES in makers.js look for it
//   voice    the engine voice (0..5) its values are in
//   params   every control of that voice, by its merged name (schema.js MERGED: coarse, decay, cutoff, ...), and each
//            knob's modulation (modsrc:<knob>, modamt:<knob>: schema.js MOD_DIALS)
// toVoice() puts it on any engine voice (schema.js mapVoice), so nothing of it is lost.
import { VOICE_SCHEMAS, NUM_PARAMS, ALL_PARAMS, INIT_VALUES, mapVoice, dec2 } from './schema.js?v=mwmt9v3r';

export const TYPES = ['drum 1', 'drum 2', 'drum 3', 'snare', 'cymbal', 'hihat'];
// the controls a sound keeps: the voice's own and their modulation, not its sends, sequencer or trim (those belong to a key)
const kept = (voice) => VOICE_SCHEMAS[voice].filter((e) => !(e.par >= NUM_PARAMS && e.extra === undefined && !e.mod && !e.table));

// a voice's values ([[parameter, value]] or a Map) as a bucket sound
export function fromVoice(vals, voice, meta) {
  const m = vals instanceof Map ? vals : new Map(vals), params = {};
  for (const e of kept(voice)) params[e.ukey] = dec2(m.has(e.par) ? m.get(e.par) : INIT_VALUES[e.par]);
  // (on the hi-hat's voice, mapVoice plays its open decay as the decay: keep the one it played there)
  if ('decay_open' in params) params.decay_open = params.decay;
  return { ...meta, voice, params };
}
// a bucket sound on an engine voice: [[parameter, value], ...]
export function toVoice(snd, dst) {
  const kit = INIT_VALUES.slice(0, ALL_PARAMS);
  for (const e of kept(snd.voice)) if (snd.params[e.ukey] !== undefined) kit[e.par] = snd.params[e.ukey];
  return mapVoice(kit, snd.voice, dst);
}
// the label the randomisers see: the name, then the type ("NEXUNE drum 3")
export const labelOf = (snd) => `${snd.name} ${snd.type}`;
// a file name for a sound (its name, safe)
export const fileOf = (snd) => `${String(snd.name).replace(/[^A-Za-z0-9_-]/g, '') || 'SOUND'}.json`;
// a sound read from a file someone gave us, checked: a known voice and type, every value a number in its range (a
// decimal is kept to two places)
export function tidy(s) {
  if (!s || typeof s !== 'object' || !s.params || typeof s.params !== 'object') return null;
  const voice = s.voice | 0;
  if (voice < 0 || voice > 5) return null;
  const params = {};
  for (const e of kept(voice)) { const x = s.params[e.ukey]; if (Number.isFinite(x)) params[e.ukey] = Math.max(0, Math.min(e.max, dec2(x))); }
  if (!Object.keys(params).length) return null;
  const name = String(s.name || '').toUpperCase().replace(/[^A-Z0-9 _-]/g, '').slice(0, 18).trim();
  return { name: name || 'SOUND', type: TYPES.includes(s.type) ? s.type : TYPES[voice], voice, params };
}
