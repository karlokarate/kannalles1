#!/usr/bin/env python3
from __future__ import annotations

import hashlib
import json
import re
import sqlite3
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
CATALOG = ROOT / "Catalog"
MANIFEST_NAME = "catalog-manifest.v1.json"
STATIC_PRODUCTION_FILES = (
    MANIFEST_NAME,
    "catalog-production.contract.v1.json",
    "catalog-build-report.v1.json",
    "catalog-build-report.v1.txt",
    "SHA256SUMS.txt",
)
EXPECTED_COLUMNS = ["id", "g", "n", "b", "c", "s", "q", "u", "m", "r"]
SMOKE_QUERIES = ("kinder bueno", "vollkornbrot", "erdnüsse", "nutella", "salzstangen")
MAX_SAFE_INTEGER = 9_007_199_254_740_991
SHA256_PATTERN = re.compile(r"[a-f0-9]{64}", re.IGNORECASE)


def nested(value: dict[str, Any], *paths: tuple[str, ...]) -> Any:
    for path in paths:
        current: Any = value
        for part in path:
            if not isinstance(current, dict) or part not in current:
                break
            current = current[part]
        else:
            return current
    return None


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def require_json(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:  # noqa: BLE001
        raise SystemExit(f"FEHLER: {path.name} ist kein gültiges UTF-8-JSON: {exc}") from exc
    if not isinstance(value, dict):
        raise SystemExit(f"FEHLER: {path.name} muss ein JSON-Objekt sein.")
    return value


def safe_catalog_name(value: Any, field: str) -> str:
    name = str(value or "")
    if not name or Path(name).name != name or name in {".", ".."}:
        raise SystemExit(f"FEHLER: Manifest-{field} ist kein sicherer Dateiname: {value!r}")
    return name


def manifest_values(manifest: dict[str, Any]) -> dict[str, Any]:
    return {
        "filename": safe_catalog_name(nested(manifest, ("database", "file")), "database.file"),
        "size": nested(manifest, ("database", "bytes")),
        "sha256": nested(manifest, ("database", "sha256")),
        "application_id": nested(manifest, ("database", "applicationId")),
        "user_version": nested(manifest, ("database", "userVersion")),
        "page_size": nested(manifest, ("database", "pageSize")),
        "product_count": nested(manifest, ("database", "products")),
        "brand_count": nested(manifest, ("database", "brands")),
        "codec_file": safe_catalog_name(nested(manifest, ("codecFile",)), "codecFile"),
        "runtime_file": safe_catalog_name(nested(manifest, ("runtimeTypescript",)), "runtimeTypescript"),
        "image_file": safe_catalog_name(nested(manifest, ("image", "dictionaryFile")), "image.dictionaryFile"),
        "image_sha256": nested(manifest, ("image", "dictionarySha256")),
    }


def require_manifest_shape(manifest: dict[str, Any], values: dict[str, Any]) -> None:
    if manifest.get("contract") != "kh-checker-offline-catalog-production":
        raise SystemExit("FEHLER: Falscher Manifestvertrag.")
    if manifest.get("contractVersion") != "1.0.0":
        raise SystemExit("FEHLER: Nicht unterstützte Manifestvertragsversion.")
    if not str(manifest.get("catalogVersion") or "").strip():
        raise SystemExit("FEHLER: catalogVersion fehlt.")
    integer_fields = ("size", "application_id", "user_version", "page_size", "product_count", "brand_count")
    for field in integer_fields:
        value = values[field]
        if not isinstance(value, int) or isinstance(value, bool) or value <= 0:
            raise SystemExit(f"FEHLER: Manifest-{field} ist keine positive Ganzzahl: {value!r}")
    if not SHA256_PATTERN.fullmatch(str(values["sha256"] or "")):
        raise SystemExit("FEHLER: Manifest-Datenbank-SHA-256 ist ungültig.")
    if not SHA256_PATTERN.fullmatch(str(values["image_sha256"] or "")):
        raise SystemExit("FEHLER: Manifest-Bildschlüssel-SHA-256 ist ungültig.")


def verify_sums(path: Path, expected_references: set[str]) -> None:
    referenced: set[str] = set()
    for line in path.read_text(encoding="utf-8").splitlines():
        clean = line.strip()
        if not clean or clean.startswith("#"):
            continue
        parts = clean.split(maxsplit=1)
        if len(parts) != 2 or not SHA256_PATTERN.fullmatch(parts[0]):
            raise SystemExit(f"FEHLER: Ungültige Zeile in {path.name}: {line}")
        expected, raw_name = parts
        name = safe_catalog_name(raw_name.lstrip("* "), "SHA256SUMS entry")
        referenced.add(name)
        target = CATALOG / name
        if not target.is_file():
            raise SystemExit(f"FEHLER: In {path.name} referenzierte Datei fehlt: {name}")
        actual = sha256(target)
        if actual.lower() != expected.lower():
            raise SystemExit(f"FEHLER: SHA-256 stimmt nicht für {name}: {actual}")
    if referenced != expected_references:
        raise SystemExit(
            "FEHLER: SHA256SUMS-Dateimenge weicht ab: "
            f"fehlend={sorted(expected_references - referenced)}, "
            f"unerwartet={sorted(referenced - expected_references)}"
        )


def fts_query(text: str) -> str:
    tokens = re.findall(r"[0-9A-Za-zÀ-ÖØ-öø-ÿ]+", text.lower())
    tokens = [token for token in tokens if len(token) >= 2]
    return " AND ".join(f'"{token.replace(chr(34), chr(34) * 2)}"*' for token in tokens)


def verify_runtime(runtime_path: Path, application_id: int, user_version: int) -> None:
    runtime = runtime_path.read_text(encoding="utf-8")
    required_fragments = (
        f"CATALOG_APPLICATION_ID = {application_id}",
        f"CATALOG_USER_VERSION = {user_version}",
        "export const CATALOG_SEARCH_SQL",
        "p.r DESC,p.n COLLATE NOCASE ASC,p.id ASC",
        "export function packStandardGtin",
        "export function decodeCatalogMetadata",
        "export function buildCatalogImageUrl",
        "export function buildCatalogFtsQuery",
    )
    missing = [fragment for fragment in required_fragments if fragment not in runtime]
    if missing:
        raise SystemExit(f"FEHLER: Runtime-SSOT unvollständig: {missing}")


def verify_sqlite(database: Path, values: dict[str, Any]) -> dict[str, int]:
    uri = f"file:{database.as_posix()}?mode=ro&immutable=1"
    connection = sqlite3.connect(uri, uri=True)
    try:
        quick_check = connection.execute("PRAGMA quick_check(1)").fetchone()[0]
        if quick_check != "ok":
            raise SystemExit(f"FEHLER: SQLite quick_check: {quick_check}")
        names = {
            row[0]
            for row in connection.execute(
                "SELECT name FROM sqlite_schema WHERE type IN ('table','view')"
            )
        }
        missing = {"p", "d", "x"} - names
        if missing:
            raise SystemExit(f"FEHLER: SQLite-Pflichtobjekte fehlen: {sorted(missing)}")
        columns = [row[1] for row in connection.execute("PRAGMA table_info(p)")]
        if columns != EXPECTED_COLUMNS:
            raise SystemExit(f"FEHLER: p-Spalten weichen ab: {columns}")
        product_count = int(connection.execute("SELECT count(*) FROM p").fetchone()[0])
        brand_count = int(connection.execute("SELECT count(*) FROM d").fetchone()[0])
        application_id = int(connection.execute("PRAGMA application_id").fetchone()[0])
        user_version = int(connection.execute("PRAGMA user_version").fetchone()[0])
        page_size = int(connection.execute("PRAGMA page_size").fetchone()[0])
        max_metadata = int(connection.execute("SELECT max(m) FROM p").fetchone()[0])
        invalid_rows = int(
            connection.execute(
                "SELECT count(*) FROM p WHERE n IS NULL OR trim(n)='' OR c<0 OR c>100 OR m<0"
            ).fetchone()[0]
        )
        if invalid_rows:
            raise SystemExit(f"FEHLER: {invalid_rows} ungültige Produktzeilen.")
        if max_metadata > MAX_SAFE_INTEGER:
            raise SystemExit(f"FEHLER: Metadaten überschreiten JavaScript-safe integer: {max_metadata}")
        for query in SMOKE_QUERIES:
            hit = connection.execute(
                "SELECT rowid FROM x WHERE x MATCH ? LIMIT 1",
                (fts_query(query),),
            ).fetchone()
            if hit is None:
                raise SystemExit(f"FEHLER: Pflichtsuche ohne Treffer: {query}")
    finally:
        connection.close()

    checks = (
        ("application_id", application_id),
        ("user_version", user_version),
        ("page_size", page_size),
        ("product_count", product_count),
        ("brand_count", brand_count),
    )
    for key, actual in checks:
        if int(values[key]) != actual:
            raise SystemExit(f"FEHLER: Manifest-{key}={values[key]}, SQLite={actual}")
    return {
        "application_id": application_id,
        "user_version": user_version,
        "page_size": page_size,
        "product_count": product_count,
        "brand_count": brand_count,
        "max_metadata": max_metadata,
    }


def main() -> int:
    missing_static = [name for name in STATIC_PRODUCTION_FILES if not (CATALOG / name).is_file()]
    if missing_static:
        raise SystemExit("FEHLER: Produktionskatalog-Metadaten fehlen: " + ", ".join(missing_static))

    manifest = require_json(CATALOG / MANIFEST_NAME)
    values = manifest_values(manifest)
    require_manifest_shape(manifest, values)
    derived_files = {
        values["filename"],
        values["codec_file"],
        values["image_file"],
        values["runtime_file"],
    }
    production_files = set(STATIC_PRODUCTION_FILES) | derived_files
    missing = sorted(name for name in production_files if not (CATALOG / name).is_file())
    if missing:
        raise SystemExit("FEHLER: Manifestreferenzierte Produktionsdateien fehlen: " + ", ".join(missing))

    database = CATALOG / values["filename"]
    codecs = require_json(CATALOG / values["codec_file"])
    image_keys = require_json(CATALOG / values["image_file"])
    production_contract = require_json(CATALOG / "catalog-production.contract.v1.json")
    build_report = require_json(CATALOG / "catalog-build-report.v1.json")

    if codecs.get("contract") != manifest.get("contract"):
        raise SystemExit("FEHLER: Codec- und Manifestvertrag stimmen nicht überein.")
    if production_contract.get("contract") != manifest.get("contract"):
        raise SystemExit("FEHLER: Produktions- und Manifestvertrag stimmen nicht überein.")
    if build_report.get("status") != "ok" or build_report.get("blockers"):
        raise SystemExit("FEHLER: Buildreport ist nicht freigegeben.")
    if image_keys.get("contract") != "kh-checker-off-image-key-dictionary":
        raise SystemExit("FEHLER: Falscher Bildschlüsselvertrag.")

    expected_sums = production_files - {"SHA256SUMS.txt"}
    verify_sums(CATALOG / "SHA256SUMS.txt", expected_sums)
    actual_size = database.stat().st_size
    if values["size"] != actual_size:
        raise SystemExit(f"FEHLER: Manifest-Größe={values['size']}, Datei={actual_size}")
    actual_hash = sha256(database)
    if str(values["sha256"]).lower() != actual_hash:
        raise SystemExit(f"FEHLER: Manifest-SHA-256 stimmt nicht: {actual_hash}")
    if str(values["image_sha256"]).lower() != sha256(CATALOG / values["image_file"]):
        raise SystemExit("FEHLER: Bildschlüssel-SHA-256 stimmt nicht zum Manifest.")

    sqlite_values = verify_sqlite(database, values)
    verify_runtime(CATALOG / values["runtime_file"], sqlite_values["application_id"], sqlite_values["user_version"])
    print(json.dumps({
        "mode": "production-v1",
        "catalogVersion": manifest["catalogVersion"],
        "database": str(database.relative_to(ROOT)),
        "sizeBytes": actual_size,
        "sha256": actual_hash,
        **sqlite_values,
    }, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
