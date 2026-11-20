// The page inside the plugin. The plugin (plugin/src/PluginEditor.cpp) runs this before the page loads, after it sets
// window.lxrHost = { store, shared, rate }:
//   store   this plugin's own saved state (the page's localStorage 'lxr-afx-v3', kept in the DAW's project), or null
//   shared  the page's other lxr-afx-* settings (the LOOK, presets, saved sounds...), shared by every copy of the plugin
//   rate    the DAW's sample rate
// It stands in for what the page uses from the browser, so the page runs as it is (nothing in app/ is plugin code):
//   AudioContext + AudioWorkletNode   the port's messages go to the plugin's engine (the C++ port of sound/), its meters
//                                     come back to port.onmessage
//   navigator.requestMIDIAccess       one input, "DAW": the DAW's MIDI, so the page shows what's played. The plugin
//                                     plays the notes itself (sample-exact, window shut too), from the key table this
//                                     sends it (afx.keyTable: what each key plays), so the page's own 'play' for them is
//                                     dropped here
//   localStorage                      'lxr-afx-v3' is this plugin's state, the other lxr-afx-* keys are shared
(function () {
  'use strict';
  const host = (window.lxrHost = window.lxrHost || {});
  const STORE = 'lxr-afx-v3';

  // the plugin's side: window.__JUCE__ (JUCE's WebBrowserComponent), which may come in after this runs
  const queue = [], listeners = [];
  const backend = () => window.__JUCE__ && window.__JUCE__.backend;
  let hooked = false, waiting = false;
  function hook() {
    const b = backend(); if (!b) return false;
    if (!hooked) { hooked = true; for (const [n, f] of listeners) b.addEventListener(n, f); }
    while (queue.length) { const [n, p] = queue.shift(); b.emitEvent(n, p); }
    return true;
  }
  function emit(name, payload) {
    queue.push([name, payload]);
    if (hook() || waiting) return;
    waiting = true;
    const t = setInterval(() => { if (hook()) { clearInterval(t); waiting = false; } }, 10);
  }
  function on(name, f) { listeners.push([name, f]); const b = backend(); if (b && hooked) b.addEventListener(name, f); else emit('hello', '{}'); }
  const json = (m) => JSON.stringify(m, (k, v) => (ArrayBuffer.isView(v) ? Array.from(v) : v));

  // ---- storage ----
  const mem = new Map();
  for (const k in host.shared || {}) mem.set(k, String(host.shared[k]));
  if (host.store != null) mem.set(STORE, String(host.store));
  const fake = {
    getItem: (k) => (mem.has(String(k)) ? mem.get(String(k)) : null),
    setItem(k, v) {
      k = String(k); v = String(v); mem.set(k, v);
      if (k === STORE) stateSoon(); else if (k.startsWith('lxr-afx')) emit('shared', JSON.stringify({ k, v }));
    },
    removeItem(k) { k = String(k); mem.delete(k); if (k !== STORE && k.startsWith('lxr-afx')) emit('shared', JSON.stringify({ k, v: null })); },
    clear() { mem.clear(); },
    key: (i) => [...mem.keys()][i] ?? null,
    get length() { return mem.size; },
  };
  try { Object.defineProperty(window, 'localStorage', { get: () => fake, configurable: true }); }
  catch (e) { const P = Storage.prototype; P.getItem = fake.getItem; P.setItem = fake.setItem; P.removeItem = fake.removeItem; }

  // ---- the key table: what every key plays, so the plugin plays the DAW's notes itself ----
  let sent = new Map(), keysT = 0, stateT = 0;
  function table() { try { return window.afx && window.afx.keyTable ? window.afx.keyTable() : null; } catch (e) { return null; } }
  function sendKeys(full) {
    const t = table(); if (!t) return null;
    const now = new Map(t.map((e) => [e[0], json(e)])), keys = [], drop = [];
    for (const [n, s] of now) if (full || sent.get(n) !== s) keys.push(s);
    if (!full) for (const n of sent.keys()) if (!now.has(n)) drop.push(n);
    sent = now;
    if (full || keys.length || drop.length) emit('dsp', `{"type":"keys","full":${!!full},"keys":[${keys.join(',')}],"drop":${JSON.stringify(drop)}}`);
    return `[${[...now.values()].join(',')}]`;
  }
  const keysSoon = () => { if (!keysT) keysT = setTimeout(() => { keysT = 0; sendKeys(false); }, 40); };
  // the page saved (300 ms after any change): its state and the whole key table go into the DAW's project
  function stateSoon() {
    clearTimeout(stateT);
    stateT = setTimeout(() => { const keys = sendKeys(false); emit('state', `{"store":${JSON.stringify(mem.get(STORE) ?? null)},"keys":${keys || 'null'}}`); }, 0);
  }

  // ---- audio ----
  let quiet = false; // a DAW note going through the page: the plugin plays it already
  const NOTES = new Set(['play', 'back', 'release']);
  class Port {
    constructor() { this.onmessage = null; }
    postMessage(m) {
      if (!m || m.type === 'table') return; // (the plugin makes its own wavetables)
      if (NOTES.has(m.type)) { if (!quiet) emit('dsp', json(m)); return; }
      emit('dsp', json(m)); keysSoon();
    }
  }
  const port = new Port();
  on('peaks', (p) => { if (port.onmessage) port.onmessage({ data: typeof p === 'string' ? JSON.parse(p) : p }); });
  class AudioContext {
    constructor() { this.state = 'running'; this.sampleRate = host.rate || 48000; this.destination = {}; this.audioWorklet = { addModule: () => Promise.resolve() }; }
    get currentTime() { return performance.now() / 1000; }
    resume() { this.state = 'running'; return Promise.resolve(); }
    suspend() { return Promise.resolve(); }
  }
  class AudioWorkletNode { constructor() { this.port = port; } connect() {} disconnect() {} }
  window.AudioContext = AudioContext; window.webkitAudioContext = AudioContext; window.AudioWorkletNode = AudioWorkletNode;

  // ---- MIDI: the DAW's, shown on the page ----
  const input = { id: 'daw', name: 'DAW', manufacturer: '', state: 'connected', type: 'input', onmidimessage: null };
  const access = { inputs: new Map([['daw', input]]), outputs: new Map(), onstatechange: null, sysexEnabled: false };
  navigator.requestMIDIAccess = () => Promise.resolve(access);
  on('midi', (p) => {
    const list = typeof p === 'string' ? JSON.parse(p) : p;
    quiet = true;
    try { for (const d of list) if (input.onmidimessage) input.onmidimessage({ data: new Uint8Array(d), timeStamp: performance.now() }); }
    finally { quiet = false; }
  });

  // ---- Space is the DAW's (Johnny, 2026-11-20: Ableton's play/stop): the page doesn't take it, and with nothing on the
  // page handling it (no preventDefault) the webview passes it up to the plugin window and on to the DAW. A text field
  // still gets its spaces ----
  const typing = (t) => t && t.closest && t.closest('input[type="text"], input:not([type]), textarea, [contenteditable]');
  for (const type of ['keydown', 'keypress', 'keyup']) {
    window.addEventListener(type, (e) => {
      if ((e.key !== ' ' && e.code !== 'Space') || typing(e.target)) return;
      e.stopImmediatePropagation();
      const a = document.activeElement; if (a && a !== document.body && a.blur) a.blur(); // (or a focused button would press)
    }, true);
  }

  // the plugin asks for the whole table (a new engine after the DAW's sample rate changed, or a restored project)
  on('keys?', () => { sendKeys(true); });
  emit('hello', '{}');
})();
