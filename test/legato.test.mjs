// node test/legato.test.mjs: each zone mono with last-note priority (the page keeps the held keys; the instrument
// brings an earlier key back on the next RETURN step of the BPM grid). Offline, timing every trigger in beats.
import { LxrInstrument } from '../sound/instrument.js';
import { SEQ_ON_BASE, SEQ_PAT_BASE } from '../sound/schema.js';
let fails = 0, checks = 0;
const ok = (c, m) => { checks++; if (!c) { fails++; console.log('FAIL', m); } };
function rig(ret, pat = 0) {
  const inst = new LxrInstrument(48000), log = [], L = new Float32Array(480), R = new Float32Array(480);
  inst.setFx({ tempo: { bpm: 120, ret } }); inst.setParam(SEQ_ON_BASE + 0, pat ? 1 : 0); inst.setParam(SEQ_PAT_BASE + 0, pat);
  const trig = inst.e.trigger.bind(inst.e); inst.e.trigger = (v, vel, note) => { log.push({ beat: inst.beat, note }); trig(v, vel, note); };
  const until = (beat) => { while (inst.beat < beat) inst.render(L, R); };
  return { inst, log, until };
}
const near = (a, b) => Math.abs(a - b) < 0.02; // a block is 0.003 beats at 120 BPM
// 1/16 (a quarter of a beat): key 62 over key 60, let go at beat 0.8, 60 comes back at beat 1.0
{ const { inst, log, until } = rig(2);
  until(0.1); inst.play(0, 60, 100, null); until(0.6); inst.play(0, 62, 100, null); until(0.8); inst.back(0, 60, 100, null); until(1.5);
  const backs = log.filter((t) => t.beat > 0.7);
  ok(backs.length === 1 && backs[0].note === 60 && near(backs[0].beat, 1.0), '1/16 return: ' + JSON.stringify(backs)); }
// on a step already: not a whole step late
{ const { inst, log, until } = rig(2);
  until(0.5); const b = inst.beat; inst.back(0, 60, 100, null); until(1.0);
  ok(log.length === 1 && log[0].beat - b < 0.26, 'return right after a step: ' + JSON.stringify(log)); }
// NOW: at once
{ const { inst, log, until } = rig(0);
  until(0.37); const b = inst.beat; inst.back(0, 60, 100, null); until(0.6);
  ok(log.length === 1 && log[0].beat - b < 0.01, 'NOW return: ' + JSON.stringify(log)); }
// 1/4: the next beat
{ const { inst, log, until } = rig(4);
  until(1.1); inst.back(0, 60, 100, null); until(2.5);
  ok(log.length === 1 && near(log[0].beat, 2.0), '1/4 return: ' + JSON.stringify(log)); }
// every key let go before the step: nothing comes back
{ const { inst, log, until } = rig(2);
  until(0.3); inst.back(0, 60, 100, null); until(0.4); inst.release(0); until(1.0);
  ok(log.length === 0, 'released before the step: ' + JSON.stringify(log)); }
// a new key before the step: it plays, and the old one doesn't come back over it
{ const { inst, log, until } = rig(2);
  until(0.3); inst.back(0, 60, 100, null); until(0.4); inst.play(0, 64, 100, null); until(1.0);
  ok(log.length === 1 && log[0].note === 64, 'a new key cancels the return: ' + JSON.stringify(log)); }
// the sequencer (steps 1 and 3 of 8, in 1/16s): pressed at beat 0.1, it starts on the next 1/16 (0.25) and loops every
// 2 beats; nothing on the press itself
{ const { inst, log, until } = rig(2, 0b101);
  until(0.1); inst.play(0, 60, 100, null); until(4.1); inst.release(0); until(5);
  const beats = log.map((t) => +t.beat.toFixed(2));
  ok(log.length === 4 && [0.25, 0.75, 2.25, 2.75].every((b, i) => near(log[i].beat, b)), 'sequence steps: ' + beats);
  ok(!log.some((t) => t.beat > 4.1), 'the sequence did not stop on release'); }
// legato with sequences: the newest key's pattern plays, then the earlier key comes back on the grid and starts its
// pattern over from step 1 at that step
{ const { inst, log, until } = rig(2, 0b11111111);
  until(0.1); inst.play(0, 60, 100, null); until(0.6); inst.play(0, 62, 100, null); until(1.1); inst.back(0, 60, 100, null); until(1.8); inst.release(0); until(3);
  const after = log.filter((t) => t.beat > 1.1);
  ok(log.filter((t) => t.note === 62).length >= 2, 'the newest key did not play its steps');
  ok(after.length >= 3 && after.every((t) => t.note === 60) && near(after[0].beat, 1.25) && near(after[1].beat, 1.5), 'steps after the return: ' + JSON.stringify(after)); }
// the pattern edited while the key is held is heard at once; ACTIVE switched off silences the steps
{ const { inst, log, until } = rig(2, 0b1);
  until(0.1); inst.play(0, 60, 100, null); until(0.4); inst.setParam(SEQ_PAT_BASE, 0b11111111); until(1.05); const n = log.length;
  inst.setParam(SEQ_ON_BASE, 0); until(2);
  ok(n === 4 && log.length === n, `live edit: ${n} steps, then ${log.length - n} after ACTIVE off`); }
// the other zones don't care
{ const { inst, log, until } = rig(2);
  until(0.1); inst.back(0, 60, 100, null); inst.play(1, 61, 100, null); until(0.6);
  ok(log.length === 2 && log.some((t) => t.note === 60 && near(t.beat, 0.25)), 'zones not independent: ' + JSON.stringify(log)); }
// a key auditioned (not held) plays once even with its sequence ACTIVE
{ const { inst, log, until } = rig(2, 0b11111111);
  until(0.1); inst.play(0, 60, 100, null, false); until(2);
  ok(log.length === 1, 'an auditioned key repeated: ' + log.length); }
// the echo's SYNC: TIME is a note length at the BPM, and follows the BPM
{ const inst = new LxrInstrument(48000), fs = 44140, echo = { time: 74, feedback: 60, tone: 90, pingpong: 0, sync: 1, div: 7 };
  inst.setFx({ echo, tempo: { bpm: 120, ret: 2 } });
  ok(Math.abs(inst.echo.delay.sync - 0.375 * fs) < 1, 'echo 1/8D at 120: ' + inst.echo.delay.sync);
  inst.setFx({ echo, tempo: { bpm: 90, ret: 2 } });
  ok(Math.abs(inst.echo.delay.sync - 0.5 * fs) < 1, 'echo 1/8D at 90: ' + inst.echo.delay.sync);
  inst.setFx({ echo: { ...echo, sync: 0 }, tempo: { bpm: 90, ret: 2 } });
  ok(Math.abs(inst.echo.delay.sync - 0.219 * fs) < 30, 'echo unsynced: ' + inst.echo.delay.sync); }
console.log(fails ? `${fails} of ${checks} checks failed` : `ok: ${checks} checks`); process.exit(fails ? 1 : 0);
