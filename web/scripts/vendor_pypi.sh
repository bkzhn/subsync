#!/usr/bin/env bash
# Download the pure-Python PyPI dependencies (from build.config.json:vendorPypi)
# and their transitive deps as universal wheels into vendor/wheels/, so the site
# installs them offline via micropip and never contacts PyPI at runtime (which
# matters where PyPI is blocked, e.g. behind some VPNs). Same approach as the
# ipyflow/pipescript JupyterLite builds.
#
# Runs at build time (make vendor), where PyPI must be reachable; the *deployed*
# site then needs no PyPI access.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WEB_DIR="$(cd "$HERE/.." && pwd)"
CONFIG="$WEB_DIR/build.config.json"
WHEELS="$WEB_DIR/vendor/wheels"
mkdir -p "$WHEELS"

PKGS="$(python3 -c "import json;print(' '.join(json.load(open('$CONFIG'))['vendorPypi']))")"

# Bootstrap pip if the active interpreter lacks it (uv venvs ship without pip).
python3 -m pip --version >/dev/null 2>&1 \
  || python3 -m ensurepip --upgrade >/dev/null 2>&1 \
  || { command -v uv >/dev/null 2>&1 && uv pip install pip; }

echo "==> downloading PyPI wheels: $PKGS"
# Download into a temp dir, then copy only universal (pure-Python) wheels into
# vendor/wheels — so we never disturb the platform-specific webrtcvad wasm wheel
# that already lives there.
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
# --implementation py --abi none --platform any -> only universal wheels, which is
# all we can run in Pyodide anyway.
python3 -m pip download --only-binary=:all: \
  --implementation py --abi none --platform any \
  $PKGS -d "$TMP"
for w in "$TMP"/*-none-any.whl; do
  [ -e "$w" ] && cp "$w" "$WHEELS/"
done
echo "==> vendor/wheels now has $(ls "$WHEELS"/*.whl 2>/dev/null | wc -l | tr -d ' ') wheel(s)"
