#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import sqlite3
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
CATALOG = ROOT / "Catalog"
PRODUCTION_FILES = (
    "kh-checker-dach-v1.sqlite",
    "catalog-manifest.v1.json",
    "catalog-codecs.v1.json",
    "catalog-image-keys.v2.json",
    "catalog-runtime.generated.ts",
    "catalog-production.contract.v1.json",
    "catalog-build-report.v1.json",
    "catalog-build-report.v1.txt",
    "SHA256SUMS.txt",
)


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


def manifest_values(manifest: dict[str, Any], database: Path) -> dict[str, Any]:
    return {
        "filename": nested(
            manifest,
            ("filename",),
            ("artifact", "filename"),
            ("database", "filename"),
        )
        or database.name,
        "size": nested(
            manifest,
            ("sizeBytes",),
            ("size_bytes",),
            ("artifact", "sizeBytes"),
            ("database", "sizeBytes"),
        ),
        "sha256": nested(
            manifest,
            ("sha256",),
            ("artifact", "sha256"),
            ("database", "sha256"),
        ),
        "application_id": nested(
            manifest,
            ("applicationId",),
            ("application_id",),
            ("sqlite", "applicationId"),
            ("sqlite", "application_id"),
        ),
        "user_version": nested(
            manifest,
            ("userVersion",),
            ("user_version",),
            ("sqlite", "userVersion"),
            ("sqlite", "user_version"),
        ),
        "product_count": nested(
            manifest,
            ("productCount",),
            ("product_count",),
            ("counts", "products"),
        ),
    }


def verify_sums(path: Path) -> None:
    for line in path.read_text(encoding="utf-8").splitlines():
        clean = line.strip()
        if not clean or clean.startswith("#"):
            continue
        parts = clean.split(maxsplit=1)
        if len(parts) != 2 or len(parts[0]) != 64:
            raise SystemExit(f"FEHLER: Ungültige Zeile in {path.name}: {line}")
        expected, raw_name = parts
        name = raw_name.lstrip("* ")
        target = CATALOG / name
        if not target.is_file():
            raise SystemExit(f"FEHLER: In {path.name} referenzierte Datei fehlt: {name}")
        actual = sha256(target)
        if actual.lower() != expected.lower():
            raise SystemExit(f"FEHLER: SHA-256 stimmt nicht für {name}: {actual}")


def verify_sqlite(database: Path, manifest: dict[str, Any]) -> dict[str, int]:
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
        product_count = int(connection.execute("SELECT count(*) FROM p").fetchone()[0])
        if product_count <= 0:
            raise SystemExit("FEHLER: Produkttabelle p ist leer.")
        application_id = int(connection.execute("PRAGMA application_id").fetchone()[0])
        user_version = int(connection.execute("PRAGMA user_version").fetchone()[0])
    finally:
        connection.close()

    values = manifest_values(manifest, database)
    checks = (
        ("application_id", application_id),
        ("user_version", user_version),
        ("product_count", product_count),
    )
    for key, actual in checks:
        expected = values[key]
        if expected is not None and int(expected) != actual:
            raise SystemExit(f"FEHLER: Manifest-{key}={expected}, SQLite={actual}")
    return {
        "application_id": application_id,
        "user_version": user_version,
        "product_count": product_count,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--allow-benchmark",
        action="store_true",
        help="Temporäre Browser-Proof-Datei akzeptieren, solange production-v1 fehlt.",
    )
    args = parser.parse_args()

    production = all((CATALOG / name).is_file() for name in PRODUCTION_FILES)
    if production:
        database = CATALOG / "kh-checker-dach-v1.sqlite"
        manifest_path = CATALOG / "catalog-manifest.v1.json"
        for name in (
            "catalog-manifest.v1.json",
            "catalog-codecs.v1.json",
            "catalog-image-keys.v2.json",
            "catalog-production.contract.v1.json",
            "catalog-build-report.v1.json",
        ):
            require_json(CATALOG / name)
        verify_sums(CATALOG / "SHA256SUMS.txt")
        mode = "production-v1"
    elif args.allow_benchmark:
        database = CATALOG / "kh-checker-dach.sqlite"
        manifest_path = CATALOG / "manifest.json"
        if not database.is_file() or not manifest_path.is_file():
            raise SystemExit("FEHLER: Benchmark-SQLite oder Benchmark-Manifest fehlt.")
        mode = "benchmark-proof"
    else:
        missing = [name for name in PRODUCTION_FILES if not (CATALOG / name).is_file()]
        raise SystemExit(
            "FEHLER: Production-v1-Katalog ist unvollständig. Fehlend: " + ", ".join(missing)
        )

    manifest = require_json(manifest_path)
    values = manifest_values(manifest, database)
    if values["filename"] not in {database.name, "kh-checker-dach.sqlite"}:
        raise SystemExit(
            f"FEHLER: Manifest-Dateiname {values['filename']!r} passt nicht zu {database.name!r}."
        )
    actual_size = database.stat().st_size
    if values["size"] is not None and int(values["size"]) != actual_size:
        raise SystemExit(f"FEHLER: Manifest-Größe={values['size']}, Datei={actual_size}")
    actual_hash = sha256(database)
    if values["sha256"] is not None and str(values["sha256"]).lower() != actual_hash:
        raise SystemExit(f"FEHLER: Manifest-SHA-256 stimmt nicht: {actual_hash}")

    sqlite_values = verify_sqlite(database, manifest)
    print(
        json.dumps(
            {
                "mode": mode,
                "database": str(database.relative_to(ROOT)),
                "sizeBytes": actual_size,
                "sha256": actual_hash,
                **sqlite_values,
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
