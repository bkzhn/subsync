#!/usr/bin/env bash
# Build the Pyodide (Emscripten/wasm32) wheels for ffsubsync's C-extension deps,
# so the browser can use the same native libraries as the CLI:
#   * webrtcvad — exact CLI-parity VAD (py-webrtcvad's vendored WebRTC VAD C source)
#   * cchardet  — exact CLI-parity encoding detection (faust-cchardet / uchardet C++)
# Output: web/vendor/wheels/{webrtcvad,faust_cchardet}-*-<abi>.whl
#
# This needs network + a POSIX toolchain and is intended for CI (Linux). It is
# idempotent-ish: rerunning rebuilds into a clean temp dir.
#
# Requirements:
#   * a Python 3.13 host interpreter (Pyodide 0.28.x's cross-build env requires it)
#   * builds on Linux; macOS host SDK headers leak into emcc and break the build
#
# Usage: build_wheels.sh [webrtcvad|cchardet|all]   (default: all)
# Pins are read from web/build.config.json.
set -euo pipefail

WHICH="${1:-all}"

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WEB_DIR="$(cd "$HERE/.." && pwd)"
CONFIG="$WEB_DIR/build.config.json"

read_cfg() { python3 -c "import json,sys;print(json.load(open('$CONFIG'))$1)"; }
PYODIDE_VERSION="$(read_cfg "['pyodideVersion']")"
PY_WEBRTCVAD_REF="$(read_cfg "['pyWebrtcvadRef']")"
FAUST_CCHARDET_REF="$(read_cfg "['faustCchardetRef']")"
PYODIDE_ABI_TAG="$(read_cfg "['pyodideAbiTag']")"

WHEEL_OUT="$WEB_DIR/vendor/wheels"
mkdir -p "$WHEEL_OUT"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# --- shared cross-build toolchain -------------------------------------------
# Install pyodide-build + a matching Emscripten SDK once, reused by every wheel.
_TOOLCHAIN_READY=""
setup_toolchain() {
  [ -n "$_TOOLCHAIN_READY" ] && return
  echo "==> setting up cross-build toolchain (pyodide=$PYODIDE_VERSION)"
  python3 -m pip install --quiet --upgrade pyodide-build wheel
  pyodide xbuildenv install "$PYODIDE_VERSION"
  local emver
  emver="$(pyodide config get emscripten_version)"
  echo "==> emscripten $emver"
  git clone --quiet --depth 1 https://github.com/emscripten-core/emsdk "$WORK/emsdk"
  "$WORK/emsdk/emsdk" install "$emver"
  "$WORK/emsdk/emsdk" activate "$emver"
  # shellcheck disable=SC1091
  source "$WORK/emsdk/emsdk_env.sh"
  _TOOLCHAIN_READY=1
}

# retag_and_publish <build_dir>
# Recent pyodide-build (>= PEP 783) tags wheels `pyemscripten_2025_0_wasm32`, but
# the pinned Pyodide runtime advertises the *same* ABI under its pre-rename name
# and rejects the new spelling ("built with Emscripten vpyemscripten.2025.0 but
# Pyodide was built with Emscripten v4.0.9"). Retag to the runtime's ABI tag.
# This is a pure rename of an identical ABI (verified: the retagged wheel installs
# and imports in the 0.28.x runtime). Then copy the wheel into the site vendor dir.
retag_and_publish() {
  local dir="$1"
  if ! ls "$dir"/dist/*-"$PYODIDE_ABI_TAG".whl >/dev/null 2>&1; then
    python3 -m wheel tags --platform-tag "$PYODIDE_ABI_TAG" --remove "$dir"/dist/*.whl
  fi
  cp "$dir"/dist/*.whl "$WHEEL_OUT/"
}

# --- webrtcvad ---------------------------------------------------------------
build_webrtcvad() {
  echo "==> building webrtcvad wasm wheel (py-webrtcvad=$PY_WEBRTCVAD_REF)"
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
  popd >/dev/null
  retag_and_publish "$WORK/py-webrtcvad"
}

# --- faust-cchardet (uchardet C++) -------------------------------------------
build_cchardet() {
  echo "==> building cchardet wasm wheel (faust-cchardet=$FAUST_CCHARDET_REF)"
  git clone --quiet --depth 1 --branch "$FAUST_CCHARDET_REF" \
    https://github.com/faust-streaming/cChardet "$WORK/cChardet"
  pushd "$WORK/cChardet" >/dev/null

  # Unlike py-webrtcvad (vendored C), faust-cchardet keeps the uchardet C++ sources
  # in a git submodule (src/ext/uchardet). setup.py globs that dir for *.cpp, so the
  # submodule MUST be checked out or the extension has no sources to compile.
  git submodule update --init --recursive --depth 1
  ls src/ext/uchardet/src/*.cpp >/dev/null 2>&1 \
    || { echo "uchardet submodule not populated (no .cpp sources)"; exit 1; }

  # uchardet is portable, arch-neutral C++ (no `#error for your architecture`
  # branches), so no wasm source patch is needed today. If a future emcc build
  # fails on an arch/#error, add the minimal fix here — cf. webrtcvad's typedefs.h
  # patch above. setup.py adds `-lstdc++` on Linux hosts; emcc treats that as
  # built-in and ignores it, so it is harmless under the wasm cross-build.

  pyodide build
  popd >/dev/null
  retag_and_publish "$WORK/cChardet"
}

# --- driver ------------------------------------------------------------------
case "$WHICH" in
  webrtcvad)
    setup_toolchain
    build_webrtcvad
    ;;
  cchardet)
    setup_toolchain
    build_cchardet
    ;;
  all)
    setup_toolchain
    # webrtcvad first so a cchardet hiccup never costs us the (critical) VAD wheel.
    build_webrtcvad
    # cchardet is best-effort: the site falls back to charset-normalizer for
    # encoding detection when the wheel is absent, so a failure must not abort the
    # build or drop the webrtcvad wheel. Warn and continue (exit 0).
    set +e
    build_cchardet
    cchardet_rc=$?
    set -e
    if [ "$cchardet_rc" -ne 0 ]; then
      echo "==> WARNING: cchardet wasm wheel build failed (rc=$cchardet_rc);" \
           "site falls back to charset-normalizer for encoding detection" >&2
    fi
    ;;
  *)
    echo "usage: $(basename "$0") [webrtcvad|cchardet|all]" >&2
    exit 2
    ;;
esac

echo "==> wrote:"
ls -1 "$WHEEL_OUT"/*.whl
