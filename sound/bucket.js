// The SOUND BUCKET: every sound the app makes new sounds from. It began as every sound of every kit, taken out one by
// one (tools/extract-bucket.mjs), and every sound saved in the SOUND BLENDER joins it (tools/add-to-bucket.mjs), so
// new sounds become the source of newer ones. The files are bucket/*.json, one per sound; tools/build-bucket.mjs
// bundles them into sound/bucket-sounds.js for the page.
//
// A bucket sound: { name, type, from, voice, params: { control: value } }
//   name     its own name (a kit drum's name from kits/names.json, or a made-up one for a saved sound)
//   type     drum 1, drum 2, drum 3, snare, cymbal or hihat: the kit voice it is (or is mostly) of. It goes last in
//            the label the randomisers see, as RECIPES in makers.js look for it
//   from     where it came from (a kit file and voice, or the two sounds it was blended from)
//   voice    the engine voice (0..5) its values are in
//   params   every control of that voice, by its merged name (schema.js MERGED: coarse, decay, cutoff, ...), and each
//            knob's modulation (modsrc:<knob>, modamt:<knob>: schema.js MOD_DIALS)
// toVoice() puts it on any engine voice, the way a kit sound is (schema.js mapVoice), so nothing of it is lost.
import { VOICE_SCHEMAS, NUM_PARAMS, ALL_PARAMS, INIT_VALUES, mapVoice } from './schema.js?v=mwmf3ffm';

export const TYPES = ['drum 1', 'drum 2', 'drum 3', 'snare', 'cymbal', 'hihat'];
// the controls a sound keeps: the voice's own and their modulation, not its sends, sequencer or trim (those belong to a key)
const kept = (voice) => VOICE_SCHEMAS[voice].filter((e) => !(e.par >= NUM_PARAMS && e.extra === undefined && !e.mod));

// a kit's voice as a bucket sound
export function fromKit(kit, src, meta) {
  const val = (p) => (p < kit.length ? kit[p] : INIT_VALUES[p]);
  const params = {};
  for (const e of kept(src)) params[e.ukey] = val(e.par);
  return { ...meta, type: TYPES[src], voice: src, params };
}
// a voice's values ([[parameter, value]] or a Map) as a bucket sound
export function fromVoice(vals, voice, meta) {
  const m = vals instanceof Map ? vals : new Map(vals), params = {};
  for (const e of kept(voice)) params[e.ukey] = m.has(e.par) ? m.get(e.par) : INIT_VALUES[e.par];
  // (on the hi-hat's voice, mapVoice plays its open decay as the decay: keep the one it played there)
  if ('decay_open' in params) params.decay_open = params.decay;
  return { ...meta, voice, params };
}
// a bucket sound on an engine voice: [[parameter, value], ...], as mapVoice gives a kit sound
export function toVoice(snd, dst) {
  const kit = Uint8Array.from(INIT_VALUES.subarray(0, ALL_PARAMS));
  for (const e of kept(snd.voice)) if (snd.params[e.ukey] !== undefined) kit[e.par] = snd.params[e.ukey];
  return mapVoice(kit, snd.voice, dst);
}
// the label the randomisers see: the name, then the type ("NEXUNE drum 3")
export const labelOf = (snd) => `${snd.name} ${snd.type}`;
// a file name for a sound (its name, safe)
export const fileOf = (snd) => `${String(snd.name).replace(/[^A-Za-z0-9_-]/g, '') || 'SOUND'}.json`;
// a sound read from a file someone gave us, checked: a known voice and type, every value a whole number in 0..255
export function tidy(s) {
  if (!s || typeof s !== 'object' || !s.params || typeof s.params !== 'object') return null;
  const voice = s.voice | 0;
  if (voice < 0 || voice > 5) return null;
  const params = {};
  for (const e of kept(voice)) { const x = s.params[e.ukey]; if (Number.isInteger(x)) params[e.ukey] = Math.max(0, Math.min(e.max, x)); }
  if (!Object.keys(params).length) return null;
  const name = String(s.name || '').toUpperCase().replace(/[^A-Z0-9 _-]/g, '').slice(0, 18).trim();
  return { name: name || 'SOUND', type: TYPES.includes(s.type) ? s.type : TYPES[voice], from: String(s.from || '').slice(0, 160), voice, params };
}
