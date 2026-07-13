#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import http.server
import json
import os
import re
import shutil
import stat
import tempfile
import threading
import urllib.request
import zipfile
from pathlib import Path, PurePosixPath

REQUIRED_FILES = (
    'index.html',
    'manifest.webmanifest',
    'sw.js',
    'API-DIAGNOSE.html',
    'README-ERST-LESEN.html',
    'api-diagnose.js',
    'package-info.css',
    'icons/icon-192.png',
    'icons/icon-512.png',
    'icons/icon-maskable-512.png',
    'icons/apple-touch-icon.png',
    'VERSION.txt',
    'release-manifest.json',
    'SHA256SUMS.txt',
    '.nojekyll',
    'api-docs/index.html',
    'api-docs/search-api.openapi.json',
    'api-docs/search-api.openapi.yaml',
    'api-docs/generation-manifest.json',
)
PRECACHE_REQUIRED = (
    'index.html',
    'API-DIAGNOSE.html',
    'README-ERST-LESEN.html',
    'api-diagnose.js',
    'package-info.css',
    'icons/apple-touch-icon.png',
)
BANNED_PARTS = {'.git', '.github', 'node_modules', 'src', 'server', 'e2e', 'playwright-report', 'test-results'}
BANNED_ROOT_FILES = {
    'package.json', 'package-lock.json', 'vite.config.ts', 'playwright.config.ts',
    'tsconfig.json', 'tsconfig.app.json', 'tsconfig.node.json'
}
TEXT_SUFFIXES = {'.html', '.js', '.css', '.json', '.txt', '.md', '.webmanifest', '.yaml', '.yml'}
BANNED_SUFFIXES = {'.jar', '.aar', '.war', '.apk', '.aab', '.db', '.sqlite', '.sqlite3', '.pem', '.p12', '.pfx', '.key'}
BANNED_NAMES = {'.env', '.env.local', '.env.production', 'id_rsa', 'id_ed25519'}
MAX_ARCHIVE_BYTES = 100 * 1024 * 1024
MAX_ENTRIES = 5_000
MAX_UNCOMPRESSED_BYTES = 250 * 1024 * 1024
MAX_SINGLE_FILE_BYTES = 50 * 1024 * 1024
MAX_COMPRESSION_RATIO = 200


def fail(message: str) -> None:
    raise SystemExit(f'RELEASE VALIDATION FAILED: {message}')


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open('rb') as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def safe_zip_name(raw: str) -> PurePosixPath:
    if '\\' in raw:
        fail(f'ZIP entry uses a backslash: {raw!r}')
    path = PurePosixPath(raw)
    if path.is_absolute() or '..' in path.parts or not path.parts:
        fail(f'unsafe ZIP path: {raw!r}')
    return path


def validate_zip_metadata(archive: zipfile.ZipFile) -> None:
    infos = archive.infolist()
    if len(infos) > MAX_ENTRIES:
        fail(f'ZIP has too many entries: {len(infos)} > {MAX_ENTRIES}')
    total_uncompressed = sum(info.file_size for info in infos)
    if total_uncompressed > MAX_UNCOMPRESSED_BYTES:
        fail(f'ZIP expands to {total_uncompressed} bytes; limit is {MAX_UNCOMPRESSED_BYTES}')

    seen: set[str] = set()
    seen_casefold: set[str] = set()
    for info in infos:
        path = safe_zip_name(info.filename)
        normalized = str(path)
        if len(normalized) > 240:
            fail(f'ZIP path is too long: {normalized}')
        if normalized in seen or normalized.casefold() in seen_casefold:
            fail(f'duplicate or case-colliding ZIP entry: {normalized}')
        seen.add(normalized)
        seen_casefold.add(normalized.casefold())
        if info.flag_bits & 0x1:
            fail(f'encrypted ZIP entry is not allowed: {normalized}')
        unix_mode = info.external_attr >> 16
        if stat.S_ISLNK(unix_mode):
            fail(f'symlink is not allowed: {normalized}')
        file_type = stat.S_IFMT(unix_mode)
        if file_type not in (0, stat.S_IFREG, stat.S_IFDIR):
            fail(f'special filesystem entry is not allowed: {normalized}')
        if any(part in BANNED_PARTS for part in path.parts):
            fail(f'non-deployable directory is embedded: {normalized}')
        if path.name in BANNED_ROOT_FILES or path.name.lower() in BANNED_NAMES:
            fail(f'source/build/secret file is embedded in deployable ZIP: {normalized}')
        if path.suffix.lower() == '.zip':
            fail(f'nested ZIP is not allowed in deployable artifact: {normalized}')
        if path.suffix.lower() in BANNED_SUFFIXES:
            fail(f'forbidden native/server/database/key artifact: {normalized}')
        if info.file_size > MAX_SINGLE_FILE_BYTES:
            fail(f'ZIP entry exceeds per-file limit: {normalized} ({info.file_size} bytes)')
        if info.file_size >= 1024 * 1024:
            ratio = info.file_size / max(info.compress_size, 1)
            if ratio > MAX_COMPRESSION_RATIO:
                fail(f'suspicious ZIP compression ratio for {normalized}: {ratio:.1f}')


def extract_safely(archive: zipfile.ZipFile, destination: Path) -> None:
    for info in archive.infolist():
        path = safe_zip_name(info.filename)
        target = destination.joinpath(*path.parts)
        target_resolved = target.resolve()
        if destination.resolve() not in (target_resolved, *target_resolved.parents):
            fail(f'ZIP entry escapes destination: {info.filename}')
        if info.is_dir():
            target.mkdir(parents=True, exist_ok=True)
            continue
        target.parent.mkdir(parents=True, exist_ok=True)
        with archive.open(info, 'r') as source, target.open('wb') as output:
            shutil.copyfileobj(source, output)


def select_site_root(unpacked: Path) -> Path:
    if (unpacked / 'index.html').is_file():
        return unpacked
    candidates = [p.parent for p in unpacked.glob('*/index.html') if p.is_file()]
    if len(candidates) != 1:
        fail('index.html must be at ZIP root or inside exactly one top-level directory')
    return candidates[0]


def validate_checksums(site: Path) -> None:
    checksum_file = site / 'SHA256SUMS.txt'
    expected: dict[str, str] = {}
    for line_number, line in enumerate(checksum_file.read_text(encoding='utf-8').splitlines(), start=1):
        if not line.strip():
            continue
        match = re.fullmatch(r'([0-9a-f]{64})  (.+)', line)
        if not match:
            fail(f'invalid SHA256SUMS.txt line {line_number}')
        digest, relative = match.groups()
        path = safe_zip_name(relative)
        if str(path) == 'SHA256SUMS.txt':
            fail('SHA256SUMS.txt must not hash itself')
        if str(path) in expected:
            fail(f'duplicate checksum entry: {path}')
        expected[str(path)] = digest

    actual_files = {
        str(path.relative_to(site).as_posix())
        for path in site.rglob('*')
        if path.is_file() and path.name != 'SHA256SUMS.txt'
    }
    if set(expected) != actual_files:
        missing = sorted(actual_files - set(expected))
        extra = sorted(set(expected) - actual_files)
        fail(f'checksum coverage mismatch; missing={missing}, extra={extra}')
    for relative, digest in expected.items():
        actual = sha256(site / relative)
        if actual != digest:
            fail(f'checksum mismatch for {relative}: {actual} != {digest}')


def local_reference(reference: str) -> str | None:
    clean = reference.split('#', 1)[0].split('?', 1)[0]
    if not clean or clean.startswith(('data:', 'blob:', '//')):
        return None
    if re.match(r'^[a-z][a-z0-9+.-]*:', clean, re.I):
        return None
    if clean.startswith('/'):
        fail(f'root-absolute reference is not GitHub Pages subpath safe: {reference}')
    return clean.removeprefix('./')


def validate_html(site: Path) -> list[str]:
    references: list[str] = []
    for relative in ('index.html', 'API-DIAGNOSE.html', 'README-ERST-LESEN.html'):
        text = (site / relative).read_text(encoding='utf-8')
        for reference in re.findall(r'(?:src|href)=["\']([^"\']+)["\']', text, re.I):
            local = local_reference(reference)
            if local is None:
                continue
            references.append(local)
            if not (site / local).is_file():
                fail(f'{relative} references missing file: {local}')
    index = (site / 'index.html').read_text(encoding='utf-8')
    if 'apple-touch-icon' not in index:
        fail('index.html does not link the Apple touch icon')
    if 'Content-Security-Policy' not in index:
        fail('index.html is missing the static Content-Security-Policy meta tag')
    if 'name="referrer" content="no-referrer"' not in index:
        fail('index.html is missing the no-referrer meta policy')
    return references


def validate_manifest(site: Path) -> dict:
    manifest = json.loads((site / 'manifest.webmanifest').read_text(encoding='utf-8'))
    expected = {
        'id': './', 'start_url': './', 'scope': './', 'display': 'standalone',
        'orientation': 'any', 'lang': 'de-DE'
    }
    for key, value in expected.items():
        if manifest.get(key) != value:
            fail(f'manifest {key}={manifest.get(key)!r}; expected {value!r}')
    icons = manifest.get('icons')
    if not isinstance(icons, list) or len(icons) < 3:
        fail('manifest must define at least three icons')
    purposes = set()
    sizes = set()
    for icon in icons:
        source = local_reference(str(icon.get('src', '')))
        if not source or not (site / source).is_file():
            fail(f'invalid or missing manifest icon: {icon!r}')
        sizes.add(str(icon.get('sizes', '')))
        purposes.add(str(icon.get('purpose', 'any')))
    if not {'192x192', '512x512'}.issubset(sizes):
        fail(f'manifest icon sizes incomplete: {sorted(sizes)}')
    if 'maskable' not in purposes:
        fail('manifest does not include a maskable icon')
    return manifest


def validate_runtime(site: Path, version: str) -> None:
    service_worker = (site / 'sw.js').read_text(encoding='utf-8')
    for required in PRECACHE_REQUIRED:
        if required not in service_worker:
            fail(f'service worker does not precache {required}')
    cache_name = f'kh-v{version}-off-product-images'
    if cache_name not in service_worker:
        fail(f'service worker cache name does not contain current version: {cache_name}')

    app_js_files = sorted((site / 'assets').glob('*.js'))
    if not app_js_files:
        fail('no built JavaScript asset found')
    app_js = '\n'.join(path.read_text(encoding='utf-8') for path in app_js_files)
    diagnostic_js = (site / 'api-diagnose.js').read_text(encoding='utf-8')
    combined = app_js + '\n' + diagnostic_js
    required_strings = ('/api/v1/search', '/api/v1/product/', r'^\d{7,14}$')
    for required in required_strings:
        if required not in combined:
            fail(f'required API path missing from built runtime: {required}')
    for forbidden in (
        'https://search.openfoodfacts.org',
        'https://world.openfoodfacts.org/cgi/search.pl',
        'https://world.openfoodfacts.org/api/',
        'boost_phrase',
        'OPENAI_API_KEY',
        'OFF_USER_AGENT',
        'process.env.OFF_USER_AGENT',
    ):
        if forbidden in combined:
            fail(f'forbidden frontend string found: {forbidden}')
    if version not in app_js:
        fail(f'built app JavaScript does not contain application version {version}')
    if f"const APP_VERSION = '{version}'" not in diagnostic_js:
        fail('API diagnosis page version was not generated from package.json')


def validate_release_manifest(site: Path, expected_version: str | None) -> str:
    data = json.loads((site / 'release-manifest.json').read_text(encoding='utf-8'))
    version = str(data.get('version', '')).strip()
    if not re.fullmatch(r'\d+\.\d+\.\d+', version):
        fail(f'invalid release version: {version!r}')
    if expected_version and version != expected_version:
        fail(f'release version {version} does not match expected {expected_version}')
    if data.get('artifactType') != 'static-pwa':
        fail('release-manifest artifactType is invalid')
    deployment_profile = data.get('deploymentProfile')
    gateway_url = data.get('configuredGatewayUrl')
    if deployment_profile not in {'gateway', 'direct-pages'}:
        fail('release-manifest deploymentProfile is invalid')
    if deployment_profile == 'gateway':
        if not isinstance(gateway_url, str) or not gateway_url.startswith('https://'):
            fail('gateway release-manifest requires an HTTPS configuredGatewayUrl')
    elif gateway_url is not None:
        fail('direct-pages release-manifest must not embed a gateway URL')
    if data.get('qualityGatesSkipped') is not False:
        fail('release was built with skipped quality gates')
    if data.get('schemaVersion') != 3:
        fail('release-manifest schemaVersion must be 3')
    if data.get('browserGateAtBuild') != 'passed_at_build':
        fail('release-manifest browserGateAtBuild is invalid')
    if data.get('browserGateRequiredBeforeDeploy') is not True:
        fail('browser gate must be mandatory before release')
    if data.get('browserGatePolicy') != 'required_chromium_firefox_webkit_before_release':
        fail('release-manifest browser gate policy is invalid')
    if data.get('qualityGateMode') not in {'executed_by_release_script', 'prevalidated_by_ci_pipeline'}:
        fail('release-manifest qualityGateMode is invalid')
    runtime = data.get('runtime') or {}
    if runtime.get('staticAssetHostingRequiresApplicationServer') is not False:
        fail('release static-asset hosting contract is invalid')
    if runtime.get('nativeAndroidApk') is not False:
        fail('release manifest must identify this artifact as PWA, not native APK')
    if runtime.get('browserDataAccess') != 'direct-off-or-configured-gateway':
        fail('release manifest must declare direct and gateway API lanes')
    if runtime.get('gatewayRuntimeRequiredForGlobalSearch') is not False:
        fail('release manifest must keep direct global search independent from a gateway')
    if runtime.get('gatewayOptionalForDirectSearch') is not True:
        fail('release manifest must preserve the optional gateway lane')
    version_text = (site / 'VERSION.txt').read_text(encoding='utf-8')
    if f'KH Checker v{version}' not in version_text:
        fail('VERSION.txt does not match release-manifest.json')
    return version



def validate_contract_generation(site: Path, release: dict, version: str) -> None:
    generation = release.get('contractGeneration') or {}
    if generation.get('authoritativeSource') != 'contracts/source/search-api.contract.mjs':
        fail('contractGeneration authoritativeSource is invalid')
    if generation.get('openapiVersion') != '3.1.0':
        fail('contractGeneration openapiVersion must be 3.1.0')

    for key in ('openapi', 'openapiYaml', 'generationManifest'):
        item = generation.get(key) or {}
        relative = item.get('file')
        expected = item.get('sha256')
        if not isinstance(relative, str) or not re.fullmatch(r'[0-9a-f]{64}', str(expected)):
            fail(f'contractGeneration {key} metadata is invalid')
        safe = safe_zip_name(relative)
        target = site.joinpath(*safe.parts)
        if not target.is_file():
            fail(f'contractGeneration file missing: {relative}')
        if sha256(target) != expected:
            fail(f'contractGeneration checksum mismatch: {relative}')

    openapi = json.loads((site / generation['openapi']['file']).read_text(encoding='utf-8'))
    if openapi.get('openapi') != '3.1.0' or str(openapi.get('info', {}).get('version')) != version:
        fail('embedded OpenAPI version does not match the release')
    kh = openapi.get('x-kh-generator') or {}
    if kh.get('appVersion') != version or kh.get('localCooldownAllowed') is not False:
        fail('embedded OpenAPI KH generator invariants are invalid')
    if kh.get('maximumDirectSearchBackendsPerAction') != 2:
        fail('embedded OpenAPI search backend limit is invalid')

    manifest = json.loads((site / generation['generationManifest']['file']).read_text(encoding='utf-8'))
    if str(manifest.get('appVersion')) != version:
        fail('embedded generation manifest version does not match release')
    tools = generation.get('tools') or {}
    required_tools = {'orval', 'redocly', 'hono', 'honoZodOpenApi', 'zod', 'msw', 'faker'}
    if not required_tools.issubset(tools):
        fail(f'contractGeneration tools incomplete: {sorted(required_tools - set(tools))}')

def scan_for_secrets(site: Path) -> None:
    secret_patterns = [
        re.compile(r'sk-[A-Za-z0-9_-]{20,}'),
        re.compile(r'OPENAI_API_KEY\s*='),
        re.compile(r'BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY'),
    ]
    for path in site.rglob('*'):
        if not path.is_file() or path.suffix.lower() not in TEXT_SUFFIXES:
            continue
        try:
            text = path.read_text(encoding='utf-8')
        except UnicodeDecodeError:
            continue
        for pattern in secret_patterns:
            if pattern.search(text):
                fail(f'possible secret in {path.relative_to(site)} matching {pattern.pattern}')


def smoke_http(site: Path, base_path: str, references: list[str], manifest: dict) -> None:
    if not base_path.startswith('/') or not base_path.endswith('/'):
        fail(f'base path must start and end with slash: {base_path!r}')
    with tempfile.TemporaryDirectory(prefix='kh-pages-http-') as temp:
        http_root = Path(temp)
        target = http_root / base_path.strip('/')
        shutil.copytree(site, target)

        class QuietHandler(http.server.SimpleHTTPRequestHandler):
            def log_message(self, *_args) -> None:
                pass

        handler = lambda *args, **kwargs: QuietHandler(*args, directory=str(http_root), **kwargs)
        server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            origin = f'http://127.0.0.1:{server.server_port}'
            urls = [base_path, f'{base_path}manifest.webmanifest', f'{base_path}sw.js']
            urls += [f'{base_path}{reference}' for reference in references]
            urls += [f"{base_path}{icon['src'].removeprefix('./')}" for icon in manifest.get('icons', [])]
            for url in dict.fromkeys(urls):
                with urllib.request.urlopen(origin + url, timeout=5) as response:
                    body = response.read()
                    if response.status != 200 or not body:
                        fail(f'static HTTP smoke failed: {url} -> {response.status}')
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=5)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('--zip', required=True, type=Path)
    parser.add_argument('--site', required=True, type=Path)
    parser.add_argument('--expected-version')
    parser.add_argument('--base-path', default='/kannalles1/')
    args = parser.parse_args()

    archive_path = args.zip.resolve()
    if not archive_path.is_file():
        fail(f'ZIP does not exist: {archive_path}')
    if archive_path.suffix.lower() != '.zip':
        fail(f'not a ZIP file: {archive_path}')
    if archive_path.stat().st_size > MAX_ARCHIVE_BYTES:
        fail(f'ZIP is too large: {archive_path.stat().st_size} > {MAX_ARCHIVE_BYTES}')

    with tempfile.TemporaryDirectory(prefix='kh-release-unpack-') as temp:
        unpacked = Path(temp)
        with zipfile.ZipFile(archive_path) as archive:
            bad = archive.testzip()
            if bad:
                fail(f'corrupt ZIP entry: {bad}')
            validate_zip_metadata(archive)
            extract_safely(archive, unpacked)
        source = select_site_root(unpacked)
        if args.site.exists():
            shutil.rmtree(args.site)
        shutil.copytree(source, args.site)

    site = args.site.resolve()
    for required in REQUIRED_FILES:
        if not (site / required).is_file():
            fail(f'required file missing: {required}')
    validate_checksums(site)
    references = validate_html(site)
    manifest = validate_manifest(site)
    release_data = json.loads((site / 'release-manifest.json').read_text(encoding='utf-8'))
    version = validate_release_manifest(site, args.expected_version)
    validate_contract_generation(site, release_data, version)
    contract_path = site / 'contracts' / f'kh-checker-api-config-user-needs-v{version}.json'
    if not contract_path.is_file():
        fail(f'machine-readable runtime contract missing: {contract_path.relative_to(site)}')
    contract = json.loads(contract_path.read_text(encoding='utf-8'))
    if str(contract.get('application', {}).get('version')) != version:
        fail('machine-readable runtime contract version does not match release')
    generator = contract.get('qualityAndTooling', {}).get('generatorPipeline') or {}
    if generator.get('authoritativeInput') != 'contracts/source/search-api.contract.mjs':
        fail('machine-readable runtime contract does not declare the generator authority')
    if generator.get('clientGenerator') != 'Orval fetch':
        fail('machine-readable runtime contract does not declare the Orval Fetch generator')
    architecture = contract.get('architecture') or {}
    if architecture.get('portableGatewayRuntime') != 'node-express-container':
        fail('machine-readable runtime contract does not declare the Node/Express runtime')
    if architecture.get('optionalAdapters') != []:
        fail('machine-readable runtime contract contains a retired platform adapter')
    if architecture.get('browserDataAccess') != 'direct-off-or-configured-gateway':
        fail('machine-readable runtime contract does not declare both API lanes')
    if architecture.get('primarySearch') != 'public-search-a-licious':
        fail('machine-readable runtime contract does not declare direct Search-a-licious primary')
    validate_runtime(site, version)
    scan_for_secrets(site)
    smoke_http(site, args.base_path, references, manifest)

    file_count = sum(1 for path in site.rglob('*') if path.is_file())
    total_bytes = sum(path.stat().st_size for path in site.rglob('*') if path.is_file())
    print(json.dumps({
        'status': 'valid',
        'version': version,
        'zip': str(archive_path),
        'site': str(site),
        'files': file_count,
        'bytes': total_bytes,
        'sha256': sha256(archive_path),
        'basePath': args.base_path,
    }, ensure_ascii=False))


if __name__ == '__main__':
    main()
