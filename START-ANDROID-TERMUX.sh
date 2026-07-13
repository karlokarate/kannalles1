#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  echo "Node.js 22.18 oder neuer fehlt. In Termux zuerst ausführen: pkg install nodejs-lts"
  exit 1
fi
node scripts/verify-node-version.mjs

if [ ! -f dist/index.html ]; then
  echo "Erzeuge die Offline-Web-App …"
  npm ci
  npm run build
fi

export HOST="${HOST:-127.0.0.1}"
export PORT="${PORT:-8787}"
URL="http://127.0.0.1:$PORT"
echo "Starte KH Checker unter $URL"
(
  sleep 2
  if command -v termux-open-url >/dev/null 2>&1; then
    termux-open-url "$URL" >/dev/null 2>&1 || true
  fi
) &
exec node scripts/serve-static.mjs dist
