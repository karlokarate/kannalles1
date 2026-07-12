#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  echo "Node.js 22.18 oder neuer wird benötigt."
  exit 1
fi

if ! node scripts/verify-node-version.mjs; then
  echo "Node.js 22.18 oder neuer wird benötigt (Node 24 LTS empfohlen)."
  exit 1
fi

if [ ! -f dist/index.html ]; then
  echo "Source-Checkout erkannt: installiere Build-Werkzeuge und erzeuge die Web-App …"
  npm ci
  npm run api:generate
  npm run build
elif [ ! -d node_modules ]; then
  npm ci --omit=dev
fi

export HOST="${HOST:-127.0.0.1}"
export PORT="${PORT:-8787}"
URL="http://127.0.0.1:$PORT"
(
  sleep 2
  if command -v xdg-open >/dev/null 2>&1; then xdg-open "$URL" >/dev/null 2>&1 || true;
  elif command -v open >/dev/null 2>&1; then open "$URL" >/dev/null 2>&1 || true;
  fi
) &
exec node server/index.mjs
