#!/usr/bin/env python3
import argparse
import pathlib
import zipfile


parser = argparse.ArgumentParser()
parser.add_argument('--zip', required=True)
args = parser.parse_args()
archive = pathlib.Path(args.zip)

with zipfile.ZipFile(archive) as bundle:
    names = [name.replace('\\', '/') for name in bundle.namelist() if not name.endswith('/')]

for name in names:
    path = pathlib.PurePosixPath(name)
    if path.is_absolute() or '..' in path.parts:
        raise SystemExit(f'unsafe source archive path: {name}')
    lowered_parts = tuple(part.casefold() for part in path.parts)
    if '.codex' in lowered_parts:
        raise SystemExit(f'internal .codex data in source archive: {name}')
    basename = path.name
    lowered_basename = basename.casefold()
    if lowered_basename == '.env.example':
        continue
    if lowered_basename == '.env' or lowered_basename.startswith('.env.'):
        raise SystemExit(f'environment secret file in source archive: {name}')
    if lowered_basename.endswith('.zip'):
        raise SystemExit(f'nested archive in source archive: {name}')

print(f'source bundle valid: {archive} ({len(names)} files)')
