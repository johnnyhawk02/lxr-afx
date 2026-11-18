// Adds the sounds saved in the SOUND BLENDER to the sound bucket: give it the file EXPORT LIST wrote
// (lxr-afx-new-sounds-<date>.json). Each sound is checked (sound/bucket.js tidy) and written to bucket/<NAME>.json;
// a sound already in the bucket (the same name and values, or the same values under another name) is skipped, and a
// name in use by another sound gets -2, -3... Then sound/bucket-sounds.js is rebuilt.
//   node tools/add-to-bucket.mjs ~/Downloads/lxr-afx-new-sounds-2026-11-18.json
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tidy, fileOf } from '../sound/bucket.js';

const file = process.argv[2];
if (!file) { console.error('usage: node tools/add-to-bucket.mjs <exported sounds .json>'); process.exit(1); }
const data = JSON.parse(readFileSync(file, 'utf8')), list = Array.isArray(data) ? data : data.sounds;
if (!Array.isArray(list)) { console.error('no sounds in that file'); process.exit(1); }
const dir = new URL('../bucket/', import.meta.url);
const have = readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(readFileSync(new URL(f, dir), 'utf8')));
const sig = (s) => `${s.voice}|${JSON.stringify(s.params)}`;
const sigs = new Map(have.map((s) => [sig(s), s.name])), taken = new Set(have.map(fileOf));
let added = 0, same = 0, bad = 0;
for (const raw of list) {
  let s = tidy(raw);
  if (!s) { bad++; continue; }
  if (sigs.has(sig(s))) { same++; continue; }
  const base = s.name; let k = 2;
  while (taken.has(fileOf(s))) s = { ...s, name: `${base}-${k++}` };
  taken.add(fileOf(s)); sigs.set(sig(s), s.name);
  writeFileSync(new URL(fileOf(s), dir), JSON.stringify(s, null, 1) + '\n'); added++;
  console.log(`  + ${s.name} (${s.type})`);
}
console.log(`bucket/: ${added} added, ${same} in the bucket already${bad ? `, ${bad} not sounds` : ''}`);
execFileSync(process.execPath, [new URL('build-bucket.mjs', import.meta.url).pathname], { stdio: 'inherit' });
