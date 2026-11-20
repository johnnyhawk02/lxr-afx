# LXR-AFX plugin (macOS: VST3, AU, standalone app)

The web app as a plugin. It looks the same because it *is* the same page, the repo's own `index.html`, `app/` and `css/`, shown in the plugin's window. It sounds the same because the engine is a C++ port of `sound/` and `engine/`, and it is checked against the JS sample for sample.

## Install

1. Get the latest build. Either:
   - download it from the [plugin-latest release](https://github.com/johnnyhawk02/lxr-afx/releases/tag/plugin-latest), or
   - take the `LXR-AFX-mac` artifact of the latest *plugin* run on the repo's Actions tab.
2. Unzip it.
3. Put `LXR-AFX.vst3` in `~/Library/Audio/Plug-Ins/VST3/`. For Logic, put `LXR-AFX.component` in `~/Library/Audio/Plug-Ins/Components/`.
4. The build isn't signed with an Apple developer account, so macOS blocks it until you clear the download flag. Do that once per new build:
   ```
   xattr -dr com.apple.quarantine ~/Library/Audio/Plug-Ins/VST3/LXR-AFX.vst3
   xattr -dr com.apple.quarantine ~/Library/Audio/Plug-Ins/Components/LXR-AFX.component
   ```
5. Rescan plugins in the DAW. It is an instrument called **LXR-AFX**.

`LXR-AFX.app` is the same thing as a standalone app, with no DAW needed.

To hand it to other people without step 4, it would need a paid Apple Developer account ($99 a year) to sign and notarise it. The workflow can do that later, using the account's certificate as repo secrets.

## How it works

The plugin plays MIDI channel 1, with the keys and zones laid out as in the web app.

**Notes** are played by the C++ engine, sample-accurate, even with the plugin window shut. The page sends the plugin a *key table* (what every key plays), so DAW notes don't need the page. The page still shows each note as it's played.

**Knobs and menus** are the web page itself. Everything you change goes to the engine just as it goes to the AudioWorklet in the browser.

**Saving:**
- Each plugin's sound (the page's `lxr-afx-v3` state: the sounds, keys, locks, FX) is saved in the DAW project.
- The look, knob style, presets and saved sounds are shared by every copy of the plugin. They live in `~/Library/Application Support/LXR-AFX/shared.json`.

**Keys:** Space belongs to the DAW (play/stop in Ableton). The page ignores it in the plugin, and the key goes on to the DAW.

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

You need Xcode, CMake and Node.js.

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
