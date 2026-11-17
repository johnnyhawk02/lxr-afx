// node test/shots.mjs [url] [outdir]: screenshots at 1440x900 and 1280x800, after playing a few notes through the
// page's test hook (no MIDI device needed). Fails on any page error.
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const { chromium } = createRequire(import.meta.url)('playwright');
import { sendPar, VOICE_SCHEMAS, trimPar, TRIM_ZERO } from '../sound/schema.js';
const url = process.argv[2] || 'http://localhost:8123/';
const out = process.argv[3] || 'shots';
const b = await chromium.launch();
let errors = 0;
for (const [w, h] of [[1440, 900], [1280, 800], [1440, 760], [1280, 700], [1440, 790]]) {
  const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  // a click on a control, opening the RANDOM menu first if it lives there
  // a knob turned the only way it turns: pressed and dragged (up: true turns it up), dy pixels
  p.nudge = async (k, up, dy = 14) => { if (typeof k === 'string') k = await p.$(k); const b = await k.boundingBox(), x = b.x + b.width / 2, y = b.y + b.height / 2;
    await p.mouse.move(x, y); await p.mouse.down(); for (let i = 1; i <= 4; i++) await p.mouse.move(x, y + (up ? -1 : 1) * dy * i / 4); await p.mouse.up(); };
  p.mclick = async (id) => { if (!(await p.isVisible(id))) await p.click('#menu-btn'); await p.click(id); await p.keyboard.press('Escape'); };
  // LOW KEY, RETURN, LEARN and BS2 MAP live in SETTINGS: a click on one opens it first
  { const click = p.click.bind(p); p.click = async (sel, o) => { if (/^#(low-up|low-down|ret|learn|cc-reset|bpm-up|bpm-down|bpm)$/.test(sel) && !(await p.isVisible(sel))) {
    await click('#settings-btn'); const r = await click(sel, o); if (sel !== '#learn' && await p.isVisible('#settings-panel')) await click('#settings-btn'); return r; } return click(sel, o); }; }
  p.on('pageerror', (e) => { errors++; console.log('page error:', e.message); });
  p.on('console', (m) => { if (m.type() === 'error') { errors++; console.log('console:', m.text()); } });
  await p.goto(url); await p.waitForTimeout(600);
  await p.screenshot({ path: `${out}/start-${w}x${h}.png` });
  await p.click('#start-btn'); await p.waitForTimeout(800);
    for (const [ch, n] of [[1, 52], [1, 60], [1, 70], [1, 55]]) { await p.evaluate(([c, k]) => window.afx.noteOn(c, k, 110), [ch, n]); await p.waitForTimeout(150); }
  // an edit goes to the last drum key played (G2), not the base
  const before = await p.evaluate(() => JSON.parse(localStorage.getItem('lxr-afx-v3') || 'null'));
  await p.nudge('.knob', true, 30);
  await p.waitForTimeout(500);
  const after = await p.evaluate(() => JSON.parse(localStorage.getItem('lxr-afx-v3')));
  const edits = after.keyEdits[0]['55'];
  if (!edits || JSON.stringify(after.values) !== JSON.stringify(before ? before.values : after.values)) { errors++; console.log('key edit did not land on G2', edits); }
  // the randomisers pull variants from the kits without errors
  for (const id of ['#alter', '#kit-alter', '#undo', '#kit-scatter', '#alter', '#undo', '#scatter', '#alter']) { await p.mclick(id); await p.waitForTimeout(80); }
  await p.evaluate(() => window.afx.noteOn(1, 55, 110));
  await p.waitForTimeout(400);
  { const st = await p.evaluate(() => JSON.parse(localStorage.getItem('lxr-afx-v3')));
    const keys = Object.keys(st.keyEdits[0]).length, labelled = Object.values(st.keyEdits[0]).filter((e) => e._kit).length;
    if (keys !== 8 || labelled !== 8) { errors++; console.log('scatter: drum keys', keys, 'labelled', labelled); } }
  // BREED: RANDOM with NEW SOUNDS FROM on BREED deals every drum key a bred sound (two kit sounds named), then back to KIT
  await p.mclick('#src-breed'); await p.mclick('#scatter'); await p.waitForTimeout(600);
  { const st = await p.evaluate(() => JSON.parse(localStorage.getItem('lxr-afx-v3')));
    const bred = Object.values(st.keyEdits[0]).filter((e) => / × /.test(e._kit || '')).length;
    if (st.rand.source !== 'breed' || bred !== 8) { errors++; console.log('breed: source', st.rand.source, 'bred keys', bred); } }
  if (w === 1440 && h === 900) { await p.click('#menu-btn'); await p.waitForTimeout(150); await p.screenshot({ path: `${out}/breed-menu-${w}x${h}.png` }); await p.keyboard.press('Escape'); }
  await p.mclick('#src-kit');
  // knobs: filter freq (CC16) on the key just played; LEARN maps CC 30 to the drum's decay
  await p.evaluate(() => { window.afx.noteOn(1, 66, 110); window.afx.cc(16, 20); window.afx.cc(18, 64); });
  await p.click('#learn'); await p.click('.vf .knob');
  await p.evaluate(() => window.afx.cc(99, 1)); // nothing armed yet: ignored as unmapped
  await p.waitForTimeout(400);
  { const st = await p.evaluate(() => JSON.parse(localStorage.getItem('lxr-afx-v3')));
    const echo = st.keyEdits[2]['66']?.[sendPar(4, 0)];
    if (st.sel !== 2 || !st.keyEdits[2]['66'] || echo !== 64) { errors++; console.log('cc: sel', st.sel, 'edits', st.keyEdits[2]['66'], 'echo send', echo); } }
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
  // UNDO, several steps: two knobs turned, then NEW SOUND, then CLEAR; four UNDOs bring the key back step by step
  if (w === 1440 && h === 900) {
    const key = () => p.evaluate(() => JSON.stringify(afx.keyEdits()[0]['52'] || null));
    await p.evaluate(() => { afx.cc(123, 0); afx.noteOn(1, 52, 100); }); await p.waitForTimeout(80); await p.evaluate(() => afx.noteOff(52));
    const s0 = await key(), knobs = await p.$$('#faders .vf .knob');
    const turn = async (k) => p.nudge(k, Number(await k.getAttribute('aria-valuenow')) <= 2); // (a way it can move)
    await turn(knobs[0]); await p.waitForTimeout(120); const s1 = await key();
    await turn(knobs[1]); await p.waitForTimeout(120); const s2 = await key();
    await p.click('#rand-key'); await p.waitForTimeout(500); const s3 = await key();
    await p.click('#clear-key'); await p.waitForTimeout(120); const s4 = await key();
    const back = []; for (let i = 0; i < 4; i++) { await p.click('#undo'); await p.waitForTimeout(150); back.push(await key()); }
    if (new Set([s0, s1, s2, s3, s4]).size !== 5 || back[0] !== s3 || back[1] !== s2 || back[2] !== s1 || back[3] !== s0) {
      errors++; console.log('undo steps:', new Set([s0, s1, s2, s3, s4]).size, back[0] === s3, back[1] === s2, back[2] === s1, back[3] === s0); }
  }
  // a hand edit: the knob's label lights and the key says "1 edit"; a double-click puts the control back as dealt
  if (w === 1440 && h === 900) {
    await p.evaluate(() => { afx.cc(123, 0); afx.noteOn(1, 53, 100); }); await p.waitForTimeout(80); await p.evaluate(() => afx.noteOff(53));
    const val = () => p.$eval('#faders .vf output', (o) => o.textContent), lit = () => p.$$eval('#faders .vf.keyed', (e) => e.length);
    const info = () => p.textContent('#kh-info'), dots = () => p.$$eval('#keystrip .k.own', (e) => e.length);
    const v0 = await val(), l0 = await lit(), d0 = await dots(), knob = await p.$('#faders .vf .knob');
    await p.nudge(knob, Number(await knob.getAttribute('aria-valuenow')) <= 2); await p.waitForTimeout(100);
    const v1 = await val(), l1 = await lit(), i1 = await info(), d1 = await dots();
    await knob.dblclick(); await p.waitForTimeout(100);
    const v2 = await val(), l2 = await lit(), i2 = await info();
    if (v1 === v0 || l1 !== l0 + 1 || !/ · 1 edit$/.test(i1) || d1 !== d0 + 1 || v2 !== v0 || l2 !== l0 || / edit/.test(i2)) {
      errors++; console.log('hand edit:', v0, v1, v2, l0, l1, l2, i1, '|', i2, d0, d1); }
    const locks = await p.$$eval('#faders .lock', (b) => [b.length, b.filter((x) => x.querySelector('svg')).length]);
    if (locks[0] < 20 || locks[0] !== locks[1]) { errors++; console.log('lock icons:', locks); }
  }
  // ] and [ step to the next and the previous key (across the zones), playing it
  if (w === 1440 && h === 900) {
    await p.evaluate(() => { afx.cc(123, 0); afx.noteOn(1, 55, 100); }); await p.waitForTimeout(80); await p.evaluate(() => { afx.noteOff(55); document.activeElement.blur(); });
    const at = async () => (await p.textContent('#kh-engine')) + ' ' + (await p.textContent('#kh-num'));
    const k0 = await at(); await p.keyboard.press(']'); await p.waitForTimeout(250); const k1 = await at();
    await p.keyboard.press('ArrowRight'); await p.waitForTimeout(250); const k2 = await at();
    await p.keyboard.press('['); await p.waitForTimeout(150); await p.keyboard.press('['); await p.waitForTimeout(250); const k3 = await at();
    if (k0 !== 'DRUM #55' || k1 !== 'SNARE #56' || k2 !== 'SNARE #57' || k3 !== 'DRUM #55') { errors++; console.log('key steps:', k0, k1, k2, k3); }
  }
  // LOCK KEY: a locked key keeps its sound through SCATTER, RE-ROLL and a base edit
  { const k = () => p.evaluate(() => JSON.parse(localStorage.getItem('lxr-afx-v3')).keyEdits[0]['51']);
    await p.evaluate(() => afx.noteOn(1, 51, 100)); await p.waitForTimeout(50);
    await p.click('#lock-key'); await p.waitForTimeout(400);
    const snap = await k();
    await p.mclick('#scatter'); await p.waitForTimeout(600);
    await p.keyboard.press('r'); await p.waitForTimeout(50);
    await p.mclick('#alter'); await p.waitForTimeout(600);
    await p.keyboard.press('k'); await p.waitForTimeout(300);
    if (!snap?._lock || JSON.stringify(await k()) !== JSON.stringify(snap)) { errors++; console.log('lock key: changed', snap?._lock); }
    if (w === 1440 && h === 900) await p.screenshot({ path: `${out}/lockkey-${w}x${h}.png` });
    if (w === 1280 && h === 700) await p.screenshot({ path: `${out}/lockkey-${w}x${h}.png` });
    await p.click('#lock-key'); await p.waitForTimeout(400);
    if ((await k())?._lock) { errors++; console.log('lock key: did not unlock'); }
  }
  // COPY / PASTE: Ctrl+C on one key, Ctrl+V on another plays the same sound; onto another engine it maps; UNDO
  { const ke = () => p.evaluate(() => JSON.parse(localStorage.getItem('lxr-afx-v3')).keyEdits);
    await p.evaluate(() => afx.noteOn(1, 50, 100)); await p.waitForTimeout(50);
    await p.keyboard.press('Control+c');
    await p.evaluate(() => afx.noteOn(1, 49, 100)); await p.waitForTimeout(50);
    await p.keyboard.press('Control+v'); await p.waitForTimeout(700);
    const a = await ke(), src = a[0]['50'] || {}, dst = a[0]['49'];
    const diff = dst ? Object.keys(dst).filter((k) => k[0] !== '_' && src[k] !== undefined && src[k] !== dst[k]) : ['none'];
    if (!dst || !dst._kit || diff.length) { errors++; console.log('paste: differs', diff); }
    await p.evaluate(() => afx.noteOn(1, 58, 100)); await p.waitForTimeout(50);
    const before = (await ke())[1]['58'];
    await p.click('#paste-key'); await p.waitForTimeout(600);
    if (!(await ke())[1]['58']?._kit) { errors++; console.log('paste across engines: nothing'); }
    if (w === 1440 && h === 760) await p.screenshot({ path: `${out}/paste-${w}x${h}.png` });
    await p.click('#undo'); await p.waitForTimeout(400);
    if (JSON.stringify((await ke())[1]['58']) !== JSON.stringify(before)) { errors++; console.log('paste: undo did not restore'); }
  }
  // FX: the key's sends sit with its knobs; the effects and the master on the FX + MASTER tab (F)
  await p.click('#fx-tab'); await p.waitForTimeout(150);
  { const secs = await p.$$eval('.fxside .sect h3', (h) => h.map((x) => (x.querySelector('.t') || x).textContent));
    const sends = await p.$$eval('#faders .sect', (v) => v.filter((x) => x.querySelector('h3')?.textContent === 'fx sends')[0]?.querySelectorAll('.vf').length);
    if (secs.join() !== 'ECHO,REVERB,DISTORTION,SIDECHAIN,COMPRESSOR,OUTPUT' || sends !== 2) { errors++; console.log('fx column:', secs, sends); }
    const clip = await p.evaluate(() => { const f = document.querySelector('.fxside').getBoundingClientRect(), sc = document.getElementById('screen').getBoundingClientRect();
      return [...document.querySelectorAll('.fxside .vf, .fxside .envm, .fxside .hdb')].filter((e) => { const r = e.getBoundingClientRect(); return r.bottom > sc.bottom - 8 || r.right > sc.right - 8; }).length; });
    if (clip) { errors++; console.log(`${w}x${h}: ${clip} fx knobs cut off`); }
    // the master distortion: its ON switch, a switch in a knob's place, the sidechain's sentence; all saved
    const dirt = () => p.evaluate(() => JSON.parse(localStorage.getItem('lxr-afx-v3')).fx.dirt);
    await p.click('.sect.dirt h3 .hdb'); await p.click('.sect.dirt .vsw .swb >> nth=2'); await p.click('.sect.dirt >> nth=1 >> h3 .hdb >> nth=1');
    await p.waitForTimeout(600);
    { const d = await dirt(), off = await p.$$eval('.sect.dirt.off', (v) => v.length);
      if (!d || d.on !== 1 || d.clip !== 1 || d.target !== 2 || off !== 1) { errors++; console.log('distortion switches:', d, off); } }
    if (w === 1440 && h === 790) await p.screenshot({ path: `${out}/dirt-on-${w}x${h}.png` });
    if (h === 790 || h === 700) await p.screenshot({ path: `${out}/fx-tab-${w}x${h}.png` });
    await p.click('.sect.dirt h3 .hdb'); await p.click('.sect.dirt .vsw .swb >> nth=2'); await p.click('.sect.dirt >> nth=1 >> h3 .hdb >> nth=1'); await p.click('.sect.dirt >> nth=1 >> h3 .hdb >> nth=1');
    await p.waitForTimeout(600);
  }
  // the grid (Johnny: keep everything on a grid): every engine's knobs sit on the panel's 14 columns, and the FX +
  // MASTER tab's controls on its three columns of 5, 6 and 6
  const cols = (sel) => p.evaluate((sel) => new Set([...document.querySelectorAll(sel)].map((k) => { const b = k.getBoundingClientRect(); return Math.round(b.left + b.width / 2); })).size, sel);
  { const right = await cols('.fxside .vf .knob, .fxside .vsw .swb, .fxside .envm .segs');
    if (right > 17) { errors++; console.log(`${w}x${h}: the FX tab on ${right} columns (17 allowed)`); } }
  for (const i of [0, 1, 2]) {
    await p.click(`#sounds .snd >> nth=${i}`); await p.waitForTimeout(100);
    const left = await cols('#faders .sect:not(.sends) .vf .knob');
    if (left > 14) { errors++; console.log(`${w}x${h} engine ${i}: knobs on ${left} columns (14 allowed)`); }
  }
  await p.click('#sounds .snd >> nth=0');
  // legato, last-note priority per zone: hold D2, press E2 (same zone), a snare in between; letting go of E2 goes back
  // to D2 (the key shown), letting go of the snare changes nothing in the drum zone; RETURN steps through its settings
  { const key = () => p.textContent('#kh-note');
    await p.evaluate(() => { afx.cc(123, 0); afx.noteOn(1, 50, 100); afx.noteOn(1, 52, 100); });
    const a = await key();
    await p.evaluate(() => { afx.noteOn(1, 57, 100); afx.noteOff(57); afx.noteOff(52); }); const b = await key();
    await p.evaluate(() => afx.noteOff(50));
    await p.click('#ret'); const r1 = await p.textContent('#ret'); await p.click('#ret', { modifiers: ['Shift'] }); const r0 = await p.textContent('#ret');
    if (a !== 'E2' || b !== 'D2' || r1 !== '1/8' || r0 !== '1/16') { errors++; console.log('legato:', a, b, r1, r0); } }
  // no sequencer (Johnny, 2026-11-17): no SEQ section, no RHYTHMS slider, and no key runs a rhythm, whatever NEW SOUND deals
  if (w === 1440 && h === 900) {
    const count = () => p.evaluate(() => { let n = 0; afx.sounds.forEach((s, i) => { for (let k = s.zone.lo; k <= s.zone.hi; k++) if (afx.active(i, k)) n++; }); return n; });
    await p.evaluate(() => { afx.cc(123, 0); afx.noteOn(1, 50, 100); afx.noteOff(50); }); await p.waitForTimeout(50);
    for (let i = 0; i < 8; i++) { await p.click('#rand-key'); await p.waitForTimeout(30); }
    const n = await count(), seq = await p.$$eval('.sect.seq, #rhythm-bars, .k.run', (e) => e.length);
    if (n || seq) { errors++; console.log('no sequencer:', n, 'keys run a rhythm,', seq, 'sequencer parts on screen'); }
  }
  { await p.click('#bpm-up'); const bpm = await p.textContent('#bpm'); await p.click('#bpm-down');
    if (bpm !== '121') { errors++; console.log('bpm', bpm); } }
  // NEW SOUND is the dice at the top right of the synth block (not in the key header any more): its cell is the last
  // two columns of the first row, above FX SENDS; a press deals the key a new sound, changes the face and rolls; K too
  { await p.evaluate(() => { afx.cc(123, 0); afx.noteOn(1, afx.sounds[0].zone.lo + 1, 100); }); await p.waitForTimeout(80); await p.evaluate(() => afx.noteOff(afx.sounds[0].zone.lo + 1));
    const g = await p.evaluate(() => { const r = (el) => el.getBoundingClientRect(), d = r(document.getElementById('rand-key')), cell = r(document.querySelector('#faders .sect.dice')), f = r(document.getElementById('faders')),
      sends = r(document.querySelector('#faders .sect.sends')), lvl = r(document.querySelector('#faders .vf.big .knob'));
      return { inHead: !!document.querySelector('#keyhead #rand-key'), right: f.right - cell.right, top: cell.top - f.top, above: sends.top - cell.bottom, sameCol: Math.abs(cell.left - sends.left) + Math.abs(cell.right - sends.right),
        axis: Math.abs((d.left + d.right) / 2 - (lvl.left + lvl.right) / 2), square: Math.abs(d.width - d.height), inside: d.top >= cell.top && d.bottom <= cell.bottom, size: d.width }; });
    if (g.inHead || g.right > 14 || g.top > 14 || g.above < 0 || g.above > 14 || g.sameCol > 1 || g.axis > 1.5 || g.square > 0.5 || !g.inside || g.size < 44) { errors++; console.log(`${w}x${h} dice:`, JSON.stringify(g)); }
    const name = () => p.textContent('#kh-info'), face = () => p.getAttribute('#rand-key', 'data-face');
    const n0 = await name(), f0 = await face(); await p.click('#rand-key'); const rolling = await p.evaluate(() => document.getElementById('rand-key').classList.contains('roll'));
    await p.waitForTimeout(450); const n1 = await name(), f1 = await face(), done = await p.evaluate(() => !document.getElementById('rand-key').classList.contains('roll'));
    await p.evaluate(() => document.activeElement.blur()); await p.keyboard.press('k'); await p.waitForTimeout(450); const n2 = await name(), f2 = await face();
    if (n1 === n0 || n2 === n1 || !rolling || !done || !/^[1-6]$/.test(f1) || !/^[1-6]$/.test(f2)) { errors++; console.log('dice roll:', JSON.stringify([n0, n1, n2, f0, f1, f2, rolling, done])); }
    await p.click('#undo'); await p.waitForTimeout(100); await p.click('#undo'); await p.waitForTimeout(100); }
  // AUTO LEVEL: SCATTER ALL and ALTER ALL trim every key they deal (a locked key keeps its own), the AUTO chip at the
  // head of LEVEL takes a key's trim off and puts it back (ALL KEYS: the zone's), UNDO takes that back, and with AUTO
  // LEVEL off in the RANDOM menu a new sound plays untrimmed
  { const trims = () => p.evaluate(() => afx.sounds.map((s, i) => { const o = []; for (let k = s.zone.lo; k <= s.zone.hi; k++) o.push(afx.trim(i, k)); return o; }));
    const tap = (sound, i) => p.evaluate(async ([sound, i]) => { const n = afx.sounds[sound].zone.lo + i; afx.cc(123, 0); afx.noteOn(1, n, 100); await new Promise((r) => setTimeout(r, 60)); afx.noteOff(n); }, [sound, i]);
    const chip = async () => [await p.textContent('#auto-level'), await p.getAttribute('#auto-level', 'aria-pressed')];
    const menu = (id) => p.evaluate((id) => document.getElementById(id).click(), id);
    await tap(0, 2); await p.waitForTimeout(150); await p.click('#lock-key'); await p.waitForTimeout(100);
    const t0 = await trims();
    await menu('kit-scatter'); await p.waitForTimeout(500); const t1 = await trims();
    await menu('kit-alter'); await p.waitForTimeout(500); const t2 = await trims();
    const nz = (t) => t.flat().filter((x) => x !== 0).length, moved = (a, b) => a.flat().filter((x, i) => x !== b.flat()[i]).length;
    if (nz(t1) < 18 || nz(t2) < 18 || moved(t0, t1) < 15 || t1[0][2] !== t0[0][2] || t2[0][2] !== t0[0][2] || t2.flat().some((x) => x < -16 || x > 12 || (x * 4) % 1))
      { errors++; console.log('auto level:', JSON.stringify([t0, t1, t2])); }
    await p.click('#lock-key'); await p.waitForTimeout(100);
    // a snare key that has a trim: the chip shows it; a press measures it again and keeps it (never switches it off)
    const i = t2[1].findIndex((x) => x !== 0); await tap(1, i); await p.waitForTimeout(200);
    const c0 = await chip(); await p.click('#auto-level'); const c1 = await chip(), still = (await trims())[1][i];
    if (c0[1] !== 'true' || !/^AUTO [+-]\d+\.\ddB$/.test(c0[0]) || c1[0] !== c0[0] || c1[1] !== 'true' || still !== t2[1][i])
      { errors++; console.log('auto chip:', JSON.stringify([c0, c1, still, t2[1][i]])); }
    // off: NEW SOUND deals the key its sound as the kit made it
    await menu('auto-on'); await tap(1, i); await p.waitForTimeout(150); await p.click('#rand-key'); await p.waitForTimeout(400);
    const offTrim = (await trims())[1][i], offChip = await chip();
    await menu('auto-on');
    if (offTrim !== 0 || offChip[0] !== 'AUTO 0dB') { errors++; console.log('auto level off:', offTrim, offChip); }
    // LEVEL (this engine) and LEVEL ALL even out the keys as they are, their sounds untouched; UNDO takes it back
    await p.evaluate(([t, z]) => { for (const ed of Object.values(afx.keyEdits()[1])) if (ed && ed[t] !== undefined) ed[t] = z; }, [trimPar(3), TRIM_ZERO]); // (every snare key's correction off first)
    await p.waitForTimeout(100);
    const snd = () => p.evaluate(() => JSON.stringify(afx.sounds.map((s, i) => { const o = []; for (let k = s.zone.lo; k <= s.zone.hi; k++) o.push(afx.patch(i, k).filter(([par]) => par < 247)); return o; })));
    const s0 = await snd(), l0 = await trims();
    await menu('level'); await p.waitForTimeout(400); const l1 = await trims();
    await menu('kit-level'); await p.waitForTimeout(500); const l2 = await trims(), s2 = await snd();
    await p.click('#undo'); await p.waitForTimeout(100); const l3 = await trims();
    const J = JSON.stringify;
    if (l0[1].some((x) => x !== 0) || nz([l1[1]]) < 5 || J(l1[0]) !== J(l0[0]) || J(l1[2]) !== J(l0[2]) || nz(l2) < 18 || J(l2[1]) !== J(l1[1]) || s2 !== s0 || J(l3) !== J(l1))
      { errors++; console.log('level keys:', J([l0, l1, l2, l3]), s2 === s0); }
    await p.evaluate(() => afx.cc(123, 0)); }
  // INIT PATCH: a new patch. With a locked key it asks first (the first press changes nothing); then every key has a
  // fresh kit sound and no lock, 8 of the 25 keys a reverb send and 5 an echo send (30% and 20%), the rest none, the
  // pans and rhythms as SCATTER ALL deals them, levelled; BPM, the effects and the master are back at their starting
  // settings (RETURN stays); UNDO brings the old patch back, its lock, its effects and its tempo too
  { const state = () => p.evaluate(([e, r]) => afx.sounds.map((s, i) => { const o = []; for (let k = s.zone.lo; k <= s.zone.hi; k++) { const m = new Map(afx.patch(i, k)), ed = afx.keyEdits()[i][k] || {};
      o.push({ echo: m.get(e[s.engineVoice]), rev: m.get(r[s.engineVoice]), kit: ed._kit || '', lock: !!ed._lock, pan: afx.pan(i, k), on: afx.active(i, k), trim: afx.trim(i, k) }); } return o; }),
      [[0, 1, 2, 3, 4, 5].map((v) => sendPar(v, 0)), [0, 1, 2, 3, 4, 5].map((v) => sendPar(v, 1))]);
    const press = () => p.evaluate(() => document.getElementById('init-patch').click()), J = JSON.stringify;
    await p.evaluate(() => { afx.cc(123, 0); const n = afx.sounds[2].zone.lo + 4; afx.noteOn(1, n, 100); afx.noteOff(n); }); await p.waitForTimeout(150);
    await p.click('#lock-key'); await p.waitForTimeout(100);
    const fxNow = () => p.evaluate(() => [JSON.stringify(afx.fx()), document.getElementById('bpm').textContent, document.getElementById('ret').textContent]);
    const fx0 = await fxNow(); // (set off the defaults: three presses of BPM +, one of RETURN, and a control of each effect)
    await p.evaluate(() => { const f = afx.fx(); f.echo.feedback = 99; f.reverb.size = 10; f.dirt.on = 1; f.master.thresh = 30; f.master.level = 50; });
    for (let i = 0; i < 3; i++) await p.click('#bpm-up'); await p.click('#ret'); const fx1 = await fxNow();
    const before = await state(); await press(); await p.waitForTimeout(150);
    const asked = await state(), armed = await p.getAttribute('#init-patch', 'aria-pressed'), info = await p.textContent('#init-info');
    await press(); await p.waitForTimeout(600); const st = await state(), all = st.flat(), fx2 = await fxNow();
    { const want = await p.evaluate(() => { const d = structuredClone(afx.fxDefaults); d.tempo.ret = afx.fx().tempo.ret; return JSON.stringify(d); }), got = JSON.parse(fx2[0]), w = JSON.parse(want);
      const same = Object.keys(w).every((k) => Object.keys(w[k]).every((f) => got[k][f] === w[k][f]));
      if (fx1[1] !== '123' || fx1[2] === fx0[2] || !same || fx2[1] !== '120' || fx2[2] !== fx1[2]) { errors++; console.log('init patch, effects:', fx1[1], fx1[2], fx2[1], fx2[2], same, fx2[0]); } }
    const rev = all.filter((k) => k.rev > 0), ech = all.filter((k) => k.echo > 0), ons = st.map((z) => z.filter((k) => k.on).length);
    if (J(asked) !== J(before) || armed !== 'true' || !/1 LOCKED KEY/.test(info)) { errors++; console.log('init patch, asking:', armed, info, J(asked) === J(before)); }
    if (all.length !== 25 || all.some((k) => !k.kit || k.lock) || rev.length !== 8 || ech.length !== 5 || rev.some((k) => k.rev < 45 || k.rev > 95) || ech.some((k) => k.echo < 40 || k.echo > 85)
      || !st[0].every((k) => k.pan === 63) || !st[1].every((k) => k.pan >= 51 && k.pan <= 76) || J(ons) !== J([0, 0, 0]) || all.filter((k) => k.trim !== 0).length < 18)
      { errors++; console.log('init patch:', 'reverb', rev.length, 'echo', ech.length, 'rhythms', J(ons), J(all.map((k) => [k.kit, k.lock, k.echo, k.rev, k.pan, k.trim]))); }
    await p.waitForTimeout(100); await press(); await p.waitForTimeout(600); const again = await state(); // nothing locked now: one press
    if (J(again.flat().map((k) => k.kit)) === J(all.map((k) => k.kit)) || again.flat().filter((k) => k.rev > 0).length !== 8) { errors++; console.log('init patch, second: the same patch again'); }
    await p.click('#undo'); await p.waitForTimeout(100); await p.click('#undo'); await p.waitForTimeout(150); const back = await state();
    if (J(back) !== J(before)) { errors++; console.log('init patch, undo:', J(back.flat().map((k) => [k.kit, k.lock])), J(before.flat().map((k) => [k.kit, k.lock]))); }
    const fx3 = await fxNow(); if (J(fx3) !== J(fx1)) { errors++; console.log('init patch, undo, effects:', J(fx3), J(fx1)); }
    await p.evaluate((was) => { const f = afx.fx(), w = JSON.parse(was); for (const k in w) Object.assign(f[k], w[k], k === 'tempo' ? { bpm: f.tempo.bpm, ret: f.tempo.ret } : {}); }, fx0[0]); // (and back as they were, for the checks below)
    for (let i = 0; i < 3; i++) await p.click('#bpm-down'); await p.click('#ret', { modifiers: ['Shift'] });
    const fx4 = await fxNow(); if (J(fx4) !== J(fx0)) { errors++; console.log('init patch, effects put back:', J(fx4), J(fx0)); }
    await p.click('#lock-key'); await p.waitForTimeout(100); }
  // KNOB PADLOCKS: none is closed as it comes. A locked knob keeps its setting on every key through the dice, ALTER
  // KEY, ALTER, RANDOM, their ALL versions and INIT PATCH, and the message line names it. A new sound brings its own
  // waveforms and switches; ALTER leaves those alone unless WILD. RANDOM keeps every key's sends; a locked send keeps
  // them through INIT PATCH too. UNLOCK ALL opens every padlock
  { const sc = VOICE_SCHEMAS[0], D = sc.find((e) => e.label === 'decay').par, still = sc.filter((e) => e.rand === 'still' && e.display.type !== 'target').map((e) => e.par), REV = sendPar(0, 1);
    const J = JSON.stringify, bad = (what, ...x) => { errors++; console.log(`padlocks, ${what}:`, J(x).slice(0, 600)); };
    const zone = () => p.evaluate(() => { const s = afx.sounds[0], o = []; for (let k = s.zone.lo; k <= s.zone.hi; k++) o.push(Object.fromEntries(afx.patch(0, k))); return o; });
    const sends = () => p.evaluate((sp) => afx.sounds.flatMap((s, i) => { const o = []; for (let k = s.zone.lo; k <= s.zone.hi; k++) { const m = new Map(afx.patch(i, k)); o.push([m.get(sp[0][s.engineVoice]), m.get(sp[1][s.engineVoice])]); } return o; }),
      [[0, 1, 2, 3, 4, 5].map((v) => sendPar(v, 0)), [0, 1, 2, 3, 4, 5].map((v) => sendPar(v, 1))]);
    const press = async (id, ms = 450) => { await p.evaluate((id) => document.getElementById(id).click(), id); await p.waitForTimeout(ms);
      const cut = await p.evaluate(() => { const d = document.getElementById('detail'); return d.scrollWidth > d.clientWidth + 1 && d.textContent; }); if (cut) bad('the message is cut off', cut);
      return [await zone(), await p.textContent('#detail')]; };
    const padlock = (label, dx = 0, dy = 0) => p.evaluate(([label, dx, dy]) => { const vf = [...document.querySelectorAll('#faders .vf')].find((v) => v.querySelector('.lab')?.textContent.trim().toLowerCase() === label), r = vf.querySelector('.lock').getBoundingClientRect(); return [r.right + dx, r.top + dy]; }, [label, dx, dy]);
    const fxWas = await p.evaluate(() => JSON.stringify(afx.fx()));
    await p.evaluate(() => { afx.cc(123, 0); const n = afx.sounds[0].zone.lo + 2; afx.noteOn(1, n, 100); afx.noteOff(n); }); await p.waitForTimeout(200);
    const open = await p.evaluate(() => [afx.locks().length, document.getElementById('lock-count').textContent, document.getElementById('lock-none').disabled, document.querySelectorAll('#faders .lock[aria-pressed="true"]').length]);
    if (open[0] !== 0 || open[1] !== 'NONE LOCKED' || !open[2] || open[3] !== 0) bad('as it comes', open);
    const at = await padlock('decay', 3, -3); await p.mouse.click(at[0], at[1]); await p.waitForTimeout(150); // (a press just outside the little padlock still lands on it)
    const shut = await p.evaluate(() => [afx.locks(), document.getElementById('lock-count').textContent, document.getElementById('detail').textContent]);
    if (J(shut[0]) !== J([D]) || shut[1] !== '1 LOCKED' || !/DECAY locked/.test(shut[2])) bad('locking', shut);
    let was = await zone(); const decays = J(was.map((k) => k[D])), moved = (a, b, pars) => a.reduce((n, k, i) => n + pars.filter((q) => k[q] !== b[i][q]).length, 0), others = sc.map((e) => e.par).filter((q) => q !== D && q < 247);
    for (const [id, what, alter] of [['rand-key', 'the dice'], ['alter-key', 'ALTER KEY', 1], ['alter', 'ALTER', 1], ['scatter', 'RANDOM'], ['kit-alter', 'ALTER ALL', 1], ['kit-scatter', 'RANDOM ALL'], ['init-patch', 'INIT PATCH']]) {
      const [now, msg] = await press(id, id === 'init-patch' ? 650 : 450);
      if (J(now.map((k) => k[D])) !== decays || !/locked DECAY kept/.test(msg) || !moved(was, now, others)) bad(what, now.map((k) => k[D]), decays, msg, moved(was, now, others));
      if (alter && moved(was, now, still)) bad(what + ' moved a switch', moved(was, now, still));
      if (id === 'scatter' && !moved(was, now, still)) bad('RANDOM brought no switch of its own');
      was = now;
    }
    await p.evaluate(() => document.getElementById('wild').click()); const [wild] = await press('kit-alter'); await p.evaluate(() => document.getElementById('wild').click());
    if (!moved(was, wild, still) || J(wild.map((k) => k[D])) !== decays) bad('WILD', moved(was, wild, still));
    // the sends: INIT PATCH dealt them (8 reverb, 5 echo), RANDOM ALL and ALTER ALL leave them; with the drum's reverb send locked INIT PATCH keeps the drum keys' reverb
    const s0 = await sends(); await press('kit-scatter'); await press('kit-alter'); const s1 = await sends();
    if (J(s1) !== J(s0) || s0.filter((k) => k[1] > 0).length !== 8 || s0.filter((k) => k[0] > 0).length !== 5) bad('sends through RANDOM ALL and ALTER ALL', s0, s1);
    const ra = await padlock('reverb', -6, 8); await p.mouse.click(ra[0], ra[1]); await p.waitForTimeout(150);
    const two = await p.evaluate(() => [afx.locks().length, document.getElementById('lock-count').textContent]);
    const [, msg2] = await press('init-patch', 650), s2 = await sends();
    const longest = await p.evaluate(() => { const d = document.getElementById('detail'), em = d.querySelectorAll('em'); em[0].textContent = 'WWWWWWW WWWWWWW'; em[1].textContent = 'WWWWWWW, WWWWWWW'; return [em.length, d.scrollWidth, d.clientWidth]; }); // (with the longest name it makes up, and the longest list of locked knobs)
    if (longest[0] !== 2 || longest[1] > longest[2] + 1) bad('the INIT PATCH message at its longest is cut off', longest);
    if (two[0] !== 2 || two[1] !== '2 LOCKED' || J(s2.slice(0, 8).map((k) => k[1])) !== J(s1.slice(0, 8).map((k) => k[1])) || J(s2) === J(s1) || !/locked DECAY, REVERB kept/.test(msg2)) bad('a locked send through INIT PATCH', two, msg2, s1.slice(0, 8), s2.slice(0, 8));
    await press('lock-none', 150); const none = await p.evaluate(() => [afx.locks().length, document.getElementById('lock-count').textContent, document.getElementById('lock-none').disabled, document.getElementById('detail').textContent]);
    const [free, msg3] = await press('scatter');
    if (none[0] !== 0 || none[1] !== 'NONE LOCKED' || !none[2] || !/2 knobs unlocked/.test(none[3]) || J(free.map((k) => k[D])) === decays || /kept/.test(msg3)) bad('UNLOCK ALL', none, msg3);
    await p.evaluate((was) => afx.setFx(JSON.parse(was)), fxWas); }
  // PRESETS: the patch's name in the top bar (made up, marked * until saved). SAVE keeps it; a change marks it again,
  // REVERT goes back and UNDO brings the change back; INIT PATCH starts a new unsaved one; a saved preset loads with its
  // effects (the BPM) wherever LOW KEY has the keys, and UNDO goes back, effects and name too; a typed name, NEW NAME,
  // SAVE AS NEW, delete (two presses), EXPORT and IMPORT
  { const P = () => p.evaluate(() => ({ id: afx.presets.now().id, n: afx.presets.list().length, dirty: afx.presets.dirty(), name: document.getElementById('preset-name').textContent,
      mark: document.getElementById('preset-mark').textContent, bpm: document.getElementById('bpm').textContent, stored: (JSON.parse(localStorage.getItem('lxr-afx-presets-v1')) || []).length }));
    const sig = () => p.evaluate(() => JSON.stringify(afx.sounds.map((s, i) => { const o = []; for (let k = s.zone.lo; k <= s.zone.hi; k++) o.push(afx.patch(i, k)); return o; })));
    const press = (id) => p.evaluate((id) => document.getElementById(id).click(), id), settle = () => p.waitForTimeout(450); // (the mark follows the page's save, 300 ms on)
    const state = () => p.textContent('#preset-state'), bad = (what, ...x) => { errors++; console.log(`presets, ${what}:`, JSON.stringify(x)); };
    const NAME = /^[A-Z]{6,10}$|^[A-Z]{4,7} [A-Z]{4,7}$/;
    await p.evaluate(() => afx.cc(123, 0)); await settle();
    const a0 = await P(); await p.click('#preset-btn'); await p.waitForTimeout(100); const st0 = await state();
    await press('preset-save'); await settle(); const a1 = await P(), st1 = await state(), s1 = await sig();
    if (!NAME.test(a0.name) || a0.mark !== '*' || a0.id !== null || a0.n !== 0 || st0 !== 'NOT SAVED YET' || a1.n !== 1 || a1.stored !== 1 || a1.mark !== '' || !a1.id || st1 !== 'SAVED') bad('save', a0, st0, a1, st1);
    await press('kit-alter'); await settle(); const a2 = await P(), s2 = await sig();
    await press('preset-revert'); await settle(); const a3 = await P(), s3 = await sig();
    await press('undo'); await settle(); const a4 = await P(), s4 = await sig();
    if (a2.mark !== '*' || !a2.dirty || s2 === s1 || a3.mark !== '' || s3 !== s1 || a4.mark !== '*' || s4 !== s2 || a4.id !== a1.id) bad('change, revert, undo', a2, a3, a4, s2 === s1, s3 === s1, s4 === s2);
    await press('preset-save'); await settle();
    await press('init-patch'); await p.waitForTimeout(600); await p.click('#bpm-up'); await settle(); const b0 = await P();
    await p.click('#preset-btn'); await press('preset-save'); await settle(); const b1 = await P(), sB = await sig();
    if (b0.id !== null || b0.name === a1.name || !NAME.test(b0.name) || b0.mark !== '*' || b0.bpm !== '121' || b1.n !== 2 || b1.mark !== '' || b1.name !== b0.name) bad('init patch, second preset', b0, b1);
    await p.click('#low-up'); await p.click('#preset-btn'); await p.waitForTimeout(100);
    await p.evaluate((name) => [...document.querySelectorAll('#preset-list .pload')].find((x) => x.textContent === name).click(), a1.name); await p.waitForTimeout(600);
    const c1 = await P(), sC = await sig(), where = await p.evaluate(() => afx.sounds.map((s, i) => Object.keys(afx.keyEdits()[i]).every((n) => n >= s.zone.lo && n <= s.zone.hi) && Object.keys(afx.keyEdits()[i]).length));
    await press('undo'); await settle(); const c2 = await P(), sU = await sig(); await p.click('#low-down');
    if (c1.id !== a1.id || c1.name !== a1.name || c1.bpm !== '120' || sC !== s2 || c1.mark !== '' || JSON.stringify(where) !== '[8,8,9]' || c2.name !== b1.name || c2.id !== b1.id || c2.bpm !== '121' || sU !== sB || c2.mark !== '')
      bad('load, undo', c1, where, c2, sC === s2, sU === sB);
    await p.click('#preset-btn'); await p.waitForTimeout(100); const info0 = await p.textContent('#kh-info');
    await p.fill('#preset-input', ''); await p.click('#preset-input'); await p.keyboard.type('kazoo <b>1'); await p.keyboard.press('Enter'); await settle();
    const d1 = await P(), info1 = await p.textContent('#kh-info'), listed = await p.$$eval('#preset-list .pload', (els) => els.map((e) => e.textContent));
    await press('preset-roll'); await settle(); const d2 = await P();
    if (d1.name !== 'KAZOO B1' || info1 !== info0 || !listed.includes('KAZOO B1') || d1.mark !== '' || d1.id !== b1.id || d2.name === d1.name || !NAME.test(d2.name) || d2.id !== d1.id || d2.mark !== '') bad('names', d1, listed, d2, info0, info1);
    await press('preset-save-new'); await settle(); const e1 = await P(), del = '#preset-list .prow[aria-current="true"] .pdel';
    await p.click(del); const sure = await p.textContent(del), e2 = await P(); await p.click(del); await settle(); const e3 = await P();
    if (e1.n !== 3 || e1.id === d2.id || e1.name === d2.name || sure !== 'SURE?' || e2.n !== 3 || e3.n !== 2 || e3.id !== null || e3.mark !== '*' || e3.stored !== 2) bad('save as new, delete', e1, sure, e2, e3);
    const [dl] = await Promise.all([p.waitForEvent('download'), press('preset-export')]);
    const text = readFileSync(await dl.path(), 'utf8'), file = JSON.parse(text), imp = (t) => p.evaluate((t) => afx.presets.import(t), t);
    const im1 = await imp(text); await p.click('#preset-list .pdel'); await p.click('#preset-list .pdel'); await settle(); const f0 = await P();
    const im2 = await imp(text), f1 = await P(), im3 = (await imp('{"hello": 1}')) + (await imp('not json'));
    const evil = { presets: [{ ...file.presets[0], id: 'zzzzzz1', name: '<img src=x onerror=alert(1)>bad', data: { ...file.presets[0].data, keys: [{ 0: { _kit: '<i>x</i>', 5: 999, _lock: 1 }, 99: { 5: 1 } }, {}, {}] } }] };
    const im4 = await imp(JSON.stringify(evil)), got = await p.evaluate(() => { const x = afx.presets.list().find((q) => q.id === 'zzzzzz1'); return x && [x.name, x.data.keys[0][0], Object.keys(x.data.keys[0])]; });
    if (file.app !== 'lxr-afx' || file.presets.length !== 2 || im1 !== 0 || f0.n !== 1 || im2 !== 1 || f1.n !== 2 || f1.stored !== 2 || im3 !== 0 || im4 !== 1 || !got || /[<>=()]/.test(got[0]) || got[0].length > 18
      || /[<>]/.test(got[1]._kit) || got[1][5] !== 255 || got[1]._lock !== true || got[2].join() !== '0') bad('export, import', file.presets.length, im1, f0, im2, f1, im3, im4, got);
    await p.keyboard.press('Escape'); const shut = await p.evaluate(() => document.getElementById('preset-panel').hidden);
    const bar = await p.evaluate(() => { const r = (id) => document.getElementById(id).getBoundingClientRect(), b = r('preset-btn'), l = r('last'), lt = document.getElementById('last-text'); return [b.left > r('screen').left, document.getElementById('last').offsetWidth, [...document.getElementById('last').parentElement.children].map((c) => (c.id || c.className) + ' ' + c.offsetWidth).join(' | ') + ' · ' + lt.textContent]; });
    if (!shut || !bar[0] || bar[1] < 175) bad('top bar', shut, bar); } // (room left for the last note, whatever the name's length)
  // the scroll wheel and the trackpad change nothing, with the pointer over a knob, an effect's knob, a menu or the BPM
  { const read = () => p.evaluate(() => [...document.querySelectorAll('.knob')].map((k) => k.getAttribute('aria-valuenow')).join() + '|' + [...document.querySelectorAll('select')].map((s) => s.value).join() + '|' + document.getElementById('bpm').textContent);
    const before = await read(); let n = 0;
    for (const sel of ['#faders .vf .knob', '#faders .vf.big .knob', '.fxside .knob', '#faders select']) {
      if (sel === '.fxside .knob') await p.click('#fx-tab'); else if (await p.evaluate(() => !document.getElementById('fxside').hidden)) await p.click('#fx-tab');
      const el = await p.$(sel); if (!el) { errors++; console.log('wheel: no', sel); continue; }
      const box = await el.boundingBox(); await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      for (const dy of [-240, 360]) { await p.mouse.wheel(0, dy); await p.waitForTimeout(30); if (await read() !== before) n++; }
    }
    if (n) { errors++; console.log('the wheel changed a control', n, 'times'); } }
  await p.close();
}
// settings kept from before the padlocks changed: the knobs that used to be locked as they came (waveforms, switches, the
// LFO, LEVEL, the sends) are open again, a knob locked by hand stays locked, and the sounds are as they were
{ const p = await b.newPage({ viewport: { width: 1440, height: 790 } });
  p.on('pageerror', (e) => { errors++; console.log('page error (kept settings):', e.message); });
  await p.goto(url); await p.waitForFunction(() => window.afxReady); await p.click('#start-btn'); await p.waitForTimeout(500);
  const sc = VOICE_SCHEMAS[0], D = sc.find((e) => e.label === 'decay').par, old = VOICE_SCHEMAS.flat().filter((e) => e.rand === 'still' || e.rand === 'mix').map((e) => e.par);
  const sig = () => p.evaluate(() => JSON.stringify(afx.sounds.map((s, i) => { const o = []; for (let k = s.zone.lo; k <= s.zone.hi; k++) o.push(afx.patch(i, k)); return o; })));
  await p.evaluate(() => { document.getElementById('bpm-up').click(); document.getElementById('bpm-down').click(); }); await p.waitForTimeout(500); const before = await sig(); // (the page has kept its settings by now)
  await p.evaluate(([old, D]) => { const d = JSON.parse(localStorage.getItem('lxr-afx-v3')); delete d.lockRule; d.locks = [...old, D]; localStorage.setItem('lxr-afx-v3', JSON.stringify(d)); }, [old, D]);
  await p.reload(); await p.waitForFunction(() => window.afxReady);
  const got = await p.evaluate(() => [afx.locks(), document.getElementById('lock-count').textContent]), after = await sig();
  if (old.length < 50 || JSON.stringify(got[0]) !== JSON.stringify([D]) || got[1] !== '1 LOCKED' || after !== before) { errors++; console.log('kept settings:', old.length, JSON.stringify(got), after === before); }
  await p.close(); }
// THE PHONE VIEW: a phone held upright (a Pixel 9a's 412 x 923, with and without the browser's bars, and a small
// 360 x 640) gets 25 pads on a five-column grid and nothing scrolls; a pad plays and picks its key, held like a key,
// several at once; NEW SOUND rolls the pad pressed last, UNDO takes it back; the ECHO and REVERB bars set that key's
// sends; LOCK locks the key; INIT PATCH and RANDOM ALL deal new sounds; the message line says what happened. MENU (top
// right) opens a menu of the RANDOM menu's presses. ?desktop keeps the big screen on a phone and ?phone
// gives the phone view anywhere
for (const [w, h] of [[412, 780], [412, 915], [360, 640]]) {
  const cx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2.625, hasTouch: true, isMobile: true });
  const p = await cx.newPage(), cdp = await cx.newCDPSession(p), J = JSON.stringify;
  const bad = (what, ...x) => { errors++; console.log(`phone ${w}x${h}, ${what}:`, J(x).slice(0, 500)); };
  p.on('pageerror', (e) => bad('page error', e.message));
  await p.goto(url); await p.waitForFunction(() => window.afxReady); await p.waitForTimeout(400);
  const lay = await p.evaluate(() => { const r = (e) => e.getBoundingClientRect(), pads = [...document.querySelectorAll('#pv-pads .pad')], xs = [...new Set(pads.map((e) => Math.round(r(e).left)))];
    return { phone: document.documentElement.classList.contains('phone'), pads: pads.length, xs, small: pads.filter((e) => r(e).width < 44 || r(e).height < 44).length,
      scroll: [document.documentElement.scrollWidth - innerWidth, document.documentElement.scrollHeight - innerHeight], inner: [innerWidth, innerHeight],
      out: [...document.querySelectorAll('#pv > *, #pv button, #pv .track')].filter((e) => r(e).left < 0 || r(e).right > innerWidth + 0.5 || r(e).top < 0 || r(e).bottom > innerHeight + 0.5).map((e) => e.id || e.className),
      offGrid: [...document.querySelectorAll('.pv-row > button, .pv-send .track')].filter((e) => !xs.includes(Math.round(r(e).left))).map((e) => e.id || e.className),
      shown: [...document.querySelectorAll('.top, .main, .keyhead, #faders')].filter((e) => e.offsetParent !== null).length, start: getComputedStyle(document.getElementById('start-phone')).display !== 'none' && !document.getElementById('start').hidden,
      labels: [pads[0], pads[8], pads[24]].map((e) => e.textContent) }; });
  if (!lay.phone || lay.pads !== 25 || lay.xs.length !== 5 || lay.small || lay.scroll[0] > 0 || lay.scroll[1] > 0 || lay.inner[0] !== w || lay.out.length || lay.offGrid.length || lay.shown || !lay.start
    || J(lay.labels) !== J(['C2DRUM', 'G#2SNARE', 'C4METAL'])) bad('layout', lay);
  await p.tap('#start-btn'); await p.waitForTimeout(500);
  const mid = async (sel, n = 0, fx = 0.5) => { const r = await p.locator(sel).nth(n).boundingBox(); return { x: r.x + r.width * fx, y: r.y + r.height / 2 }; };
  const st = () => p.evaluate(() => { const sel = document.querySelector('.pad.sel'), i = [...document.querySelectorAll('.pad')].indexOf(sel), s = i < 8 ? 0 : i < 16 ? 1 : 2, note = 48 + i, ed = afx.keyEdits()[s][note] || {}, m = new Map(afx.patch(s, note)), v = afx.sounds[s].engineVoice;
    return { i, key: document.getElementById('pv-key').textContent, what: document.getElementById('pv-what').textContent, kit: ed._kit, lock: !!ed._lock, sends: [...afx.seqPars(v)].length && [m.get(afx.sendPars(v)[0]), m.get(afx.sendPars(v)[1])],
      outs: [document.querySelector('#pv-echo output').textContent, document.querySelector('#pv-reverb output').textContent], msg: document.getElementById('pv-msg').textContent, undo: !document.getElementById('pv-undo').disabled,
      down: document.querySelectorAll('.pad.down').length, name: document.getElementById('pv-name').textContent, big: document.getElementById('kh-note').textContent, dice: document.getElementById('pv-dice').disabled, lockBtn: document.getElementById('pv-lock').textContent }; });
  // a tap plays and picks the pad
  const at9 = await mid('.pad', 9); await p.touchscreen.tap(at9.x, at9.y); await p.waitForTimeout(250); const a = await st();
  if (a.i !== 9 || a.key !== 'A2' || a.big !== 'A2' || !/^SNARE · /.test(a.what) || a.down !== 0 || !/SNARE/.test(await p.textContent('#last-text'))) bad('a tap', a, await p.textContent('#last-text'));
  // two fingers hold two pads; letting go lets both go
  const at2 = await mid('.pad', 2), at20 = await mid('.pad', 20);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: at2.x, y: at2.y, id: 1 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: at2.x, y: at2.y, id: 1 }, { x: at20.x, y: at20.y, id: 2 }] }); await p.waitForTimeout(200);
  const two = await st(); await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await p.waitForTimeout(200); const none = await st();
  if (two.down !== 2 || two.i !== 20 || two.key !== 'G#3' || none.down !== 0) bad('two fingers', two.down, two.i, two.key, none.down);
  // NEW SOUND on the pad pressed last, and UNDO
  await p.touchscreen.tap(at9.x, at9.y); await p.waitForTimeout(200); const b0 = await st();
  await p.tap('#pv-dice'); await p.waitForTimeout(600); const b1 = await st();
  await p.tap('#pv-undo'); await p.waitForTimeout(300); const b2 = await st();
  if (!b0.kit || b1.kit === b0.kit || !b1.msg.includes(b1.kit) || !b1.undo || !b1.what.includes(b1.kit) || b2.kit !== b0.kit || !/undone/.test(b2.msg)) bad('new sound, undo', b0.kit, b1.kit, b1.msg, b2.kit, b2.msg);
  // the sends: a touch on the bar sets it, a drag follows the finger
  const e50 = await mid('#pv-echo .track', 0, 0.5); await p.touchscreen.tap(e50.x, e50.y); await p.waitForTimeout(150); const c1 = await st();
  const r0 = await mid('#pv-reverb .track', 0, 0.2), r1 = await mid('#pv-reverb .track', 0, 1.2);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: r0.x, y: r0.y, id: 1 }] }); await p.waitForTimeout(60); const c2 = await st();
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: r1.x, y: r1.y, id: 1 }] }); await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await p.waitForTimeout(150); const c3 = await st();
  if (Math.abs(c1.sends[0] - 64) > 3 || c1.outs[0] !== String(c1.sends[0]) || Math.abs(c2.sends[1] - 25) > 4 || c3.sends[1] !== 127 || c3.outs[1] !== '127' || c3.sends[0] !== c1.sends[0] || !/REVERB send 127/.test(c3.msg)) bad('sends', c1.sends, c1.outs, c2.sends, c3.sends, c3.outs, c3.msg);
  // LOCK: the pad shows it, NEW SOUND and the sends leave it alone; INIT PATCH asks first
  await p.tap('#pv-lock'); await p.waitForTimeout(200); const d1 = await st(), padLocked = await p.evaluate(() => document.querySelectorAll('.pad.locked').length);
  await p.touchscreen.tap(e50.x - 40, e50.y); await p.waitForTimeout(150); const d2 = await st();
  await p.tap('#pv-init'); await p.waitForTimeout(200); const ask = await p.textContent('#pv-init'), d3 = await st();
  await p.tap('#pv-init'); await p.waitForTimeout(700); const d4 = await st(), initBtn = await p.textContent('#pv-init');
  if (!d1.lock || padLocked !== 1 || !d1.dice || d1.lockBtn !== 'LOCKED' || d2.sends[0] !== c1.sends[0] || ask !== 'PRESS AGAIN' || d3.kit !== d1.kit || d4.kit === d1.kit || d4.lock || d4.name === d3.name || initBtn !== 'INIT PATCH' || d4.dice || !/new patch/.test(d4.msg))
    bad('lock, init patch', d1.lock, padLocked, d1.dice, d1.lockBtn, d2.sends, ask, d3.kit, d4.kit, d4.lock, d4.name, initBtn, d4.msg);
  await p.tap('#pv-random'); await p.waitForTimeout(600); const f1 = await st(); await p.tap('#pv-alter'); await p.waitForTimeout(400); const f2 = await st();
  if (f1.kit === d4.kit || !/all three engines/.test(f1.msg) || !/altered/.test(f2.msg) || f2.kit !== f1.kit) bad('random all, alter', d4.kit, f1.kit, f1.msg, f2.msg);
  // MENU, on the fifth column. It covers the pads and the buttons down to the message line; a press does its thing
  // and closes it. No pad runs a rhythm (the sequencer is gone)
  const menu = () => p.evaluate(() => ({ run: document.querySelectorAll('.pad.run').length, share: afx.rand().rhythms, open: !document.getElementById('pv-menu').hidden, btn: document.getElementById('pv-menu-btn').textContent,
    msg: document.getElementById('pv-msg').textContent,
    kits: [0, 1, 2].map((s) => Object.values(afx.keyEdits()[s]).map((e) => e._kit).join()), eng: [document.getElementById('pv-rand-eng').textContent, document.getElementById('pv-alter-eng').textContent, document.getElementById('pv-rand-eng-cap').textContent] }));
  const press = async (id) => { await p.tap('#pv-menu-btn'); await p.waitForTimeout(150); await p.tap(id); await p.waitForTimeout(450); return menu(); };
  const m0 = await menu(); await p.tap('#pv-menu-btn'); await p.waitForTimeout(200); const m1 = await menu();
  const ml = await p.evaluate(() => { const r = (e) => e.getBoundingClientRect(), mid = (e) => { const x = r(e); return document.elementFromPoint(x.left + x.width / 2, x.top + x.height / 2); }, m = document.getElementById('pv-menu'),
      items = [...m.querySelectorAll('button')], xs = [...new Set([...document.querySelectorAll('.pad')].map((e) => Math.round(r(e).left)))], msg = document.getElementById('pv-msg');
    return { first: items[0].textContent, n: items.length, small: items.filter((e) => r(e).height < 44).length, out: [...m.children].filter((e) => r(e).bottom > r(m).bottom + 0.5 || r(e).right > innerWidth || r(e).left < 0).length,
      covers: [document.querySelectorAll('.pad')[12], document.querySelectorAll('.pad')[24], document.getElementById('pv-init'), document.getElementById('pv-undo'), document.querySelector('#pv-echo .track')].every((e) => m.contains(mid(e))),
      msgSeen: mid(msg) === msg || msg.contains(mid(msg)), onGrid: xs.includes(Math.round(r(document.getElementById('pv-menu-btn')).left)), btnH: Math.round(r(document.getElementById('pv-menu-btn')).height) }; });
  if (w === 412 && h === 915) await p.screenshot({ path: `${out}/phone-menu.png` });
  if (m0.run || m0.open || m0.btn !== 'MENU' || !m1.open || m1.btn !== 'CLOSE' || !/^RANDOM: /.test(ml.first) || ml.n !== 3 || ml.small || ml.out || !ml.covers || !ml.msgSeen || !ml.onGrid || ml.btnH < 40)
    bad('the menu', m0.run, m0.open, m0.btn, m1.open, m1.btn, ml);
  await p.tap('#pv-menu-btn'); await p.waitForTimeout(150); const m7 = await menu();
  // RANDOM and ALTER for the engine of the pad pressed last, and ALTER ALL
  await p.touchscreen.tap(at9.x, at9.y); await p.waitForTimeout(250);
  const m8 = await press('#pv-rand-eng'), m9 = await press('#pv-alter-eng'), m10 = await press('#pv-alter-all');
  if (J(m8.eng) !== J(['RANDOM: SNARE KEYS', 'ALTER: SNARE KEYS', 'A NEW KIT SOUND ON EACH OF THE 8 SNARE KEYS']) || m8.kits[1] === m7.kits[1] || m8.kits[0] !== m7.kits[0] || m8.kits[2] !== m7.kits[2] || !/^SNARE: a new kit sound on every key/.test(m8.msg)
    || !/^SNARE: every key altered/.test(m9.msg) || !/^all three engines: every key altered/.test(m10.msg) || J(m10.kits) !== J(m8.kits) || m10.open) bad('the menu\'s random and alter', m8.eng, m8.msg, m9.msg, m10.msg, m10.open);
  const end = await p.evaluate(() => [document.documentElement.scrollWidth - innerWidth, document.documentElement.scrollHeight - innerHeight, Math.round(document.getElementById('pv-msg').getBoundingClientRect().bottom) <= innerHeight]);
  if (end[0] > 0 || end[1] > 0 || !end[2]) bad('it scrolls after use', end);
  if (w === 412) await p.screenshot({ path: `${out}/phone-${w}x${h}.png` });
  // ?desktop: the big screen on the phone
  if (h === 780) { await p.goto(url + '?desktop'); await p.waitForFunction(() => window.afxReady); await p.waitForTimeout(300);
    const dk = await p.evaluate(() => [document.documentElement.classList.contains('phone'), getComputedStyle(document.getElementById('pv')).display, document.querySelector('.top').offsetParent !== null]);
    if (dk[0] || dk[1] !== 'none' || !dk[2]) bad('?desktop', dk); }
  await cx.close();
}
// ?phone on a computer: the phone view, unscaled; without it the computer never gets the phone view
{ const p = await b.newPage({ viewport: { width: 1280, height: 800 } });
  await p.goto(url + '?phone'); await p.waitForFunction(() => window.afxReady); await p.waitForTimeout(300);
  const ph = await p.evaluate(() => [document.documentElement.classList.contains('phone'), document.getElementById('screen').getAttribute('style'), document.querySelectorAll('.pad').length, Math.round(document.getElementById('screen').getBoundingClientRect().width)]);
  await p.goto(url); await p.waitForFunction(() => window.afxReady); await p.waitForTimeout(300);
  const dk = await p.evaluate(() => [document.documentElement.classList.contains('phone'), getComputedStyle(document.getElementById('pv')).display]);
  if (!ph[0] || ph[1] || ph[2] !== 25 || ph[3] > 520 || dk[0] || dk[1] !== 'none') { errors++; console.log('?phone on a computer:', JSON.stringify([ph, dk])); }
  await p.close(); }
await b.close();
console.log(errors ? `${errors} problems` : 'no errors');
process.exit(errors ? 1 : 0);
