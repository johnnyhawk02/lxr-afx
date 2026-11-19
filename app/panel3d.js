// The GREY look's panel drawn with three.js, for a subtle depth (Johnny, 2026-11-19: "subtly 3d ... no boxes, just a
// flat plane with knobs"). A canvas sits behind the screen's contents in place of the panel's flat background and draws
// only a flat panel plane, lit, and a chicken-head knob in each knob's cell, turned with the app's own value, casting a
// soft shadow. It looks straight down through an orthographic camera, so every knob stays on its grid cell and nothing
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
const camera = new THREE.OrthographicCamera(0, 1, 0, -1, 1, 4000);
camera.position.set(0, 0, 2000);

// the light: soft fill from everywhere, and one lamp up and to the left, high, so shadows fall short to the lower right
scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8c8e, 1.0));
const sun = new THREE.DirectionalLight(0xffffff, 1.6);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 1024);
sun.shadow.radius = 5; sun.shadow.blurSamples = 16; sun.shadow.bias = -0.0004;
scene.add(sun, sun.target);

// the panel: one flat plane, the GREY look's grey with a faint brushed grain and a little more light toward the top
function panelTexture() {
  const c = document.createElement('canvas'); c.width = 2048; c.height = 1024;
  const g = c.getContext('2d');
  g.fillStyle = 'rgb(172,174,172)'; g.fillRect(0, 0, c.width, c.height);
  for (let i = 0; i < 9000; i++) { // the brushing: long faint horizontal streaks
    const y = Math.random() * c.height, x = Math.random() * c.width, l = 80 + Math.random() * 500, a = Math.random() * 0.035;
    g.strokeStyle = Math.random() < 0.5 ? `rgba(255,255,255,${a})` : `rgba(0,0,0,${a * 0.8})`;
    g.lineWidth = 1; g.beginPath(); g.moveTo(x, y); g.lineTo(x + l, y); g.stroke();
  }
  const top = g.createLinearGradient(0, 0, 0, c.height);
  top.addColorStop(0, 'rgba(255,255,255,.13)'); top.addColorStop(0.35, 'rgba(255,255,255,0)'); top.addColorStop(1, 'rgba(0,0,0,.06)');
  g.fillStyle = top; g.fillRect(0, 0, c.width, c.height);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}
const panel = new THREE.Mesh(new THREE.PlaneGeometry(1, 1),
  new THREE.MeshStandardMaterial({ map: panelTexture(), roughness: 0.78, metalness: 0.0, envMapIntensity: 0.25 }));
panel.receiveShadow = true;
scene.add(panel);

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

function makeKnob() {
  const g = new THREE.Group(), turn = new THREE.Group();
  const skirt = new THREE.Mesh(skirtGeo, MAT.skirt), cap = new THREE.Mesh(capGeo, MAT.cap);
  const head = new THREE.Mesh(headGeo, MAT.head), line = new THREE.Mesh(lineGeo, MAT.line);
  for (const m of [skirt, cap, head, line]) { m.castShadow = true; m.receiveShadow = true; }
  turn.add(skirt, cap, head, line); g.add(turn); g.userData = { turn, parts: { skirt, cap, head, line } };
  scene.add(g); return g;
}

const knobs = new Map(); // each .knob element: its three.js knob
let W = 0, H = 0;
function sync() {
  const sr = screen.getBoundingClientRect(), s = sr.width / screen.offsetWidth || 1;
  const w = screen.clientWidth, h = screen.clientHeight;
  if (w !== W || h !== H || renderer.getPixelRatio() !== Math.min(2, devicePixelRatio * s)) {
    W = w; H = h;
    renderer.setPixelRatio(Math.min(2, devicePixelRatio * s)); renderer.setSize(W, H, false);
    Object.assign(camera, { left: 0, right: W, top: 0, bottom: -H }); camera.updateProjectionMatrix();
    panel.scale.set(W, H, 1); panel.position.set(W / 2, -H / 2, 0);
    sun.position.set(W / 2 - 900, -H / 2 + 1100, 1600); sun.target.position.set(W / 2, -H / 2, 0);
    Object.assign(sun.shadow.camera, { left: -W * 0.75, right: W * 0.75, top: H * 0.75, bottom: -H * 0.75, near: 100, far: 4000 });
    sun.shadow.camera.updateProjectionMatrix();
  }
  const ox = sr.left + screen.clientLeft * s, oy = sr.top + screen.clientTop * s;
  const seen = new Set(); let sig = `${W}x${H}@${renderer.getPixelRatio()}`;
  for (const el of screen.querySelectorAll('.knob')) {
    const svg = el.querySelector('svg'), r = svg && svg.getBoundingClientRect();
    if (!r || !r.width) continue;
    seen.add(el);
    let k = knobs.get(el); if (!k) knobs.set(el, (k = makeKnob()));
    const size = r.width / s, x = (r.left - ox) / s + size / 2, y = (r.top - oy) / s + size / 2;
    k.position.set(x, -y, 0); k.scale.setScalar(size / 64);
    const m = /rotate\(([-\d.e]+)/.exec(el.querySelector('.rot')?.getAttribute('transform') || '');
    k.userData.turn.rotation.z = -(m ? +m[1] : 0) * Math.PI / 180;
    let o = 1; for (let e = el; e && e !== screen; e = e.parentElement) o *= +getComputedStyle(e).opacity;
    if (k.userData.o !== o) { k.userData.o = o; for (const [n, mesh] of Object.entries(k.userData.parts)) mesh.material = matAt(n, o); }
    k.visible = true;
    sig += `|${x.toFixed(1)},${y.toFixed(1)},${size.toFixed(1)},${m ? m[1] : 0},${o}`;
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
  || (r.attributeName === 'transform' && r.target.classList?.contains('rot')) || (r.attributeName === 'style' && r.target.id === 'stage');
new MutationObserver((rs) => { if (rs.some(relevant)) draw(); }).observe(document.getElementById('stage'),
  { subtree: true, childList: true, attributes: true, attributeFilter: ['transform', 'class', 'style', 'hidden'] });
new MutationObserver(draw).observe(root, { attributes: true, attributeFilter: ['class', 'style'] });
addEventListener('resize', draw);
document.fonts?.ready.then(draw);
draw(); setTimeout(draw, 300); setTimeout(draw, 1200);
