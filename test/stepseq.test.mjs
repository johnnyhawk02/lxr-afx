// STEP SEQ: a step a hit (HIT), steps in time (STEP TIME, at the tempo, from step 1 at each hit) and SLEW's glide.
//   node test/stepseq.test.mjs
import { LxrInstrument } from '../sound/instrument.js';
import { INIT_VALUES, ALL_PARAMS, stepPar, stepTimePar, stepSlewPar } from '../sound/schema.js';
import { BLOCK, REAL_FS } from '../engine/lxr.js';
let fails = 0, n = 0;
const ok = (c, msg) => { n++; if (!c) { fails++; console.log('FAIL', msg); } };
function make(time, slew) {
  const inst = new LxrInstrument(44140); inst.loadKit(Float64Array.from(INIT_VALUES.subarray(0, ALL_PARAMS)));
  [0, 16, 32, 48, 64, 80, 96, 112].forEach((x, k) => inst.setParam(stepPar(0, k), x));
  inst.setParam(stepTimePar(0), time); inst.setParam(stepSlewPar(0), slew); inst.setBpm(120);
  return inst;
}
// HIT: each hit the next step
{ const i = make(0, 0), got = [];
  for (let h = 0; h < 10; h++) { i.e.trigger(0, 100); i.e.renderBlock(0); got.push(i.e.stepPlayed[0]); }
  ok(got.join() === '0,1,2,3,4,5,6,7,0,1', 'HIT order ' + got); ok(Math.abs(i.e.stepNow[0] - 16 / 127) < 1e-6, 'HIT level'); }
// 1/16 at 120 bpm: a step every 125 ms, from step 1 at a hit
{ const i = make(3, 0), per = 0.125 * REAL_FS / BLOCK;
  i.e.trigger(0, 100);
  for (let b = 0; b < Math.floor(per * 2.5); b++) i.e.renderBlock(0);
  ok(i.e.stepPlayed[0] === 2, '1/16 after 2.5 steps: ' + i.e.stepPlayed[0]);
  i.e.trigger(0, 100); i.e.renderBlock(0); ok(i.e.stepPlayed[0] === 0, 'a hit starts again at step 1'); }
// SLEW: glides, reaching the step's level in time; 0 jumps
{ const i = make(0, 64); i.e.trigger(0, 100); i.e.trigger(0, 100); // (step 2: 16/127, from 0)
  i.e.renderBlock(0); const first = i.e.stepNow[0]; ok(first > 0 && first < 16 / 127 * 0.5, 'slew starts the glide: ' + first);
  for (let b = 0; b < REAL_FS * 3 / BLOCK; b++) i.e.renderBlock(0);
  ok(Math.abs(i.e.stepNow[0] - 16 / 127) < 1e-3, 'slew arrives'); }
console.log(fails ? `${fails} of ${n} STEP SEQ checks failed` : `stepseq: ${n} checks pass`);
process.exit(fails ? 1 : 0);
