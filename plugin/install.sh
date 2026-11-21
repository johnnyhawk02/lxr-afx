#!/usr/bin/env bash
# Installs (or updates) Dipogon on a Mac from the latest build: the VST3, the AU and the standalone app.
#   curl -fsSL https://github.com/johnnyhawk02/lxr-afx/releases/download/plugin-latest/install.sh | bash
# Remove it again:
#   curl -fsSL https://github.com/johnnyhawk02/lxr-afx/releases/download/plugin-latest/install.sh | bash -s -- --uninstall
# Dipogon has no paid Apple Developer account, so it is signed ad hoc, not notarised. A file a browser downloads is
# quarantined and macOS won't open it; a file fetched with curl is not, so this installs it with no warning.
set -euo pipefail
BASE="${DIPOGON_BASE:-https://github.com/johnnyhawk02/lxr-afx/releases/latest/download}"
VST3="$HOME/Library/Audio/Plug-Ins/VST3"
AU="$HOME/Library/Audio/Plug-Ins/Components"
if [ "$(uname -s)" != Darwin ]; then
  echo "Dipogon's plugin is for macOS only. Everywhere else, play it in the browser: https://dipogon.johnnyhawk.org/"; exit 1
fi
APPS="${DIPOGON_APPS:-/Applications}"; [ -w "$APPS" ] || APPS="$HOME/Applications"

if [ "${1:-}" = "--uninstall" ]; then
  rm -rf "$VST3/Dipogon.vst3" "$AU/Dipogon.component" "$APPS/Dipogon.app"
  killall -9 AudioComponentRegistrar 2>/dev/null || true
  echo "Removed Dipogon. Your presets and settings stay in ~/Library/Application Support/Dipogon (delete that folder too to remove them)."
  exit 0
fi

TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
for f in vst3 au app; do
  echo "Downloading Dipogon ($f)..."
  curl -fL --progress-bar "$BASE/Dipogon-$f.zip" -o "$TMP/$f.zip"
  ditto -x -k "$TMP/$f.zip" "$TMP/x"
done

mkdir -p "$VST3" "$AU" "$APPS"
# (the same plugin under its old name, LXR-AFX: gone, so a DAW never lists it twice)
rm -rf "$VST3/LXR-AFX.vst3" "$AU/LXR-AFX.component" "$APPS/LXR-AFX.app"
rm -rf "$VST3/Dipogon.vst3" "$AU/Dipogon.component" "$APPS/Dipogon.app"
ditto "$TMP/x/Dipogon.vst3" "$VST3/Dipogon.vst3"
ditto "$TMP/x/Dipogon.component" "$AU/Dipogon.component"
ditto "$TMP/x/Dipogon.app" "$APPS/Dipogon.app"
xattr -dr com.apple.quarantine "$VST3/Dipogon.vst3" "$AU/Dipogon.component" "$APPS/Dipogon.app" 2>/dev/null || true
# so Logic and GarageBand see the new AU without restarting the Mac
killall -9 AudioComponentRegistrar 2>/dev/null || true

echo
echo "Installed:"
echo "  VST3  $VST3/Dipogon.vst3"
echo "  AU    $AU/Dipogon.component"
echo "  app   $APPS/Dipogon.app"
echo
echo "Done. Restart your DAW or rescan plugins: it is an instrument called Dipogon."
