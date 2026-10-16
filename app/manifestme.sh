#!/bin/bash
# manifestme.sh
#
# Write a Posit deployment manifest for this FastAPI app.
# Run from anywhere: ./manifestme.sh
#
# Never bundle secrets: .env is excluded from the manifest/checksum list.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

if command -v python3.11 >/dev/null 2>&1; then
  PY=python3.11
elif command -v python3 >/dev/null 2>&1; then
  PY=python3
else
  PY=python
fi

echo "Installing rsconnect-python (if needed) with ${PY}..."
"$PY" -m pip install -q rsconnect-python

# Prefer the rsconnect CLI on PATH (python -m rsconnect is not always a module).
if command -v rsconnect >/dev/null 2>&1; then
  RSC=rsconnect
else
  RSC="$("$PY" -c 'import shutil; print(shutil.which("rsconnect") or "")')"
  if [ -z "$RSC" ]; then
    echo "rsconnect CLI not found" >&2
    exit 1
  fi
fi

# Course Posit Connect exposes 3.12 (not 3.11). Override so the manifest
# requests ~=3.12.0 even if this laptop's default Python is 3.11.
echo "Writing manifest.json for FastAPI app (Python 3.12, excluding .env)..."
"$RSC" write-manifest fastapi . --entrypoint app:app --overwrite \
  --override-python-version 3.12.0 \
  -x '.env' \
  -x '.env.*' \
  -x '__pycache__' \
  -x '__pycache__/**' \
  -x '*.pyc' \
  -x '.DS_Store'

# Hard fail if a secret file ever lands in the manifest.
if grep -q '"\.env"' manifest.json; then
  echo "ERROR: manifest.json still lists .env — do not deploy or commit." >&2
  exit 1
fi

# rsconnect may write requires ==3.12.0; Connect usually wants a 3.12.x band.
"$PY" - <<'PY'
import json
from pathlib import Path
p = Path("manifest.json")
m = json.loads(p.read_text())
m["python"]["version"] = "3.12.0"
m.setdefault("environment", {}).setdefault("python", {})["requires"] = "~=3.12.0"
p.write_text(json.dumps(m, indent=2) + "\n")
print("patched environment.python.requires -> ~=3.12.0")
PY

echo "Done. manifest.json created in: $SCRIPT_DIR"
echo "Confirm .env is NOT listed above; then commit manifest.json before deploy."
