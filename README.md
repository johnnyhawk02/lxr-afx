# LXR-AFX

A 7-voice MIDI drum instrument in the browser where every key plays a morphed variant of its sound, AFX style.
**Play it: https://johnnyhawk02.github.io/lxr-afx/** (Chrome or Edge, for Web MIDI)

![LXR-AFX at 1440 × 900](docs/screenshot.png)

- **Seven sounds on seven MIDI channels**: Drum 1, Drum 2, Drum 3, Snare, Cymbal, Closed hat and Open hat on channels 1 to 7.
  The CH setter at the top (ALL, 1-7) can send every note, on any channel, to one sound for testing.
  Keys C1 to C5 (C3 = MIDI 60), velocity used.
- **Key morph**: C3 plays the sound as you made it. Every other key plays a variant, changing pitch and timbre, more the
  further it is from C3. Each key's variant is fixed by the sound's seed; **re-roll** for a new set. Depth, pitch and
  timbre sliders for all sounds and per sound; depth 0 plays the base sound on every key.
- **Editor**: every parameter of each sound (tone, shape, filter, mod, mix). By default an edit changes only the last key
  pressed (or the key picked on the key map), kept on top of that key's morph; **ALL KEYS** edits the base instead, and
  every key's morph follows. **CLEAR KEY** / **CLEAR ALL KEYS** take a sound's key edits away.
- **Randomisers**: per sound (amount, wild, per-control locks, from a built-in kit, alter) and kit-wide (random kit,
  alter all), with undo.

## Code

| Path | What it is |
|---|---|
| `engine/` | the LXR-02 firmware's drum engine in JavaScript, copied unchanged from [elixir-desktop](https://github.com/johnnyhawk02/elixir-desktop) |
| `sound/schema.js` | the seven sounds and each one's parameter schema (range, default, display, morph and randomiser rules) |
| `sound/morph.js` | the key morph: pure, deterministic functions of the seed, the key and the base sound |
| `sound/instrument.js` | the engine as an instrument: `voices[i].play(note, velocity, params)` and `render(left, right)`, no UI |
| `sound/worklet.js` | the instrument in an AudioWorklet |
| `app/main.js`, `css/lcd.css` | the page |
| `kits/`, `sound/kits.js` | the built-in kits the randomisers draw from (`node tools/build-kits.mjs` rebuilds `kits.js`) |

No build step: the page loads the ES modules directly.

```sh
node test/morph.test.mjs                        # the morph and engine checks
python3 -m http.server 8123 & node test/shots.mjs   # screenshots at 1440x900 and 1280x800 (needs Playwright)
```

## Licence

GPL-3.0-only (see [LICENSE](LICENSE)), like Elixir and the firmware its engine is ported from
([erica-synths/lxr-desktop-app](https://github.com/erica-synths/lxr-desktop-app)). Unofficial: not made, approved or
endorsed by Erica Synths. "LXR" and "LXR-02" are trademarks of Erica Synths. The built-in kits include the Hrtl LXR-02
DLC kits, by Hrtl, distributed free by Erica Synths.
