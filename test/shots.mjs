// node test/shots.mjs [url] [outdir]: screenshots at 1440x900 and 1280x800, after playing a few notes through the
// page's test hook (no MIDI device needed). Fails on any page error.
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
const url = process.argv[2] || 'http://localhost:8123/';
const out = process.argv[3] || 'shots';
const b = await chromium.launch();
let errors = 0;
for (const [w, h] of [[1440, 900], [1280, 800]]) {
  const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  p.on('pageerror', (e) => { errors++; console.log('page error:', e.message); });
  p.on('console', (m) => { if (m.type() === 'error') { errors++; console.log('console:', m.text()); } });
  await p.goto(url); await p.waitForTimeout(600);
  await p.screenshot({ path: `${out}/start-${w}x${h}.png` });
  await p.click('#start-btn'); await p.waitForTimeout(800);
  await p.click('#chsel button:nth-child(5)'); await p.waitForTimeout(100);
  for (const [ch, n] of [[1, 60], [1, 84], [2, 43], [1, 79]]) { await p.evaluate(([c, k]) => window.afx.noteOn(c, k, 110), [ch, n]); await p.waitForTimeout(150); }
  // an edit goes to the last key played (G4 on drum 3), not the base
  const before = await p.evaluate(() => JSON.parse(localStorage.getItem('lxr-afx-v1') || 'null'));
  await p.focus('.vtrack'); for (let i = 0; i < 6; i++) await p.keyboard.press('ArrowUp');
  await p.waitForTimeout(500);
  const after = await p.evaluate(() => JSON.parse(localStorage.getItem('lxr-afx-v1')));
  const edits = after.keyEdits[2]['79'];
  if (!edits || JSON.stringify(after.values) !== JSON.stringify(before ? before.values : after.values)) { errors++; console.log('key edit did not land on G4 only', edits); }
  await p.screenshot({ path: `${out}/main-${w}x${h}.png` });
  const scroll = await p.evaluate(() => [document.documentElement.scrollWidth > innerWidth, document.documentElement.scrollHeight > innerHeight]);
  if (scroll.some(Boolean)) { errors++; console.log(`${w}x${h}: page scrolls`, scroll); }
  for (const pg of [1, 2, 3, 4]) { await p.click(`#pages button:nth-child(${pg + 1})`); await p.waitForTimeout(100); await p.screenshot({ path: `${out}/page${pg}-${w}x${h}.png` }); }
  await p.close();
}
await b.close();
console.log(errors ? `${errors} problems` : 'no errors');
process.exit(errors ? 1 : 0);
