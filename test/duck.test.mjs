// node test/duck.test.mjs: the echo's DUCK turns the echoes down while the dry sound plays and lets them back up in
// the gaps; at 0 (and in saves from before it) nothing changes. Offline: the echo's part of the mix is the mix with
// the drum's echo send at 127 minus the mix with it at 0
import { LxrInstrument, FX_DEFAULTS, echoMs } from '../sound/instrument.js';
import { sendPar } from '../sound/schema.js';
let fails = 0, checks = 0;
const ok = (c, m) => { checks++; if (!c) { fails++; console.log('FAIL', m); } };
const FS = 48000, SEC = 2;
// the drum hit at each of hits (seconds), one echo (no feedback) after TIME; echo: changes to the echo's settings
function mix(echo, send, hits) {
  const inst = new LxrInstrument(FS), n = SEC * FS, L = new Float32Array(n), R = new Float32Array(n);
  inst.setFx({ echo: { ...FX_DEFAULTS.echo, pingpong: 0, feedback: 0, ...echo }, master: { ...FX_DEFAULTS.master, thresh: 0 } });
  inst.setParam(sendPar(0, 0), send);
  let i = 0;
  for (const t of hits) { const at = Math.round(t * FS); if (at > i) inst.render(L.subarray(i, at), R.subarray(i, at)); i = Math.max(i, at); inst.voices[0].play(60, 110, null, false); }
  inst.render(L.subarray(i), R.subarray(i));
  return L;
}
const rms = (a, t0, t1) => { let s = 0; const i0 = Math.round(t0 * FS), i1 = Math.round(t1 * FS); for (let i = i0; i < i1; i++) s += a[i] * a[i]; return Math.sqrt(s / (i1 - i0)); };
const wet = (echo, hits) => { const a = mix(echo, 127, hits), b = mix(echo, 0, hits); return a.map((v, i) => v - b[i]); };
const db = (x) => (20 * Math.log10(x)).toFixed(1) + ' dB';
ok(FX_DEFAULTS.echo.duck === 0, 'DUCK starts off');
// off, and a save from before DUCK (no duck at all): the same samples
{ const a = mix({ time: 98 }, 127, [0]), b = mix({ time: 98, duck: 0 }, 127, [0]), c = mix({ time: 98, duck: undefined }, 127, [0]);
  ok(a.every((v, i) => v === b[i] && v === c[i]), 'DUCK 0 changes nothing'); }
// an echo landing on the next hit: turned well down
{ const time = 80, e = echoMs(time) / 1000, w0 = wet({ time }, [0, e]), w1 = wet({ time, duck: 127 }, [0, e]), w2 = wet({ time, duck: 64 }, [0, e]);
  const a = rms(w0, e, e + 0.15), b = rms(w1, e, e + 0.15), c = rms(w2, e, e + 0.15);
  console.log(`an echo under a hit: ${db(b / a)} at DUCK 127, ${db(c / a)} at 64`);
  ok(b / a < 0.25 && c / a < 0.75 && c > b, 'ducked under a hit'); }
// an echo in a gap (the hit has died away): back up, all but in full
{ const time = 98, e = echoMs(time) / 1000, w0 = wet({ time }, [0]), w1 = wet({ time, duck: 127 }, [0]);
  const a = rms(w0, e, e + 0.3), b = rms(w1, e, e + 0.3);
  console.log(`an echo in a gap: ${db(b / a)} at DUCK 127`);
  ok(b / a > 0.85, 'swells back in a gap'); }
console.log(`${checks - fails}/${checks} duck checks passed`);
process.exit(fails ? 1 : 0);
