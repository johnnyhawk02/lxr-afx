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
  // FX: the FX tab shows the three effects; a key's sends are knobs on its engine page
  { await p.click('.snd.fx'); await p.waitForTimeout(150);
    const secs = await p.$$eval('#faders .sect h3', (h) => h.map((x) => x.textContent));
    if (secs.join() !== 'ECHO,REVERB,DISTORTION') { errors++; console.log('fx page:', secs); }
    await p.screenshot({ path: `${out}/fx-${w}x${h}.png` });
    await p.click('.snd.fx'); await p.waitForTimeout(150);
    const sends = await p.$$eval('#faders .sect h3', (h) => h.map((x) => x.textContent));
    if (!sends.includes('fx sends')) { errors++; console.log('no fx sends section', sends); }
  }
  await p.close();
}
await b.close();
console.log(errors ? `${errors} problems` : 'no errors');
process.exit(errors ? 1 : 0);
