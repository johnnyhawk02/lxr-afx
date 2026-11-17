// LXR-AFX: preset names. New words jumbled out of pieces of real ones: the start of one word, sometimes the middle of
// a second, and the end of another, joined where a vowel meets a consonant so the result can be said out loud
// ("QUANTROPY", "NEBUTRON", "PHOSAR FLUXON"). No UI here.
//
// To add a theme, add a list to WORDS (lower case, letters only): every list is used.
export const WORDS = {
  space: ['nebula', 'quasar', 'pulsar', 'galaxy', 'comet', 'meteor', 'asteroid', 'orbit', 'planet', 'cosmos', 'stellar', 'lunar', 'solar',
    'nova', 'supernova', 'eclipse', 'zenith', 'apogee', 'perigee', 'aphelion', 'perihelion', 'equinox', 'solstice', 'satellite', 'rocket',
    'capsule', 'booster', 'gantry', 'telemetry', 'trajectory', 'parallax', 'parsec', 'redshift', 'singularity', 'wormhole', 'horizon',
    'corona', 'photosphere', 'magnetar', 'protostar', 'cluster', 'constellation', 'andromeda', 'orion', 'cassiopeia', 'sirius', 'vega',
    'altair', 'deneb', 'rigel', 'betelgeuse', 'antares', 'arcturus', 'polaris', 'mercury', 'venus', 'jupiter', 'saturn', 'uranus', 'neptune',
    'pluto', 'titan', 'europa', 'ganymede', 'callisto', 'triton', 'phobos', 'deimos', 'ceres', 'kuiper', 'heliopause', 'magnetosphere',
    'ionosphere', 'aurora', 'zodiac', 'celestial', 'astral', 'sidereal', 'galactic', 'interstellar', 'voyager', 'pioneer', 'apollo',
    'sputnik', 'soyuz', 'cosmonaut', 'astronaut', 'telescope', 'observatory', 'umbra', 'penumbra', 'albedo', 'azimuth', 'nadir', 'syzygy',
    'transit', 'occultation', 'libration', 'ecliptic', 'meridian', 'lagrange', 'perseid', 'pleiades', 'centauri', 'proxima', 'halley',
    'cygnus', 'draco', 'lyra', 'aquila', 'pegasus', 'hydra', 'carina', 'vela', 'corvus', 'gemini', 'taurus', 'scorpius', 'ophiuchus',
    'enceladus', 'oberon', 'titania', 'miranda', 'ariel', 'charon', 'eris', 'makemake', 'sedna', 'vesta', 'pallas', 'lander', 'rover',
    'module', 'docking', 'reentry', 'payload', 'thruster', 'nozzle', 'gimbal', 'apsis', 'periapsis', 'apoapsis', 'bolide', 'tektite'],
  physics: ['quantum', 'photon', 'electron', 'proton', 'neutron', 'quark', 'lepton', 'boson', 'gluon', 'muon', 'neutrino', 'hadron',
    'fermion', 'meson', 'baryon', 'positron', 'graviton', 'tachyon', 'plasma', 'entropy', 'enthalpy', 'inertia', 'momentum', 'velocity',
    'vector', 'tensor', 'scalar', 'kinetic', 'potential', 'voltage', 'current', 'ampere', 'farad', 'tesla', 'weber', 'joule', 'newton',
    'pascal', 'kelvin', 'hertz', 'coulomb', 'candela', 'lumen', 'flux', 'resonance', 'harmonic', 'oscillator', 'frequency', 'amplitude',
    'wavelength', 'interference', 'diffraction', 'refraction', 'reflection', 'polarization', 'spectrum', 'laser', 'maser', 'magnet',
    'dipole', 'monopole', 'solenoid', 'capacitor', 'inductor', 'resistor', 'diode', 'transistor', 'cathode', 'anode', 'isotope', 'nucleus',
    'fission', 'fusion', 'radiation', 'gamma', 'lambda', 'sigma', 'omega', 'delta', 'theta', 'epsilon', 'planck', 'fermi', 'dirac',
    'higgs', 'pauli', 'doppler', 'kepler', 'lorentz', 'maxwell', 'faraday', 'torque', 'friction', 'gravity', 'relativity', 'spacetime',
    'entanglement', 'superposition', 'uncertainty', 'symmetry', 'parity', 'viscosity', 'turbulence', 'vortex', 'thermal', 'adiabatic',
    'isotropic', 'cryogenic', 'superfluid', 'condensate', 'lattice', 'crystal', 'phonon', 'exciton', 'plasmon', 'soliton', 'chaos',
    'fractal', 'attractor', 'manifold', 'photonic', 'kinematic', 'ballistic', 'elastic', 'impulse', 'pendulum', 'gyroscope', 'cyclotron',
    'synchrotron', 'collider', 'calorimeter', 'interferometer', 'hologram', 'emission', 'absorption', 'ionization', 'valence', 'orbital',
    'eigenstate', 'hamiltonian', 'lagrangian', 'vacuum', 'ether', 'quintessence', 'antimatter', 'darkmatter', 'curvature', 'geodesic'],
};

const isVowel = (w, i) => 'aeiouy'.includes(w[i]) && !(w[i] === 'y' && i === 0) && !(w[i] === 'u' && w[i - 1] === 'q');
/** a word as runs of consonants and vowels in turn: "quasar" -> ['qu', 'a', 's', 'a', 'r'] ("qu" is one consonant
 *  sound, and a y that starts a word is a consonant), each { text, vowel } */
export function runs(word) {
  const out = [];
  for (let i = 0; i < word.length; i++) {
    const vowel = isVowel(word, i), last = out[out.length - 1];
    if (last && last.vowel === vowel) last.text += word[i]; else out.push({ text: word[i], vowel });
  }
  return out;
}
/** the pieces a word gives: heads (its start, up to and including a vowel run), middles (from a consonant run to a
 *  vowel run inside it) and tails (from a consonant run to its end). Every piece has a consonant and a vowel in it, and
 *  none is the whole word */
export function pieces(word) {
  const r = runs(word), join = (a, b) => r.slice(a, b).map((x) => x.text).join(''), heads = [], mids = [], tails = [];
  for (let i = 0; i < r.length; i++) {
    if (r[i].vowel && i > 0 && i < r.length - 1) { const h = join(0, i + 1); if (h.length >= 2 && h.length <= 5) heads.push(h); } // (with a consonant in it)
    if (!r[i].vowel && i > 0) {
      const t = join(i, r.length); if (i < r.length - 1 && t.length >= 2 && t.length <= 6) tails.push(t); // (with a vowel in it)
      for (let j = i + 1; j < r.length - 1; j++) if (r[j].vowel) { const m = join(i, j + 1); if (m.length >= 2 && m.length <= 4) mids.push(m); }
    }
  }
  return { heads, mids, tails };
}

const BLOCKED = ['fuck', 'shit', 'cunt', 'cock', 'dick', 'piss', 'anus', 'rape', 'nazi', 'slut', 'whor', 'fag', 'nig', 'wank', 'twat', 'porn', 'sex', 'jiz', 'coon', 'spic', 'kike'];
const sayable = (w) => !/(.)\1\1/.test(w) && !BLOCKED.some((b) => w.includes(b));
const pick = (a, rng) => a[Math.floor(rng() * a.length)];
let cache = null;
// every list's words (one copy of each) with their pieces; built again if WORDS was given another theme
function pool(lists) {
  const all = [...new Set(Object.values(lists).flat().map((w) => String(w).toLowerCase().replace(/[^a-z]/g, '')).filter((w) => w.length >= 3))];
  if (cache && cache.lists === lists && cache.n === all.length) return cache;
  const ps = all.map(pieces);
  return (cache = { lists, n: all.length, words: new Set(all), heads: ps.flatMap((p) => p.heads), mids: ps.flatMap((p) => p.mids), tails: ps.flatMap((p) => p.tails) });
}
/** one new word of min..max letters: a head, now and then a middle, and a tail, each from a different pick; never a
 *  word of the lists themselves */
export function jumble(rng = Math.random, min = 5, max = 10, lists = WORDS) {
  const p = pool(lists);
  for (let n = 0; n < 400; n++) {
    const w = pick(p.heads, rng) + (rng() < 0.3 ? pick(p.mids, rng) : '') + pick(p.tails, rng);
    if (w.length >= min && w.length <= max && !p.words.has(w) && sayable(w)) return w;
  }
  return 'nova' + pick(p.tails, rng); // (never reached with the lists as they are)
}
/** a preset name in capitals: one word, or two shorter ones; not one of taken (a Set of names in use) */
export function presetName(rng = Math.random, taken = new Set(), lists = WORDS) {
  for (let n = 0; n < 50; n++) {
    const name = (rng() < 0.55 ? jumble(rng, 6, 10, lists) : jumble(rng, 4, 7, lists) + ' ' + jumble(rng, 4, 7, lists)).toUpperCase();
    if (!taken.has(name)) return name;
  }
  return jumble(rng, 6, 10, lists).toUpperCase() + ' ' + (taken.size + 1);
}
