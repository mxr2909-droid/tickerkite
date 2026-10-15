#!/bin/bash
# Rebuild WIRE and install it into /Applications in one step:  npm run update
set -e
cd "$(dirname "$0")"

echo "› Closing WIRE…"
osascript -e 'quit app "WIRE"' >/dev/null 2>&1 || true
sleep 1

echo "› Building (1–3 minutes)…"
npm install --no-audit --no-fund --silent
npx electron-builder --mac dir --$( [ "$(uname -m)" = "arm64" ] && echo arm64 || echo x64 ) >/dev/null

APP=$(ls -d dist/mac*/WIRE.app | head -1)
if [ ! -d "$APP" ]; then echo "Build failed: no WIRE.app in dist/"; exit 1; fi

echo "› Installing to /Applications…"
rm -rf /Applications/WIRE.app
cp -R "$APP" /Applications/WIRE.app
xattr -dr com.apple.quarantine /Applications/WIRE.app >/dev/null 2>&1 || true

echo "› Opening WIRE"
open /Applications/WIRE.app
echo "✓ Done. WIRE is updated."
