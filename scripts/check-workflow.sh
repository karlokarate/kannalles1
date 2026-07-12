#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"
VERSION="$(node -p "JSON.parse(require('fs').readFileSync('package.json','utf8')).version")"
exec bash scripts/verify-pages-workflow.sh "release-out/kh-checker-v${VERSION}-komplett.zip"
