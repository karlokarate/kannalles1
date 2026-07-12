#!/usr/bin/env python3
from __future__ import annotations

import argparse
import os
import stat
import time
import zipfile
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser(description='Create a deterministic ZIP from a directory tree.')
    parser.add_argument('--source', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    parser.add_argument('--epoch', required=True, type=int)
    args = parser.parse_args()

    source = args.source.resolve()
    output = args.output.resolve()
    if not source.is_dir():
        raise SystemExit(f'Source directory does not exist: {source}')
    output.parent.mkdir(parents=True, exist_ok=True)
    output.unlink(missing_ok=True)

    epoch = max(args.epoch, 315532800)  # ZIP timestamps start in 1980.
    stamp = time.gmtime(epoch)[:6]
    files = sorted((path for path in source.rglob('*') if path.is_file()), key=lambda p: p.relative_to(source).as_posix())
    if not files:
        raise SystemExit('Refusing to create an empty ZIP.')

    with zipfile.ZipFile(output, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9, strict_timestamps=True) as archive:
        for path in files:
            if path.is_symlink():
                raise SystemExit(f'Symlinks are not allowed: {path}')
            relative = path.relative_to(source).as_posix()
            data = path.read_bytes()
            info = zipfile.ZipInfo(relative, stamp)
            info.create_system = 3
            mode = path.stat().st_mode
            executable = bool(mode & stat.S_IXUSR)
            info.external_attr = ((0o100755 if executable else 0o100644) & 0xFFFF) << 16
            info.compress_type = zipfile.ZIP_DEFLATED
            info.flag_bits |= 0x800  # UTF-8 names.
            archive.writestr(info, data, compress_type=zipfile.ZIP_DEFLATED, compresslevel=9)

    print(f'{output} ({len(files)} files, {output.stat().st_size} bytes)')


if __name__ == '__main__':
    main()
