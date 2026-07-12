#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ZIP_PATH="${1:?Aufruf: scripts/verify-release.sh /pfad/kh-checker-vX.Y.Z-komplett.zip}"
ZIP_PATH="$(cd "$(dirname "$ZIP_PATH")" && pwd)/$(basename "$ZIP_PATH")"
VERSION="$(node -p "JSON.parse(require('fs').readFileSync('$ROOT_DIR/package.json','utf8')).version")"
WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT

python3 "$ROOT_DIR/.github/scripts/validate_release_bundle.py" \
  --zip "$ZIP_PATH" \
  --site "$WORK_DIR/site" \
  --expected-version "$VERSION" \
  --base-path "/kannalles1/"

echo "Release-ZIP geprüft: $(basename "$ZIP_PATH")"
