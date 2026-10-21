#!/bin/bash
# Rebuild Tickerkite and install it into /Applications in one step:  npm run update
set -e
cd "$(dirname "$0")"

echo "› Closing Tickerkite…"
osascript -e 'quit app "Tickerkite"' >/dev/null 2>&1 || true
sleep 1

echo "› Building (1–3 minutes)…"
npm install --no-audit --no-fund --silent
npx electron-builder --mac dir --$( [ "$(uname -m)" = "arm64" ] && echo arm64 || echo x64 ) >/dev/null

APP=$(ls -d dist/mac*/Tickerkite.app | head -1)
if [ ! -d "$APP" ]; then echo "Build failed: no Tickerkite.app in dist/"; exit 1; fi

echo "› Installing to /Applications…"
rm -rf /Applications/Tickerkite.app
cp -R "$APP" /Applications/Tickerkite.app
xattr -dr com.apple.quarantine /Applications/Tickerkite.app >/dev/null 2>&1 || true

echo "› Opening Tickerkite"
open /Applications/Tickerkite.app
echo "✓ Done. Tickerkite is updated."
