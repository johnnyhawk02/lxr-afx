# Dipogon plugin (macOS: VST3, AU, standalone app)

The web app as a plugin. It looks the same because it *is* the same page, the repo's own `index.html`, `app/` and `css/`, shown in the plugin's window. It sounds the same because the engine is a C++ port of `sound/` and `engine/`, and it is checked against the JS sample for sample.

## Install

Dipogon is free and runs on any Mac with Apple silicon or Intel: a VST3 (Ableton Live, Bitwig, Reaper, Cubase...), an AU (Logic, GarageBand) and a standalone app. Open **Terminal** (Applications > Utilities), paste this line and press Return:

```
curl -fsSL https://github.com/johnnyhawk02/lxr-afx/releases/download/plugin-latest/install.sh | bash
```

Then restart your DAW, or rescan plugins. It is an instrument called **Dipogon**; the app is in Applications. Run the same line again to update. To remove it, add `-s -- --uninstall` after `bash`.

**Why a command and not a download?** Dipogon is a free project with no paid Apple Developer account, so it isn't signed or notarised by Apple, and macOS blocks a plugin downloaded in a browser ("damaged" or "unknown developer"). Fetched with `curl`, it isn't blocked. The script is short and changes nothing else: read it first if you like ([install.sh](install.sh)). It puts `Dipogon.vst3` in `~/Library/Audio/Plug-Ins/VST3`, `Dipogon.component` in `~/Library/Audio/Plug-Ins/Components` and `Dipogon.app` in `/Applications`.

If you'd rather download the zips from the [release page](https://github.com/johnnyhawk02/lxr-afx/releases/tag/plugin-latest), put them in those folders and clear the download flag macOS sets, or it won't open them:

```
xattr -dr com.apple.quarantine ~/Library/Audio/Plug-Ins/VST3/Dipogon.vst3 ~/Library/Audio/Plug-Ins/Components/Dipogon.component /Applications/Dipogon.app
```

## How it works

The plugin plays MIDI channel 1, with the keys and zones laid out as in the web app.

**Notes** are played by the C++ engine, sample-accurate, even with the plugin window shut. The page sends the plugin a *key table* (what every key plays), so DAW notes don't need the page. The page still shows each note as it's played.

**Space** belongs to the DAW: in the plugin window it starts and stops the transport, as it does everywhere else in the DAW, instead of playing a key.

**Knobs and menus** are the web page itself. Everything you change goes to the engine just as it goes to the AudioWorklet in the browser.

**The window** keeps its page loaded while it's shut, so opening it again is instant, just as you left it (no reload, no splash). Only loading a project, or changing a shared setting (the LOOK, presets...) in another copy, makes the next window load the page afresh. While a page loads, the window shows the panel's colour, never black.

**Saving:**
- Each plugin's sound (the page's `lxr-afx-v3` state: the sounds, keys, locks, FX) is saved in the DAW project.
- The look, knob style, presets and saved sounds are shared by every copy of the plugin. They live in `~/Library/Application Support/Dipogon/shared.json`.

**Limits:**
- A newly added copy plays nothing until its window has been opened once. Most DAWs open it on insert.
- After that, it plays from the project with the window shut.
- MIDI CCs mapped to knobs only work while the window is open.
- Buttons that download or share a file (EXPORT LIST) may not work in the plugin window.

## Keeping it in step with the web app

You can carry on with the web app as usual. Every build takes what it can straight from the JS:

- the page itself;
- the parameter layout and tables (`tools/gen-data.mjs` reads them from `engine/` and `sound/`);
- the bucket sounds.

Only a change to how the engine **computes** sound needs the C++ (`src/engine/`) to change too. The *Same sound as the web app* step of the build catches that. It plays the same scripts through the JS and the C++ (every bucket sound, the effects, the master, MORPH TIME, the wavetables, other sample rates), and it fails if a single sample differs.

## Building it yourself

The quick way, on a Mac with just the Command Line Tools, CMake and Node.js (no Xcode):

```
plugin/build-local.sh
```

It pulls main, builds the VST3, AU and standalone app for this Mac's chip, checks the engine against the JS,
then installs them to `~/Library/Audio/Plug-Ins/VST3`, `~/Library/Audio/Plug-Ins/Components` and `/Applications`
(signed ad hoc, quarantine cleared). Pass `--no-pull` to build what's checked out.

The universal build CI does needs Xcode:

```
cd plugin
npm install
node tools/gen-data.mjs
node tools/bundle.mjs
cmake -B build/cmake -G Xcode -DCMAKE_OSX_ARCHITECTURES="arm64;x86_64"
cmake --build build/cmake --config Release
node test/parity.mjs build/cmake/Release/lxr_parity          # the full check: every bucket sound
```

The pieces:

| Path | What it is |
|---|---|
| `src/engine/` | The C++ engine, a port of `sound/instrument.js`, `sound/dirt.js`, `engine/lxr.js` and `engine/wavetables.js`. It must be built with `-ffp-contract=off` and no fast maths, or it won't match the JS. |
| `src/plugin/` | The JUCE plugin: the processor and the webview editor. |
| `js/shim.js` | Runs before the page in the plugin. It stands in for the browser's AudioContext, Web MIDI and localStorage. |
| `js/dsp-entry.js` | The same plugin interface written in JS on the web app's own engine. It is the reference the C++ is tested against. |

It is GPL-3.0, like the LXR firmware it comes from. JUCE is used under its AGPLv3 licence, which is compatible.
