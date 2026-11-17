// node test/shot3d.mjs [url] [outdir]: the 3D view (three.js) at the laptop sizes, and a check that its knobs, keys
// and engine buttons drive the same state as the 2D screen. Headless Chromium draws WebGL in software here.
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
const [url = 'http://localhost:8123/', out = '/tmp/shots'] = process.argv.slice(2);
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
let errors = 0; const bad = (m) => { errors++; console.log(m); };
for (const [w, h] of [[1440, 900], [1280, 700], [1440, 790]]) {
  const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  p.on('console', (m) => { if (m.type() === 'error') bad('console: ' + m.text()); }); p.on('pageerror', (e) => bad('pageerror: ' + e.message));
  await p.goto(url + '?nostart'); await p.waitForFunction(() => window.afxReady);
  await p.click('#view3d-btn'); await p.waitForFunction(() => window.afx.view3d); await p.waitForTimeout(1500);
  // an engine button
  let at = await p.evaluate(() => afx.view3d.engineAt(1)); await p.mouse.click(at.x, at.y); await p.waitForTimeout(300);
  if (await p.evaluate(() => afx.sel()) !== 1) bad(`${w}x${h}: the SNARE button didn't select the snare`);
  at = await p.evaluate(() => afx.view3d.engineAt(0)); await p.mouse.click(at.x, at.y); await p.waitForTimeout(300);
  // a key: it becomes the key being edited
  at = await p.evaluate(() => afx.view3d.keyAt(4)); await p.mouse.move(at.x, at.y); await p.mouse.down(); await p.waitForTimeout(400); await p.mouse.up();
  const lo = await p.evaluate(() => afx.sounds[0].zone.lo);
  if (await p.evaluate(() => afx.editNote()) !== lo + 4) bad(`${w}x${h}: pressing a key didn't pick it`);
  // a knob: dragged up it goes up, and the 2D knob underneath shows the same value
  const val = () => p.evaluate(() => { const c = afx.controls().rows.flatMap((r) => r).flatMap((s) => s.items).find((c) => c.label === 'cutoff'); return afx.value(c); });
  await p.evaluate(() => { const c = afx.controls().rows.flatMap((r) => r).flatMap((s) => s.items).find((c) => c.label === 'cutoff'); afx.set(c, 40); });
  at = await p.evaluate(() => afx.view3d.knobAt('cutoff'));
  await p.mouse.move(at.x, at.y); await p.mouse.down(); await p.mouse.move(at.x, at.y - 40, { steps: 4 }); await p.mouse.up(); await p.waitForTimeout(200);
  const v = await val(); if (!(v > 60 && v < 85)) bad(`${w}x${h}: dragging CUTOFF up 40px gave ${v}, not about 72`);
  await p.mouse.move(at.x, at.y); await p.mouse.wheel(0, -100); await p.waitForTimeout(200);
  if (await val() !== v + 1) bad(`${w}x${h}: the wheel didn't step CUTOFF`);
  await p.waitForTimeout(400);
  await p.screenshot({ path: `${out}/3d-${w}x${h}.png` });
  // back to 2D
  await p.click('#exit3d'); await p.waitForTimeout(200);
  if (!(await p.isVisible('#faders'))) bad(`${w}x${h}: 2D VIEW didn't bring the 2D screen back`);
  await p.close();
}
await b.close();
console.log(errors ? `${errors} problems` : 'no errors'); process.exit(errors ? 1 : 0);
