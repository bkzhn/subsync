#!/usr/bin/env bash
# Build the webrtcvad Pyodide (Emscripten/wasm32) wheel from py-webrtcvad's
# vendored WebRTC VAD C source, so the browser can use the same default VAD as
# the CLI. Output: web/vendor/wheels/webrtcvad-*-wasm32.whl
#
# This needs network + a POSIX toolchain and is intended for CI (Linux). It is
# idempotent-ish: rerunning rebuilds into a clean temp dir.
#
# Requirements:
#   * a Python 3.13 host interpreter (Pyodide 0.28.x's cross-build env requires it)
#   * builds on Linux; macOS host SDK headers leak into emcc and break the build
#
# Pins are read from web/build.config.json (pyodideVersion, pyWebrtcvadRef).
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WEB_DIR="$(cd "$HERE/.." && pwd)"
CONFIG="$WEB_DIR/build.config.json"

read_cfg() { python3 -c "import json,sys;print(json.load(open('$CONFIG'))$1)"; }
PYODIDE_VERSION="$(read_cfg "['pyodideVersion']")"
PY_WEBRTCVAD_REF="$(read_cfg "['pyWebrtcvadRef']")"
PYODIDE_ABI_TAG="$(read_cfg "['pyodideAbiTag']")"

WHEEL_OUT="$WEB_DIR/vendor/wheels"
mkdir -p "$WHEEL_OUT"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
echo "==> building webrtcvad wasm wheel (pyodide=$PYODIDE_VERSION, py-webrtcvad=$PY_WEBRTCVAD_REF)"

# 1. Cross-build toolchain: pyodide-build + a matching Emscripten SDK.
python3 -m pip install --quiet --upgrade pyodide-build
pyodide xbuildenv install "$PYODIDE_VERSION"
EMSCRIPTEN_VERSION="$(pyodide config get emscripten_version)"
echo "==> emscripten $EMSCRIPTEN_VERSION"

git clone --quiet --depth 1 https://github.com/emscripten-core/emsdk "$WORK/emsdk"
"$WORK/emsdk/emsdk" install "$EMSCRIPTEN_VERSION"
"$WORK/emsdk/emsdk" activate "$EMSCRIPTEN_VERSION"
# shellcheck disable=SC1091
source "$WORK/emsdk/emsdk_env.sh"

# 2. Fetch py-webrtcvad at the pinned tag and cross-compile it to a wheel.
git clone --quiet --depth 1 --branch "$PY_WEBRTCVAD_REF" \
  https://github.com/wiseman/py-webrtcvad "$WORK/py-webrtcvad"
pushd "$WORK/py-webrtcvad" >/dev/null

# WebRTC's typedefs.h enumerates x86/ARM/MIPS/pnacl but not wasm32, so it hits
# `#error Please add support for your architecture`. wasm32 is little-endian and
# 32-bit; add a branch for it before the #else so the build recognizes the target.
perl -0pi -e 's/#else\n#error Please add support for your architecture in typedefs\.h/#elif defined(__wasm__) || defined(__wasm32__) || defined(__EMSCRIPTEN__)\n#define WEBRTC_ARCH_32_BITS\n#define WEBRTC_ARCH_LITTLE_ENDIAN\n#else\n#error Please add support for your architecture in typedefs.h/' \
  cbits/webrtc/typedefs.h
grep -q "__wasm__" cbits/webrtc/typedefs.h || { echo "typedefs.h wasm patch failed"; exit 1; }

pyodide build

# Recent pyodide-build (>= PEP 783) tags wheels `pyemscripten_2025_0_wasm32`, but
# the pinned Pyodide runtime advertises the *same* ABI under its pre-rename name
# and rejects the new spelling ("built with Emscripten vpyemscripten.2025.0 but
# Pyodide was built with Emscripten v4.0.9"). Retag to the runtime's ABI tag.
# This is a pure rename of an identical ABI (verified: the retagged wheel installs
# and imports in the 0.28.x runtime).
if ! ls dist/*-"$PYODIDE_ABI_TAG".whl >/dev/null 2>&1; then
  python3 -m pip install --quiet wheel
  python3 -m wheel tags --platform-tag "$PYODIDE_ABI_TAG" --remove dist/*.whl
fi
popd >/dev/null

# 3. Publish the wheel into the site's vendor dir.
cp "$WORK"/py-webrtcvad/dist/*.whl "$WHEEL_OUT/"
echo "==> wrote:"
ls -1 "$WHEEL_OUT"/*.whl
