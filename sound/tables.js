// The wavetables a voice's tone can play instead of the firmware's waves: TABLE 0 is CLASSIC (the firmware's waves on
// the WAVE dial, as always), 1 to 11 are METAMORF's built-in tables (engine/wavetables.js), made from maths when first
// used. A table is plain data, so the page builds it and posts it to the AudioWorklet, which never builds one while it
// plays (it plays CLASSIC until the table arrives).
import { BUILTINS, need, holds, table, hold, drop } from '../engine/wavetables.js?v=mwmo73go';

export const TABLE_IDS = [null, ...BUILTINS.map((b) => b[0])];
export const TABLE_NAMES = ['classic', ...BUILTINS.map((b) => b[1].toLowerCase())];
export const tableId = (i) => TABLE_IDS[Math.round(i)] || null;
/** the table to play for TABLE value i (null: CLASSIC). build: make it here if it isn't made yet (false: only one
 *  already held, as the AudioWorklet wants) */
export function tableFor(i, build = true) {
  const id = tableId(i);
  if (!id) return null;
  return build ? need(id) : holds(id) ? table(id) : null;
}
export { hold, holds, drop };
