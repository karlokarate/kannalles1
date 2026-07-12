#!/usr/bin/env bash
set -uo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"
VERSION="$(node -p "JSON.parse(require('fs').readFileSync('package.json','utf8')).version")"
FALLBACK_ZIP="${KH_FALLBACK_ZIP:-releases/kh-checker-v${VERSION}-komplett.zip}"
if [[ -n "${GITHUB_REPOSITORY:-}" && "${GITHUB_REPOSITORY}" == */* ]]; then
  BASE_PATH="/${GITHUB_REPOSITORY#*/}/"
else
  BASE_PATH="/kannalles1/"
fi

REPORT_DIR="$ROOT_DIR/ci-reports"
FALLBACK_SITE="$ROOT_DIR/fallback-site"
CANDIDATE_SITE="$ROOT_DIR/candidate-site"
PUBLISH_SITE="$ROOT_DIR/publish-site"
STATIC_SITE="$REPORT_DIR/source-static-site"
STATIC_RELEASE_DIR="$REPORT_DIR/source-static-release"
GATES_TSV="$REPORT_DIR/gates.tsv"
GATEWAY_URL="${VITE_DATA_GATEWAY_URL:-}"
mkdir -p "$REPORT_DIR"
rm -rf "$FALLBACK_SITE" "$CANDIDATE_SITE" "$PUBLISH_SITE" "$STATIC_SITE" "$STATIC_RELEASE_DIR" "$ROOT_DIR/release-out"
: > "$GATES_TSV"

hard_fail() {
  echo "::error::$*" >&2
  exit 1
}

record_gate() {
  printf '%s\t%s\t%s\n' "$1" "$2" "$3" >> "$GATES_TSV"
}

run_gate() {
  local slug="$1"
  local label="$2"
  shift 2
  local log="$REPORT_DIR/${slug}.log"
  echo "===== $label =====" | tee "$log"
  "$@" 2>&1 | tee -a "$log"
  local status=${PIPESTATUS[0]}
  if [[ "$status" == "0" ]]; then
    record_gate "$slug" passed "$label"
    return 0
  fi
  record_gate "$slug" failed "$label (exit $status)"
  echo "::warning::$label failed (exit $status); the best previously validated candidate remains selected." >&2
  return "$status"
}

[[ -f "$FALLBACK_ZIP" ]] || hard_fail "Validated failsoft fallback missing: $FALLBACK_ZIP"

if [[ -z "$GATEWAY_URL" ]]; then
  hard_fail "VITE_DATA_GATEWAY_URL ist leer. Dieser Release erlaubt keine direkten Browseraufrufe zu OFF-APIs."
fi
if [[ ! "$GATEWAY_URL" =~ ^https?:// ]]; then
  hard_fail "VITE_DATA_GATEWAY_URL muss mit http:// oder https:// beginnen."
fi

python3 .github/scripts/validate_release_bundle.py \
  --zip "$FALLBACK_ZIP" \
  --site "$FALLBACK_SITE" \
  --expected-version "$VERSION" \
  --base-path "$BASE_PATH" \
  | tee "$REPORT_DIR/fallback-validation.json" || hard_fail "Prebuilt fallback failed hard release validation."
record_gate fallback-validation passed "Hard-validated prebuilt v${VERSION} fallback"
cp -a "$FALLBACK_SITE" "$PUBLISH_SITE"
SELECTED_KIND="validated-prebuilt-fallback"
SELECTED_ZIP="$FALLBACK_ZIP"
SOURCE_OK=true

# A source candidate is optional at deployment time. Every stage is recorded;
# the first failure disqualifies only that candidate, never the best already
# validated PWA. A fresh static source build becomes the new fallback before
# browser infrastructure is attempted, so old runtime bugs cannot reappear.
if ! run_gate npm-ci "Install locked dependencies" npm ci --no-audit --no-fund; then SOURCE_OK=false; fi
if [[ "$SOURCE_OK" == true ]] && ! run_gate api-generation "Regenerate and verify OpenAPI/Orval/Zod/MSW artifacts" npm run api:check; then SOURCE_OK=false; fi
if [[ "$SOURCE_OK" == true ]] && ! run_gate workflow-contract "Validate the single final workflow" npm run check:workflow; then SOURCE_OK=false; fi
if [[ "$SOURCE_OK" == true ]] && ! run_gate typecheck "Application TypeScript typecheck" npm run typecheck; then SOURCE_OK=false; fi
if [[ "$SOURCE_OK" == true ]] && ! run_gate generated-typecheck "Generated Fetch/Zod/MSW/Faker TypeScript typecheck" npm run typecheck:generated; then SOURCE_OK=false; fi
if [[ "$SOURCE_OK" == true ]] && ! run_gate lint "Biome lint" npm run lint; then SOURCE_OK=false; fi
if [[ "$SOURCE_OK" == true ]] && ! run_gate unit-contract-tests "Vitest unit and contract tests" npm test; then SOURCE_OK=false; fi
if [[ "$SOURCE_OK" == true ]] && ! run_gate server-syntax "Optional gateway syntax" npm run check:server; then SOURCE_OK=false; fi
if [[ "$SOURCE_OK" == true ]] && ! run_gate scripts-syntax "Shell, Node and Python syntax" npm run check:scripts; then SOURCE_OK=false; fi
if [[ "$SOURCE_OK" == true ]] && ! run_gate audit "High/critical npm audit" npm run audit; then SOURCE_OK=false; fi
if [[ "$SOURCE_OK" == true ]] && ! run_gate production-build "Vite/PWA production build" npm run build; then SOURCE_OK=false; fi
if [[ "$SOURCE_OK" == true ]] && ! run_gate pages-contract "GitHub Pages subpath/PWA validation" npm run check:pages; then SOURCE_OK=false; fi

if command -v git >/dev/null 2>&1 && git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  SOURCE_DATE_EPOCH="$(git log -1 --format=%ct)"
else
  SOURCE_DATE_EPOCH="$(date -u +%s)"
fi
export SOURCE_DATE_EPOCH

# Freeze and validate the freshly built static PWA before Playwright. If the
# browser download or browser runtime fails, this source-built artifact—not the
# old prebuilt ZIP—is published.
if [[ "$SOURCE_OK" == true ]]; then
  if ! run_gate static-release-build "Create fresh static source-built fallback" \
      env RELEASE_PREVALIDATED=1 RELEASE_BROWSER_GATE=deferred_to_deployment_workflow OUTPUT_DIR="$STATIC_RELEASE_DIR" npm run release; then
    SOURCE_OK=false
  else
    STATIC_ZIP="$STATIC_RELEASE_DIR/kh-checker-v${VERSION}-komplett.zip"
    if ! run_gate static-candidate-validation "Validate fresh static source-built fallback" \
        python3 .github/scripts/validate_release_bundle.py \
          --zip "$STATIC_ZIP" \
          --site "$STATIC_SITE" \
          --expected-version "$VERSION" \
          --base-path "$BASE_PATH"; then
      SOURCE_OK=false
    elif ! run_gate static-candidate-pages "Revalidate fresh static Pages directory" node scripts/verify-pages-build.mjs "$STATIC_SITE"; then
      SOURCE_OK=false
    elif ! run_gate static-candidate-http "Serve fresh static Pages directory over HTTP" node scripts/verify-static-http.mjs "$STATIC_SITE"; then
      SOURCE_OK=false
    else
      rm -rf "$PUBLISH_SITE"
      cp -a "$STATIC_SITE" "$PUBLISH_SITE"
      SELECTED_KIND="source-built-static-validated-fallback"
      SELECTED_ZIP="$STATIC_ZIP"
    fi
  fi
fi

if [[ "$SOURCE_OK" == true ]]; then
  if [[ "${ONE_CLICK_SKIP_BROWSER:-0}" == "1" ]]; then
    record_gate playwright-install skipped "Browser installation explicitly skipped by ONE_CLICK_SKIP_BROWSER"
    record_gate playwright-e2e skipped "Browser suite explicitly skipped; fresh static source candidate retained"
    echo "::warning::Browser suite was skipped; using the fresh static source-built candidate." >&2
    SOURCE_OK=false
  elif ! run_gate playwright-install "Install locked Playwright Chromium and WebKit browsers" \
      npx --no-install playwright install --with-deps chromium webkit; then
    SOURCE_OK=false
  elif ! run_gate playwright-e2e "Playwright desktop, Android, iPhone, offline and axe gates" \
      env CI=true PLAYWRIGHT_INCLUDE_WEBKIT=1 npm run test:e2e; then
    SOURCE_OK=false
  fi
fi

if [[ "$SOURCE_OK" == true ]]; then
  if ! run_gate release-build "Create deterministic browser-validated app-only and source release ZIPs" \
      env RELEASE_PREVALIDATED=1 RELEASE_BROWSER_GATE=passed_at_build OUTPUT_DIR="$ROOT_DIR/release-out" npm run release; then
    SOURCE_OK=false
  fi
fi

if [[ "$SOURCE_OK" == true ]]; then
  CANDIDATE_ZIP="$ROOT_DIR/release-out/kh-checker-v${VERSION}-komplett.zip"
  if ! run_gate candidate-validation "Validate generated v${VERSION} release ZIP" \
      python3 .github/scripts/validate_release_bundle.py \
        --zip "$CANDIDATE_ZIP" \
        --site "$CANDIDATE_SITE" \
        --expected-version "$VERSION" \
        --base-path "$BASE_PATH"; then
    SOURCE_OK=false
  elif ! run_gate candidate-pages "Revalidate generated Pages directory" node scripts/verify-pages-build.mjs "$CANDIDATE_SITE"; then
    SOURCE_OK=false
  elif ! run_gate candidate-http "Serve generated Pages directory over HTTP" node scripts/verify-static-http.mjs "$CANDIDATE_SITE"; then
    SOURCE_OK=false
  fi
fi

if [[ "$SOURCE_OK" == true ]]; then
  rm -rf "$PUBLISH_SITE"
  cp -a "$CANDIDATE_SITE" "$PUBLISH_SITE"
  SELECTED_KIND="source-built-and-browser-validated"
  SELECTED_ZIP="release-out/kh-checker-v${VERSION}-komplett.zip"
elif [[ "$SELECTED_KIND" == "source-built-static-validated-fallback" ]]; then
  echo "::notice::Deploying the fresh static source-built v${VERSION} candidate because a later optional gate failed." >&2
else
  echo "::notice::Deploying the hard-validated prebuilt v${VERSION} fallback because the source build did not pass static validation." >&2
fi

# These are hard final gates because no incomplete or unsafe directory may reach Pages.
node scripts/verify-pages-build.mjs "$PUBLISH_SITE" \
  | tee "$REPORT_DIR/final-pages.log" || hard_fail "Final Pages directory failed the PWA contract."
node scripts/verify-static-http.mjs "$PUBLISH_SITE" \
  | tee "$REPORT_DIR/final-http.log" || hard_fail "Final Pages directory failed static HTTP delivery."
[[ -f "$PUBLISH_SITE/.nojekyll" ]] || hard_fail "Final Pages directory is missing .nojekyll"

SELECTED_SHA="$(sha256sum "$SELECTED_ZIP" | awk '{print $1}')"
python3 - "$GATES_TSV" "$REPORT_DIR/ONE-CLICK-SUMMARY.md" "$VERSION" "$SELECTED_KIND" "$SELECTED_ZIP" "$SELECTED_SHA" <<'PY'
from pathlib import Path
import sys

gates = []
for line in Path(sys.argv[1]).read_text(encoding='utf-8').splitlines():
    slug, status, label = line.split('\t', 2)
    gates.append((slug, status, label))
version, selected, archive, digest = sys.argv[3:7]
rows = '\n'.join(f'| `{slug}` | {status} | {label} |' for slug, status, label in gates)
Path(sys.argv[2]).write_text(f'''# KH Checker v{version} – One-Click-Workflow

- Deployment candidate: **{selected}**
- Release ZIP: `{archive}`
- SHA-256: `{digest}`

| Gate | Ergebnis | Beschreibung |
|---|---|---|
{rows}
''', encoding='utf-8')
PY

cat "$REPORT_DIR/ONE-CLICK-SUMMARY.md"
if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
  cat "$REPORT_DIR/ONE-CLICK-SUMMARY.md" >> "$GITHUB_STEP_SUMMARY"
fi
if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
  {
    echo "version=$VERSION"
    echo "selected_kind=$SELECTED_KIND"
    echo "selected_zip=$SELECTED_ZIP"
    echo "selected_sha256=$SELECTED_SHA"
  } >> "$GITHUB_OUTPUT"
fi
