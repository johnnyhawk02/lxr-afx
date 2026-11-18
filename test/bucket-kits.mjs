// The tests' kits, made from the sound bucket (the app has no kit files): kit k holds the k-th bucket sound of each
// engine voice on that voice (wrapping round where a voice has fewer), as { name, kit, drums }: kit is every
// parameter's value, as the page keeps them, so mapVoice(kit, voice, v) takes a sound off it
import { INIT_VALUES } from '../sound/schema.js';
import { BUCKET } from '../sound/bucket-sounds.js';
import { toVoice } from '../sound/bucket.js';

const byVoice = [0, 1, 2, 3, 4, 5].map((v) => BUCKET.filter((s) => s.voice === v));
const n = Math.max(...byVoice.map((l) => l.length));
export const KITS = Array.from({ length: n }, (_, k) => {
  const kit = INIT_VALUES.slice(), drums = [];
  byVoice.forEach((l, v) => { const s = l[k % l.length]; drums[v] = s.name; for (const [p, x] of toVoice(s, v)) kit[p] = x; });
  return { name: `KIT${k}`, kit, drums };
});
