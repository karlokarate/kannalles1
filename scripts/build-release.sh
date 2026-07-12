#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"
VERSION="$(node -p "JSON.parse(require('fs').readFileSync('package.json','utf8')).version")"
OUTPUT_DIR="${OUTPUT_DIR:-$ROOT_DIR/release-out}"
SOURCE_ARCHIVE="ENTWICKLER-QUELLCODE-v${VERSION}.zip"
COMPLETE_ARCHIVE="kh-checker-v${VERSION}-komplett.zip"
DEFAULT_EPOCH="$(tr -d '[:space:]' < release/source-date-epoch.txt)"
SOURCE_DATE_EPOCH="${SOURCE_DATE_EPOCH:-$DEFAULT_EPOCH}"
BUILD_DATE="$(node -e "console.log(new Date(Number(process.argv[1])*1000).toISOString())" "$SOURCE_DATE_EPOCH")"
BROWSER_GATE="${RELEASE_BROWSER_GATE:-deferred_to_deployment_workflow}"
PREVALIDATED="${RELEASE_PREVALIDATED:-0}"

for command in node npm python3 rsync sha256sum; do
  command -v "$command" >/dev/null 2>&1 || { echo "Benötigtes Werkzeug fehlt: $command" >&2; exit 1; }
done
[[ "$SOURCE_DATE_EPOCH" =~ ^[0-9]+$ ]] || { echo "SOURCE_DATE_EPOCH muss ganzzahlig sein." >&2; exit 1; }
case "$BROWSER_GATE" in passed_at_build|deferred_to_deployment_workflow) ;; *) echo "Ungültiger RELEASE_BROWSER_GATE: $BROWSER_GATE" >&2; exit 1;; esac
if [[ "${RELEASE_SKIP_CHECK:-0}" == "1" ]]; then
  echo "RELEASE_SKIP_CHECK ist für freigabefähige v2.2.4-Artefakte nicht zulässig." >&2
  exit 1
fi

mkdir -p "$OUTPUT_DIR"
OUTPUT_DIR="$(cd "$OUTPUT_DIR" && pwd)"
WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT

if [[ "$PREVALIDATED" == "1" ]]; then
  QUALITY_GATE_MODE="prevalidated_by_one_click_pipeline"
  test -f dist/index.html
  npm run api:verify
  npm run check:version
else
  QUALITY_GATE_MODE="executed_by_release_script"
  npm run check
  npm run audit
  if [[ "${RELEASE_RUN_BROWSER:-0}" == "1" ]]; then
    npm run test:e2e
    BROWSER_GATE="passed_at_build"
  fi
fi

SOURCE_STAGE="$WORK_DIR/source/kh-checker-v${VERSION}-source"
mkdir -p "$SOURCE_STAGE"
rsync -a ./ "$SOURCE_STAGE/" \
  --exclude '.git/' \
  --exclude 'node_modules/' \
  --exclude 'dist/' \
  --exclude '.generated-public/' \
  --exclude 'release-out/' \
  --exclude 'releases/' \
  --exclude 'fallback-site/' \
  --exclude 'candidate-site/' \
  --exclude 'publish-site/' \
  --exclude 'ci-reports/' \
  --exclude 'playwright-report/' \
  --exclude 'test-results/' \
  --exclude '__pycache__/' \
  --exclude '*.pyc' \
  --exclude '*.tsbuildinfo' \
  --exclude '.env'

python3 scripts/reproducible-zip.py \
  --source "$WORK_DIR/source" \
  --output "$OUTPUT_DIR/$SOURCE_ARCHIVE" \
  --epoch "$SOURCE_DATE_EPOCH"

SITE_STAGE="$WORK_DIR/site"
mkdir -p "$SITE_STAGE"
rsync -a "$ROOT_DIR/dist/" "$SITE_STAGE/"
cp "$ROOT_DIR/LICENSE" "$SITE_STAGE/LICENSE"
cp "$ROOT_DIR/README.md" "$SITE_STAGE/README.md"
cp "$ROOT_DIR/CHANGELOG.md" "$SITE_STAGE/CHANGELOG.md"
cp "$ROOT_DIR/README-ERST-LESEN.txt" "$SITE_STAGE/README-ERST-LESEN.txt"
cp "$ROOT_DIR/RELEASE-NOTES-v${VERSION}.txt" "$SITE_STAGE/RELEASE-NOTES-v${VERSION}.txt"
touch "$SITE_STAGE/.nojekyll"
printf 'KH Checker v%s\nBuild date: %s\nDeployment: static GitHub Pages PWA\n' "$VERSION" "$BUILD_DATE" > "$SITE_STAGE/VERSION.txt"

SOURCE_SHA="$(sha256sum "$OUTPUT_DIR/$SOURCE_ARCHIVE" | awk '{print $1}')"
OPENAPI_SHA="$(sha256sum "$SITE_STAGE/api-docs/search-api.openapi.json" | awk '{print $1}')"
OPENAPI_YAML_SHA="$(sha256sum "$SITE_STAGE/api-docs/search-api.openapi.yaml" | awk '{print $1}')"
GENERATION_SHA="$(sha256sum "$SITE_STAGE/api-docs/generation-manifest.json" | awk '{print $1}')"
TOOLS_JSON="$(node -e "const m=require('./contracts/generated/generation-manifest.json'); process.stdout.write(JSON.stringify(m.tools))")"
cat > "$SITE_STAGE/release-manifest.json" <<JSON
{
  "schemaVersion": 2,
  "name": "KH Checker",
  "version": "$VERSION",
  "artifactType": "static-github-pages-pwa",
  "buildDateUtc": "$BUILD_DATE",
  "sourceArchive": {
    "file": "$SOURCE_ARCHIVE",
    "sha256": "$SOURCE_SHA",
    "embedded": false
  },
  "runtime": {
    "requiresCustomServer": false,
    "directApiPrimary": "search-a-licious",
    "directApiFallback": "open-food-facts-legacy",
    "nativeAndroidApk": false
  },
  "qualityGatesSkipped": false,
  "qualityGateMode": "$QUALITY_GATE_MODE",
  "browserGateAtBuild": "$BROWSER_GATE",
  "browserGateRequiredBeforeDeploy": false,
  "browserGatePolicy": "attempt_in_one_click_workflow_and_failsoft_to_validated_prebuilt_release",
  "contractGeneration": {
    "authoritativeSource": "contracts/source/search-api.contract.mjs",
    "openapiVersion": "3.1.0",
    "openapi": { "file": "api-docs/search-api.openapi.json", "sha256": "$OPENAPI_SHA" },
    "openapiYaml": { "file": "api-docs/search-api.openapi.yaml", "sha256": "$OPENAPI_YAML_SHA" },
    "generationManifest": { "file": "api-docs/generation-manifest.json", "sha256": "$GENERATION_SHA" },
    "tools": $TOOLS_JSON
  }
}
JSON

(
  cd "$SITE_STAGE"
  find . -type f ! -name 'SHA256SUMS.txt' -print0 \
    | sort -z \
    | xargs -0 sha256sum \
    | sed 's#  \./#  #' > SHA256SUMS.txt
)
python3 scripts/reproducible-zip.py \
  --source "$SITE_STAGE" \
  --output "$OUTPUT_DIR/$COMPLETE_ARCHIVE" \
  --epoch "$SOURCE_DATE_EPOCH"

"$ROOT_DIR/scripts/verify-release.sh" "$OUTPUT_DIR/$COMPLETE_ARCHIVE"
"$ROOT_DIR/scripts/verify-pages-workflow.sh" "$OUTPUT_DIR/$COMPLETE_ARCHIVE"
printf '%s\n' "$OUTPUT_DIR/$SOURCE_ARCHIVE" "$OUTPUT_DIR/$COMPLETE_ARCHIVE"
