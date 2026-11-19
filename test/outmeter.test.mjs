// node test/outmeter.test.mjs: the output meter (FX + MASTER) reads what goes out: each side's peak after the last soft
// limit, and CLIP only when the mix went over full scale on its way into it. Offline, through the instrument
import { LxrInstrument, FX_DEFAULTS } from '../sound/instrument.js';
let fails = 0, checks = 0;
const ok = (c, m) => { checks++; if (!c) { fails++; console.log('FAIL', m); } };
const FS = 48000;
function run(master) {
  const inst = new LxrInstrument(FS), n = FS / 2, L = new Float32Array(n), R = new Float32Array(n);
  inst.setFx({ master: { ...FX_DEFAULTS.master, ...master } });
  inst.readOut();
  inst.voices[0].play(60, 127, null, false);
  inst.render(L, R);
  const pk = (a) => a.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
  return { out: inst.readOut(), l: pk(L), r: pk(R), after: inst.readOut() };
}
{ const q = run({ level: 30 });
  console.log(`quiet: L ${q.out[0].toFixed(3)} R ${q.out[1].toFixed(3)}, clip ${q.out[2]}${q.out[3]}`);
  ok(q.out[0] > 0.01 && q.out[1] > 0.01, 'a hit shows on the meter');
  ok(Math.abs(q.out[0] - q.l) < 0.02 && Math.abs(q.out[1] - q.r) < 0.02, 'the meter reads the output peaks');
  ok(!q.out[2] && !q.out[3], 'no CLIP when quiet');
  ok(q.after.every((v) => v === 0), 'a read clears it'); }
{ const h = run({ thresh: 0, makeup: 24, level: 100 });
  console.log(`hot: L ${h.out[0].toFixed(3)} R ${h.out[1].toFixed(3)}, clip ${h.out[2]}${h.out[3]}`);
  ok(h.out[2] || h.out[3], 'CLIP when the mix goes over full scale');
  ok(h.out[0] <= 1 && h.out[1] <= 1, 'the output itself stays under full scale'); }
console.log(`${checks - fails}/${checks} output meter checks passed`);
process.exit(fails ? 1 : 0);
