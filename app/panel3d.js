// The GREY look's panel drawn with three.js, for a subtle depth (Johnny, 2026-11-19: "subtly 3d ... no boxes, just a
// flat plane with knobs"). A canvas sits behind the screen's contents in place of the panel's flat background and draws
// only a flat panel plane, lit, and a chicken-head knob in each knob's cell, turned with the app's own value, casting a
// soft shadow. By default it looks straight down through an orthographic camera (SETTINGS > LENS has gentle others), so every knob stays on its grid cell and nothing
// is drawn in perspective. The text, the printed scales, the rules and the buttons stay the page's own. On while the
// look is GREY on the big screen (html.panel3d, css/grey.css); the LCD look and the phone keep the flat drawing
import * as THREE from '../vendor/three/three.module.min.js';
import { RoomEnvironment } from '../vendor/three/RoomEnvironment.js';

const root = document.documentElement;
const screen = document.getElementById('screen');
const canvas = document.createElement('canvas');
canvas.className = 'panel3d';
canvas.setAttribute('aria-hidden', 'true');
screen.prepend(canvas);

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
// a software renderer (no graphics chip: some virtual machines, headless test browsers) takes seconds a frame here, so
// it keeps the flat drawing: the import fails and app/main.js carries on without it (?3d in the address forces it on)
{ const gl = renderer.getContext(), i = gl.getExtension('WEBGL_debug_renderer_info');
  const name = String(i ? gl.getParameter(i.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
  if (/swiftshader|llvmpipe|softpipe|software|basic render/i.test(name) && !/[?&]3d\b/.test(location.search)) { canvas.remove(); renderer.dispose(); throw new Error('software renderer: ' + name); } }
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NoToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.VSMShadowMap;

const scene = new THREE.Scene();
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
// the camera (SETTINGS > LENS, html data-lens): FLAT looks straight down with no perspective; the others are a lens at
// a height over the panel (a multiple of its height) and, for LOW, set off toward the player, so the knobs' sides show
// a little. Every lens is cut to frame the panel's surface exactly (an off-axis frustum), so where a knob meets the
// panel stays on its grid cell under the page's printed scale: only the raised parts lean, by a few pixels at most
const LENSES = { flat: null, tele: { d: 6 }, wide: { d: 1.5 }, low: { d: 1.6, dy: 0.6 } };
const camera = new THREE.Camera();
let lensKey = '';
function setLens() {
  const lens = LENSES[root.dataset.lens] === undefined ? null : LENSES[root.dataset.lens];
  if (!lens) { camera.position.set(0, 0, 2000); camera.projectionMatrix.makeOrthographic(0, W, 0, -H, 1, 4000); }
  else {
    const D = lens.d * H, cx = W / 2, cy = -H / 2 - (lens.dy || 0) * H, n = D - 200, f = D + 100, k = n / D;
    camera.position.set(cx, cy, D);
    camera.projectionMatrix.makePerspective((0 - cx) * k, (W - cx) * k, (0 - cy) * k, (-H - cy) * k, n, f);
  }
  camera.updateMatrixWorld(); camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
}

// the light: soft fill from everywhere, and one lamp up and to the left, high, so shadows fall short to the lower right
scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8c8e, 1.0));
const sun = new THREE.DirectionalLight(0xffffff, 1.6);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 1024);
sun.shadow.radius = 5; sun.shadow.blurSamples = 16; sun.shadow.bias = -0.0004;
scene.add(sun, sun.target);

// the panel: one flat plane in the panel's colour (the GREY look's grey, or SETTINGS > PANEL COLOUR: --panel-rgb) with a
// faint brushed grain and a little more light toward the top. The grain is the same every time (a seeded random), so a
// new colour doesn't make it jump
function panelTexture(rgb) {
  const c = document.createElement('canvas'); c.width = 2048; c.height = 1024;
  const g = c.getContext('2d');
  let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  g.fillStyle = `rgb(${rgb.join(',')})`; g.fillRect(0, 0, c.width, c.height);
  for (let i = 0; i < 9000; i++) { // the brushing: long faint horizontal streaks
    const y = rnd() * c.height, x = rnd() * c.width, l = 80 + rnd() * 500, a = rnd() * 0.035;
    g.strokeStyle = rnd() < 0.5 ? `rgba(255,255,255,${a})` : `rgba(0,0,0,${a * 0.8})`;
    g.lineWidth = 1; g.beginPath(); g.moveTo(x, y); g.lineTo(x + l, y); g.stroke();
  }
  const top = g.createLinearGradient(0, 0, 0, c.height);
  top.addColorStop(0, 'rgba(255,255,255,.13)'); top.addColorStop(0.35, 'rgba(255,255,255,0)'); top.addColorStop(1, 'rgba(0,0,0,.06)');
  g.fillStyle = top; g.fillRect(0, 0, c.width, c.height);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}
const panel = new THREE.Mesh(new THREE.PlaneGeometry(1, 1),
  new THREE.MeshStandardMaterial({ map: null, roughness: 0.78, metalness: 0.0, envMapIntensity: 0.25 }));
panel.receiveShadow = true;
scene.add(panel);
let panelRgb = '';
function panelColour() { // (a new colour: a new texture)
  const v = getComputedStyle(root).getPropertyValue('--panel-rgb').trim() || '172 174 172';
  if (v === panelRgb) return v;
  panelRgb = v; const rgb = v.split(/[\s,]+/).map(Number).slice(0, 3);
  panel.material.map?.dispose(); panel.material.map = panelTexture(rgb.length === 3 && rgb.every((n) => n >= 0) ? rgb : [172, 174, 172]); panel.material.needsUpdate = true;
  return v;
}

// a chicken-head knob in the SVG's units (its viewBox is 64 wide, the knob's centre at 32,32), y up, z out of the panel
const U = 1;
const skirtGeo = (() => { // a round skirt, a slight chamfer up to a lighter cap: turned on a lathe
  const p = [[0, 0], [15.5, 0], [15.6, 2.4], [15.2, 3.3], [13.6, 3.5], [13.4, 3.9], [0, 3.9]].map(([r, h]) => new THREE.Vector2(r * U, h * U));
  const g = new THREE.LatheGeometry(p, 72); g.rotateX(Math.PI / 2); return g;
})();
const capGeo = new THREE.CylinderGeometry(13.4, 13.4, 0.05, 72).rotateX(Math.PI / 2).translate(0, 0, 3.95);
const headGeo = (() => { // the head: the SVG's outline, a pointer to +x, raised with a rounded edge
  const s = new THREE.Shape();
  s.moveTo(22, 0);
  s.bezierCurveTo(15, -3, 8, -7.5, 1, -10.6);
  s.absarc(-1.94, 0, 11, Math.atan2(-10.6, 2.94), Math.atan2(10.6, 2.94), true);
  s.bezierCurveTo(8, 7.5, 15, 3, 22, 0);
  const g = new THREE.ExtrudeGeometry(s, { depth: 4.2, bevelEnabled: true, bevelThickness: 1.4, bevelSize: 1.1, bevelSegments: 5, curveSegments: 40 });
  g.translate(0, 0, 3.9 + 1.4); return g;
})();
const lineGeo = new THREE.BoxGeometry(16.5, 1.9, 0.4).translate(3 + 16.5 / 2, 0, 3.9 + 1.4 + 4.2 + 1.4 + 0.05);

const MAT = {
  skirt: new THREE.MeshStandardMaterial({ color: 0x8e9094, metalness: 0.7, roughness: 0.38, envMapIntensity: 1.1 }),
  cap: new THREE.MeshStandardMaterial({ color: 0x9a9ca0, metalness: 0.8, roughness: 0.28, envMapIntensity: 1.2 }),
  head: new THREE.MeshPhysicalMaterial({ color: 0x0c0d0e, metalness: 0, roughness: 0.5, clearcoat: 0.35, clearcoatRoughness: 0.4, envMapIntensity: 0.35 }),
  line: new THREE.MeshStandardMaterial({ color: 0xf4f3ee, roughness: 0.6 }),
};
const faded = new Map(); // a material at an opacity, for knobs the page shows faded (a section switched off)
const matAt = (k, o) => {
  if (o >= 0.99) return MAT[k];
  const key = k + Math.round(o * 100);
  if (!faded.has(key)) { const m = MAT[k].clone(); m.transparent = true; m.opacity = o; faded.set(key, m); }
  return faded.get(key);
};

// the other knob styles (SETTINGS > KNOB STYLE; html.knob-round / knob-ribbed / knob-rubber, else the chicken head).
// Johnny, 2026-11-19: "give me a choice of knobs"
const lathe = (pts, n = 72) => { const g = new THREE.LatheGeometry(pts.map(([r, h]) => new THREE.Vector2(r, h)), n); g.rotateX(Math.PI / 2); return g; };
// ROUND: the metal skirt with a black round cap standing on it, a white line across the top
const roundCapGeo = lathe([[0, 3.9], [12.6, 3.9], [12.8, 9.6], [12.3, 11], [11, 11.6], [0, 11.7]]);
const roundLineGeo = new THREE.BoxGeometry(9, 1.7, 0.4).translate(2.5 + 9 / 2, 0, 11.75);
// RIBBED: a black ribbed cylinder on a flange, a slightly domed top with a white line (the classic instrument knob)
const ribFlangeGeo = lathe([[0, 0], [15, 0], [15, 1], [14.2, 1.9], [0, 1.9]]);
const ribBodyGeo = (() => {
  const s = new THREE.Shape(), N = 28;
  for (let i = 0; i <= N * 2; i++) { const a = i / (N * 2) * Math.PI * 2, r = i % 2 ? 12.6 : 13.4; i ? s.lineTo(r * Math.cos(a), r * Math.sin(a)) : s.moveTo(r, 0); }
  const g = new THREE.ExtrudeGeometry(s, { depth: 9.2, bevelEnabled: true, bevelThickness: 0.5, bevelSize: 0.3, bevelSegments: 2, curveSegments: 2 });
  g.translate(0, 0, 2.2); return g;
})();
const ribTopGeo = lathe([[0, 11.7], [12.4, 11.7], [11.9, 12.5], [0, 12.9]]);
const ribLineGeo = new THREE.BoxGeometry(9.5, 1.6, 0.4).translate(2 + 9.5 / 2, 0, 12.85);
// RUBBER: a soft-touch dome, matte, with a white dot near its edge
const rubberGeo = lathe([[0, 0], [14.6, 0], [14.9, 1.4], [14.7, 4.5], [13.8, 7.6], [11.6, 9.9], [8, 11.2], [4, 11.7], [0, 11.8]]);
const rubberDotGeo = new THREE.CylinderGeometry(1.7, 1.7, 0.6, 24).rotateX(Math.PI / 2).translate(8.6, 0, 11.1);
Object.assign(MAT, {
  black: new THREE.MeshPhysicalMaterial({ color: 0x111214, metalness: 0, roughness: 0.42, clearcoat: 0.4, clearcoatRoughness: 0.35, envMapIntensity: 0.4 }),
  rubber: new THREE.MeshStandardMaterial({ color: 0x2b2d30, metalness: 0, roughness: 0.92, envMapIntensity: 0.3 }),
});
const KNOB_PARTS = { // each style: [geometry, material] parts
  chicken: [[skirtGeo, 'skirt'], [capGeo, 'cap'], [headGeo, 'head'], [lineGeo, 'line']],
  round: [[skirtGeo, 'skirt'], [roundCapGeo, 'black'], [roundLineGeo, 'line']],
  ribbed: [[ribFlangeGeo, 'black'], [ribBodyGeo, 'black'], [ribTopGeo, 'black'], [ribLineGeo, 'line']],
  rubber: [[rubberGeo, 'rubber'], [rubberDotGeo, 'line']],
};
const knobStyle = () => (['round', 'ribbed', 'rubber'].find((k) => root.classList.contains('knob-' + k)) || 'chicken');
function makeKnob(style) {
  const g = new THREE.Group(), turn = new THREE.Group(), parts = {};
  KNOB_PARTS[style].forEach(([geo, mat], i) => {
    const m = new THREE.Mesh(geo, MAT[mat]); m.castShadow = true; m.receiveShadow = true; m.userData.mat = mat;
    turn.add(m); parts['p' + i] = m;
  });
  g.add(turn); g.userData = { turn, parts, style };
  scene.add(g); return g;
}


// a rocker switch (a two-way control's .tog, app/main.js vtoggle), like a black KCD1: a matte black bezel standing a
// little proud of the panel, a dark opening, and in it the rocker, its top two shallow slopes meeting in the middle,
// tipped on its pivot so one end stands up out of the bezel and the other sinks in. O printed on the top end, I on the
// bottom; ON has the I end pressed. In the SVG's units (64 wide, centre 32,32), y up, z out of the panel
const roundRect = (w, h, r) => {
  const s = new THREE.Shape(), x = -w / 2, y = -h / 2;
  s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r); s.lineTo(x + w, y + h - r);
  s.quadraticCurveTo(x + w, y + h, x + w - r, y + h); s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y); return s;
};
const bezelGeo = (() => {
  const s = roundRect(34.5, 48.5, 2.2), hole = roundRect(26.6, 40.6, 1);
  s.holes.push(hole);
  const g = new THREE.ExtrudeGeometry(s, { depth: 2.2, bevelEnabled: true, bevelThickness: 0.9, bevelSize: 0.9, bevelSegments: 3, curveSegments: 6 });
  g.translate(0, 0, 0.9); return g;
})();
const wellGeo = new THREE.PlaneGeometry(26.6, 40.6).translate(0, 0, 0.6);
const RK_L = 19.6, RK_W = 24.4, RK_END = 6.4, RK_MID = 4.6; // half its length, its width, its height at the ends and the middle
const rockerGeo = (() => {
  const s = new THREE.Shape(); // its side: along its length (y) and up (z)
  s.moveTo(-RK_L, -3); s.lineTo(RK_L, -3); s.lineTo(RK_L, RK_END - 0.6); s.quadraticCurveTo(RK_L, RK_END, RK_L - 0.7, RK_END);
  s.lineTo(0, RK_MID); s.lineTo(-RK_L + 0.7, RK_END); s.quadraticCurveTo(-RK_L, RK_END, -RK_L, RK_END - 0.6); s.lineTo(-RK_L, -3);
  const g = new THREE.ExtrudeGeometry(s, { depth: RK_W - 1.2, bevelEnabled: true, bevelThickness: 0.6, bevelSize: 0.5, bevelSegments: 2, curveSegments: 4 });
  g.applyMatrix4(new THREE.Matrix4().set(0, 0, 1, -(RK_W - 1.2) / 2, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1)); // (its width across x)
  g.computeVertexNormals(); return g;
})();
const RK_SLOPE = Math.atan2(RK_END - RK_MID, RK_L); // each half of its top
const markO = new THREE.RingGeometry(3.3, 4.6, 40), markI = new THREE.PlaneGeometry(1.35, 8.2);
const RK_TILT = 0.19; // how far it tips each way, radians
Object.assign(MAT, {
  bezel: new THREE.MeshStandardMaterial({ color: 0x16171a, roughness: 0.82, metalness: 0, envMapIntensity: 0.5 }),
  well: new THREE.MeshBasicMaterial({ color: 0x030303 }),
  rocker: new THREE.MeshStandardMaterial({ color: 0x1d1e21, roughness: 0.78, metalness: 0, envMapIntensity: 0.6 }),
  mark: new THREE.MeshStandardMaterial({ color: 0xf2f1ec, roughness: 0.7, metalness: 0 }),
});
function makeRocker() {
  const g = new THREE.Group(), tip = new THREE.Group();
  const bezel = new THREE.Mesh(bezelGeo, MAT.bezel), well = new THREE.Mesh(wellGeo, MAT.well), rocker = new THREE.Mesh(rockerGeo, MAT.rocker);
  const o = new THREE.Mesh(markO, MAT.mark), i = new THREE.Mesh(markI, MAT.mark);
  const along = (m, y, up) => { m.position.set(0, y, RK_MID + (RK_END - RK_MID) * Math.abs(y) / RK_L + 0.62); m.rotation.x = up ? RK_SLOPE : -RK_SLOPE; };
  along(o, 10, true); along(i, -10, false);
  for (const m of [bezel, rocker]) { m.castShadow = true; m.receiveShadow = true; }
  tip.position.z = 1.2; tip.add(rocker, o, i);
  g.add(bezel, well, tip); g.userData = { tip, parts: { bezel, well, rocker, mark: o, mark2: i } };
  scene.add(g); return g;
}
const PART_MAT = { mark2: 'mark' };

// LEVEL's fader cap (app/main.js FADER_SVG: a 40 x 200 box, the cap 30 x 24 round its middle): a black mixer cap with
// a white line across its top, standing over the printed slot. In the SVG's units, y up
const fcapGeo = (() => {
  const g = new THREE.ExtrudeGeometry(roundRect(28, 22, 2.6), { depth: 7, bevelEnabled: true, bevelThickness: 1.2, bevelSize: 1, bevelSegments: 4, curveSegments: 8 });
  g.translate(0, 0, 1.2);
  g.computeVertexNormals(); return g;
})();
const fcapLineGeo = new THREE.BoxGeometry(24, 1.8, 0.3).translate(0, 0, 9.5);
const slotGeo = (() => { const g = new THREE.ShapeGeometry(roundRect(6, 206, 3), 6); g.translate(0, 0, 0.05); return g; })();
Object.assign(MAT, { slot: new THREE.MeshStandardMaterial({ color: 0x111213, roughness: 0.9, metalness: 0 }) });
function makeFader() { // (the group sits at the box's middle; the cap rides up and down the slot in it)
  const g = new THREE.Group(), ride = new THREE.Group();
  const slot = new THREE.Mesh(slotGeo, MAT.slot), cap = new THREE.Mesh(fcapGeo, MAT.black), line = new THREE.Mesh(fcapLineGeo, MAT.line);
  cap.castShadow = line.castShadow = true; cap.receiveShadow = slot.receiveShadow = true;
  slot.userData.mat = 'slot'; cap.userData.mat = 'black'; line.userData.mat = 'line';
  ride.add(cap, line); g.add(slot, ride); g.userData = { ride, parts: { slot, cap, line }, fader: true };
  scene.add(g); return g;
}

const knobs = new Map(); // each .knob element: its three.js knob (and each .tog: its rocker)
let W = 0, H = 0;
function sync() {
  const sr = screen.getBoundingClientRect(), s = sr.width / screen.offsetWidth || 1;
  const w = screen.clientWidth, h = screen.clientHeight;
  if (w !== W || h !== H || renderer.getPixelRatio() !== Math.min(2, devicePixelRatio * s)) {
    W = w; H = h;
    renderer.setPixelRatio(Math.min(2, devicePixelRatio * s)); renderer.setSize(W, H, false);
    lensKey = '';
    panel.scale.set(W, H, 1); panel.position.set(W / 2, -H / 2, 0);
    sun.position.set(W / 2 - 900, -H / 2 + 1100, 1600); sun.target.position.set(W / 2, -H / 2, 0);
    Object.assign(sun.shadow.camera, { left: -W * 0.75, right: W * 0.75, top: H * 0.75, bottom: -H * 0.75, near: 100, far: 4000 });
    sun.shadow.camera.updateProjectionMatrix();
  }
  if (lensKey !== (root.dataset.lens || 'flat')) { lensKey = root.dataset.lens || 'flat'; setLens(); }
  const ox = sr.left + screen.clientLeft * s, oy = sr.top + screen.clientTop * s;
  const style = knobStyle();
  const seen = new Set(); let sig = `${W}x${H}@${renderer.getPixelRatio()}/${lensKey}:${style}/${panelColour()}`;
  for (const el of screen.querySelectorAll('.knob:not(.fslide)')) {
    const svg = el.querySelector('svg'), r = svg && svg.getBoundingClientRect();
    if (!r || !r.width || el.closest('#fxside') || el.checkVisibility?.({ visibilityProperty: true }) === false) continue; // (hidden, or in the FX + MASTER pop-up: a solid box over the canvas, drawn flat)
    seen.add(el);
    let k = knobs.get(el); if (k && k.userData.style !== style) { scene.remove(k); k = null; }
    if (!k) knobs.set(el, (k = makeKnob(style)));
    const size = r.width / s, x = (r.left - ox) / s + size / 2, y = (r.top - oy) / s + size / 2;
    k.position.set(x, -y, 0); k.scale.setScalar(size / 64);
    const m = /rotate\(([-\d.e]+)/.exec(el.querySelector('.rot')?.getAttribute('transform') || '');
    k.userData.turn.rotation.z = -(m ? +m[1] : 0) * Math.PI / 180;
    let o = 1; for (let e = el; e && e !== screen; e = e.parentElement) o *= +getComputedStyle(e).opacity;
    if (k.userData.o !== o) { k.userData.o = o; for (const mesh of Object.values(k.userData.parts)) mesh.material = matAt(mesh.userData.mat, o); }
    k.visible = true;
    sig += `|${x.toFixed(1)},${y.toFixed(1)},${size.toFixed(1)},${m ? m[1] : 0},${o}`;
  }
  for (const el of screen.querySelectorAll('.knob.fslide')) { // (LEVEL's fader: its cap where the page has it)
    const svg = el.querySelector('svg'), r = svg && svg.getBoundingClientRect();
    if (!r || !r.width || el.closest('#fxside') || el.checkVisibility?.({ visibilityProperty: true }) === false) continue; // (hidden, or in the FX + MASTER pop-up: a solid box over the canvas, drawn flat)
    seen.add(el);
    let k = knobs.get(el); if (!k) knobs.set(el, (k = makeFader()));
    // (the svg keeps its 40 x 200 drawing's shape inside a box that is often wider: scale by the tighter side and centre
    // it, as the browser does, so the slot and cap land on the printed scale and never run out of the cell)
    const u = Math.min(r.width / 40, r.height / 200) / s, m = /translate\(0 ([-\d.e]+)/.exec(el.querySelector('.cap')?.getAttribute('transform') || ''), ty = m ? +m[1] : 200;
    const x = (r.left + r.width / 2 - ox) / s, y = (r.top + r.height / 2 - oy) / s;
    k.position.set(x, -y, 0); k.scale.setScalar(u); k.userData.ride.position.y = 100 - ty;
    let o = 1; for (let e = el; e && e !== screen; e = e.parentElement) o *= +getComputedStyle(e).opacity;
    if (k.userData.o !== o) { k.userData.o = o; for (const mesh of Object.values(k.userData.parts)) mesh.material = matAt(mesh.userData.mat, o); }
    k.visible = true;
    sig += `|f${x.toFixed(1)},${y.toFixed(1)},${u.toFixed(3)},${ty},${o}`;
  }
  for (const el of screen.querySelectorAll('.tog')) {
    const svg = el.querySelector('svg'), r = svg && svg.getBoundingClientRect();
    if (!r || !r.width || el.closest('#fxside') || el.checkVisibility?.({ visibilityProperty: true }) === false) continue; // (hidden, or in the FX + MASTER pop-up: a solid box over the canvas, drawn flat)
    seen.add(el);
    let k = knobs.get(el); if (!k) knobs.set(el, (k = makeRocker()));
    const size = r.width / s, x = (r.left - ox) / s + size / 2, y = (r.top - oy) / s + size / 2, on = el.getAttribute('aria-checked') === 'true';
    k.position.set(x, -y, 0); k.scale.setScalar(size / 64);
    k.userData.tip.rotation.x = on ? RK_TILT : -RK_TILT; // (ON: the O end up, the I end pressed in)
    let o = 1; for (let e = el; e && e !== screen; e = e.parentElement) o *= +getComputedStyle(e).opacity;
    if (k.userData.o !== o) { k.userData.o = o; for (const [n, mesh] of Object.entries(k.userData.parts)) mesh.material = matAt(PART_MAT[n] || n, o); }
    k.visible = true;
    sig += `|r${x.toFixed(1)},${y.toFixed(1)},${size.toFixed(1)},${on},${o}`;
  }
  for (const [el, k] of knobs) if (!seen.has(el)) { k.visible = false; if (!el.isConnected) { scene.remove(k); knobs.delete(el); } }
  return sig;
}

// draw only when something a knob shows has changed: a value, a place, a fade, the window
let queued = false, last = '';
const wanted = () => root.classList.contains('look-grey') && !root.classList.contains('phone');
const draw = () => {
  if (queued) return; queued = true;
  requestAnimationFrame(() => {
    queued = false;
    const on = wanted(); root.classList.toggle('panel3d', on);
    if (!on) { last = ''; return; }
    const sig = sync();
    if (sig !== last) { last = sig; renderer.render(scene, camera); }
  });
};
const relevant = (r) => r.type === 'childList' || r.attributeName === 'class' || r.attributeName === 'hidden'
  || r.attributeName === 'aria-checked' || (r.attributeName === 'transform' && (r.target.classList?.contains('rot') || r.target.classList?.contains('cap'))) || (r.attributeName === 'style' && r.target.id === 'stage');
new MutationObserver((rs) => { if (rs.some(relevant)) draw(); }).observe(document.getElementById('stage'),
  { subtree: true, childList: true, attributes: true, attributeFilter: ['transform', 'class', 'style', 'hidden', 'aria-checked'] });
new MutationObserver(draw).observe(root, { attributes: true, attributeFilter: ['class', 'style', 'data-lens'] });
addEventListener('resize', draw);
document.fonts?.ready.then(draw);
draw(); setTimeout(draw, 300); setTimeout(draw, 1200);
