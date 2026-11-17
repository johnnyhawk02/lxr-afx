// LXR-AFX: the 3D view (three.js). The screen as a piece of hardware on a desk: a bevelled panel with the labels
// printed on it, knobs, buttons and faders as real parts with shadows, LEDs and displays that glow.
//
// How it stays the same instrument: the 2D screen is still there, laid out at a fixed size underneath the 3D canvas
// (the "blueprint"), and the panel is built from it. Every label, line and readout of the blueprint is drawn into the
// panel's texture (scan and paint, below); every knob, button and slider of it gets a 3D part at the same place; and a
// press on the canvas is found on the panel with a ray, then handed to the blueprint's own control as pointer events.
// So each 3D control reads and writes the very state its 2D control does (presets, MIDI, UNDO and saving are untouched),
// and a control added to the 2D screen shows up here by itself. Menus open as the 2D menus, over the panel.
//
// Drawn on demand: a frame is rendered only when the blueprint changes, something is pressed or the window resizes.
import * as THREE from '../vendor/three.module.min.js';
import { RoomEnvironment } from '../vendor/RoomEnvironment.js';

const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const px = (s) => parseFloat(s) || 0;
function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
const parseCol = (s) => { const m = /rgba?\(([^)]+)\)/.exec(s || ''); if (!m) return null; const p = m[1].split(/[ ,/]+/).map(parseFloat); return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1]; };
const lum = (c) => (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255;
const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const mix = (a, b, t) => { const x = hex(a), y = hex(b); return '#' + x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, '0')).join(''); };

// ---- the look: what LOOK (bottom right) sets, kept in this browser, with three slots ----
export const PANELS = { charcoal: ['#303236', '#ece8dc'], black: ['#18191a', '#f0ede4'], silver: ['#9a9da1', '#131517'], cream: ['#bfb69c', '#231f17'], olive: ['#66744f', '#10160a'], blue: ['#27384e', '#e6ebf2'], red: ['#7a2521', '#f3e9dc'] };
export const FINISHES = { satin: [0.35, 0.55, 0.5], brushed: [0.82, 0.4, 1], matte: [0, 0.92, 0.35], gloss: [0.15, 0.2, 0] }; // metalness, roughness, bump
export const KNOB_COLORS = { black: '#18191b', cream: '#d9d1b8', silver: '#c9ccd0', orange: '#d8621f', red: '#b3261e', blue: '#2d5fa8' };
export const LEDS = { amber: '#ffb028', red: '#ff4a3a', green: '#77ff5e', white: '#f2f5ff', blue: '#4fb2ff' };
export const KNOB_STYLES = ['ribbed', 'smooth', 'skirt', 'stl'];
const LOOK_KEY = 'lxr-afx-look-v1', STL_KEY = 'lxr-afx-knob-stl';
const LOOK0 = { panel: 'charcoal', finish: 'satin', knob: 'ribbed', knobColor: 'black', knobSize: 100, wear: 25, light: 100, led: 'amber' };
let look = { ...LOOK0 }, slots = [null, null, null];
function tidyLook(l) {
  const o = { ...LOOK0, ...(l && typeof l === 'object' ? l : {}) };
  if (!PANELS[o.panel]) o.panel = LOOK0.panel; if (!FINISHES[o.finish]) o.finish = LOOK0.finish; if (!KNOB_STYLES.includes(o.knob)) o.knob = LOOK0.knob;
  if (!KNOB_COLORS[o.knobColor]) o.knobColor = LOOK0.knobColor; if (!LEDS[o.led]) o.led = LOOK0.led;
  o.knobSize = clamp(Math.round(+o.knobSize) || 100, 70, 130); o.wear = clamp(Math.round(+o.wear) || 0, 0, 100); o.light = clamp(Math.round(+o.light) || 100, 40, 160);
  return { panel: o.panel, finish: o.finish, knob: o.knob, knobColor: o.knobColor, knobSize: o.knobSize, wear: o.wear, light: o.light, led: o.led };
}
function loadLook() { try { const d = JSON.parse(localStorage.getItem(LOOK_KEY) || 'null'); if (d) { look = tidyLook(d.look); slots = [0, 1, 2].map((i) => (d.slots && d.slots[i] ? tidyLook(d.slots[i]) : null)); } } catch (e) { /* as it comes */ } }
function saveLook() { try { localStorage.setItem(LOOK_KEY, JSON.stringify({ look, slots })); } catch (e) { /* not kept */ } }
let P = null; // the palette the look gives the painter
function setPalette() {
  const [base, print] = PANELS[look.panel], dark = lum(hex(base)) < 0.4;
  const led = LEDS[look.led];
  P = { base, print, dark, led, cap: mix(base, dark ? '#ffffff' : '#000000', dark ? 0.1 : 0.12), glass: '#090a0b', onlit: '#101114',
    litA: mix(led, '#000000', 0.45), litG: mix(led, '#000000', 0.5), bigA: mix(led, '#000000', 0.62), bigG: mix(led, '#000000', 0.74) }; // (a lit button, a lit area: backlit, not blinding)
  if (ui) { // the menus that open over the panel take its colours
    const [r, g, b] = hex(print), s = ui.style;
    s.setProperty('--panel', mix(base, '#000000', dark ? 0.15 : 0)); s.setProperty('--ink', print); s.setProperty('--muted', `rgba(${r},${g},${b},.66)`); s.setProperty('--ghost', `rgba(${r},${g},${b},.13)`);
    s.setProperty('--tint', `rgba(${r},${g},${b},.09)`); s.setProperty('--rule', `1px solid rgba(${r},${g},${b},.34)`); s.setProperty('--shadow', 'none');
  }
}

// ---- the blueprint: the 2D screen, scanned into things to paint (items) and things to build (parts) ----
const DESK = { w: 1440, h: 900 }, PHONE = { w: 400, h: 800 };
let root = null, dim = DESK, phone = false;
const bp = { k: 1, left: 0, top: 0 }; // the blueprint on the page: its scale and corner
const SKIP = '.menupanel, .start, .pv-menu, script, style, input';
const UNIT = '.vf, button, .lcdbox, .keyname, .keyinfo, .status, select, .grm, .envm, .lockveil, .pv-key, .pv-msg, .pv-send, .pv-top, .info, .lowkey';
const DISPLAY = '.lcdbox, .keyname, .keyinfo, .status, select, output, .info, .pv-key, .pv-msg, #pv-name';
const GLASS = '.lcdbox, .status, .pv-key, .pv-msg';
const CAP = 'button:not(.lock), .pad';
const FADER = '.htrack, .pv-send .track';
const MENUS = '.menupanel, .pv-menu';
let base = { el: null, items: [], parts: [], bbox: null }, units = [];
const unitMap = new Map();
const range = document.createRange(), mcan = document.createElement('canvas').getContext('2d'), fontM = new Map();
function metrics(font) {
  let m = fontM.get(font);
  if (!m) { mcan.font = font; const t = mcan.measureText('Mg'); m = { asc: t.fontBoundingBoxAscent ?? t.actualBoundingBoxAscent, desc: t.fontBoundingBoxDescent ?? t.actualBoundingBoxDescent }; fontM.set(font, m); }
  return m;
}
const rectOf = (el) => { const q = el.getBoundingClientRect(); return { x: (q.left - bp.left) / bp.k, y: (q.top - bp.top) / bp.k, w: q.width / bp.k, h: q.height / bp.k }; };
const fontOf = (cs) => `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
const spacing = (cs) => (cs.letterSpacing === 'normal' ? '0px' : cs.letterSpacing);
const meet = (a, b) => (!a ? b : !b ? a : [Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.min(a[2], b[2]), Math.min(a[3], b[3])]);

function measure() { const q = root.getBoundingClientRect(); bp.left = q.left; bp.top = q.top; bp.k = q.width / dim.w || 1; }
function scanAll() {
  measure();
  base = { el: null, items: [], parts: [], bbox: null }; units = []; unitMap.clear();
  walk(root, 1, null, { disp: false, glass: false, clip: null });
}
function scanUnit(u) { // one unit again, in place; false if it's gone or no longer where a unit can be found
  if (!root.contains(u.el)) return false;
  const pe = u.el.parentElement; let op = 1, clip = null, disp = false, glass = false;
  for (let n = pe; n && n !== root.parentElement; n = n.parentElement) {
    const cs = getComputedStyle(n); if (cs.display === 'none' || n.hidden) return false;
    op *= parseFloat(cs.opacity); if (n !== root && cs.overflowX !== 'visible') { const r = rectOf(n); clip = meet(clip, [r.x, r.y, r.x + r.w, r.y + r.h]); }
    if (n.matches(DISPLAY)) disp = true; if (n.matches(GLASS)) glass = true;
  }
  u.items = []; u.parts = []; u.bbox = null; u.fresh = true;
  walk(u.el, op, u, { disp, glass, clip });
  return true;
}
function walk(el, op, unit, f) {
  if (el.hidden || el.matches(SKIP)) return;
  const cs = getComputedStyle(el);
  if (cs.display === 'none') return;
  const o = op * parseFloat(cs.opacity); if (o < 0.03) return;
  const r = rectOf(el), tag = el.localName;
  let u = unit;
  if (u && u.fresh) u.fresh = false; // (a unit being scanned again: it is its own root)
  else if (!u && el !== root && el.matches(UNIT)) { u = { el, items: [], parts: [], bbox: null }; units.push(u); unitMap.set(el, u); }
  const out = u ? u.items : base.items, pts = u ? u.parts : base.parts;
  if (tag === 'svg') { scanSvg(el, o, out); if (u && u.el === el) u.bbox = [r.x - 8, r.y - 8, r.x + r.w + 8, r.y + r.h + 8]; return; }
  const rad = px(cs.borderTopLeftRadius);
  const box = (role, a, rr = rad) => out.push({ t: 'fill', x: r.x, y: r.y, w: r.w, h: r.h, r: rr, role, a, clip: f.clip });
  const disp = f.disp || el.matches(DISPLAY);
  let glass = f.glass, clip = f.clip, part = null;
  if (el !== root && r.w > 0 && r.h > 0) {
    if (el.matches(GLASS) || tag === 'select') { box('glass', 1, Math.max(rad, 3)); glass = true; }
    if (el.matches(FADER)) { // a slider: its slot is printed, its cap is a part; the 2D bar isn't drawn
      const i = el.querySelector('i'), ir = i ? rectOf(i) : null;
      out.push({ t: 'slot', x: r.x, y: r.y, w: r.w, h: r.h });
      pts.push({ kind: 'fader', el, x: r.x, y: r.y, w: r.w, h: r.h, f: ir ? clamp(ir.w / Math.max(1, r.w - 6), 0, 1) : 0 });
      if (u && u.el === el) u.bbox = [r.x - 8, r.y - 8, r.x + r.w + 8, r.y + r.h + 8];
      return;
    }
    if (el.matches(CAP) && r.w >= 14 && r.h >= 14) { box('cap', 1, Math.max(rad, 2)); part = { kind: 'cap', el, x: r.x, y: r.y, w: r.w, h: r.h, lit: false, down: el.classList.contains('down') }; pts.push(part); }
    const bg = parseCol(cs.backgroundColor);
    if (bg && bg[3] > 0.01) {
      const role = lum(bg) < 0.4 ? (bg[3] >= 0.8 ? 'lit' : 'tint') : 'face';
      box(role, bg[3] * o); if (part && role === 'lit') part.lit = true;
    }
    borders(cs, r, rad, o, out, f.clip);
    const ins = /^(rgba?\([^)]+\)) 0px 0px 0px ([\d.]+)px inset$/.exec(cs.boxShadow); // a frame drawn inside it (the pad pressed last): a ring of light too
    if (ins && parseCol(ins[1])[3] > 0.02) { const lw = +ins[2]; out.push({ t: 'box', x: r.x + lw / 2 + 1, y: r.y + lw / 2 + 1, w: r.w - lw - 2, h: r.h - lw - 2, r: Math.max(0, rad - lw / 2), lw, a: o, role: 'ring', clip: f.clip }); }
    if (cs.outlineStyle !== 'none' && px(cs.outlineWidth) > 0) { // an outline (the key picked, the step playing, a knob held): a ring of light round it
      const ow = px(cs.outlineWidth), off = px(cs.outlineOffset) + ow / 2, oc = parseCol(cs.outlineColor);
      if (oc && oc[3] * o > 0.02) out.push({ t: 'box', x: r.x - off, y: r.y - off, w: r.w + 2 * off, h: r.h + 2 * off, r: cs.borderRadius === '50%' ? r.w : rad + off, lw: ow, a: oc[3] * o, role: 'ring', dash: cs.outlineStyle === 'dashed', clip: f.clip });
    }
    if (cs.overflowX !== 'visible') clip = meet(clip, [r.x, r.y, r.x + r.w, r.y + r.h]);
  }
  if (el.classList.contains('knob')) {
    const m = /rotate\(([-\d.]+)/.exec(el.querySelector('.ptr')?.getAttribute('transform') || '');
    pts.push({ kind: 'knob', el, cx: r.x + r.w / 2, cy: r.y + r.h / 2, r: Math.min(r.w, r.h) / 2, ang: m ? +m[1] : 0 });
  }
  const st = { fl: null, fb: null, lr: null, lb: null };
  if (tag === 'select') {
    const font = fontOf(cs), m = metrics(font), y = r.y + r.h / 2 + (m.asc - m.desc) / 2, a = o * (el.disabled ? 0.4 : 1);
    out.push({ t: 'text', s: (el.selectedOptions[0]?.textContent || '').trim(), x: r.x + px(cs.paddingLeft) + px(cs.borderLeftWidth) + 2, y, font, ls: spacing(cs), role: 'display', a, glass: true, clip: [r.x, r.y, r.x + r.w - 18, r.y + r.h] });
    out.push({ t: 'text', s: '▾', x: r.x + r.w - 15, y, font, ls: '0px', role: 'display', a, glass: true, clip: null });
  } else {
    const g = { disp, glass, clip };
    for (const n of el.childNodes) {
      if (n.nodeType === 3) textNode(n, cs, o, out, g, st);
      else if (n.nodeType === 1) walk(n, o, u, g);
    }
  }
  if (el !== root) { pseudo(el, '::before', cs, r, o, out, st, disp, glass, f.clip); pseudo(el, '::after', cs, r, o, out, st, disp, glass, f.clip); }
  if (u && u.el === el) u.bbox = [r.x - 10, r.y - 10, r.x + r.w + 10, r.y + r.h + 10];
}
function borders(cs, r, rad, o, out, clip) {
  const S = ['Top', 'Right', 'Bottom', 'Left'], w = S.map((s) => (cs['border' + s + 'Style'] === 'none' ? 0 : px(cs['border' + s + 'Width'])));
  if (!(w[0] || w[1] || w[2] || w[3])) return;
  const c = S.map((s) => parseCol(cs['border' + s + 'Color']) || [0, 0, 0, 0]);
  const role = (k) => (lum(c[k]) < 0.4 ? 'rule' : 'facerule'), dash = (k) => cs['border' + S[k] + 'Style'] === 'dashed';
  if (w[0] && w[0] === w[1] && w[0] === w[2] && w[0] === w[3] && c.every((x) => x[3] === c[0][3])) {
    if (c[0][3] * o > 0.02) out.push({ t: 'box', x: r.x + w[0] / 2, y: r.y + w[0] / 2, w: r.w - w[0], h: r.h - w[0], r: Math.max(0, rad - w[0] / 2), lw: w[0], a: c[0][3] * o, role: role(0), dash: dash(0), clip });
    return;
  }
  const L = [[r.x, r.y + w[0] / 2, r.x + r.w, r.y + w[0] / 2], [r.x + r.w - w[1] / 2, r.y, r.x + r.w - w[1] / 2, r.y + r.h], [r.x, r.y + r.h - w[2] / 2, r.x + r.w, r.y + r.h - w[2] / 2], [r.x + w[3] / 2, r.y, r.x + w[3] / 2, r.y + r.h]];
  for (let k = 0; k < 4; k++) if (w[k] && c[k][3] * o > 0.02) out.push({ t: 'line', x0: L[k][0], y0: L[k][1], x1: L[k][2], y1: L[k][3], lw: w[k], a: c[k][3] * o, role: role(k), dash: dash(k), clip });
}
function textNode(n, cs, o, out, g, st) {
  const s = n.nodeValue; if (!/\S/.test(s)) return;
  const col = parseCol(cs.color); if (!col || col[3] * o < 0.03) return;
  const font = fontOf(cs), m = metrics(font), up = cs.textTransform === 'uppercase', role = lum(col) >= 0.4 ? 'onlit' : g.disp ? 'display' : 'print';
  const re = /\S+/g; let w;
  while ((w = re.exec(s))) {
    range.setStart(n, w.index); range.setEnd(n, w.index + w[0].length);
    const q = range.getClientRects()[0]; if (!q || !q.width) continue;
    const x = (q.left - bp.left) / bp.k, top = (q.top - bp.top) / bp.k, h = q.height / bp.k, wd = q.width / bp.k, y = top + (h + m.asc - m.desc) / 2;
    if (g.clip && (x > g.clip[2] || x + wd < g.clip[0] || top > g.clip[3] || top + h < g.clip[1])) continue;
    out.push({ t: 'text', s: up ? w[0].toUpperCase() : w[0], x, y, font, ls: spacing(cs), role, a: col[3] * o, glass: g.glass, clip: g.clip, w: wd, top, h });
    if (st.fl === null) { st.fl = x; st.fb = y; } st.lr = x + wd; st.lb = y;
  }
}
// ::before and ::after: a word of text beside the element's own, or an empty box placed inside it
function pseudo(el, which, cs, r, o, out, st, disp, glass, clip) {
  const ps = getComputedStyle(el, which), c = ps.content;
  if (!c || c === 'none' || c === 'normal' || ps.display === 'none') return;
  const a = o * parseFloat(ps.opacity), txt = c.replace(/^["']|["']$/g, '');
  if (txt.trim()) {
    const col = parseCol(ps.color); if (!col) return;
    const font = fontOf(ps), m = metrics(font); mcan.font = font;
    const y = st.fb ?? r.y + r.h / 2 + (m.asc - m.desc) / 2;
    const x = which === '::before' ? (st.fl ?? r.x + px(cs.paddingLeft) + mcan.measureText(txt).width) - mcan.measureText(txt).width : (st.lr ?? r.x);
    out.push({ t: 'text', s: txt.trim(), x, y: which === '::before' ? y : st.lb ?? y, font, ls: '0px', role: lum(col) >= 0.4 ? 'onlit' : disp ? 'display' : 'print', a: col[3] * a, glass, clip });
    return;
  }
  if (ps.position !== 'absolute') return;
  const num = (v) => (v === 'auto' ? null : parseFloat(v));
  const bl = px(cs.borderLeftWidth), bt = px(cs.borderTopWidth), pw = r.w - bl - px(cs.borderRightWidth), ph = r.h - bt - px(cs.borderBottomWidth);
  const L = num(ps.left), R = num(ps.right), T = num(ps.top), B = num(ps.bottom);
  let w = num(ps.width), h = num(ps.height);
  if (w === null || (L !== null && R !== null && !w)) w = L !== null && R !== null ? pw - L - R : 0;
  if (h === null || (T !== null && B !== null && !h)) h = T !== null && B !== null ? ph - T - B : 0;
  const bw = ['Top', 'Right', 'Bottom', 'Left'].map((s) => (ps['border' + s + 'Style'] === 'none' ? 0 : px(ps['border' + s + 'Width'])));
  if (ps.boxSizing !== 'border-box') { w += bw[1] + bw[3]; h += bw[0] + bw[2]; }
  const q = { x: r.x + bl + (L !== null ? L : R !== null ? pw - R - w : 0) + (L !== null ? px(ps.marginLeft) : 0), y: r.y + bt + (T !== null ? T : B !== null ? ph - B - h : 0), w, h };
  if (q.w <= 0 && q.h <= 0) return;
  const bg = parseCol(ps.backgroundColor);
  if (bg && bg[3] > 0.01 && q.w > 0 && q.h > 0) out.push({ t: 'fill', x: q.x, y: q.y, w: q.w, h: q.h, r: px(ps.borderTopLeftRadius), role: lum(bg) < 0.4 ? (bg[3] >= 0.8 ? 'mark' : 'tint') : 'onlitfill', a: bg[3] * a, clip });
  borders(ps, q, 0, a, out, clip);
}
function scanSvg(svg, o, out) {
  const r = rectOf(svg); if (r.w <= 0 || r.h <= 0) return;
  const vb = svg.viewBox && svg.viewBox.baseVal, sx = r.w / ((vb && vb.width) || r.w), sy = r.h / ((vb && vb.height) || r.h);
  const knob = svg.parentElement.classList.contains('knob'), locked = !!svg.closest('.lock[aria-pressed="true"]');
  for (const c of svg.children) {
    const tag = c.localName, cl = c.classList;
    if (knob && cl.contains('ptr')) continue;
    const cs = getComputedStyle(c); if (cs.display === 'none') continue;
    const a = o * parseFloat(cs.opacity); if (a < 0.03) continue;
    const at = (k) => parseFloat(c.getAttribute(k)) || 0;
    const fill = parseCol(cs.fill), stroke = parseCol(cs.stroke);
    let role = 'print';
    if (knob && cl.contains('tk')) role = cl.contains('on') ? 'led' : 'tick';
    else if (knob && cl.contains('notch')) role = 'led';
    else if (locked) role = 'led';
    else if ((stroke && stroke[3] > 0 && lum(stroke) >= 0.4) || (fill && fill[3] > 0 && lum(fill) >= 0.4)) role = 'onlit';
    if (tag === 'text') { out.push({ t: 'svgtext', s: c.textContent, x: r.x, y: r.y, sx, sy, tx: at('x'), ty: at('y'), font: `${cs.fontSize} ${cs.fontFamily}`, a, role }); continue; }
    let p = null;
    if (tag === 'path') p = new Path2D(c.getAttribute('d'));
    else if (tag === 'rect') { p = new Path2D(); const rx = at('rx'); if (rx) p.roundRect(at('x'), at('y'), at('width'), at('height'), rx); else p.rect(at('x'), at('y'), at('width'), at('height')); }
    else if (tag === 'circle') { p = new Path2D(); p.arc(at('cx'), at('cy'), at('r'), 0, 7); }
    else if (tag === 'line') { p = new Path2D(); p.moveTo(at('x1'), at('y1')); p.lineTo(at('x2'), at('y2')); }
    else continue;
    const rot = /rotate\(([-\d.]+)[ ,]+([-\d.]+)[ ,]+([-\d.]+)\)/.exec(c.getAttribute('transform') || '');
    out.push({ t: 'svg', p, x: r.x, y: r.y, w: r.w, h: r.h, sx, sy, rot: rot && [+rot[1], +rot[2], +rot[3]], fill: tag !== 'line' && fill ? fill[3] : 0, stroke: role === 'tick' || role === 'led' ? 1 : stroke ? stroke[3] : 0, lw: px(cs.strokeWidth) || 1, a, role, cap: cs.strokeLinecap });
  }
}

// ---- the painter: the items onto two canvases the panel's material uses, A (what the light falls on: the finish, the
// print, the faces of the buttons) and G (what glows by itself: LEDs, lit buttons, the displays' text). One layout
// pixel is K canvas pixels ----
let canA = null, canG = null, A = null, G = null, K = 1, texA = null, texG = null, wearCan = null;
function rr(c, it) { c.beginPath(); if (it.r > 0.5) c.roundRect(it.x, it.y, it.w, it.h, Math.min(it.r, it.w / 2, it.h / 2)); else c.rect(it.x, it.y, it.w, it.h); }
const glow = (on) => { G.shadowColor = on ? P.led : 'transparent'; G.shadowBlur = on ? 5 * K : 0; };
function clipTo(c, q) { c.save(); c.beginPath(); c.rect(q[0], q[1], q[2] - q[0], q[3] - q[1]); c.clip(); }
function paint(it) {
  const cl = it.clip; if (cl) { clipTo(A, cl); clipTo(G, cl); }
  switch (it.t) {
    case 'fill':
      rr(A, it); rr(G, it);
      if (it.role === 'glass') { A.fillStyle = P.glass; A.fill(); G.fillStyle = '#000'; G.fill(); }
      else if (it.role === 'cap') { A.fillStyle = P.cap; A.fill(); G.fillStyle = '#000'; G.fill(); }
      else if (it.role === 'lit') { const big = it.w * it.h > 30000; A.globalAlpha = G.globalAlpha = it.a; A.fillStyle = big ? P.bigA : P.litA; A.fill(); G.fillStyle = big ? P.bigG : P.litG; G.fill(); }
      else if (it.role === 'mark') { A.globalAlpha = it.a; A.fillStyle = P.print; A.fill(); }
      else if (it.role === 'onlitfill') { A.globalAlpha = G.globalAlpha = it.a; A.fillStyle = P.onlit; A.fill(); G.fillStyle = '#000'; G.fill(); }
      else if (it.role === 'tint') { A.globalAlpha = it.a; A.fillStyle = P.print; A.fill(); }
      else { A.globalAlpha = G.globalAlpha = it.a; A.fillStyle = P.base; A.fill(); G.fillStyle = '#000'; G.fill(); } // (a veil of the panel's own colour)
      break;
    case 'box': case 'line': {
      const ring = it.role === 'ring';
      for (const c of ring ? [A, G] : [A]) {
        c.globalAlpha = it.a * (it.role === 'rule' ? 0.9 : 1); c.strokeStyle = ring ? P.led : it.role === 'rule' ? P.print : P.onlit; c.lineWidth = it.lw; c.setLineDash(it.dash ? [it.lw * 3, it.lw * 2] : []);
        if (c === G) glow(true);
        if (it.t === 'box') { rr(c, it); c.stroke(); } else { c.beginPath(); c.moveTo(it.x0, it.y0); c.lineTo(it.x1, it.y1); c.stroke(); }
        c.setLineDash([]); if (c === G) glow(false);
      }
      break;
    }
    case 'slot': { // a slider's groove, with a scale under it
      const y = it.y + it.h / 2;
      A.fillStyle = P.glass; A.beginPath(); A.roundRect(it.x + 2, y - 4, it.w - 4, 8, 4); A.fill();
      A.globalAlpha = 0.5; A.fillStyle = P.print; for (let i = 0; i <= 10; i++) A.fillRect(it.x + 9 + i * (it.w - 19) / 10, it.y + it.h - 5, 1, i % 5 ? 3 : 5);
      break;
    }
    case 'text': {
      const disp = it.role === 'display' && (P.dark || it.glass), on = it.role === 'onlit';
      A.font = it.font; A.letterSpacing = it.ls; A.globalAlpha = it.a; A.fillStyle = on ? P.onlit : disp ? P.led : P.print; A.fillText(it.s, it.x, it.y);
      if (disp || on) { G.font = it.font; G.letterSpacing = it.ls; G.globalAlpha = it.a; G.fillStyle = on ? '#000' : P.led; if (disp) glow(true); G.fillText(it.s, it.x, it.y); glow(false); }
      break;
    }
    case 'svgtext':
      A.save(); A.translate(it.x, it.y); A.scale(it.sx, it.sy); A.font = it.font; A.letterSpacing = '0px'; A.globalAlpha = it.a; A.fillStyle = P.print; A.fillText(it.s, it.tx, it.ty); A.restore();
      break;
    case 'svg': {
      const led = it.role === 'led', col = led ? P.led : it.role === 'onlit' ? P.onlit : P.print, al = it.a * (it.role === 'tick' ? 0.28 : 1);
      for (const c of led || it.role === 'onlit' ? [A, G] : [A]) {
        c.save(); c.translate(it.x, it.y); c.scale(it.sx, it.sy); if (it.rot) { c.translate(it.rot[1], it.rot[2]); c.rotate(it.rot[0] * Math.PI / 180); c.translate(-it.rot[1], -it.rot[2]); }
        c.globalAlpha = al; c.lineWidth = it.lw; c.lineCap = it.cap || 'butt';
        const k = c === G && !led ? '#000' : col; if (c === G && led) glow(true);
        if (it.fill) { c.globalAlpha = al * it.fill; c.fillStyle = k; c.fill(it.p); }
        if (it.stroke) { c.globalAlpha = al * it.stroke; c.strokeStyle = k; c.stroke(it.p); }
        c.restore(); if (c === G) glow(false);
      }
      break;
    }
  }
  A.globalAlpha = 1; G.globalAlpha = 1;
  if (cl) { A.restore(); G.restore(); }
}
const itemBox = (it) => (it.t === 'line' ? [Math.min(it.x0, it.x1) - 2, Math.min(it.y0, it.y1) - 2, Math.max(it.x0, it.x1) + 2, Math.max(it.y0, it.y1) + 2]
  : it.t === 'text' ? [it.x - 8, (it.top ?? it.y - 24) - 8, it.x + (it.w ?? 300) + 8, (it.top ?? it.y - 24) + (it.h ?? 30) + 8] : [it.x - 8, it.y - 8, it.x + (it.w ?? 64) + 8, it.y + (it.h ?? 64) + 8]);
const hits = (b, q) => !q || (b[0] < q[2] && b[2] > q[0] && b[1] < q[3] && b[3] > q[1]);
// the whole panel, or the part of it inside q ([x0, y0, x1, y1] in layout pixels)
function repaint(q) {
  for (const c of [A, G]) { c.save(); c.setTransform(K, 0, 0, K, 0, 0); if (q) { c.beginPath(); c.rect(q[0], q[1], q[2] - q[0], q[3] - q[1]); c.clip(); } }
  A.fillStyle = P.base; A.fillRect(0, 0, dim.w, dim.h); G.fillStyle = '#000'; G.fillRect(0, 0, dim.w, dim.h);
  for (const it of base.items) { if (q) { it.b ||= itemBox(it); if (!hits(it.b, q)) continue; } paint(it); }
  for (const u of units) if (hits(u.bbox, q)) for (const it of u.items) paint(it);
  if (look.wear && wearCan) { A.globalAlpha = look.wear / 100; A.drawImage(wearCan, 0, 0, dim.w, dim.h); A.globalAlpha = 1; }
  A.restore(); G.restore();
}
// the canvases to the graphics card: all of both, or just the part that changed
function upload(q) {
  const gl = renderer.getContext();
  for (const [c, tex] of [[A, texA], [G, texG]]) {
    const wt = q && renderer.properties.get(tex).__webglTexture;
    if (!wt || tex.dirtyAll) { tex.needsUpdate = true; tex.dirtyAll = true; continue; }
    const x = clamp(Math.floor(q[0] * K), 0, canA.width - 1), y = clamp(Math.floor(q[1] * K), 0, canA.height - 1);
    const w = clamp(Math.ceil(q[2] * K) - x, 1, canA.width - x), h = clamp(Math.ceil(q[3] * K) - y, 1, canA.height - y);
    const img = c.getImageData(x, y, w, h);
    renderer.state.activeTexture(gl.TEXTURE0); renderer.state.bindTexture(gl.TEXTURE_2D, wt);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false); gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, x, y, w, h, gl.RGBA, gl.UNSIGNED_BYTE, img.data);
    gl.generateMipmap(gl.TEXTURE_2D);
  }
}
function makeCanvases() {
  const w = Math.round(dim.w * K), h = Math.round(dim.h * K);
  if (canA && canA.width === w && canA.height === h) return;
  texA?.dispose(); texG?.dispose();
  canA = document.createElement('canvas'); canG = document.createElement('canvas'); canA.width = canG.width = w; canA.height = canG.height = h;
  A = canA.getContext('2d', { willReadFrequently: true }); G = canG.getContext('2d', { willReadFrequently: true });
  const tex = (c) => { const t = new THREE.CanvasTexture(c); t.flipY = false; t.colorSpace = THREE.SRGBColorSpace; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
    t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy()); t.dirtyAll = true; return t; };
  texA = tex(canA); texG = tex(canG);
  for (const m of [faceMat, capTopMat]) { m.map = texA; m.emissiveMap = texG; m.needsUpdate = true; }
}
// wear: specks of bare panel where the print has rubbed off, fine scratches, a few smudges; the same every time
function makeWear() {
  const w = 1024, h = Math.round(1024 * dim.h / dim.w), c = document.createElement('canvas'); c.width = w; c.height = h;
  const x = c.getContext('2d'), R = rng(77);
  for (let i = 0; i < 1500; i++) { // the print rubs off most near the edges and where hands rest
    const e = R() < 0.45, px0 = e ? (R() < 0.5 ? R() * 0.06 : 1 - R() * 0.06) : R(), py0 = e && R() < 0.5 ? (R() < 0.5 ? R() * 0.08 : 1 - R() * 0.08) : R();
    x.globalAlpha = 0.35 + R() * 0.6; x.fillStyle = P.base; x.beginPath(); x.arc(px0 * w, py0 * h, 0.4 + R() * R() * 2.6, 0, 7); x.fill();
  }
  x.lineCap = 'round';
  for (let i = 0; i < 90; i++) {
    const x0 = R() * w, y0 = R() * h, an = R() * 6.3, len = 8 + R() * R() * 160;
    x.globalAlpha = 0.08 + R() * 0.2; x.strokeStyle = P.dark ? '#ffffff' : '#000000'; x.lineWidth = 0.4 + R() * 0.5;
    x.beginPath(); x.moveTo(x0, y0); x.quadraticCurveTo(x0 + Math.cos(an) * len / 2 + (R() - 0.5) * 12, y0 + Math.sin(an) * len / 2 + (R() - 0.5) * 12, x0 + Math.cos(an) * len, y0 + Math.sin(an) * len); x.stroke();
  }
  for (let i = 0; i < 14; i++) {
    const cx = R() * w, cy = R() * h, rad = 30 + R() * 90, g = x.createRadialGradient(cx, cy, 0, cx, cy, rad);
    g.addColorStop(0, P.dark ? 'rgba(0,0,0,.22)' : 'rgba(60,40,20,.14)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    x.globalAlpha = 1; x.fillStyle = g; x.fillRect(cx - rad, cy - rad, rad * 2, rad * 2);
  }
  wearCan = c;
}

// ---- the scene ----
let renderer = null, scene = null, camera = null, canvas = null, ui = null, env = null;
let faceMat = null, capTopMat = null, bodyMat = null, capMat = null, knobMat = null, markMat = null, deskMat = null, bumpTex = null, deskTex = null;
let face = null, body = null, desk = null, knobGeo = null, markGeo = null, stlGeo = null, keyL = null, fillL = null, rimL = null, hemi = null;
const capGeos = new Map(), objs = new Map(), boxGeo = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
const MARGIN = 16, THICK = 40, BEVEL = 5;
function roundShape(w, h, r) {
  const s = new THREE.Shape(), x = -w / 2, y = -h / 2;
  s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.absarc(x + w - r, y + r, r, -Math.PI / 2, 0, false); s.lineTo(x + w, y + h - r); s.absarc(x + w - r, y + h - r, r, 0, Math.PI / 2, false);
  s.lineTo(x + r, y + h); s.absarc(x + r, y + h - r, r, Math.PI / 2, Math.PI, false); s.lineTo(x, y + r); s.absarc(x + r, y + r, r, Math.PI, Math.PI * 1.5, false);
  return s;
}
// a slab with bevelled edges lying flat, its top at y = top
function slab(w, d, h, r, b, top) {
  const g = new THREE.ExtrudeGeometry(roundShape(w - 2 * b, d - 2 * b, Math.max(0.5, r - b)), { depth: Math.max(0.01, h - 2 * b), bevelEnabled: b > 0, bevelThickness: b, bevelSize: b, bevelSegments: 3, curveSegments: 8 });
  g.rotateX(-Math.PI / 2); g.translate(0, top - (h - b), 0);
  return g;
}
// a quad on the panel (or lifted off it) that shows its own piece of the panel's texture: layout x0..x1, y0..y1
function quad(x0, y0, x1, y1) {
  const g = new THREE.BufferGeometry(), cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, hx = (x1 - x0) / 2, hy = (y1 - y0) / 2;
  g.setAttribute('position', new THREE.Float32BufferAttribute([-hx, 0, -hy, -hx, 0, hy, hx, 0, hy, hx, 0, -hy], 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute([x0 / dim.w, y0 / dim.h, x0 / dim.w, y1 / dim.h, x1 / dim.w, y1 / dim.h, x1 / dim.w, y0 / dim.h], 2));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  return { g, cx, cy };
}
const wx = (x) => x - dim.w / 2, wz = (y) => y - dim.h / 2;
function noiseTex(size, draw, rep) { const c = document.createElement('canvas'); c.width = c.height = size; draw(c.getContext('2d'), size); const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; if (rep) t.repeat.set(rep[0], rep[1]); return t; }
function makeBump() {
  bumpTex?.dispose();
  const brushed = look.finish === 'brushed', R = rng(5);
  bumpTex = noiseTex(256, (x, n) => {
    x.fillStyle = '#808080'; x.fillRect(0, 0, n, n);
    if (brushed) for (let i = 0; i < 2600; i++) { const v = 90 + R() * 80; x.fillStyle = `rgb(${v},${v},${v})`; x.globalAlpha = 0.5; x.fillRect(R() * n - 40, R() * n, 20 + R() * 120, 1); }
    else for (let i = 0; i < 9000; i++) { const v = 100 + R() * 56; x.fillStyle = `rgb(${v},${v},${v})`; x.fillRect(R() * n, R() * n, 1, 1); }
  }, [dim.w / 256, dim.h / 256]);
  faceMat.bumpMap = bumpTex; faceMat.bumpScale = FINISHES[look.finish][2] * 0.6; faceMat.needsUpdate = true;
}
// a knob one unit across the cap and one unit tall, turned on a lathe: a skirt, a body (ribbed or smooth) and a flat top
function latheKnob(style) {
  const v = (x, y) => new THREE.Vector2(x, y);
  const pts = style === 'skirt' ? [v(0, 0), v(1.25, 0), v(1.25, 0.1), v(1.12, 0.2), v(0.8, 0.26), v(0.76, 0.9), v(0.7, 1), v(0, 1)]
    : style === 'smooth' ? [v(0, 0), v(1, 0), v(1, 0.84), v(0.97, 0.95), v(0.9, 1), v(0, 1)]
      : [v(0, 0), v(1, 0), v(1, 0.16), v(0.93, 0.2), v(0.9, 0.24), v(0.86, 0.9), v(0.8, 0.98), v(0.74, 1), v(0, 1)];
  const g = new THREE.LatheGeometry(pts, 72);
  if (style === 'ribbed') { // ribs up the body, not on the skirt or the top
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) { const y = p.getY(i); if (y > 0.23 && y < 0.93) { const x = p.getX(i), z = p.getZ(i), a = Math.atan2(z, x), k = 1 + 0.035 * Math.cos(a * 24); p.setXYZ(i, x * k, y, z * k); } }
    g.computeVertexNormals();
  }
  return g;
}
// an STL file (binary or text) as a knob: stood on z, centred, one unit across
export function parseSTL(buf) {
  const dv = new DataView(buf), n = buf.byteLength >= 84 ? dv.getUint32(80, true) : 0; let pos;
  if (n && 84 + n * 50 === buf.byteLength) { pos = new Float32Array(n * 9); for (let i = 0; i < n; i++) for (let k = 0; k < 9; k++) pos[i * 9 + k] = dv.getFloat32(84 + i * 50 + 12 + k * 4, true); }
  else { const t = new TextDecoder().decode(buf), re = /vertex\s+([-\d.eE+]+)\s+([-\d.eE+]+)\s+([-\d.eE+]+)/g, a = []; let m; while ((m = re.exec(t))) a.push(+m[1], +m[2], +m[3]); pos = new Float32Array(a); }
  if (pos.length < 9 || pos.length % 9) throw new Error('not an STL file');
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.rotateX(-Math.PI / 2); g.computeBoundingBox();
  const b = g.boundingBox, rad = Math.max(b.max.x - b.min.x, b.max.z - b.min.z) / 2 || 1;
  g.translate(-(b.min.x + b.max.x) / 2, -b.min.y, -(b.min.z + b.max.z) / 2); g.scale(1 / rad, 1 / rad, 1 / rad); g.computeVertexNormals(); g.computeBoundingBox();
  return g;
}
function setKnobGeo() {
  if (knobGeo && knobGeo !== stlGeo) knobGeo.dispose();
  knobGeo = look.knob === 'stl' && stlGeo ? stlGeo : latheKnob(look.knob === 'stl' ? 'ribbed' : look.knob);
  knobGeo.computeBoundingBox();
}
function build() {
  scene = new THREE.Scene(); scene.background = new THREE.Color('#141516');
  camera = new THREE.PerspectiveCamera(24, 1, 100, 20000);
  const pm = new THREE.PMREMGenerator(renderer), room = new RoomEnvironment();
  env = pm.fromScene(room, 0.04).texture; scene.environment = env; scene.environmentIntensity = 0.5; pm.dispose();
  room.traverse((o) => { o.geometry?.dispose(); o.material?.dispose(); });
  hemi = new THREE.HemisphereLight('#fff6ea', '#2a2622', 0.6); scene.add(hemi);
  keyL = new THREE.DirectionalLight('#ffffff', 2.1); fillL = new THREE.DirectionalLight('#dfe8ff', 0.75); rimL = new THREE.DirectionalLight('#ffe9cf', 0.45);
  for (const l of [keyL, fillL, rimL]) { scene.add(l); scene.add(l.target); }
  faceMat = new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: '#ffffff', emissiveIntensity: 1.5 });
  capTopMat = new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: '#ffffff', emissiveIntensity: 1.5, roughness: 0.55, metalness: 0 });
  bodyMat = new THREE.MeshStandardMaterial(); capMat = new THREE.MeshStandardMaterial({ roughness: 0.62, metalness: 0 });
  knobMat = new THREE.MeshStandardMaterial(); markMat = new THREE.MeshStandardMaterial({ roughness: 0.5 });
  deskTex = noiseTex(512, (x, n) => { // a dark wooden desk: long grain
    const R = rng(9); x.fillStyle = '#2a211a'; x.fillRect(0, 0, n, n);
    for (let i = 0; i < 900; i++) { const v = R(); x.globalAlpha = 0.05 + R() * 0.12; x.fillStyle = v < 0.5 ? '#120d09' : '#4a3a2c'; x.fillRect(0, R() * n, n, 0.5 + R() * 2.5); }
    for (let i = 0; i < 60; i++) { x.globalAlpha = 0.06; x.fillStyle = '#0c0907'; x.beginPath(); x.ellipse(R() * n, R() * n, 30 + R() * 90, 1 + R() * 3, 0, 0, 7); x.fill(); }
  }, [5, 9]);
  deskTex.colorSpace = THREE.SRGBColorSpace;
  deskMat = new THREE.MeshStandardMaterial({ map: deskTex, roughness: 0.78, metalness: 0 });
  markGeo = new THREE.BoxGeometry(1, 1, 1);
}
// the panel's own parts, for the size the blueprint has now: the slab, its printed face, the desk, the lights
function buildPanel() {
  for (const m of [face, body, desk]) if (m) { scene.remove(m); m.geometry.dispose(); }
  const W = dim.w, H = dim.h;
  body = new THREE.Mesh(slab(W + 2 * MARGIN, H + 2 * MARGIN, THICK, 20, BEVEL, 0), bodyMat); body.castShadow = body.receiveShadow = true; scene.add(body);
  const q = quad(0, 0, W, H); face = new THREE.Mesh(q.g, faceMat); face.position.set(0, 0.06, 0); face.receiveShadow = true; scene.add(face);
  desk = new THREE.Mesh(new THREE.PlaneGeometry(16000, 16000).rotateX(-Math.PI / 2), deskMat); desk.position.y = -THICK; desk.receiveShadow = true; scene.add(desk);
  const R = Math.max(W, H);
  keyL.position.set(-R * 0.45, R * 1.3, R * 0.35); fillL.position.set(R * 0.7, R * 0.9, R * 0.55); rimL.position.set(R * 0.1, R * 0.6, -R * 1.1);
  const small = phone || Math.min(screen.width, screen.height) <= 700;
  for (const [l, size, rad] of [[keyL, small ? 1024 : 2048, 3.5], [fillL, 1024, 6]]) {
    l.castShadow = l !== fillL || !small; const s = l.shadow; s.mapSize.set(size, size); s.radius = rad; s.bias = -0.0004; s.normalBias = 0.5;
    const c = s.camera, e = R * 0.72; c.left = -e; c.right = e; c.top = e; c.bottom = -e; c.near = R * 0.3; c.far = R * 3.2; c.updateProjectionMatrix(); s.map?.dispose(); s.map = null;
  }
  makeBump();
}
function applyLook(all) {
  setPalette();
  const [metal, rough] = FINISHES[look.finish], kc = KNOB_COLORS[look.knobColor], silver = look.knobColor === 'silver';
  faceMat.metalness = metal; faceMat.roughness = rough; bodyMat.color.set(P.base); bodyMat.metalness = metal; bodyMat.roughness = rough;
  capMat.color.set(mix(P.cap, '#000000', 0.25));
  knobMat.color.set(kc); knobMat.metalness = silver ? 0.9 : 0.05; knobMat.roughness = silver ? 0.32 : 0.42;
  markMat.color.set(lum(hex(kc)) < 0.45 ? '#f4f1e8' : '#141414');
  const b = look.light / 100; renderer.toneMappingExposure = b;
  faceMat.emissiveIntensity = capTopMat.emissiveIntensity = 1.5 / b;
  if (all) { makeBump(); makeWear(); setKnobGeo(); for (const o of objs.values()) drop(o); objs.clear(); fullPending = true; }
  invalidate();
}

// ---- the parts: a knob, a button's cap, a slider's cap for each control of the blueprint ----
function capGeo(w, d, h) {
  const k = `${Math.round(w)}|${Math.round(d)}|${h}`; let g = capGeos.get(k);
  if (!g) { g = slab(Math.round(w), Math.round(d), h, Math.min(4, Math.min(w, d) / 4), Math.min(1.2, h / 3), h); capGeos.set(k, g); }
  return g;
}
function make(p) {
  const g = new THREE.Group(), o = { kind: p.kind, g, p, y: 0 };
  if (p.kind === 'knob') {
    const rad = p.r * 0.6 * look.knobSize / 100, bb = knobGeo.boundingBox, tall = look.knob === 'stl' && stlGeo ? rad : rad * 0.85;
    const turn = new THREE.Group(), m = new THREE.Mesh(knobGeo, knobMat); m.scale.set(rad, tall, rad); m.castShadow = true; turn.add(m);
    const top = (bb ? bb.max.y : 1) * tall, mark = new THREE.Mesh(markGeo, markMat); mark.scale.set(rad * 0.62, 0.9, Math.max(1.6, rad * 0.11)); mark.position.set(rad * 0.48, top + 0.3, 0); turn.add(mark);
    g.add(turn); o.turn = turn; o.top = top; o.rad = rad * 1.12; g.position.set(wx(p.cx), 0, wz(p.cy));
    const R = rng((p.cx * 131 + p.cy * 71) | 0); R(); const t = look.wear / 100 * 0.045; g.rotation.set((R() - 0.5) * t, 0, (R() - 0.5) * t); // (a little off true, as used knobs sit)
  } else if (p.kind === 'cap') {
    const h = clamp(Math.round(Math.min(p.w, p.h) * 0.14), 3, 7), side = new THREE.Mesh(capGeo(p.w - 1, p.h - 1, h), capMat); side.castShadow = true; g.add(side);
    const q = quad(p.x + 1.5, p.y + 1.5, p.x + p.w - 1.5, p.y + p.h - 1.5), top = new THREE.Mesh(q.g, capTopMat); top.position.y = h + 0.05; top.receiveShadow = true; g.add(top);
    o.h = h; o.top = h; o.own = q.g; g.position.set(wx(p.x + p.w / 2), 0, wz(p.y + p.h / 2));
  } else if (p.kind === 'fader') {
    const cap = new THREE.Mesh(boxGeo, knobMat); cap.scale.set(20, 11, Math.max(10, p.h - 8)); cap.castShadow = true; g.add(cap);
    const line = new THREE.Mesh(markGeo, markMat); line.scale.set(1.6, 0.8, Math.max(8, p.h - 10)); line.position.y = 11.2; g.add(line);
    o.top = 11;
  }
  g.traverse((x) => { x.userData.o = o; });
  scene.add(g);
  return o;
}
function drop(o) { scene.remove(o.g); o.own?.dispose(); }
const same = (a, b) => a.kind === b.kind && (a.kind === 'knob' ? a.cx === b.cx && a.cy === b.cy && a.r === b.r : a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h);
function update(o, p) {
  o.p = p;
  if (p.kind === 'knob') o.turn.rotation.y = -p.ang * Math.PI / 180;
  else if (p.kind === 'fader') o.g.position.set(wx(p.x + 13 + p.f * (p.w - 26)), 0, wz(p.y + p.h / 2));
  else o.want = -(o.h * (p.down || pressed.has(p.el) ? 0.6 : p.lit ? 0.22 : 0));
}
function sync(list, seen) {
  for (const p of list) {
    let o = objs.get(p.el);
    if (o && !same(o.p, p)) { drop(o); o = null; }
    if (!o) { o = make(p); objs.set(p.el, o); if (o.kind === 'cap') { update(o, p); o.y = o.want; o.g.position.y = o.y; } }
    update(o, p); seen?.add(p.el);
  }
}
const pressed = new Set(); // the caps a pointer holds down now
function animate() { // caps travel to where they belong; true while any is still moving
  let moving = false;
  for (const o of objs.values()) if (o.kind === 'cap' && o.y !== o.want) { const d = o.want - o.y; o.y = Math.abs(d) < 0.08 ? o.want : o.y + d * 0.45; o.g.position.y = o.y; needDraw = needShadow = true; moving = moving || o.y !== o.want; }
  return moving;
}

// ---- keeping up with the blueprint: what changed is scanned and painted again, and nothing else ----
let obs = null, menuObs = null, raf = 0, fullPending = true, fitPending = true, needDraw = true, needShadow = true;
const dirty = new Set();
// something may have changed: look again on the next frame (draw: it certainly has, so the scene is drawn again)
function invalidate(draw = true) { if (draw) needDraw = true; if (!raf && renderer) raf = requestAnimationFrame(frame); }
// what a unit shows, as text: scanned again and found the same, it isn't painted or drawn again
const sigOf = (u) => JSON.stringify([u.items, u.parts], (k, v) => (k === 'el' || k === 'b' || k === 'p' ? undefined : typeof v === 'number' ? Math.round(v * 50) / 50 : v));
function onMutations(list) {
  for (const m of list) {
    const t = m.target.nodeType === 1 ? m.target : m.target.parentElement;
    if (!t) continue;
    if (t.matches(MENUS)) { if (m.type === 'attributes' && m.attributeName === 'hidden') placeMenu(t); continue; }
    if (t.closest(MENUS) || t.closest('.start')) continue;
    // a change where nothing is shown (the phone's pads on a laptop, the big screen on a phone) changes nothing here
    if (t !== root && !t.getClientRects().length && (m.type !== 'attributes' || !t.parentElement.getClientRects().length)) continue;
    let u = null; for (let n = t; n && n !== root; n = n.parentElement) if (unitMap.has(n)) u = n;
    if (u && !fullPending) dirty.add(u); else fullPending = true;
  }
  invalidate(false);
}
function refresh() {
  if (fitPending) { fit(); fitPending = false; fullPending = true; }
  if (fullPending || dirty.size > 40) {
    fullPending = false; dirty.clear(); stats.full++; needDraw = needShadow = true;
    const t0 = performance.now(); makeCanvases(); scanAll(); const t1 = performance.now(); repaint(null); stats.scan = t1 - t0; stats.paint = performance.now() - t1;
    texA.dirtyAll = texG.dirtyAll = true; upload(null);
    const seen = new Set(); sync(base.parts, seen); for (const u of units) sync(u.parts, seen);
    for (const [el, o] of objs) if (!seen.has(el)) { drop(o); objs.delete(el); }
    return;
  }
  if (!dirty.size) return;
  stats.part++; measure();
  for (const el of dirty) {
    const u = unitMap.get(el); if (!u) continue;
    const was = u.bbox, olds = u.parts.map((p) => p.el), wasParts = u.psig;
    u.sig ??= sigOf(u);
    if (!scanUnit(u)) { fullPending = true; continue; }
    const sig = sigOf(u); if (sig === u.sig) continue; // (it shows what it showed)
    u.sig = sig; needDraw = true;
    // a unit that has moved or changed size may have moved its neighbours: everything is looked at again
    if (!was || !u.bbox || was.some((v, i) => Math.abs(v - u.bbox[i]) > 0.5)) { fullPending = true; continue; }
    repaint(u.bbox); upload(u.bbox);
    u.psig = JSON.stringify(u.parts, (k, v) => (k === 'el' ? undefined : v)); if (u.psig !== wasParts) needShadow = true;
    const seen = new Set(); sync(u.parts, seen);
    for (const e of olds) if (!seen.has(e)) { const o = objs.get(e); if (o) { drop(o); objs.delete(e); } }
  }
  dirty.clear();
  if (fullPending) refresh();
}
const stats = { frames: 0, draws: 0, full: 0, part: 0, ms: 0, scan: 0, paint: 0 }; // (how often it has drawn: for the tests)
function frame() {
  raf = 0; if (!renderer) return;
  stats.frames++; const t0 = performance.now();
  refresh();
  const moving = animate();
  if (needDraw || moving) {
    if (needShadow || moving) { renderer.shadowMap.needsUpdate = true; needShadow = false; } // (shadows are cast again only when a part has moved)
    renderer.render(scene, camera); needDraw = false; stats.draws++;
    texA.dirtyAll = texG.dirtyAll = false;
  }
  stats.ms = performance.now() - t0;
  if (moving) invalidate();
}

// The blueprint is always one size, whatever the window's: the stylesheet's size rules (@media max-width and so on) are
// answered for that size while the 3D view is on, and given back when it stops
const frozen = new Map();
function thawMedia() { for (const [r, t] of frozen) r.media.mediaText = t; frozen.clear(); }
function freezeMedia() {
  thawMedia();
  for (const sheet of document.styleSheets) {
    let rules; try { rules = sheet.cssRules; } catch (e) { continue; } // (another site's sheet: not ours to read)
    for (const r of rules) {
      if (!(r instanceof CSSMediaRule)) continue;
      const t = r.media.mediaText, parts = t.split(/\s+and\s+/i).map((s) => /^\(\s*(min|max)-(width|height)\s*:\s*([\d.]+)px\s*\)$/i.exec(s.trim()));
      if (!parts.every(Boolean)) continue;
      const ok = parts.every((m) => { const v = m[2].toLowerCase() === 'width' ? dim.w : dim.h; return m[1].toLowerCase() === 'min' ? v >= +m[3] : v <= +m[3]; });
      frozen.set(r, t); r.media.mediaText = ok ? 'all' : 'not all';
    }
  }
}

// ---- the camera: above and a little in front, a gentle perspective, the whole panel in the window ----
let scale = 1; // window pixels per layout pixel, at the panel's middle
const tmp = new THREE.Vector3();
function fit() {
  const vw = Math.max(50, innerWidth), vh = Math.max(50, innerHeight);
  phone = document.documentElement.classList.contains('phone');
  const d = phone ? PHONE : DESK, hs = document.documentElement.style;
  if (d !== dim || !face) { dim = d; hs.setProperty('--bpw', d.w + 'px'); hs.setProperty('--bph', d.h + 'px'); freezeMedia(); opts.onLayout?.(); buildPanel(); makeWear(); for (const o of objs.values()) drop(o); objs.clear(); }
  hs.setProperty('--bpk', Math.min(1, vw / dim.w, vh / dim.h));
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2)); renderer.setSize(vw, vh, false);
  const tilt = (phone ? 12 : 19) * Math.PI / 180, hw = dim.w / 2 + MARGIN, hd = dim.h / 2 + MARGIN, mx = phone ? 0.035 : 0.03, my = phone ? 0.03 : 0.035;
  camera.fov = phone ? 26 : 22; camera.aspect = vw / vh;
  const pts = [[-hw, 0, -hd], [hw, 0, -hd], [-hw, 0, hd], [hw, 0, hd], [-hw, -THICK, hd], [hw, -THICK, hd], [-hw, 24, -hd], [hw, 24, -hd]];
  let D = 4000, tz = 0;
  for (let i = 0; i < 16; i++) {
    camera.position.set(0, D * Math.cos(tilt), tz + D * Math.sin(tilt)); camera.lookAt(0, 0, tz); camera.near = D * 0.3; camera.far = D * 4; camera.updateProjectionMatrix(); camera.updateMatrixWorld(true);
    let x0 = 9, x1 = -9, y0 = 9, y1 = -9;
    for (const p of pts) { tmp.set(p[0], p[1], p[2]).project(camera); x0 = Math.min(x0, tmp.x); x1 = Math.max(x1, tmp.x); y0 = Math.min(y0, tmp.y); y1 = Math.max(y1, tmp.y); }
    D *= Math.max((x1 - x0) / (2 - 2 * mx), (y1 - y0) / (2 - 2 * my));
    tz -= (y0 + y1) / 2 * D * Math.tan(camera.fov * Math.PI / 360) / Math.cos(tilt) * 0.9;
  }
  const a = tmp.set(-100, 0, 0).project(camera).x, b = tmp.set(100, 0, 0).project(camera).x; scale = (b - a) / 2 * vw / 200;
  let k = clamp(Math.ceil(scale * Math.min(devicePixelRatio || 1, 2) * 1.25 * 4) / 4, 1.5, 3); while (dim.w * k > 3600 || dim.h * k > 3600) k -= 0.25; // (finer than the screen, so the print stays sharp)
  K = k;
  for (const m of document.querySelectorAll('#v3d-ui > ' + MENUS.replace(', ', ', #v3d-ui > '))) placeMenu(m, true);
}
// a point of the panel (layout pixels, at height y) in the window
function toScreen(x, y, up = 0) { tmp.set(wx(x), up, wz(y)).project(camera); return [(tmp.x + 1) / 2 * innerWidth, (1 - tmp.y) / 2 * innerHeight]; }

// ---- pointer and touch: a ray from the eye through the pointer finds the part, or the place on the panel; the press
// then goes to the blueprint's own control there, as the pointer events a press on the 2D screen would give it ----
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), live = new Map(), FAKE = 7000;
let lastClick = { el: null, t: 0 };
function pick(e) {
  const q = canvas.getBoundingClientRect(); ndc.set((e.clientX - q.left) / q.width * 2 - 1, 1 - (e.clientY - q.top) / q.height * 2);
  ray.setFromCamera(ndc, camera);
  const o0 = ray.ray.origin, d = ray.ray.direction; if (d.y >= -1e-4) return null;
  const at = (h) => { const t = (h - o0.y) / d.y; return [o0.x + d.x * t + dim.w / 2, o0.z + d.z * t + dim.h / 2]; };
  let best = null;
  for (const o of objs.values()) { // the parts that stand up from the panel, the tallest first: where the ray meets their tops
    const p = o.p, [x, y] = at(o.top + (o.y || 0));
    const hit = o.kind === 'knob' ? Math.hypot(x - p.cx, y - p.cy) <= o.rad : o.kind === 'cap' ? x >= p.x && x <= p.x + p.w && y >= p.y && y <= p.y + p.h : Math.abs(x - (o.g.position.x + dim.w / 2)) <= 12 && y >= p.y && y <= p.y + p.h;
    if (hit && (!best || o.top > best.o.top) && getComputedStyle(p.el).pointerEvents !== 'none') best = { o, x, y };
  }
  let [x, y] = best ? [best.x, best.y] : at(0), el = null;
  if (best && best.o.kind !== 'cap') el = best.o.p.el;
  else {
    if (x < 0 || y < 0 || x > dim.w || y > dim.h) return null;
    const cx = bp.left + x * bp.k, cy = bp.top + y * bp.k;
    el = document.elementsFromPoint(cx, cy).find((n) => n !== root && root.contains(n)) || null;
    if (best && (!el || !best.o.p.el.contains(el))) el = best.o.p.el;
  }
  return el ? { el, x, y, o: best && best.o } : null;
}
function fire(el, type, e, x, y, more) {
  const init = { bubbles: true, cancelable: true, composed: true, view: window, clientX: x, clientY: y, screenX: x, screenY: y, button: e.button || 0, buttons: /up|click/.test(type) ? 0 : 1,
    shiftKey: e.shiftKey, ctrlKey: e.ctrlKey, altKey: e.altKey, metaKey: e.metaKey, ...more };
  el.dispatchEvent(type.startsWith('pointer') ? new PointerEvent(type, { ...init, pointerId: FAKE + e.pointerId, pointerType: e.pointerType, isPrimary: e.isPrimary, pressure: /up/.test(type) ? 0 : 0.5 }) : new MouseEvent(type, init));
}
function onDown(e) {
  if (e.button) return;
  e.stopPropagation(); // (the page hears of this press from the control it's handed to, not from the canvas)
  closeSelect();
  measure(); const h = pick(e); if (!h) { fire(root, 'pointerdown', e, -1, -1); return; } // (a press off every control still closes an open menu)
  e.preventDefault(); try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* gone already */ }
  const x = bp.left + h.x * bp.k, y = bp.top + h.y * bp.k, cap = h.o && h.o.kind === 'cap' ? h.o : objs.get(h.el.closest(CAP));
  live.set(e.pointerId, { el: h.el, x, y, sx: e.clientX, sy: e.clientY, moved: false, cap });
  if (cap && !cap.p.el.disabled) { pressed.add(cap.p.el); update(cap, cap.p); }
  fire(h.el, 'pointerdown', e, x, y); fire(h.el, 'mousedown', e, x, y);
  invalidate();
}
function onMove(e) {
  const l = live.get(e.pointerId);
  if (!l) { if (e.pointerType === 'mouse') hover(e); return; }
  if (Math.hypot(e.clientX - l.sx, e.clientY - l.sy) > 6) l.moved = true;
  const k = bp.k / scale; // (a drag covers on the blueprint what it covers on the panel)
  fire(l.el, 'pointermove', e, l.x + (e.clientX - l.sx) * k, l.y + (e.clientY - l.sy) * k); fire(l.el, 'mousemove', e, l.x + (e.clientX - l.sx) * k, l.y + (e.clientY - l.sy) * k);
}
function onUp(e) {
  const l = live.get(e.pointerId); if (!l) return;
  live.delete(e.pointerId);
  const k = bp.k / scale, x = l.x + (e.clientX - l.sx) * k, y = l.y + (e.clientY - l.sy) * k, cancel = e.type === 'pointercancel';
  if (l.cap) { pressed.delete(l.cap.p.el); if (objs.get(l.cap.p.el) === l.cap) update(l.cap, l.cap.p); }
  fire(l.el, cancel ? 'pointercancel' : 'pointerup', e, x, y); if (!cancel) fire(l.el, 'mouseup', e, x, y);
  if (!cancel && !l.moved && root.contains(l.el)) {
    const sel = l.el.closest('select');
    if (sel) openSelect(sel, e.clientX, e.clientY);
    else {
      const now = performance.now(), twice = lastClick.el === l.el && now - lastClick.t < 450;
      fire(l.el, 'click', e, x, y, { detail: twice ? 2 : 1 });
      if (twice && root.contains(l.el)) fire(l.el, 'dblclick', e, x, y, { detail: 2 });
      lastClick = twice ? { el: null, t: 0 } : { el: l.el, t: now };
    }
  }
  invalidate();
}
let hoverT = 0;
function hover(e) { // the pointer's shape, and the control's own tip, as on the 2D screen
  if (hoverT) return;
  hoverT = requestAnimationFrame(() => {
    hoverT = 0; if (!canvas) return;
    const h = pick(e), el = h && h.el;
    let c = 'default', tip = '';
    if (el) { const cs = getComputedStyle(el).cursor; c = cs && cs !== 'auto' && cs !== 'default' ? cs : el.closest('button, select, [role="slider"]') ? 'pointer' : 'default'; if (el.closest(':disabled')) c = 'default'; tip = el.closest('[title]')?.title || ''; }
    canvas.style.cursor = c; if (canvas.title !== tip) canvas.title = tip;
  });
}

// ---- a list to choose from, for the blueprint's <select> boxes ----
let selBox = null;
function closeSelect() { if (selBox) { selBox.remove(); selBox = null; } }
function openSelect(sel, x, y) {
  closeSelect(); if (sel.disabled) return;
  selBox = document.createElement('div'); selBox.className = 'v3d-list'; selBox.setAttribute('role', 'listbox');
  const add = (o, box) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = o.textContent; b.disabled = o.disabled; if (o.selected) b.setAttribute('aria-selected', 'true');
    b.addEventListener('click', () => { sel.value = o.value; sel.dispatchEvent(new Event('input', { bubbles: true })); sel.dispatchEvent(new Event('change', { bubbles: true })); closeSelect(); }); box.append(b); };
  for (const c of sel.children) {
    if (c.localName === 'optgroup') { const h = document.createElement('h4'); h.textContent = c.label; selBox.append(h); for (const o of c.children) add(o, selBox); } else add(c, selBox);
  }
  ui.append(selBox);
  const w = selBox.offsetWidth, h = selBox.offsetHeight;
  selBox.style.left = clamp(x - 20, 6, innerWidth - w - 6) + 'px'; selBox.style.top = clamp(y - 20, 6, Math.max(6, innerHeight - h - 6)) + 'px';
  selBox.querySelector('[aria-selected]')?.scrollIntoView({ block: 'center' });
}

// ---- the menus: the 2D menus themselves, lifted out of the blueprint while they're open and put over the panel ----
const homes = new Map(); // a lifted menu -> the mark left where it belongs
function placeMenu(m, again) {
  if (m.hidden) { const mark = homes.get(m); if (mark) { mark.replaceWith(m); homes.delete(m); m.removeAttribute('style'); } invalidate(); return; }
  if (!homes.has(m)) { const mark = document.createComment('menu'); m.before(mark); homes.set(m, mark); ui.append(m); menuObs.observe(m, { attributes: true, attributeFilter: ['hidden'] }); }
  else if (!again) return;
  measure();
  const mark = homes.get(m), from = mark.parentElement, s = Math.min(scale, (innerWidth - 12) / (m.offsetWidth || 400));
  if (m.matches('.pv-menu')) { // the phone's menu: over the pads and buttons, where it lies on the 2D screen
    const a = rectOf($('pv-pads')), b = rectOf($('pv-msg')), [x0, y0] = toScreen(0, a.y - 2), [x1] = toScreen(dim.w, a.y - 2), [, y1] = toScreen(0, b.y - 4);
    Object.assign(m.style, { position: 'fixed', inset: 'auto', left: x0 + 6 + 'px', top: y0 + 'px', width: (x1 - x0 - 12) / s + 'px', height: (y1 - y0) / s + 'px', transform: `scale(${s})`, transformOrigin: '0 0', padding: '8px', borderRadius: '6px' });
    return;
  }
  const r = rectOf(from.querySelector('button') || from), left = m.classList.contains('pleft');
  const [bx, by] = toScreen(left ? r.x : r.x + r.w, r.y + r.h + 6, 8);
  Object.assign(m.style, { position: 'fixed', top: Math.min(by, innerHeight - 80) + 'px', transform: `scale(${s})`, transformOrigin: left ? '0 0' : '100% 0', maxHeight: (innerHeight - by - 8) / s + 'px', overflowY: 'auto',
    left: left ? clamp(bx, 6, Math.max(6, innerWidth - m.offsetWidth * s - 6)) + 'px' : 'auto', right: left ? 'auto' : clamp(innerWidth - bx, 6, Math.max(6, innerWidth - m.offsetWidth * s - 6)) + 'px' });
}

// ---- LOOK: the panel's colour and finish, the knobs, the lights, wear, three slots, and the way back to 2D ----
let lookBox = null, opts = null;
function chips(name, keys, cur, set, sw) {
  return `<div class="row"><span>${name}</span><div class="chips" data-k="${set}">${keys.map((k) => `<button type="button" data-v="${k}" aria-pressed="${k === cur}"${sw ? ` style="--c:${sw[k]}" class="sw" aria-label="${k}" title="${k}"` : ''}>${sw ? '' : k.toUpperCase()}</button>`).join('')}</div></div>`;
}
const slide = (name, k, min, max, v, unit) => `<div class="row"><span>${name}</span><input type="range" data-k="${k}" min="${min}" max="${max}" value="${v}"><output>${v}${unit}</output></div>`;
function drawLook() {
  const sw = (o, i) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, i === undefined ? v : v[i]]));
  lookBox.innerHTML = `<h3>LOOK <button type="button" data-close="1" title="Close">CLOSE</button></h3>
    ${chips('PANEL', Object.keys(PANELS), look.panel, 'panel', sw(PANELS, 0))}${chips('FINISH', Object.keys(FINISHES), look.finish, 'finish')}
    ${chips('KNOBS', KNOB_STYLES.filter((k) => k !== 'stl' || stlGeo), look.knob, 'knob')}${chips('KNOB COLOUR', Object.keys(KNOB_COLORS), look.knobColor, 'knobColor', sw(KNOB_COLORS))}
    ${slide('KNOB SIZE', 'knobSize', 70, 130, look.knobSize, '%')}${chips('LIGHTS', Object.keys(LEDS), look.led, 'led', sw(LEDS))}
    ${slide('WEAR', 'wear', 0, 100, look.wear, '%')}${slide('BRIGHTNESS', 'light', 40, 160, look.light, '%')}
    <div class="row"><span>SLOTS</span><div class="slots">${[0, 1, 2].map((i) => `<button type="button" data-load="${i}"${slots[i] ? '' : ' disabled'} title="Use the look kept in slot ${i + 1}">${i + 1}</button><button type="button" data-save="${i}" title="Keep this look in slot ${i + 1}">SAVE</button>`).join('')}</div></div>
    <div class="row"><span>KNOB STL</span><div class="slots wide"><button type="button" data-stl="load" title="Use a knob model of your own: an STL file, standing on its base">LOAD FILE</button><button type="button" data-stl="clear"${stlGeo ? '' : ' disabled'}>REMOVE</button></div></div>
    <div class="row"><span></span><div class="slots wide"><button type="button" data-reset="1" title="The look as it comes">RESET</button><button type="button" data-2d="1" title="The flat screen, as before. 3D VIEW there brings this back">2D VIEW</button></div></div>`;
}
function setLook(l, all = true) { look = tidyLook(l); saveLook(); applyLook(all); }
// the LOOK button on the panel opens and closes the settings (open: true, false, or left out to switch)
export function toggleLook(open) {
  if (!lookBox) return false;
  lookBox.hidden = open === undefined ? !lookBox.hidden : !open;
  if (!lookBox.hidden) drawLook();
  opts.onLook?.(!lookBox.hidden);
  return !lookBox.hidden;
}
function buildLook() {
  lookBox = document.createElement('div'); lookBox.id = 'v3d-lookbox'; lookBox.hidden = true;
  const file = document.createElement('input'); file.type = 'file'; file.accept = '.stl'; file.hidden = true;
  ui.append(lookBox, file);
  lookBox.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    const k = b.parentElement.dataset.k;
    if (b.dataset.close) { toggleLook(false); return; }
    if (k) setLook({ ...look, [k]: b.dataset.v });
    else if (b.dataset.load) { if (slots[+b.dataset.load]) setLook(slots[+b.dataset.load]); }
    else if (b.dataset.save) { slots[+b.dataset.save] = { ...look }; saveLook(); }
    else if (b.dataset.reset) setLook(LOOK0);
    else if (b.dataset.stl === 'load') { file.click(); return; }
    else if (b.dataset.stl === 'clear') { stlGeo?.dispose(); stlGeo = null; try { localStorage.removeItem(STL_KEY); } catch (err) { /* nothing kept */ } setLook({ ...look, knob: look.knob === 'stl' ? 'ribbed' : look.knob }); }
    else if (b.dataset['2d']) { opts.on2d(); return; }
    drawLook();
  });
  lookBox.addEventListener('input', (e) => { const i = e.target; if (!i.dataset || !i.dataset.k) return; i.nextElementSibling.textContent = i.value + '%'; setLook({ ...look, [i.dataset.k]: +i.value }, i.dataset.k !== 'light'); });
  file.addEventListener('change', async () => {
    const f = file.files[0]; file.value = ''; if (!f) return;
    try { const buf = await f.arrayBuffer(); useStl(buf); try { if (buf.byteLength < 1500000) localStorage.setItem(STL_KEY, btoa(String.fromCharCode(...new Uint8Array(buf).reduce((a, b, i) => { (a[i >> 13] ||= []).push(b); return a; }, []).flatMap((c) => c)))); } catch (err) { /* too big to keep: this visit only */ } }
    catch (err) { opts.say(`that file isn't an STL model (${err.message})`); }
    drawLook();
  });
}
function useStl(buf) { const g = parseSTL(buf); stlGeo?.dispose(); stlGeo = g; setLook({ ...look, knob: 'stl' }); }
// A knob model for everyone who opens the page: put the STL file in the repo and name it here (e.g. 'assets/knob.stl').
// One loaded with LOAD FILE in LOOK is kept in that browser only
export const KNOB_STL = '';
async function findStl() {
  try {
    const kept = localStorage.getItem(STL_KEY);
    if (kept) { const s = atob(kept), b = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i); stlGeo = parseSTL(b.buffer); }
    else if (KNOB_STL) { const r = await fetch(KNOB_STL); if (r.ok) { stlGeo = parseSTL(await r.arrayBuffer()); if (!localStorage.getItem(LOOK_KEY)) look.knob = 'stl'; } }
  } catch (err) { stlGeo = null; }
  if (renderer && stlGeo && look.knob === 'stl') applyLook(true);
}

// ---- starting and stopping ----
let onResize = null, htmlObs = null;
export function start(o) {
  if (renderer) return true;
  opts = o; root = o.root;
  canvas = document.createElement('canvas'); canvas.id = 'v3d'; canvas.setAttribute('aria-label', 'LXR-AFX, the panel in 3D');
  try { renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' }); } catch (err) { renderer = null; canvas = null; return false; }
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap; renderer.shadowMap.autoUpdate = false; renderer.toneMapping = THREE.NeutralToneMapping;
  loadLook(); setPalette();
  document.documentElement.classList.add('v3d');
  ui = document.createElement('div'); ui.id = 'v3d-ui';
  document.body.append(canvas, ui);
  const st = $('start'); if (st) { const mark = document.createComment('start'); st.before(mark); homes.set(st, mark); ui.append(st); }
  build(); setKnobGeo(); applyLook(false); buildLook();
  obs = new MutationObserver(onMutations);
  obs.observe(root, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['class', 'style', 'hidden', 'disabled', 'aria-pressed', 'aria-expanded', 'aria-selected', 'aria-current', 'transform', 'data-face'] });
  menuObs = new MutationObserver((l) => { for (const m of l) placeMenu(m.target); });
  htmlObs = new MutationObserver(() => { fitPending = true; invalidate(); }); htmlObs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
  root.addEventListener('change', onChange, true); root.addEventListener('input', onChange, true);
  canvas.addEventListener('pointerdown', onDown); canvas.addEventListener('pointermove', onMove); canvas.addEventListener('pointerup', onUp); canvas.addEventListener('pointercancel', onUp);
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('webglcontextrestored', () => { fullPending = true; invalidate(); });
  onResize = () => { fitPending = true; closeSelect(); invalidate(); }; addEventListener('resize', onResize);
  document.fonts?.ready.then(() => { fontM.clear(); fullPending = true; invalidate(); });
  for (const m of root.querySelectorAll(MENUS)) if (!m.hidden) placeMenu(m);
  fitPending = true; fullPending = true; frame();
  findStl();
  window.afx3d = { ready: true, look: () => ({ ...look }), setLook, toggleLook, slots: () => slots, dim: () => ({ ...dim }), at: (el, up) => { const r = rectOf(el); return toScreen(r.x + r.w / 2, r.y + r.h / 2, up ?? (objs.get(el)?.top || 0)); }, parts: () => [...objs.values()].map((x) => x.kind), scale: () => scale, K: () => K,
    render: () => { fullPending = true; frame(); }, calls: () => renderer.info.render.calls, stats: () => ({ ...stats }) };
  return true;
}
function onChange(e) { let u = null; for (let n = e.target; n && n !== root; n = n.parentElement) if (unitMap.has(n)) u = n; if (u) dirty.add(u); else fullPending = true; invalidate(false); }
export function stop() {
  if (!renderer) return;
  cancelAnimationFrame(raf); raf = 0; obs.disconnect(); menuObs.disconnect(); htmlObs.disconnect(); removeEventListener('resize', onResize);
  root.removeEventListener('change', onChange, true); root.removeEventListener('input', onChange, true);
  closeSelect();
  for (const [m, mark] of homes) { mark.replaceWith(m); m.removeAttribute('style'); } homes.clear();
  thawMedia(); lookBox = null;
  for (const o of objs.values()) drop(o); objs.clear();
  for (const g of capGeos.values()) g.dispose(); capGeos.clear();
  for (const x of [face, body, desk]) x?.geometry.dispose();
  if (knobGeo && knobGeo !== stlGeo) knobGeo.dispose(); stlGeo?.dispose(); markGeo.dispose();
  for (const m of [faceMat, capTopMat, bodyMat, capMat, knobMat, markMat, deskMat]) m.dispose();
  for (const t of [texA, texG, bumpTex, deskTex, env]) t?.dispose();
  for (const l of [keyL, fillL]) l.shadow.map?.dispose();
  renderer.dispose(); renderer.forceContextLoss?.();
  canvas.remove(); ui.remove();
  renderer = scene = camera = canvas = ui = face = body = desk = texA = texG = canA = canG = knobGeo = stlGeo = bumpTex = null; live.clear(); pressed.clear(); dirty.clear(); unitMap.clear(); units = [];
  document.documentElement.classList.remove('v3d'); for (const k of ['--bpk', '--bpw', '--bph']) document.documentElement.style.removeProperty(k);
  delete window.afx3d;
}
