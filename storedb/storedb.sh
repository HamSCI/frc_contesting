#!/bin/bash
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$REPO_DIR/venv/bin/activate"
python3 "$REPO_DIR/storedb/storedb.py"
