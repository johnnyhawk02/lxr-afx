# LXR-AFX

An AFX-mode drum instrument in the browser: three sounds on one MIDI channel, every key its own sound.
**Play it: https://johnnyhawk02.github.io/lxr-afx/** (Chrome or Edge, for Web MIDI)

![LXR-AFX at 1440 × 900](docs/screenshot.png)

- **Three zones on MIDI channel 1**, laid out for the 25 keys of a Bass Station 2 at its default octave (lowest key MIDI
  48), one zone for each of the engine's three voice types, all three able to sound at once: **drum** on the lowest 8
  keys (48-55), **snare** on the next 8 (56-63), **metal** on the top 9 (64-72). Each zone's base key is its middle key
  (52, 60, 68). LOW KEY (in **SETTINGS**, top bar) moves the whole layout by octaves; the sizes are `ZONE_SIZES` in `sound/schema.js`. Velocity is used.
- **Every key has its own sound.** A zone starts with a different kit sound of its type on every key (RANDOM in the
  RANDOM menu deals a fresh set); a key with nothing of its own plays the engine's base. (The auto-morph of earlier
  versions is gone: sound/morph.js is no longer used.)
- **Layout, top down: the key, then its engine, then its synth settings.** The key header shows the key you last played
  (or clicked on its strip of all 25 keys), its engine and what it plays, with **LOCK KEY** (L),
  **ALTER KEY** (A), **COPY** / **PASTE** (Cmd+C / Cmd+V, Ctrl on a PC; onto another engine it maps by control name) and
  **CLEAR**. A locked key turns the header black and veils the knobs. Everything that randomises a
  whole engine or all three (INIT PATCH, random, alter, level, the ALTER amount, AUTO LEVEL, the knob padlocks)
  is in the **RANDOM** menu.
- **FX and master** (the right-hand column, full height): the two send effects from Elixir Desktop (the firmware's
  delay as an echo, and its reverb, both returned at full level), then the **master**: everything, dry and FX returns, through the
  **distortion**, then a soft-knee compressor (threshold, ratio, attack, release, knee, makeup) with a
  gain-reduction meter, then the level. Each key's ECHO / REVERB sends are FX SENDS knobs with its synth knobs.
  The **reverb is stereo**: the firmware's reverb gave one output, the same on both sides; here that output is the
  left side, and the right side reads the same reverb loops at other points and the early reflections at other
  times. The two sides are equally loud and unlike each other, so the tail spreads between the speakers.
  The echo's **SYNC** switch turns TIME from milliseconds into a note length at the BPM (1/32 to 1/2, with triplets and
  dotted lengths, 1/8D by default), and it follows the BPM; switched off, TIME goes back to the milliseconds it had.
- **Morphable switches**: the oscillator **WAVE**, **A WAVE** and **B WAVE**, the filter **TYPE** and **A MODE** (FM or
  MIX) are knobs, not menus, so a sound can blend into another. Each old setting is a detent the knob catches: WAVE runs
  sine, tri, saw, rec, pwm, noise; TYPE runs lp, bp, unity bp, hp, notch, peak, lp2, off; A MODE runs fm to mix. On a
  detent the engine runs exactly the firmware's code, so every kit sound plays sample for sample as it did
  (`node test/merged.test.mjs`). Between two detents the knob shows both and how far along (`tri>saw 40`): the two
  waves are read at the same point of the cycle from the same band-limited tables and crossfaded; the filter's LP, BP
  and HP outputs (one filter state) are mixed, with LP2 or the dry input crossfaded in at the far end; and mod A's FM
  depth fades out as it fades into the mix (`node test/switches.test.mjs`). An LFO or velocity aimed at one moves it
  the firmware's way from a detent, and along the dial from between two. Patches saved before the knobs were dials are
  converted when they load. **PWM** never goes below 1 by hand or by a randomiser (at 0 the pwm wave is silent), but a kit
  sound that comes with 0 keeps it.
- **Master distortion** (`sound/dirt.js`, our own design after a dual-path bass distortion pedal's signal flow), before
  the compressor, off until its **ON** is pressed. A dirty path, PREGAIN, then a filter (FILTER: high-pass, or LP),
  GAIN into two anti-aliased clip stages (CLIP: diode, hard and early, or LED, louder and more open), then TONE (bass,
  scooped mids at noon, treble) with BASS shelving its bass end, at the DIRTY volume; beside it a clean path at the
  CLEAN volume. XOVER sends the half of the signal the filter takes away to the clean path (distorted highs with clean
  lows, or the other way round). The **SIDECHAIN** listens to the mix or one engine (SOURCE), through a filter (LP, BP,
  HP at FREQ) into an envelope (SENS, DECAY, shown on the ENV meter) that turns PREGAIN, CUTOFF or TONE up or down.
- **Mono, last-note priority, per zone**: each zone (drum, snare, metal) plays one key at a time, the newest. Hold a
  key, press another in the same zone and it takes over (with its own sound); let go of it while the
  first is still held and the first comes back on the next step of the BPM grid (**RETURN** in SETTINGS, with **BPM**: NOW,
  1/32, **1/16** by default, 1/8, 1/4). The three zones don't affect each other. MIDI all-notes-off lets go of every
  zone.
- **No sequencer**: the per-key step sequencer and the RHYTHMS slider were taken out (Johnny didn't find them useful); a
  key plays once per press. The engine's AMP REPEAT knob still retriggers a sound.
- **Left column**: the key, its engine, and the synth knobs in four rows (osc, fm / amp, pitch, click / filter,
  velocity, mix / lfo), with the **NEW SOUND** dice, the key's ECHO / REVERB sends and its big **LEVEL** knob in a column at the
  right. Everything sits on one grid: equal cells, one knob to a cell, so every knob lines up with the ones above and
  below it on every engine; the right-hand column shares one set of six columns the same way. Pasting a key onto
  another engine labels it, e.g. "Brownie snare (as metal)".
- **Editor**: every parameter of the sound on one screen, as knobs (press and drag up/down; the scroll
  wheel, the trackpad and the arrow keys never change a control, nothing stays marked after a drag, so passing the pointer over one is safe). A control you
  change by hand on a key gets a **lit label**, a notch outside its ring shows where it was, and a **double-click puts
  it back**; the key header counts the edits ("Brownie snare · 2 edits") and the key gets a dot on the strip. The
  small **padlock** at a knob's top right locks that control (faint: open, solid: locked; see KNOB PADLOCKS below). Plus-minus knobs (PAN, COARSE, FINE, the FM and mod frequencies,
  the distortion's PREGAIN, BASS and TONE) have their centre at the top and light from there out to either side; PAN
  reads **L100 … C … R100**, with L and R at the ends of its ring. An edit changes only the last key
  pressed (or the key picked in the key list), always. **CLEAR** puts a key back to the engine's base sound.
- **Knobs** (MIDI CC on channel 1), mapped for a Bass Station 2: they act on the last key played, like the editor (which
  follows the sound you play). Filter freq → cutoff, resonance → reso, overdrive → drive, amp attack/decay → attack/decay,
  mod env decay → pitch decay, mod env depth → pitch amount, distortion → FM amount, osc 1 coarse/fine → coarse/fine,
  LFO 1 speed / portamento → the key's echo / reverb sends, osc 1 / osc 2 / sub levels → the
  drum / snare / metal levels. **LEARN** (in SETTINGS, with **BS2 MAP**, which puts the Bass Station 2 map back) maps any knob to any control: press it, click the control, turn the knob.
- **Randomisers**: **RANDOM** deals a different real kit sound of the engine's type onto every one of its keys. **NEW SOUND** (or K, or a
  learned button) swaps just the key you last played for another kit sound, leaving the rest of the set alone.
- **LOCK KEY** (or L) freezes the key you last played: its whole sound and pitch are kept, and nothing (RANDOM,
  the other randomisers, reset, clear) changes it until you unlock it. Locked keys show a padlock on the key strip, a key you edited by hand a dot.
- **INIT PATCH** (top of the RANDOM menu): a new patch in one press. Every key of all three zones gets a fresh kit
  sound, levelled and panned as RANDOM ALL deals them; **30% of the keys get a reverb send and 20% an
  echo send** (8 and 5 of the 25, which ones is random, a key can have both), the rest none. Locked keys and hand
  edits are replaced, so with locked keys it asks first (press again within four seconds). **BPM goes back to 120 and
  the echo, the reverb, the distortion, the compressor and the output level to their starting settings**; RETURN, the
  zone levels and the knob padlocks stay, and a knob with a closed padlock keeps its setting on every key (a locked
  send keeps its keys' sends). The new patch gets a new name and is not saved yet. UNDO brings the old patch back:
  locks, effects, tempo, name and all.
- **PRESETS** (the patch's name, beside the logo): the whole patch under a name. A preset holds every key's sound,
  edits, lock and sends, the three engines' settings, the effects, the master and the BPM. **SAVE** keeps the
  patch under its name (a `*` after the name means it has changed since, or was never saved), **SAVE AS NEW** keeps it
  as another preset under a new name, **REVERT** goes back to the saved one. Click a preset in the list to load it
  (UNDO takes the load back), **X** then **SURE?** deletes it. Type in the name box and press Enter to rename.
  Presets live in this browser (localStorage); **EXPORT** writes them all to one JSON file and **IMPORT** adds a
  file's presets to the list, so they can be backed up or moved to another computer. Keys are stored by their place
  in the layout, so a preset loads the same wherever LOW KEY is. Not part of a preset: the knob padlocks, the BS2
  knob map, LOW KEY and the RANDOM menu's settings.
- **Auto names**: every new patch is named by jumbling real words: the start of one word, sometimes the middle of a
  second, and the end of another, joined where a vowel meets a consonant so the result can be said out loud (JONDALF,
  GRIMWISE, ENCHANDIL, PHOTORION, BOPZUFIN, DRYANA LUMEHIL). One word of 6 to 10 letters or two of 4 to 7, never a
  real word of the lists, never a name already in use. **NEW NAME** rolls another. The words come from six themed
  lists in `app/names.js`, about a thousand words in all: **space**, **physics**, **Tolkien** (people and places of
  Middle-earth), **fantasy**, **alien** (made-up alien-sounding words and a few from old science fiction) and
  **myth** (Greek, Norse, Egyptian and other old gods and heroes). Every word is a mix: its start and its end always
  come from two different lists. To add a theme, add a list to `WORDS` there.
- **RANDOM menu**: **RANDOM**, **ALTER** and **LEVEL** for the engine on screen, **RANDOM ALL**, **ALTER ALL** and
  **LEVEL ALL** for all three, each with a line under it saying what it does. RANDOM gives every key a new kit sound;
  ALTER nudges every key around what it plays now by the **ALTER** amount under HOW MUCH (10% as it comes; ALTER KEY
  uses it too). ALTER moves the knobs of the sound and leaves alone what a kit sound is built on (waveforms, FM mode,
  filter type, the LFO, velocity, sample rate), LEVEL and the sends; **WILD** lets it take a control outside the
  ranges drums usually sit in, and change those switches too. Locked keys stay. (RANDOM was called SCATTER.)
- **KNOB PADLOCKS**: a knob with a closed padlock **keeps its setting on every key of its engine, whatever random
  thing you press**: the dice, RANDOM, ALTER, ALTER KEY, their ALL versions and INIT PATCH. The message line names
  what was kept ("locked DECAY, CUTOFF kept"). Nothing is locked as it comes; **UNLOCK ALL** in the RANDOM menu opens
  every padlock, and the menu counts the closed ones. Only your own hand, UNDO and loading a preset change a locked
  knob. (Before, 17 knobs came locked, so NEW SOUND kept the old waveform and switches under a new sound's name, and
  RANDOM (then SCATTER) and INIT PATCH ignored the padlocks.) New sounds always keep a key's sends, locked or not.
- **NEW SOUND is the dice** at the top right of the synth block, at the head of the key's own two columns (its FX
  sends and its LEVEL are below it). Press it, or K, and the key gets a different kit sound of its engine; the dice
  turns once and its face changes a few times, a third of a second (with reduced motion set, the face just changes).
- **Auto level**: the kits' sounds are of very different loudness (the loudest drum is 50 dB above the quietest), so
  every sound a randomiser deals or alters (NEW SOUND, RANDOM, ALTER, ALTER KEY, a paste onto another engine) is
  played offline, measured, and its key gets a **trim** that brings it to its engine's level: **drum -17 dB, snare
  -11.5 dB, metal -16 dB** (the loudest 100 ms of a hit, K-weighted, below full scale). Those are the middle loudness of
  each engine's kit sounds, so a typical sound plays as it always did, loud ones come down and quiet ones come up
  (never past full scale, at most 12 dB up or 16 dB down). The trim is a gain of its own: the **LEVEL** knob and the
  zone levels stay yours, and LEVEL's padlock has no say in it. The **AUTO** button at the head of the LEVEL cell
  shows the key's trim ("AUTO -3.5dB"); press it to measure the key as it plays now and level it again. **LEVEL** and **LEVEL ALL** in the
  RANDOM menu even out the keys you have now without changing their sounds. **AUTO LEVEL** in the RANDOM menu (on as
  it comes) switches the automatic part off: a newly dealt sound then plays as loud as its kit made it. Locked keys
  are left alone; UNDO takes any of it back.
- **Computer keys**: **[** and **]** (or the left and right arrows) step to the key before or after and play it, **Space**
  plays the key again, **K** new sound, **A** alter key, **L** lock key, **Z** undo, **1-3** pick an engine, Cmd/Ctrl+C
  and V copy and paste a key. The buttons show their keys.
- **UNDO** (or Z, or Cmd+Z / Ctrl+Z) takes back the last change to the sounds: a knob turned (a whole drag is one step),
  a randomiser, NEW SOUND, ALTER KEY, PASTE, CLEAR. It keeps the last 40 steps, so pressing it again
  goes further back; the status line says what it undid. The effects and the master aren't part of it; locked keys stay.
- **Pan when randomising**: every randomiser that places a sound (NEW SOUND, RANDOM, RANDOM ALL, ALTER,
  ALTER ALL, ALTER KEY, even WILD) keeps the **drum centred**, the **snare within 20% left or right** and puts the
  **metal anywhere**, left to right. Set by hand, any pan goes anywhere; the padlock on the pan knob keeps it out of the
  randomisers.
- **On a phone** (held upright): a simple screen takes the big one's place, by itself. **25 pads**, one for each key,
  five to a row, lowest at the top left, shaded by engine (drum, snare, metal). A pad plays its key for as long as it
  is held, several fingers at once, and the pad pressed last is the one the buttons
  below act on: **NEW SOUND** (the dice) and **ALTER** for that key, **LOCK**, and two bars, **ECHO** and **REVERB**,
  for that key's sends (touch or slide along a bar). Under them **INIT PATCH**, **RANDOM ALL** and **UNDO**, and the
  message line that says what happened. A padlock on a pad means it is
  locked. **MENU** (top right; the same button closes it) opens a menu over the pads: **RANDOM** and **ALTER** act on the
  engine of the pad pressed last, and **ALTER ALL** on all 25 keys. A press does its thing and closes the menu; UNDO
  takes any of them back. The patch is the same one the big screen plays and stores. Presets, the knobs and the effects are on the big
  screen only, and the phone doesn't ask for MIDI. Add `?desktop` to the address for the big screen on a phone, or
  `?phone` for the phone screen on a computer.

## Code

| Path | What it is |
|---|---|
| `engine/` | the LXR-02 firmware's drum engine in JavaScript, copied from [elixir-desktop](https://github.com/johnnyhawk02/elixir-desktop) (two additions: `renderBlock(only)` renders a single voice, for AUTO LEVEL's measurement, and the reverb has a right-hand output of its own when `stereo` is set) |
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
node test/reverb.test.mjs                       # the stereo reverb: left as the firmware's, right as loud and unlike it
node test/names.test.mjs                        # the preset names: sayable, varied, never a list word, always a mix of lists
python3 -m http.server 8123 & node test/shots.mjs   # the page in a browser: laptop sizes and the phone (needs Playwright)
```

## Licence

GPL-3.0-only (see [LICENSE](LICENSE)), like Elixir and the firmware its engine is ported from
([erica-synths/lxr-desktop-app](https://github.com/erica-synths/lxr-desktop-app)). Unofficial: not made, approved or
endorsed by Erica Synths. "LXR" and "LXR-02" are trademarks of Erica Synths. The built-in kits include the Hrtl LXR-02
DLC kits, by Hrtl, distributed free by Erica Synths.
