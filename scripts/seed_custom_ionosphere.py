#!/usr/bin/env python3
"""Seed a custom ionosphere directory with the bundled ITURHFProp data set.

Copies every file from itu_r_hf/ITURHFProp/Data/ (including the Antenna/
subdirectory) into ionosphere/custom/ so the destination is a complete
drop-in DataFilePath for the prediction engine. A future modification tool
can then edit the ionosNN.bin maps in the custom directory while the bundled
reference data stays pristine.

Idempotent: files that already exist at the destination are skipped, so
re-running never clobbers modified maps. Use --force to overwrite everything
and restore the pristine reference data.

Usage:
    python scripts/seed_custom_ionosphere.py [--dest DIR] [--force]
"""
import argparse
import os
import shutil
import sys

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
SRC_DIR = os.path.join(REPO_ROOT, 'itu_r_hf', 'ITURHFProp', 'Data')
DEFAULT_DEST = os.path.join(REPO_ROOT, 'ionosphere', 'custom')

# Must match REQUIRED_DATA_FILES in routes/api.py — the files ITURHFProp
# actually opens from DataFilePath at runtime.
REQUIRED = ([f'ionos{m:02d}.bin' for m in range(1, 13)]
            + [f'COEFF{m:02d}W.txt' for m in range(1, 13)]
            + ['P1239-3 Decile Factors.txt'])


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument('--dest', default=DEFAULT_DEST,
                    help='destination directory (default: ionosphere/custom)')
    ap.add_argument('--force', action='store_true',
                    help='overwrite existing files (restores pristine data)')
    args = ap.parse_args()

    if not os.path.isdir(SRC_DIR):
        print(f'ERROR: bundled data directory not found: {SRC_DIR}')
        return 1

    copied = skipped = 0
    for root, _dirs, files in os.walk(SRC_DIR):
        rel = os.path.relpath(root, SRC_DIR)
        out_dir = os.path.normpath(os.path.join(args.dest, rel))
        os.makedirs(out_dir, exist_ok=True)
        for name in files:
            dst = os.path.join(out_dir, name)
            if os.path.exists(dst) and not args.force:
                skipped += 1
                continue
            shutil.copy2(os.path.join(root, name), dst)
            copied += 1

    missing = [f for f in REQUIRED
               if not os.path.isfile(os.path.join(args.dest, f))]
    print(f'Seeded {args.dest}: {copied} file(s) copied, {skipped} skipped.')
    if missing:
        print('ERROR: still missing required files: ' + ', '.join(missing))
        return 1
    print('All required files present. To use this data set, add to .env:')
    print('  ITURHF_DATA_PATH=ionosphere/custom')
    print('then restart the dashboard.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
