#!/bin/bash

# testme.sh — run the FastAPI app locally (no arguments).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Prefer a working Python 3 with uvicorn (Homebrew python3 may lack pip).
if command -v python3.11 >/dev/null 2>&1; then
  PY=python3.11
elif command -v python3 >/dev/null 2>&1; then
  PY=python3
else
  PY=python
fi

"$PY" -m uvicorn app:app --host 0.0.0.0 --port 8000
