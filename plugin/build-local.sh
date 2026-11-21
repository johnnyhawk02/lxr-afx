#!/bin/sh
# Builds Dipogon (VST3, AU, standalone app) on this Mac and installs it. Needs only the Command Line Tools,
# cmake and node (no Xcode). Run from anywhere:  plugin/build-local.sh
# Pulls main first unless you pass --no-pull. Builds for this Mac's chip only (faster than CI's universal build).
set -e
cd "$(dirname "$0")"
[ "$1" = "--no-pull" ] || git pull --ff-only
npm install --no-audit --no-fund --silent
node tools/gen-data.mjs
node tools/bundle.mjs
cmake -B build/local -G "Unix Makefiles" -DCMAKE_BUILD_TYPE=Release -DCMAKE_OSX_ARCHITECTURES="$(uname -m)" >/dev/null
cmake --build build/local --target LXR_AFX_VST3 LXR_AFX_AU LXR_AFX_Standalone lxr_parity -j"$(sysctl -n hw.ncpu)"
node test/parity.mjs build/local/lxr_parity --quick

A=build/local/LXR_AFX_artefacts/Release
P="$HOME/Library/Audio/Plug-Ins"
mkdir -p "$P/VST3" "$P/Components"
install_bundle() { # $1 built bundle, $2 destination folder
  dest="$2/$(basename "$1")"
  rm -rf "$dest"
  ditto "$1" "$dest"
  codesign --force --deep -s - "$dest"
  xattr -dr com.apple.quarantine "$dest" 2>/dev/null || true
  echo "installed $dest"
}
install_bundle "$A/VST3/Dipogon.vst3" "$P/VST3"
install_bundle "$A/AU/Dipogon.component" "$P/Components"
install_bundle "$A/Standalone/Dipogon.app" /Applications
# the same plugin under its old name, LXR-AFX: gone, so a DAW never lists it twice
rm -rf "$P/VST3/LXR-AFX.vst3" "$P/Components/LXR-AFX.component" /Applications/LXR-AFX.app
killall -9 AudioComponentRegistrar 2>/dev/null || true # so hosts see the new AU
echo "done: rescan plugins in Ableton (or restart it) to load the new build"
