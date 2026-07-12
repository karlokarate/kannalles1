#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ZIP_PATH="${1:?Aufruf: scripts/verify-pages-workflow.sh /pfad/kh-checker-vX.Y.Z-komplett.zip}"
ZIP_PATH="$(cd "$(dirname "$ZIP_PATH")" && pwd)/$(basename "$ZIP_PATH")"
VERSION="$(node -p "JSON.parse(require('fs').readFileSync('$ROOT_DIR/package.json','utf8')).version")"
WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT

python3 "$ROOT_DIR/.github/scripts/validate_release_bundle.py" \
  --zip "$ZIP_PATH" \
  --site "$WORK_DIR/site" \
  --expected-version "$VERSION" \
  --base-path "/kannalles1/"

node "$ROOT_DIR/scripts/verify-pages-build.mjs" "$WORK_DIR/site"
node "$ROOT_DIR/scripts/verify-static-http.mjs" "$WORK_DIR/site"
FILE_COUNT="$(find "$WORK_DIR/site" -type f | wc -l | tr -d ' ')"
echo "Pages-Workflow-Emulation bestanden: $FILE_COUNT Dateien publishbar."
