// node test/shots.mjs [url] [outdir]: screenshots at 1440x900 and 1280x800, after playing a few notes through the
// page's test hook (no MIDI device needed). Fails on any page error.
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
const url = process.argv[2] || 'http://localhost:8123/';
const out = process.argv[3] || 'shots';
const b = await chromium.launch();
let errors = 0;
for (const [w, h] of [[1440, 900], [1280, 800], [1440, 760], [1280, 700]]) {
  const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  p.on('pageerror', (e) => { errors++; console.log('page error:', e.message); });
  p.on('console', (m) => { if (m.type() === 'error') { errors++; console.log('console:', m.text()); } });
  await p.goto(url); await p.waitForTimeout(600);
  await p.screenshot({ path: `${out}/start-${w}x${h}.png` });
  await p.click('#start-btn'); await p.waitForTimeout(800);
    for (const [ch, n] of [[1, 52], [1, 60], [1, 70], [1, 55]]) { await p.evaluate(([c, k]) => window.afx.noteOn(c, k, 110), [ch, n]); await p.waitForTimeout(150); }
  // an edit goes to the last drum key played (G2), not the base
  const before = await p.evaluate(() => JSON.parse(localStorage.getItem('lxr-afx-v3') || 'null'));
  await p.focus('.knob'); for (let i = 0; i < 6; i++) await p.keyboard.press('ArrowUp');
  await p.waitForTimeout(500);
  const after = await p.evaluate(() => JSON.parse(localStorage.getItem('lxr-afx-v3')));
  const edits = after.keyEdits[0]['55'];
  if (!edits || JSON.stringify(after.values) !== JSON.stringify(before ? before.values : after.values)) { errors++; console.log('key edit did not land on G2', edits); }
  // the randomisers pull variants from the kits without errors
  for (const id of ['#rand', '#vary', '#alter', '#kit-rand', '#undo', '#kit-scatter', '#alter', '#undo', '#scatter', '#alter']) { await p.click(id); await p.waitForTimeout(80); }
  await p.evaluate(() => window.afx.noteOn(1, 55, 110));
  await p.waitForTimeout(400);
  { const st = await p.evaluate(() => JSON.parse(localStorage.getItem('lxr-afx-v3')));
    const keys = Object.keys(st.keyEdits[0]).length, labelled = Object.values(st.keyEdits[0]).filter((e) => e._kit).length;
    if (keys !== 8 || labelled !== 8) { errors++; console.log('scatter: drum keys', keys, 'labelled', labelled); } }
  // knobs: filter freq (CC16) on the key just played; LEARN maps CC 30 to the drum's decay
  await p.evaluate(() => { window.afx.noteOn(1, 66, 110); window.afx.cc(16, 20); window.afx.cc(18, 64); });
  await p.click('#learn'); await p.click('.vf .knob');
  await p.evaluate(() => window.afx.cc(99, 1)); // nothing armed yet: ignored as unmapped
  await p.waitForTimeout(400);
  { const st = await p.evaluate(() => JSON.parse(localStorage.getItem('lxr-afx-v3')));
    if (st.sel !== 2 || !st.keyEdits[2]['66'] || st.global.depth !== 50) { errors++; console.log('cc: sel', st.sel, 'edits', st.keyEdits[2]['66'], 'depth', st.global.depth); } }
  await p.keyboard.press('Escape');
  await p.screenshot({ path: `${out}/main-${w}x${h}.png` });
  const scroll = await p.evaluate(() => [document.documentElement.scrollWidth > innerWidth, document.documentElement.scrollHeight > innerHeight]);
  if (scroll.some(Boolean)) { errors++; console.log(`${w}x${h}: page scrolls`, scroll); }
  { const r = await p.evaluate(() => { const b = document.getElementById('screen').getBoundingClientRect(); return [b.right, b.bottom]; });
    if (r[0] > w + 1 || r[1] > h + 1) { errors++; console.log(`${w}x${h}: screen overflows`, r); } }
  // every sound's knobs fit the editor (nothing cut off at the bottom or right)
  for (const k of ['1', '2', '3']) {
    await p.keyboard.press(k); await p.waitForTimeout(80);
    if (k !== '3') await p.screenshot({ path: `${out}/sound${k}-${w}x${h}.png` });
    const clip = await p.evaluate(() => { const f = document.getElementById('faders').getBoundingClientRect();
      return [...document.querySelectorAll('#faders .vf, #faders .vsel')].filter((e) => { const r = e.getBoundingClientRect(); return r.bottom > f.bottom + 1 || r.right > f.right + 1; }).length; });
    if (clip) { errors++; console.log(`${w}x${h} sound ${k}: ${clip} controls cut off`); }
  }

  // NEW SOUND: only the played key changes, and UNDO takes it back
  { const st = () => p.evaluate(() => JSON.parse(localStorage.getItem('lxr-afx-v3')).keyEdits[0]);
    await p.evaluate(() => afx.noteOn(1, 50, 100)); await p.waitForTimeout(50);
    const before = await st();
    await p.click('#rand-key'); await p.waitForTimeout(600);
    const after = await st();
    const changed = Object.keys({ ...before, ...after }).filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]));
    if (changed.join() !== '50' || !after['50']?._kit) { errors++; console.log('new sound: changed', changed, after['50']?._kit); }
    if (w === 1440 && h === 900) await p.screenshot({ path: `${out}/newsound-${w}x${h}.png` });
    await p.click('#undo'); await p.waitForTimeout(300);
    if (JSON.stringify(await st()) !== JSON.stringify(before)) { errors++; console.log('new sound: undo did not restore'); }
  }
  await p.close();
}
await b.close();
console.log(errors ? `${errors} problems` : 'no errors');
process.exit(errors ? 1 : 0);
