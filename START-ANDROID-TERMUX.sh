#!/usr/bin/env bash
set -euo pipefail

SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PORT="${PORT:-8787}"
TARGET_DIR="${KH_CHECKER_HOME:-$HOME/.local/share/kh-checker-v2.2.4}"

if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  echo "Node.js fehlt. In Termux zuerst ausführen: pkg install nodejs-lts"
  exit 1
fi

RUNTIME_DIR="$SOURCE_DIR"
case "$SOURCE_DIR" in
  /storage/*|/sdcard/*)
    echo "Kopiere die Runtime aus dem Android-Speicher nach: $TARGET_DIR"
    mkdir -p "$TARGET_DIR"
    rm -rf "$TARGET_DIR/dist" "$TARGET_DIR/server"
    cp -R "$SOURCE_DIR/dist" "$SOURCE_DIR/server" "$TARGET_DIR/"
    cp "$SOURCE_DIR/package.json" "$SOURCE_DIR/package-lock.json" "$TARGET_DIR/"
    if [ -f "$SOURCE_DIR/.env" ]; then cp "$SOURCE_DIR/.env" "$TARGET_DIR/.env"; fi
    if [ -f "$SOURCE_DIR/.env.example" ]; then cp "$SOURCE_DIR/.env.example" "$TARGET_DIR/.env.example"; fi
    RUNTIME_DIR="$TARGET_DIR"
    ;;
esac

cd "$RUNTIME_DIR"
if [ ! -d node_modules ]; then
  echo "Installiere Produktionsabhängigkeiten einmalig …"
  npm ci --omit=dev
fi

export HOST="127.0.0.1"
export PORT
URL="http://127.0.0.1:$PORT"

echo "Starte KH Checker v2.2.4 unter $URL"
(
  sleep 2
  if command -v termux-open-url >/dev/null 2>&1; then
    termux-open-url "$URL" >/dev/null 2>&1 || true
  fi
) &
exec node server/index.mjs
