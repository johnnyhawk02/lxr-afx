// node test/view3d.mjs [url] [outdir]: the 3D view in a real browser (WebGL in software, so it runs anywhere), at the
// laptop sizes and on a phone. Every control is pressed on the 3D panel, through the canvas, and the check is that the
// app's own state changed as a press on the 2D screen would change it. Writes screenshots; ends "no errors".
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
const { chromium } = createRequire(import.meta.url)('playwright');
const url = process.argv[2] || 'http://localhost:8123/', out = process.argv[3] || '/tmp/shots3d';
mkdirSync(out, { recursive: true });
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
let bad = 0;
const ok = (c, what) => { if (!c) { bad++; console.log('FAIL', what); } else console.log('ok  ', what); };
async function open(w, h, opts = {}) {
  const cx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: opts.dpr || 1, hasTouch: !!opts.touch, isMobile: !!opts.touch });
  const p = await cx.newPage(), errs = [];
  p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => { if (m.type() === 'error' && !/404|MIDI|midi/.test(m.text())) errs.push(m.text()); });
  await p.goto(url + (opts.q || '')); await p.waitForFunction(() => window.afxReady && window.afx3d && afx3d.ready, null, { timeout: 20000 });
  await p.waitForTimeout(1000);
  const at = (sel) => p.evaluate((s) => afx3d.at(document.querySelector(s)), sel);
  const ev = (f, a) => p.evaluate(f, a);
  return { cx, p, errs, at, ev };
}

// ---- the laptop sizes: it fits, nothing of the 2D screen shows, and it draws only when something changes ----
for (const [w, h] of [[1440, 900], [1280, 800], [1440, 760], [1280, 700], [1440, 790]]) {
  const { cx, p, errs, ev } = await open(w, h, { q: '?nostart' });
  ok(await ev(() => afx.view() === '3d' && document.documentElement.classList.contains('v3d')), `${w}x${h}: opens in 3D`);
  const c = await ev(() => { const q = document.querySelector('#v3d').getBoundingClientRect(); return [q.width, q.height]; });
  ok(c[0] === w && c[1] === h, `${w}x${h}: the canvas fills the window`);
  const corners = await ev(() => ['#undo', '#preset-btn', '#fxglobal', '#detail', '.faders .vf.big'].map((s) => afx3d.at(document.querySelector(s))));
  ok(corners.every(([x, y]) => x > 0 && y > 0 && x < w && y < h), `${w}x${h}: the panel's corners are all in the window`);
  const s0 = await ev(() => afx3d.stats().draws); await p.waitForTimeout(1500);
  ok(await ev((n) => afx3d.stats().draws === n, s0), `${w}x${h}: nothing is drawn while nothing changes`);
  await p.screenshot({ path: `${out}/3d-${w}x${h}.png` });
  ok(!errs.length, `${w}x${h}: no page errors ${errs.join(' | ')}`);
  await cx.close();
}

// ---- every kind of control, pressed on the panel at 1440x900 ----
{
  const { cx, p, errs, at, ev } = await open(1440, 900);
  const txt = (s) => ev((s) => document.querySelector(s).textContent, s);
  let [x, y] = await ev(() => { const r = document.querySelector('#start-btn').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; });
  await p.mouse.click(x, y); await p.waitForTimeout(400);
  ok(await ev(() => document.querySelector('#start').hidden), 'START over the panel starts');
  // a knob: dragged up it turns up, its pointer turns with it; a double-click puts it back
  const was = await txt('#faders .vf output');
  [x, y] = await at('#faders .vf .knob');
  await p.mouse.move(x, y); await p.mouse.down(); await p.mouse.move(x, y - 20, { steps: 4 }); await p.mouse.move(x, y - 40, { steps: 4 }); await p.mouse.up(); await p.waitForTimeout(300);
  const now = await txt('#faders .vf output');
  ok(parseInt(now) > parseInt(was), `a knob dragged up turns up (${was} to ${now})`);
  await p.mouse.dblclick(x, y); await p.waitForTimeout(300);
  ok(await txt('#faders .vf output') !== now, 'a double-click on a knob resets it');
  // the wheel and hover change nothing (Johnny's rule)
  const v0 = await txt('#faders .vf output'); await p.mouse.move(x, y); await p.mouse.wheel(0, -400); await p.waitForTimeout(300);
  ok(await txt('#faders .vf output') === v0, 'the wheel over a knob changes nothing');
  // a key of the strip, an engine, a sequencer step, a lock
  [x, y] = await at('#keystrip .k:nth-child(3)'); await p.mouse.click(x, y); await p.waitForTimeout(300);
  ok(await txt('#kh-note') === 'D2', 'a key of the strip picks it');
  [x, y] = await at('#sounds .snd:nth-of-type(3)'); await p.mouse.click(x, y); await p.waitForTimeout(300);
  ok(await txt('#kh-engine') === 'METAL', 'an engine button picks the engine');
  const st = '#faders .sect.seq .st:nth-child(2)', s0 = await ev((s) => document.querySelector(s).getAttribute('aria-pressed'), st);
  [x, y] = await at(st); await p.mouse.click(x, y); await p.waitForTimeout(300);
  ok(await ev((s) => document.querySelector(s).getAttribute('aria-pressed'), st) !== s0, 'a sequencer step toggles');
  [x, y] = await at('#lock-key'); await p.mouse.click(x, y); await p.waitForTimeout(300);
  ok(await ev(() => document.querySelector('#screen').classList.contains('keylocked') || document.body.classList.contains('keylocked') || !!document.querySelector('.keylocked')), 'LOCK KEY locks the key');
  await p.screenshot({ path: `${out}/3d-locked.png` });
  [x, y] = await at('#lock-key'); await p.mouse.click(x, y); await p.waitForTimeout(300);
  // the dice, then UNDO on the panel
  const before = await ev(() => JSON.stringify(afx.keyEdits()));
  [x, y] = await at('#faders .dicebtn'); await p.mouse.click(x, y); await p.waitForTimeout(500);
  ok(await ev(() => JSON.stringify(afx.keyEdits())) !== before, 'the dice gives the key a new sound');
  [x, y] = await at('#undo'); await p.mouse.click(x, y); await p.waitForTimeout(400);
  ok(await ev(() => JSON.stringify(afx.keyEdits())) === before, 'UNDO on the panel takes it back');
  // a list (VEL DEST)
  [x, y] = await at('.vsel select'); await p.mouse.click(x, y); await p.waitForTimeout(300);
  ok(await ev(() => !!document.querySelector('.v3d-list')), 'a list opens over the panel');
  await p.click('.v3d-list button:nth-of-type(3)'); await p.waitForTimeout(300);
  ok(await ev(() => document.querySelector('.vsel select').selectedIndex === 2), 'a choice in it sets the list');
  // the RANDOM menu: opens over the panel, its buttons work, a press on the panel elsewhere closes it
  [x, y] = await at('#menu-btn'); await p.mouse.click(x, y); await p.waitForTimeout(400);
  ok(await ev(() => !document.querySelector('#menu-panel').hidden && document.querySelector('#menu-panel').parentElement.id === 'v3d-ui'), 'RANDOM opens its menu over the panel');
  await p.screenshot({ path: `${out}/3d-menu.png` });
  const k0 = await ev(() => JSON.stringify(afx.patch(0, 48)));
  await p.click('#kit-alter'); await p.waitForTimeout(400);
  ok(await ev(() => JSON.stringify(afx.patch(0, 48))) !== k0, 'ALTER ALL in it alters');
  [x, y] = await at('#fxglobal'); await p.mouse.click(x, y + 200); await p.waitForTimeout(300);
  ok(await ev(() => document.querySelector('#menu-panel').hidden && document.querySelector('#menu-panel').parentElement.id === 'menu'), 'a press elsewhere closes it and puts it back');
  // LOOK: a change of panel colour, kept; 2D VIEW and back
  [x, y] = await at('#view-btn'); await p.mouse.click(x, y); await p.waitForTimeout(300);
  ok(await ev(() => !document.querySelector('#v3d-lookbox').hidden), 'LOOK opens the look settings');
  await p.click('#v3d-lookbox [data-k="panel"] [data-v="silver"]'); await p.waitForTimeout(600);
  ok(await ev(() => afx3d.look().panel === 'silver' && JSON.parse(localStorage.getItem('lxr-afx-look-v1')).look.panel === 'silver'), 'a panel colour is used and kept');
  await p.click('#v3d-lookbox [data-save="0"]');
  await p.click('#v3d-lookbox [data-reset]'); await p.waitForTimeout(400);
  ok(await ev(() => afx3d.look().panel === 'charcoal'), 'RESET gives the look as it comes');
  await p.click('#v3d-lookbox [data-load="0"]'); await p.waitForTimeout(400);
  ok(await ev(() => afx3d.look().panel === 'silver'), 'slot 1 gives back the look kept in it');
  await p.screenshot({ path: `${out}/3d-look.png` });
  await p.click('#v3d-lookbox [data-2d]'); await p.waitForTimeout(500);
  ok(await ev(() => afx.view() === '2d' && !document.querySelector('#v3d') && !window.afx3d && localStorage.getItem('lxr-afx-view') === '2d'), '2D VIEW gives the flat screen, and is kept');
  await p.reload(); await p.waitForFunction(() => window.afxReady); await p.waitForTimeout(500);
  ok(await ev(() => afx.view() === '2d'), 'a reload stays 2D');
  await p.click('#start-btn').catch(() => {}); await p.click('#view-btn'); await p.waitForFunction(() => window.afx3d && afx3d.ready); await p.waitForTimeout(500);
  ok(await ev(() => afx.view() === '3d' && afx3d.look().panel === 'silver'), '3D VIEW brings the panel back, as it looked');
  await ev(() => afx3d.setLook({ ...afx3d.look(), panel: 'charcoal' }));
  ok(!errs.length, `no page errors ${errs.join(' | ')}`);
  await cx.close();
}

// ---- a phone (Pixel 9a size), by touch ----
for (const [w, h] of [[412, 915], [412, 780]]) {
  const { cx, p, errs, at, ev } = await open(w, h, { touch: true, dpr: 2.625 });
  const cdp = await cx.newCDPSession(p), touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y], i) => ({ x, y, id: i })) });
  ok(await ev(() => document.documentElement.classList.contains('phone') && afx3d.dim().w === 400), `${w}x${h}: the phone panel`);
  await p.screenshot({ path: `${out}/3d-phone-${w}x${h}-start.png` });
  await p.tap('#start-btn'); await p.waitForTimeout(400);
  let [x, y] = await at('#pv-pads .pad:nth-child(7)'); await p.touchscreen.tap(x, y); await p.waitForTimeout(400);
  ok((await ev(() => document.querySelector('#pv-key').textContent)) === 'F#2', `${w}x${h}: a pad tapped is the key`);
  const k = await ev(() => JSON.stringify(afx.patch(0, 54)));
  [x, y] = await at('#pv-dice'); await p.touchscreen.tap(x, y); await p.waitForTimeout(500);
  ok(await ev(() => JSON.stringify(afx.patch(0, 54))) !== k, `${w}x${h}: NEW SOUND rolls it`);
  [x, y] = await at('#pv-echo .track');
  await touch('touchStart', [[x - 60, y]]); await touch('touchMove', [[x, y]]); await touch('touchMove', [[x + 40, y]]); await touch('touchEnd', []); await p.waitForTimeout(400);
  ok(+(await ev(() => document.querySelector('#pv-echo output').textContent)) > 40, `${w}x${h}: the ECHO fader slides`);
  const [x1, y1] = await at('#pv-pads .pad:nth-child(1)'), [x2, y2] = await at('#pv-pads .pad:nth-child(25)');
  await touch('touchStart', [[x1, y1]]); await touch('touchStart', [[x1, y1], [x2, y2]]); await p.waitForTimeout(300);
  ok((await ev(() => document.querySelectorAll('#pv-pads .pad.down').length)) === 2, `${w}x${h}: two pads held at once`);
  await p.screenshot({ path: `${out}/3d-phone-${w}x${h}.png` });
  await touch('touchEnd', []); await p.waitForTimeout(300);
  ok((await ev(() => document.querySelectorAll('#pv-pads .pad.down').length)) === 0, `${w}x${h}: and let go`);
  [x, y] = await at('#pv-menu-btn'); await p.touchscreen.tap(x, y); await p.waitForTimeout(400);
  ok(await ev(() => !document.querySelector('#pv-menu').hidden), `${w}x${h}: MENU opens`);
  await p.screenshot({ path: `${out}/3d-phone-${w}x${h}-menu.png` });
  await p.tap('#pv-norhythm'); await p.waitForTimeout(400);
  ok(await ev(() => document.querySelector('#pv-menu').hidden && afx.rand().rhythms === 0), `${w}x${h}: REMOVE ALL RHYTHMS works from it`);
  ok(!errs.length, `${w}x${h}: no page errors ${errs.join(' | ')}`);
  await cx.close();
}

// ---- ?2d gives the flat screen for a visit ----
{ const cx = await b.newContext({ viewport: { width: 1440, height: 900 } }), p = await cx.newPage();
  await p.goto(url + '?2d&nostart'); await p.waitForFunction(() => window.afxReady); await p.waitForTimeout(400);
  ok(await p.evaluate(() => afx.view() === '2d' && !document.querySelector('#v3d')), '?2d opens the 2D screen'); await cx.close(); }

await b.close();
console.log(bad ? `${bad} failed` : 'no errors');
process.exit(bad ? 1 : 0);
