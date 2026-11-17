// node test/shots.mjs [url] [outdir]: screenshots at 1440x900 and 1280x800, after playing a few notes through the
// page's test hook (no MIDI device needed). Fails on any page error.
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
import { sendPar } from '../sound/schema.js';
const url = process.argv[2] || 'http://localhost:8123/';
const out = process.argv[3] || 'shots';
const b = await chromium.launch();
let errors = 0;
for (const [w, h] of [[1440, 900], [1280, 800], [1440, 760], [1280, 700], [1440, 790]]) {
  const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  // a click on a control, opening the RANDOM menu first if it lives there
  p.mclick = async (id) => { if (!(await p.isVisible(id))) await p.click('#menu-btn'); await p.click(id); await p.keyboard.press('Escape'); };
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
  for (const id of ['#rand', '#vary', '#alter', '#kit-rand', '#undo', '#kit-scatter', '#alter', '#undo', '#scatter', '#alter']) { await p.mclick(id); await p.waitForTimeout(80); }
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
    await knobs[0].focus(); await p.keyboard.press('ArrowUp'); await p.keyboard.press('ArrowUp'); await p.waitForTimeout(120); const s1 = await key();
    await knobs[1].focus(); await p.keyboard.press('ArrowDown'); await p.waitForTimeout(120); const s2 = await key();
    await p.click('#rand-key'); await p.waitForTimeout(500); const s3 = await key();
    await p.click('#clear-key'); await p.waitForTimeout(120); const s4 = await key();
    const back = []; for (let i = 0; i < 4; i++) { await p.click('#undo'); await p.waitForTimeout(150); back.push(await key()); }
    if (new Set([s0, s1, s2, s3, s4]).size !== 5 || back[0] !== s3 || back[1] !== s2 || back[2] !== s1 || back[3] !== s0) {
      errors++; console.log('undo steps:', new Set([s0, s1, s2, s3, s4]).size, back[0] === s3, back[1] === s2, back[2] === s1, back[3] === s0); }
  }
  // LOCK KEY: a locked key keeps its sound through SCATTER, RE-ROLL and a base edit
  { const k = () => p.evaluate(() => JSON.parse(localStorage.getItem('lxr-afx-v3')).keyEdits[0]['51']);
    await p.evaluate(() => afx.noteOn(1, 51, 100)); await p.waitForTimeout(50);
    await p.click('#lock-key'); await p.waitForTimeout(400);
    const snap = await k();
    await p.mclick('#scatter'); await p.waitForTimeout(600);
    await p.keyboard.press('r'); await p.waitForTimeout(50);
    await p.mclick('#rand'); await p.waitForTimeout(600);
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
  // FX: the right column holds this key's sends and the three effects
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
    if (w === 1440 && h === 790) await p.screenshot({ path: `${out}/dirt-on-${w}x${h}.png`, clip: { x: 1090, y: 290, width: 340, height: 300 } });
    await p.click('.sect.dirt h3 .hdb'); await p.click('.sect.dirt .vsw .swb >> nth=2'); await p.click('.sect.dirt >> nth=1 >> h3 .hdb >> nth=1'); await p.click('.sect.dirt >> nth=1 >> h3 .hdb >> nth=1');
    await p.waitForTimeout(600);
  }
  // the grid (Johnny: keep everything on a grid): every engine's knobs sit on the panel's 11 columns, and every
  // control in the right column on its 6
  for (const i of [0, 1, 2]) {
    await p.click(`#sounds .snd >> nth=${i}`); await p.waitForTimeout(100);
    const cols = (sel) => p.evaluate((sel) => new Set([...document.querySelectorAll(sel)].map((k) => { const b = k.getBoundingClientRect(); return Math.round(b.left + b.width / 2); })).size, sel);
    const left = await cols('#faders .sect:not(.sends) .vf .knob'), right = await cols('.fxside .vf .knob, .fxside .vsw .swb, .fxside .envm .segs');
    if (left > 11 || right > 6) { errors++; console.log(`${w}x${h} engine ${i}: knobs on ${left} columns (11 allowed), right column on ${right} (6 allowed)`); }
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
  // the sequencer: a step, ACTIVE and RANDOM change this key's own pattern; NEW SOUND switches a random pattern on
  // about half the time (and off the rest)
  if (w === 1440 && h === 900) {
    await p.evaluate(() => { afx.cc(123, 0); afx.noteOn(1, 50, 100); afx.noteOff(50); }); await p.waitForTimeout(50);
    const [on, pat] = await p.evaluate(() => afx.seqPars(0)), ed = () => p.evaluate(() => afx.keyEdits()[0][50] || {});
    const val = async (par) => { const e = await ed(); return e[par] ?? (await p.evaluate((x) => afx.base(x), par)); };
    const a0 = await val(on); await p.click('.sect.seq .hdb >> nth=0'); const a1 = await val(on);
    const p0 = await val(pat); await p.click('.sect.seq .st >> nth=2'); const p1 = await val(pat);
    await p.click('.sect.seq .hdb >> nth=1'); const r = await ed();
    if (a1 !== 1 - a0 || p1 !== (p0 ^ 4) || r[on] !== 1 || !(r[pat] & 1)) { errors++; console.log('seq edits:', a0, a1, p0, p1, r[on], r[pat]); }
    let ons = 0;
    for (let i = 0; i < 24; i++) { await p.click('#rand-key'); await p.waitForTimeout(30); if ((await ed())[on] === 1) ons++; }
    if (ons < 3 || ons > 21) { errors++; console.log('NEW SOUND turned the sequence on', ons, 'of 24 times'); }
  }
  // RHYTHMS: 0% no key plays a rhythm, 100% every unlocked key does, 40% somewhere between; moving back down to 40%
  // gives the same keys as before; one UNDO takes the drag back
  if (w === 1440 && h === 900) {
    const count = () => p.evaluate(() => { let n = 0, all = 0; afx.sounds.forEach((s, i) => { for (let k = s.zone.lo; k <= s.zone.hi; k++) { all++; if (afx.active(i, k)) n++; } }); return [n, all]; });
    await p.evaluate(() => afx.rhythms(0)); const [n0] = await count();
    await p.evaluate(() => afx.rhythms(40)); const [n40, all] = await count(); const keys40 = await p.evaluate(() => JSON.stringify(afx.keyEdits().map((z) => Object.keys(z).filter((k) => z[k]._r !== undefined && z[k]._r < 0.4))));
    await p.evaluate(() => afx.rhythms(100)); const [n100] = await count();
    await p.evaluate(() => afx.rhythms(40)); const keys40b = await p.evaluate(() => JSON.stringify(afx.keyEdits().map((z) => Object.keys(z).filter((k) => z[k]._r !== undefined && z[k]._r < 0.4))));
    if (n0 !== 0 || n100 < all - 1 || Math.abs(n40 - 10) > 1 || keys40 !== keys40b) { errors++; console.log('rhythms:', n0, n40, n100, all, keys40 === keys40b); }
    await p.evaluate(() => afx.rhythms(50));
    await p.click('#menu-btn'); const bar = await p.isVisible('#rhythm-bars .htrack'); await p.click('#menu-btn');
    if (!bar) { errors++; console.log('no RHYTHMS slider in the RANDOM menu'); }
    // the echo's SYNC: TIME reads a note length, unchanged by the BPM; off again, back to its milliseconds
    { const echoTime = () => p.$$eval('.fxside .vf', (els) => els.find((e) => e.querySelector('.lab')?.textContent === 'time')?.querySelector('output').textContent);
      let sb = null;
      for (const e of await p.$$('.fxside .vsw')) if ((await e.$eval('.lab', (x) => x.textContent)) === 'sync') sb = await e.$('.swb');
      const t0 = await echoTime(); await sb.click(); const t1 = await echoTime(); await p.click('#bpm-up'); const t2 = await echoTime(); await p.click('#bpm-down');
      await sb.click(); const t3 = await echoTime();
      if (!/ms$/.test(t0) || t1 !== '1/8D' || t2 !== '1/8D' || t3 !== t0) { errors++; console.log('echo sync:', t0, t1, t2, t3); } }
    // randomised pans: SCATTER ALL puts every drum key in the centre, the snare's within 20%, the metal's anywhere
    await p.evaluate(() => document.getElementById('kit-scatter').click()); await p.waitForTimeout(400);
    const pans = await p.evaluate(() => afx.sounds.map((s, i) => { const o = []; for (let k = s.zone.lo; k <= s.zone.hi; k++) o.push(afx.pan(i, k)); return o; }));
    const [dr, sn, me] = pans;
    if (!dr.every((x) => x === 63) || !sn.every((x) => x >= 51 && x <= 76) || new Set(sn).size < 2 || !me.some((x) => x < 50 || x > 76)) { errors++; console.log('pans:', JSON.stringify(pans)); }
    // the pan knob reads L/C/R, its ring lit from the top
    const panOut = await p.$$eval('#faders .vf', (els) => els.filter((e) => e.querySelector('.lab')?.textContent === 'pan').map((e) => [e.querySelector('output').textContent, e.querySelectorAll('.tk.on').length, !!e.querySelector('.lr')]));
    if (panOut.length !== 1 || !/^(C|[LR]\d{1,3})$/.test(panOut[0][0]) || (panOut[0][0] === 'C') !== (panOut[0][1] === 1) || !panOut[0][2]) { errors++; console.log('pan knob:', JSON.stringify(panOut)); }
    await p.evaluate(() => document.getElementById('undo').click()); await p.waitForTimeout(100);
  }
  { const has = await p.$$eval('#faders .sect h3', (h) => h.some((x) => x.textContent === 'seq' || x.querySelector?.('.t')?.textContent === 'seq'));
    await p.click('#bpm-up'); const bpm = await p.textContent('#bpm'); await p.click('#bpm-down');
    if (!has || bpm !== '121') { errors++; console.log('repeat:', has, 'bpm', bpm); } }
  await p.close();
}
await b.close();
console.log(errors ? `${errors} problems` : 'no errors');
process.exit(errors ? 1 : 0);
