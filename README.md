# LXR-AFX

An AFX-mode drum instrument in the browser: three sounds on one MIDI channel, every key its own sound.
**Play it: https://johnnyhawk02.github.io/lxr-afx/** (Chrome or Edge, for Web MIDI)

![LXR-AFX at 1440 × 900](docs/screenshot.png)

- **Three zones on MIDI channel 1**, laid out for the 25 keys of a Bass Station 2 at its default octave (lowest key MIDI
  48), one zone for each of the engine's three voice types, all three able to sound at once: **drum** on the lowest 8
  keys (48-55), **snare** on the next 8 (56-63), **metal** on the top 9 (64-72). Each zone's base key is its middle key
  (52, 60, 68). LOW KEY moves the whole layout by octaves; the sizes are `ZONE_SIZES` in `sound/schema.js`. Velocity is used.
- **Every key has its own sound.** A zone starts with a different kit sound of its type on every key (SCATTER in the
  RANDOM menu deals a fresh set); a key with nothing of its own plays the engine's base. (The auto-morph of earlier
  versions is gone: sound/morph.js is no longer used.)
- **Layout, top down: the key, then its engine, then its synth settings.** The key header shows the key you last played
  (or clicked on its strip of all 25 keys), its engine and what it plays, with **LOCK KEY** (L),
  **ALTER KEY** (A), **COPY** / **PASTE** (Cmd+C / Cmd+V, Ctrl on a PC; onto another engine it maps by control name) and
  **CLEAR**. A locked key turns the header black and veils the knobs. Everything that randomises a
  whole engine or all three (INIT PATCH, scatter, alter, level, the ALTER amount, RHYTHMS, AUTO LEVEL, control locks)
  is in the **RANDOM** menu.
- **FX and master** (the right-hand column, full height): the two send effects from Elixir Desktop (the firmware's
  delay as an echo, and its reverb, both returned at full level), then the **master**: everything, dry and FX returns, through the
  **distortion**, then a soft-knee compressor (threshold, ratio, attack, release, knee, makeup) with a
  gain-reduction meter, then the level. Each key's ECHO / REVERB sends are FX SENDS knobs with its synth knobs.
  The echo's **SYNC** switch turns TIME from milliseconds into a note length at the BPM (1/32 to 1/2, with triplets and
  dotted lengths, 1/8D by default), and it follows the BPM; switched off, TIME goes back to the milliseconds it had.
- **Master distortion** (`sound/dirt.js`, our own design after a dual-path bass distortion pedal's signal flow), before
  the compressor, off until its **ON** is pressed. A dirty path, PREGAIN, then a filter (FILTER: high-pass, or LP),
  GAIN into two anti-aliased clip stages (CLIP: diode, hard and early, or LED, louder and more open), then TONE (bass,
  scooped mids at noon, treble) with BASS shelving its bass end, at the DIRTY volume; beside it a clean path at the
  CLEAN volume. XOVER sends the half of the signal the filter takes away to the clean path (distorted highs with clean
  lows, or the other way round). The **SIDECHAIN** listens to the mix or one engine (SOURCE), through a filter (LP, BP,
  HP at FREQ) into an envelope (SENS, DECAY, shown on the ENV meter) that turns PREGAIN, CUTOFF or TONE up or down.
- **Mono, last-note priority, per zone**: each zone (drum, snare, metal) plays one key at a time, the newest. Hold a
  key, press another in the same zone and it takes over (with its own sound and sequence); let go of it while the
  first is still held and the first comes back on the next step of the BPM grid (**RETURN** in the top bar: NOW,
  1/32, **1/16** by default, 1/8, 1/4). The three zones don't affect each other. MIDI all-notes-off lets go of every
  zone.
- **Sequencer** (SEQ, each key its own): eight steps, **ACTIVE** and **RANDOM**. While the key is held and ACTIVE is
  on it plays its lit steps in 1/16s on the BPM grid, starting on the next 1/16 after the press, round and round; with
  ACTIVE off the key plays once as usual. RANDOM deals a new pattern (and switches it on); editing steps while the key
  is held is heard at once. **NEW SOUND** gives the key a random pattern, switched on, at the RHYTHMS share (and switches it
  off otherwise); its padlock keeps NEW SOUND off it. The other randomisers never touch it.
- **RHYTHMS** (RANDOM menu, 50% by default): the share of keys that play a running rhythm. Moving it switches keys on
  or off at once across all three zones (always the same keys in the same order, each keeping its pattern or dealt a
  random one); SCATTER and SCATTER ALL deal rhythms to exactly that share of each zone's keys, NEW SOUND
  at that chance. 0%: no key, 100%: every key. Locked keys, and a zone whose SEQ is locked, stay as they are; UNDO takes back a whole drag.
- **Left column**: the key, its engine, and the synth knobs in four rows (osc, fm / amp, pitch, click / filter,
  velocity, mix / lfo, seq), with the **NEW SOUND** dice, the key's ECHO / REVERB sends and its big **LEVEL** knob in a column at the
  right. Everything sits on one grid: equal cells, one knob to a cell, so every knob lines up with the ones above and
  below it on every engine; the right-hand column shares one set of six columns the same way. Pasting a key onto
  another engine labels it, e.g. "Brownie snare (as metal)".
- **Editor**: every parameter of the sound on one screen, as knobs (drag up/down, or the arrow keys once clicked; the scroll
  wheel and the trackpad never change a control, so passing the pointer over one is safe). A control you
  change by hand on a key gets a **lit label**, a notch outside its ring shows where it was, and a **double-click puts
  it back**; the key header counts the edits ("Brownie snare · 2 edits") and the key gets a dot on the strip. The
  small **padlock** at a knob's top right locks that control against the randomisers (faint: open, solid: locked). Plus-minus knobs (PAN, COARSE, FINE, the FM and mod frequencies,
  the distortion's PREGAIN, BASS and TONE) have their centre at the top and light from there out to either side; PAN
  reads **L100 … C … R100**, with L and R at the ends of its ring. By default an edit changes only the last key
  pressed (or the key picked in the key list); **ALL KEYS** sets a control on every key of the zone at once (locked keys
  stay). **CLEAR** puts a key back to the engine's base sound.
- **Knobs** (MIDI CC on channel 1), mapped for a Bass Station 2: they act on the last key played, like the editor (which
  follows the sound you play). Filter freq → cutoff, resonance → reso, overdrive → drive, amp attack/decay → attack/decay,
  mod env decay → pitch decay, mod env depth → pitch amount, distortion → FM amount, osc 1 coarse/fine → coarse/fine,
  LFO 1 speed / portamento → the key's echo / reverb sends, osc 1 / osc 2 / sub levels → the
  drum / snare / metal levels. **LEARN** maps any knob to any control: press it, click the control, turn the knob.
- **Randomisers**: **SCATTER** deals a different real kit sound of the zone's type onto every key. **NEW SOUND** (or K, or a
  learned button) swaps just the key you last played for another kit sound, leaving the rest of the set alone.
- **LOCK KEY** (or L) freezes the key you last played: its whole sound and pitch are kept, and nothing (scatter,
  randomisers, ALL KEYS edits, reset, clear) changes it until you unlock it. Locked keys show a padlock on the key strip; a key that
  plays a rhythm has a dashed foot, a key you edited by hand a dot.
- **INIT PATCH** (top of the RANDOM menu): a new patch in one press. Every key of all three zones gets a fresh kit
  sound, levelled, panned and given rhythms as SCATTER ALL deals them; **30% of the keys get a reverb send and 20% an
  echo send** (8 and 5 of the 25, which ones is random, a key can have both), the rest none. Locked keys and hand
  edits are replaced, so with locked keys it asks first (press again within four seconds). **BPM goes back to 120 and
  the echo, the reverb, the distortion, the compressor and the output level to their starting settings**; RETURN, the
  zone levels and the control locks stay. The new patch gets a new name and is not saved yet. UNDO brings the old
  patch back: locks, effects, tempo, name and all.
- **PRESETS** (the patch's name, beside the logo): the whole patch under a name. A preset holds every key's sound,
  edits, lock, rhythm and sends, the three engines' settings, the effects, the master and the BPM. **SAVE** keeps the
  patch under its name (a `*` after the name means it has changed since, or was never saved), **SAVE AS NEW** keeps it
  as another preset under a new name, **REVERT** goes back to the saved one. Click a preset in the list to load it
  (UNDO takes the load back), **X** then **SURE?** deletes it. Type in the name box and press Enter to rename.
  Presets live in this browser (localStorage); **EXPORT** writes them all to one JSON file and **IMPORT** adds a
  file's presets to the list, so they can be backed up or moved to another computer. Keys are stored by their place
  in the layout, so a preset loads the same wherever LOW KEY is. Not part of a preset: the control locks, the BS2
  knob map, LOW KEY and the RANDOM menu's settings.
- **Auto names**: every new patch is named by jumbling real words: the start of one word, sometimes the middle of a
  second, and the end of another, joined where a vowel meets a consonant so the result can be said out loud (NEBUTRON,
  QUASARIUS, FITRON PEDE). One word of 6 to 10 letters or two of 4 to 7, never a real word of the lists, never a name
  already in use. **NEW NAME** rolls another. The words come from themed lists in `app/names.js` (space and physics,
  about 145 words each); to add a theme, add a list to `WORDS` there.
- **RANDOM menu**: **SCATTER**, **ALTER** and **LEVEL** for the engine on screen, **SCATTER ALL**, **ALTER ALL** and
  **LEVEL ALL** for all three.
  ALTER nudges every key around what it plays now by the **ALTER** amount under HOW MUCH (10% as it comes; ALTER KEY
  uses it too); **WILD** lets it take a control outside the ranges drums usually sit in. Locked keys and locked
  controls stay. (RANDOMISE, VARY, RANDOM KIT and INIT are gone: they changed the engine's base sound, which no key
  plays since every key got a sound of its own.)
- **NEW SOUND is the dice** at the top right of the synth block, at the head of the key's own two columns (its FX
  sends and its LEVEL are below it). Press it, or K, and the key gets a different kit sound of its engine; the dice
  turns once and its face changes a few times, a third of a second (with reduced motion set, the face just changes).
- **Auto level**: the kits' sounds are of very different loudness (the loudest drum is 50 dB above the quietest), so
  every sound a randomiser deals or alters (NEW SOUND, SCATTER, ALTER, ALTER KEY, a paste onto another engine) is
  played offline, measured, and its key gets a **trim** that brings it to its engine's level: **drum -17 dB, snare
  -11.5 dB, metal -16 dB** (the loudest 100 ms of a hit, K-weighted, below full scale). Those are the middle loudness of
  each engine's kit sounds, so a typical sound plays as it always did, loud ones come down and quiet ones come up
  (never past full scale, at most 12 dB up or 16 dB down). The trim is a gain of its own: the **LEVEL** knob and the
  zone levels stay yours, and LEVEL's padlock has no say in it. The **AUTO** button at the head of the LEVEL cell
  shows the key's trim ("AUTO -3.5dB"); press it to take the trim off, press again to measure and level the key as it
  is now (editing ALL KEYS it does the whole zone and counts the keys, "AUTO 6/8"). **LEVEL** and **LEVEL ALL** in the
  RANDOM menu even out the keys you have now without changing their sounds. **AUTO LEVEL** in the RANDOM menu (on as
  it comes) switches the automatic part off: a newly dealt sound then plays as loud as its kit made it. Locked keys
  are left alone; UNDO takes any of it back.
- **Computer keys**: **[** and **]** (or the left and right arrows) step to the key before or after and play it, **Space**
  plays the key again, **K** new sound, **A** alter key, **L** lock key, **Z** undo, **1-3** pick an engine, Cmd/Ctrl+C
  and V copy and paste a key. The buttons show their keys.
- **UNDO** (or Z, or Cmd+Z / Ctrl+Z) takes back the last change to the sounds: a knob turned (a whole drag is one step),
  a randomiser, NEW SOUND, ALTER KEY, PASTE, CLEAR, the RHYTHMS slider. It keeps the last 40 steps, so pressing it again
  goes further back; the status line says what it undid. The effects and the master aren't part of it; locked keys stay.
- **Pan when randomising**: every randomiser that places a sound (NEW SOUND, SCATTER, SCATTER ALL, ALTER,
  ALTER ALL, ALTER KEY, even WILD) keeps the **drum centred**, the **snare within 20% left or right** and puts the
  **metal anywhere**, left to right. Set by hand, any pan goes anywhere; the padlock on the pan knob keeps it out of the
  randomisers.

## Code

| Path | What it is |
|---|---|
| `engine/` | the LXR-02 firmware's drum engine in JavaScript, copied from [elixir-desktop](https://github.com/johnnyhawk02/elixir-desktop) (one addition: `renderBlock(only)` renders a single voice, for AUTO LEVEL's measurement) |
| `sound/schema.js` | the seven sounds and each one's parameter schema (range, default, display, morph and randomiser rules) |
| `sound/morph.js` | the old key morph (no longer used by the page; kept with its tests) |
| `sound/instrument.js` | the engine as an instrument: `voices[i].play(note, velocity, params)` and `render(left, right)`, no UI |
| `sound/worklet.js` | the instrument in an AudioWorklet |
| `sound/level.js` | AUTO LEVEL: a sound's loudness, measured offline through the engine, and the trim that brings it to its engine's target (`node tools/levels.mjs` measures every kit sound and prints each engine's median) |
| `app/main.js`, `css/lcd.css` | the page |
| `app/names.js` | the preset names: the themed word lists (`WORDS`) and the jumbler, no UI |
| `kits/`, `sound/kits.js` | the built-in kits the randomisers draw from (`node tools/build-kits.mjs` rebuilds `kits.js`) |

No build step: the page loads the ES modules directly.

```sh
node test/morph.test.mjs                        # the morph and engine checks
node test/level.test.mjs                        # AUTO LEVEL: every kit sound lands at its engine's target
node test/names.test.mjs                        # the preset names: sayable, varied, never a list word
python3 -m http.server 8123 & node test/shots.mjs   # screenshots at 1440x900 and 1280x800 (needs Playwright)
```

## Licence

GPL-3.0-only (see [LICENSE](LICENSE)), like Elixir and the firmware its engine is ported from
([erica-synths/lxr-desktop-app](https://github.com/erica-synths/lxr-desktop-app)). Unofficial: not made, approved or
endorsed by Erica Synths. "LXR" and "LXR-02" are trademarks of Erica Synths. The built-in kits include the Hrtl LXR-02
DLC kits, by Hrtl, distributed free by Erica Synths.
