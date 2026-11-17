// The 3D view: the instrument as a piece of hardware, drawn with three.js. It keeps no state of its own: everything it
// shows it reads through the bridge (window.afx, see app/main.js), and every knob, key and button calls the same
// actions as the 2D screen. It draws only when something changed (the bridge's rev counter, a pointer, an animation).
import * as THREE from '../vendor/three.module.min.js';
import { RoomEnvironment } from '../vendor/RoomEnvironment.js';

// the panel, in "centimetres": x to the right, z towards you, the panel's top at y = 0
const PW = 60, PD = 46, TOP = 0;
const PX = 40; // silkscreen pixels per unit
const ROW_Z = [-9.9, -3.7, 2.5, 8.7], ROW_X0 = -27, PITCH = 4.2, SEC_GAP = 1.3;
const SIDE_X = 23.4; // the right-hand column: the key's sends, and its LEVEL under them
const KEY_Z0 = 14.3, KEY_LEN = 7.4, KEY_W = 2.6, LED_Z = 13.2;
const LCD = { x: -17, z: -18.6, w: 23, d: 6.6 };
const ENG = { x: [-0.6, 5.2, 11], z: -18.9, w: 5.2, d: 2.6 };
const A0 = 0.75 * Math.PI, SWEEP = 1.5 * Math.PI; // a knob turns from 7 o'clock to 5 o'clock, as on the 2D screen

export function start(afx, onExit) {
  const wrap = document.createElement('div'); wrap.className = 'view3d'; wrap.hidden = true;
  wrap.innerHTML = '<canvas></canvas><div class="bar3d"><button class="btn sm" id="exit3d" title="Back to the 2D screen">2D VIEW</button></div>';
  document.body.append(wrap);
  const canvas = wrap.querySelector('canvas');
  wrap.querySelector('#exit3d').addEventListener('click', onExit);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
  const scene = new THREE.Scene(); scene.background = new THREE.Color(0x0b0c0e);
  const pm = new THREE.PMREMGenerator(renderer);
  scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture; scene.environmentIntensity = 0.55;
  const camera = new THREE.PerspectiveCamera(20, 1, 1, 900);

  // one light source, upper left and behind the panel, so every knob throws the same shadow
  const sun = new THREE.DirectionalLight(0xfff1dc, 2.6);
  sun.position.set(-30, 70, -34); sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048); sun.shadow.radius = 5; sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.03;
  Object.assign(sun.shadow.camera, { left: -44, right: 44, top: 36, bottom: -36, near: 10, far: 200 });
  scene.add(sun, new THREE.HemisphereLight(0xbfd0ff, 0x1a1410, 0.35));

  // ---- the case: a dark anodised panel between two wooden cheeks, on a table ----
  const std = (o) => new THREE.MeshStandardMaterial(o);
  const add = (mesh, cast = true, recv = true) => { mesh.castShadow = cast; mesh.receiveShadow = recv; scene.add(mesh); return mesh; };
  const table = add(new THREE.Mesh(new THREE.PlaneGeometry(600, 600), std({ color: 0x101113, roughness: 0.92 })), false);
  table.rotation.x = -Math.PI / 2; table.position.y = -3.2;
  const body = add(new THREE.Mesh(new THREE.BoxGeometry(PW, 3.2, PD), std({ color: 0x17181b, metalness: 0.6, roughness: 0.5 })));
  body.position.y = TOP - 1.6 - 0.01;
  const woodTex = (() => {
    const c = document.createElement('canvas'); c.width = 64; c.height = 512; const g = c.getContext('2d');
    g.fillStyle = '#6b4526'; g.fillRect(0, 0, 64, 512);
    let seed = 7; const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 260; i++) { g.strokeStyle = `rgba(${r() < 0.5 ? '40,22,10' : '150,104,64'},${0.05 + r() * 0.16})`; g.lineWidth = 0.5 + r() * 2; const x = r() * 64; g.beginPath(); g.moveTo(x, 0); g.bezierCurveTo(x + r() * 8 - 4, 170, x + r() * 8 - 4, 340, x + r() * 6 - 3, 512); g.stroke(); }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  })();
  const wood = std({ map: woodTex, roughness: 0.55 });
  for (const sx of [-1, 1]) { const ch = add(new THREE.Mesh(new THREE.BoxGeometry(1.6, 4.2, PD + 1), wood)); ch.position.set(sx * (PW / 2 + 0.8), TOP - 1.3, 0); }

  // ---- the silkscreen: the panel's face is one canvas (labels, section rules and each control's value), lit like
  // the rest, so the text stays sharp and the knobs' shadows fall across it ----
  const silk = document.createElement('canvas'); silk.width = PW * PX; silk.height = PD * PX;
  const sg = silk.getContext('2d');
  const silkTex = new THREE.CanvasTexture(silk); silkTex.colorSpace = THREE.SRGBColorSpace;
  silkTex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  const face = add(new THREE.Mesh(new THREE.PlaneGeometry(PW, PD), std({ map: silkTex, metalness: 0.55, roughness: 0.48 })), false);
  face.rotation.x = -Math.PI / 2; face.position.y = TOP;
  const sx = (x) => (x + PW / 2) * PX, sz = (z) => (z + PD / 2) * PX;
  const FONT = '"Helvetica Neue", Helvetica, Arial, sans-serif';
  function text(t, x, z, size, { color = '#e9eaec', align = 'center', weight = 600, maxW = 0, font = FONT } = {}) {
    sg.font = `${weight} ${size * PX}px ${font}`; sg.fillStyle = color; sg.textAlign = align; sg.textBaseline = 'middle';
    if (maxW) { const w = sg.measureText(t).width; if (w > maxW * PX) { sg.save(); sg.translate(sx(x), sz(z)); sg.scale(maxW * PX / w, 1); sg.fillText(t, 0, 0); sg.restore(); return; } }
    sg.fillText(t, sx(x), sz(z));
  }
  const rule = (x1, x2, z, color = '#7d8188', w = 0.06) => { sg.strokeStyle = color; sg.lineWidth = w * PX; sg.beginPath(); sg.moveTo(sx(x1), sz(z)); sg.lineTo(sx(x2), sz(z)); sg.stroke(); };

  // ---- the LCD: the 2D screen's green display, sunk behind glass in a raised bezel ----
  const lcdC = document.createElement('canvas'); lcdC.width = 1045; lcdC.height = 300; const lg = lcdC.getContext('2d');
  const lcdTex = new THREE.CanvasTexture(lcdC); lcdTex.colorSpace = THREE.SRGBColorSpace; lcdTex.anisotropy = silkTex.anisotropy;
  const lcd = new THREE.Mesh(new THREE.PlaneGeometry(LCD.w, LCD.d), new THREE.MeshBasicMaterial({ map: lcdTex, toneMapped: false }));
  lcd.rotation.x = -Math.PI / 2; lcd.position.set(LCD.x, TOP + 0.08, LCD.z); scene.add(lcd);
  const bezelM = std({ color: 0x0e0f11, metalness: 0.3, roughness: 0.35 });
  const bz = 0.9, bh = 0.7;
  for (const [w, d, x, z] of [[LCD.w + 2 * bz, bz, 0, -(LCD.d + bz) / 2], [LCD.w + 2 * bz, bz, 0, (LCD.d + bz) / 2], [bz, LCD.d, -(LCD.w + bz) / 2, 0], [bz, LCD.d, (LCD.w + bz) / 2, 0]]) {
    const b = add(new THREE.Mesh(new THREE.BoxGeometry(w, bh, d), bezelM)); b.position.set(LCD.x + x, TOP + bh / 2, LCD.z + z);
  }
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(LCD.w, LCD.d), new THREE.MeshPhysicalMaterial({ color: 0xffffff, transparent: true, opacity: 0.1, roughness: 0.04, metalness: 0, clearcoat: 1 }));
  glass.rotation.x = -Math.PI / 2; glass.position.set(LCD.x, TOP + bh - 0.12, LCD.z); scene.add(glass);
  function drawLcd() {
    const d = afx.lcd(), W = lcdC.width, H = lcdC.height, ink = '#1b2310', dim = 'rgba(27,35,16,.55)';
    lg.fillStyle = d.locked ? '#1b2310' : '#b4c48c'; lg.fillRect(0, 0, W, H);
    const fg = d.locked ? '#b4c48c' : ink, fd = d.locked ? 'rgba(180,196,140,.6)' : dim;
    lg.textBaseline = 'alphabetic'; lg.textAlign = 'left';
    lg.fillStyle = fd; lg.font = '34px VT323, monospace'; lg.fillText('KEY', 28, 62);
    lg.fillStyle = fg; lg.font = '150px VT323, monospace'; lg.fillText(d.note, 22, 172);
    lg.fillStyle = fd; lg.font = '40px VT323, monospace'; lg.fillText(d.num + (d.locked ? '  LOCKED' : ''), 28, 216);
    lg.fillStyle = fg; lg.font = '76px VT323, monospace'; lg.fillText(d.engine, 300, 84);
    lg.font = '50px VT323, monospace'; lg.fillText(fit(lg, d.info, W - 330), 300, 140);
    lg.fillStyle = fd; lg.font = '38px VT323, monospace'; lg.fillText(fit(lg, d.last, W - 330), 300, 190);
    lg.fillStyle = fg; lg.fillRect(0, 232, W, 3);
    lg.font = '44px VT323, monospace'; lg.fillText(fit(lg, d.detail, W - 56), 28, 278);
    // the display's pixel grid
    lg.fillStyle = 'rgba(0,0,0,.05)'; for (let y = 0; y < H; y += 4) lg.fillRect(0, y, W, 1);
    lcdTex.needsUpdate = true;
  }
  const fit = (g, t, w) => { if (g.measureText(t).width <= w) return t; while (t.length > 3 && g.measureText(t + '…').width > w) t = t.slice(0, -1); return t + '…'; };

  // ---- knobs ----
  const alu = std({ color: 0xc8cbd0, metalness: 1, roughness: 0.36 });
  const aluTop = std({ color: 0xdcdee2, metalness: 0.85, roughness: 0.62 });
  const inkM = std({ color: 0x101114, roughness: 0.6 });
  const lathe = (pts, seg) => new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), seg);
  const knobGeo = {
    body: lathe([[1.16, 0], [1.16, 0.22], [1.02, 0.3], [0.96, 1.5], [0.9, 1.58]], 20).toNonIndexed(), // 20 flats: machined
    top: lathe([[0.9, 1.58], [0.84, 1.6], [0, 1.6]], 48),
    mark: new THREE.BoxGeometry(0.18, 0.03, 0.8),
    side: new THREE.BoxGeometry(0.1, 1.1, 0.03),
  };
  knobGeo.body.computeVertexNormals(); // flat facets
  function makeKnob(scale) {
    const g = new THREE.Group(), rot = new THREE.Group(); g.add(rot);
    const b = new THREE.Mesh(knobGeo.body, alu), t = new THREE.Mesh(knobGeo.top, aluTop);
    const m = new THREE.Mesh(knobGeo.mark, inkM); m.position.set(0, 1.605, -0.46);
    const s = new THREE.Mesh(knobGeo.side, inkM); s.position.set(0, 0.9, -0.975);
    for (const o of [b, t]) { o.castShadow = true; o.receiveShadow = true; }
    rot.add(b, t, m, s); g.scale.setScalar(scale); g.userData.rot = rot;
    return g;
  }
  let knobs = [], ctl = null, voiceBuilt = -1;
  const knobRoot = new THREE.Group(); scene.add(knobRoot);
  function buildKnobs() {
    ctl = afx.controls(); voiceBuilt = ctl.voice; knobRoot.clear(); knobs = [];
    const put = (c, x, z, scale, sec) => { const k = makeKnob(scale); k.position.set(x, TOP, z); k.userData.pick = { kind: 'knob', i: knobs.length }; knobRoot.add(k); knobs.push({ c, x, z, scale, mesh: k, sec }); };
    ctl.rows.forEach((secs, r) => {
      let x = ROW_X0;
      for (const sec of secs) { sec.x0 = x; sec.z = ROW_Z[r]; for (const c of sec.items) { put(c, x + PITCH / 2, ROW_Z[r], 1); x += PITCH; } sec.x1 = x; x += SEC_GAP; }
    });
    ctl.sends.forEach((c, i) => put(c, SIDE_X + (i - (ctl.sends.length - 1) / 2) * PITCH, ROW_Z[1], 1));
    put(ctl.level, SIDE_X, ROW_Z[3] - 2.4, 2.1);
  }

  // ---- the keys: 25 of them, as on the Bass Station 2, each with an LED: lit for the key being edited, dim for a
  // key with its own sound, red for a locked one ----
  const whiteM = std({ color: 0xe9e5d9, roughness: 0.3 }), blackM = std({ color: 0x141416, roughness: 0.28 });
  const ledGeo = new THREE.CylinderGeometry(0.24, 0.24, 0.16, 16);
  const keys = [];
  const lowNote = () => afx.sounds[0].zone.lo, soundOf = (note) => afx.sounds.findIndex((s) => note >= s.zone.lo && note <= s.zone.hi);
  const KX0 = -15 * KEY_W / 2;
  const WHITE = [0, -1, 1, -1, 2, 3, -1, 4, -1, 5, -1, 6], AFTER = [0, 0, 1, 1, 2, 3, 3, 4, 4, 5, 5, 6];
  for (let i = 0; i < 25; i++) {
    const o = Math.floor(i / 12), s = i % 12, blk = WHITE[s] < 0;
    const x = blk ? KX0 + (o * 7 + AFTER[s] + 1) * KEY_W : KX0 + (o * 7 + WHITE[s] + 0.5) * KEY_W;
    const piv = new THREE.Group(); piv.position.set(x, TOP + (blk ? 0.75 : 0.1), KEY_Z0);
    const m = new THREE.Mesh(blk ? new THREE.BoxGeometry(KEY_W * 0.56, 1.1, KEY_LEN * 0.62) : new THREE.BoxGeometry(KEY_W - 0.12, 1.0, KEY_LEN), blk ? blackM : whiteM);
    m.position.set(0, 0, (blk ? KEY_LEN * 0.62 : KEY_LEN) / 2); m.castShadow = true; m.receiveShadow = true;
    m.userData.pick = { kind: 'key', i };
    piv.add(m); scene.add(piv);
    const led = new THREE.Mesh(ledGeo, new THREE.MeshStandardMaterial({ color: 0x2a2018, emissive: 0x000000, roughness: 0.3 }));
    led.position.set(x, TOP + 0.08, LED_Z - (blk ? 0.75 : 0)); scene.add(led);
    keys.push({ piv, led, blk, x, down: 0, pos: 0 });
  }
  // the keybed's well: the keys sit a little into the panel
  const lip = add(new THREE.Mesh(new THREE.BoxGeometry(15 * KEY_W + 0.6, 0.5, 0.5), bezelM)); lip.position.set(0, TOP + 0.25, KEY_Z0 - 0.35);

  // ---- the three engine buttons: a cap that stays down, LED on, for the engine in front ----
  const capM = std({ color: 0x33363b, roughness: 0.75 }), capGeo = new THREE.BoxGeometry(ENG.w, 0.9, ENG.d), lensGeo = new THREE.BoxGeometry(0.9, 0.12, 0.42);
  const engines = afx.sounds.map((s, i) => {
    const cap = add(new THREE.Mesh(capGeo, capM)); cap.position.set(ENG.x[i], TOP + 0.45, ENG.z); cap.userData.pick = { kind: 'engine', i };
    const lens = new THREE.Mesh(lensGeo, new THREE.MeshStandardMaterial({ color: 0x3a2a14, emissive: 0x000000, roughness: 0.25 })); lens.position.set(-ENG.w / 2 + 0.9, 0.46, 0); cap.add(lens);
    return { cap, lens, pos: 0 };
  });

  // ---- the silkscreen's text ----
  function drawSilk() {
    sg.fillStyle = '#1a1c1f'; sg.fillRect(0, 0, silk.width, silk.height);
    // a faint brushed grain
    sg.globalAlpha = 0.035; sg.fillStyle = '#fff'; let q = 3; for (let y = 0; y < silk.height; y += 3) { q = (q * 16807) % 2147483647; sg.fillRect(0, y, silk.width, (q % 3) ? 1 : 0); } sg.globalAlpha = 1;
    text('LXR-AFX', 27.6, -19.6, 2.1, { align: 'right', weight: 800 });
    text('MIDI DRUM SYNTHESIZER', 27.6, -17.7, 0.6, { align: 'right', color: '#8d9198' });
    text('ENGINE', ENG.x[0] - ENG.w / 2, ENG.z - 2.3, 0.62, { align: 'left', color: '#8d9198' });
    afx.sounds.forEach((s, i) => text(`${s.name}  ${afx.noteName(s.zone.lo)}-${afx.noteName(s.zone.hi)}`, ENG.x[i], ENG.z + 2.25, 0.66));
    for (const secs of ctl.rows) for (const sec of secs) {
      const xa = sec.x0 + 0.5, xb = sec.x1 - 0.5;
      text(sec.name.toUpperCase(), xa, sec.z - 3.5, 0.72, { align: 'left', weight: 700 });
      rule(xa + sg.measureText(sec.name.toUpperCase()).width / PX + 0.4, xb, sec.z - 3.5);
    }
    text('FX SENDS', SIDE_X - PITCH + 0.5, ROW_Z[1] - 3.5, 0.72, { align: 'left', weight: 700 });
    rule(SIDE_X - PITCH + 5.3, SIDE_X + PITCH - 0.5, ROW_Z[1] - 3.5);
    sg.strokeStyle = '#3a3d42'; sg.lineWidth = 0.06 * PX; sg.beginPath(); sg.moveTo(sx(SIDE_X - PITCH - 0.9), sz(ROW_Z[0] - 3.6)); sg.lineTo(sx(SIDE_X - PITCH - 0.9), sz(ROW_Z[3] + 2.4)); sg.stroke();
    for (const k of knobs) {
      const big = k.scale > 1.5, r = 1.16 * k.scale;
      // the scale round the knob: a dot at each end and the middle
      sg.fillStyle = '#8d9198';
      for (const f of [0, 0.25, 0.5, 0.75, 1]) { const a = A0 + f * SWEEP, rr = r + 0.42; sg.beginPath(); sg.arc(sx(k.x + rr * Math.cos(a)), sz(k.z + rr * Math.sin(a)), (f === 0.5 ? 0.09 : 0.07) * PX, 0, 7); sg.fill(); }
      text(afx.text(k.c), k.x, k.z - r - (big ? 1.5 : 1.12), big ? 1.25 : 0.72, { color: afx.keyed(k.c) ? '#ffd98a' : '#ffb94f', maxW: big ? 8 : PITCH - 0.25, weight: 600 });
      text(k.c.label.toUpperCase(), k.x, k.z + r + (big ? 1.2 : 0.62), big ? 1.2 : 0.56, { maxW: big ? 8 : PITCH - 0.2, weight: big ? 800 : 600 });
    }
    // the three zones over the keys
    afx.sounds.forEach((s) => {
      const a = keys[s.zone.lo - lowNote()], b = keys[s.zone.hi - lowNote()]; if (!a || !b) return;
      const xa = a.x - 0.55, xb = b.x + 0.55, z = LED_Z - 1.75;
      rule(xa, xb, z, '#7d8188'); for (const x of [xa, xb]) { sg.beginPath(); sg.moveTo(sx(x), sz(z)); sg.lineTo(sx(x), sz(z + 0.4)); sg.stroke(); }
      sg.fillStyle = '#1a1c1f'; const w = s.name.length * 0.5 + 0.8; sg.fillRect(sx((xa + xb) / 2 - w / 2), sz(z - 0.4), w * PX, 0.8 * PX);
      text(s.name, (xa + xb) / 2, z, 0.66, { weight: 700 });
    });
    silkTex.needsUpdate = true;
  }

  // ---- what changes with the state: knob angles, LEDs, the engine in front, the two canvases ----
  let rev = -1, dirty = true;
  function sync() {
    if (afx.controls().voice !== voiceBuilt) buildKnobs();
    for (const k of knobs) {
      const v = afx.value(k.c), n = k.c.steps ? k.c.steps.length - 1 : k.c.max;
      const f = n ? (k.c.steps ? Math.max(0, k.c.steps.indexOf(v)) : v) / n : 0;
      k.mesh.userData.rot.rotation.y = (0.75 - 1.5 * f) * Math.PI;
    }
    keys.forEach((k, i) => {
      const note = lowNote() + i, s = soundOf(note), st = s < 0 ? {} : afx.key(s, note);
      k.led.material.color.set(st.locked ? 0x40100c : 0x2a2018);
      k.led.material.emissive.set(st.sel ? (st.locked ? 0xff3020 : 0xffa030) : st.locked ? 0x8a1408 : st.own ? 0x3a7a20 : 0x000000);
      k.led.material.emissiveIntensity = st.sel ? 2.4 : 0.9;
    });
    engines.forEach((e, i) => { const on = i === afx.sel(); e.lens.material.emissive.set(on ? 0xffa030 : 0x000000); e.lens.material.emissiveIntensity = 2.4; e.target = on ? 1 : 0; });
    drawSilk(); drawLcd();
  }

  // ---- the camera: looking down the panel from the front, pulled back until the whole case is in the window ----
  function frame() {
    const w = wrap.clientWidth, h = wrap.clientHeight; if (!w || !h) return;
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2)); renderer.setSize(w, h, false);
    camera.aspect = w / h;
    const dir = new THREE.Vector3(0, Math.sin(1.24), Math.cos(1.24)), look = new THREE.Vector3(0, 0, 0);
    const pts = []; for (const x of [-PW / 2 - 1.8, PW / 2 + 1.8]) for (const z of [-PD / 2 - 0.6, PD / 2 + 0.6]) for (const y of [-3.2, 1.6]) pts.push(new THREE.Vector3(x, y, z));
    let lo = 40, hi = 800;
    for (let i = 0; i < 22; i++) {
      const d = (lo + hi) / 2; camera.position.copy(look).addScaledVector(dir, d); camera.lookAt(look); camera.updateMatrixWorld(); camera.updateProjectionMatrix();
      const fits = pts.every((p) => { const q = p.clone().project(camera); return Math.abs(q.x) < 0.985 && q.y < 0.97 && q.y > -0.97; });
      if (fits) hi = d; else lo = d;
    }
    camera.position.copy(look).addScaledVector(dir, hi); camera.lookAt(look); camera.updateProjectionMatrix();
    dirty = true;
  }
  window.addEventListener('resize', frame);

  // ---- pointer: drag a knob (up is more, Shift is fine), wheel it a step, double-click it home; press a key; push
  // an engine's button ----
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  function pick(ev) {
    const r = canvas.getBoundingClientRect(); ndc.set((ev.clientX - r.left) / r.width * 2 - 1, -(ev.clientY - r.top) / r.height * 2 + 1);
    ray.setFromCamera(ndc, camera);
    for (const hit of ray.intersectObjects(scene.children, true)) { let o = hit.object; while (o && !o.userData.pick) o = o.parent; if (o) return o.userData.pick; if (hit.object === face || hit.object === body) return null; }
    return null;
  }
  const span = (c) => (c.steps ? c.steps.length - 1 : c.max), at = (c) => (c.steps ? Math.max(0, c.steps.indexOf(afx.value(c))) : afx.value(c));
  const putAt = (c, x) => { x = Math.max(0, Math.min(span(c), Math.round(x))); afx.set(c, c.steps ? c.steps[x] : x); };
  let drag = null, heldKey = -1;
  const keyUp = () => { if (heldKey < 0) return; keys[heldKey].down = 0; afx.release(lowNote() + heldKey); heldKey = -1; dirty = true; };
  canvas.addEventListener('pointerdown', (ev) => {
    const p = pick(ev); if (!p) return;
    canvas.setPointerCapture(ev.pointerId); afx.wake();
    if (p.kind === 'knob') { const c = knobs[p.i].c; drag = { c, y: ev.clientY, from: at(c) }; canvas.style.cursor = 'ns-resize'; }
    else if (p.kind === 'key') { const note = lowNote() + p.i, s = soundOf(note); if (s < 0) return; heldKey = p.i; keys[p.i].down = 1; afx.press(s, note); dirty = true; }
    else if (p.kind === 'engine') afx.select(p.i);
  });
  canvas.addEventListener('pointermove', (ev) => {
    if (drag) { putAt(drag.c, drag.from + (drag.y - ev.clientY) * span(drag.c) / (ev.shiftKey ? 640 : 160)); return; }
    if (heldKey >= 0) return;
    const p = pick(ev); canvas.style.cursor = p ? (p.kind === 'knob' ? 'ns-resize' : 'pointer') : '';
  });
  const end = () => { drag = null; keyUp(); };
  canvas.addEventListener('pointerup', end); canvas.addEventListener('pointercancel', end);
  canvas.addEventListener('wheel', (ev) => { const p = pick(ev); if (!p || p.kind !== 'knob') return; ev.preventDefault(); const c = knobs[p.i].c; putAt(c, at(c) + (ev.deltaY < 0 ? 1 : -1)); }, { passive: false });
  canvas.addEventListener('dblclick', (ev) => { const p = pick(ev); if (p && p.kind === 'knob') afx.reset(knobs[p.i].c); });

  // ---- the loop: nothing is drawn unless something moved ----
  let shown = false;
  function tick() {
    if (!shown) return;
    requestAnimationFrame(tick);
    if (afx.rev() !== rev) { rev = afx.rev(); sync(); dirty = true; }
    for (const k of keys) { if (Math.abs(k.pos - k.down) > 0.002) { k.pos += (k.down - k.pos) * 0.45; dirty = true; } else k.pos = k.down; k.piv.rotation.x = k.pos * 0.075; }
    for (const e of engines) { if (Math.abs(e.pos - e.target) > 0.002) { e.pos += (e.target - e.pos) * 0.4; dirty = true; } else e.pos = e.target; e.cap.position.y = TOP + 0.45 - e.pos * 0.28; }
    if (dirty) { dirty = false; renderer.render(scene, camera); }
  }
  buildKnobs();
  document.fonts?.ready.then(() => { rev = -1; });
  // where a control is in the window (for tests, and later for hints)
  const where = (v) => { const q = v.project(camera), r = canvas.getBoundingClientRect(); return { x: r.left + (q.x + 1) / 2 * r.width, y: r.top + (1 - q.y) / 2 * r.height }; };
  return {
    knobAt: (label) => { const k = knobs.find((k) => k.c.label === label); return k && where(new THREE.Vector3(k.x, 1.6 * k.scale, k.z)); },
    keyAt: (i) => where(new THREE.Vector3(keys[i].x, keys[i].blk ? 1.3 : 0.6, KEY_Z0 + (keys[i].blk ? 2.5 : 6))),
    engineAt: (i) => where(new THREE.Vector3(ENG.x[i], 0.9, ENG.z)),
    show(on) { wrap.hidden = !on; if (on && !shown) { shown = true; rev = -1; frame(); tick(); } else if (!on) shown = false; },
  };
}
