# Build automation for the browser (WebAssembly / Pyodide) ffsubsync site.
# Runs entirely inside this worktree; never touches the main checkout.

SHELL := /bin/bash
WEB_DIR := $(CURDIR)
REPO_ROOT := $(abspath $(WEB_DIR)/..)
DIST := $(WEB_DIR)/dist/site
PYODIDE_VERSION := $(shell python3 -c "import json;print(json.load(open('build.config.json'))['pyodideVersion'])")
# node may be provided via nvm and absent from make's bare PATH; fall back to the
# newest nvm-installed node so `make` works outside an nvm-initialized shell.
NODE ?= $(shell command -v node 2>/dev/null || ls $(HOME)/.nvm/versions/node/*/bin/node 2>/dev/null | sort -V | tail -1)

# Deps the native correctness tests need (mirror build.config.json + the
# transitive libs ffsubsync imports at load time). webrtcvad-wheels is the native
# stand-in for the browser's wasm webrtcvad wheel.
TEST_DEPS := --with numpy --with pysubs2 --with srt --with ffmpeg-python \
             --with auditok --with webrtcvad-wheels --with charset-normalizer \
             --with rich --with tqdm

.PHONY: help vendor vendor-pypi site serve test test-audio test-browser clean \
        emsdk wheels webrtcvad-wheel cchardet-wheel

help:
	@echo "ffsubsync web (Pyodide=$(PYODIDE_VERSION)) targets:"
	@echo "  make vendor         bundle local ffsubsync + bridge -> vendor/py_sources.json"
	@echo "  make site           assemble deployable static bundle -> dist/site"
	@echo "  make serve          serve dist/site at http://localhost:8000"
	@echo "  make test           native correctness test: sub-vs-sub (uv, no browser)"
	@echo "  make test-audio     native correctness test: audio path VAD->align (uv)"
	@echo "  make test-browser   headless Pyodide sync test (Playwright; needs network)"
	@echo "  make clean          remove dist/ and generated vendor bundle"
	@echo "  --- Phase 2 (video/audio) ---"
	@echo "  make wheels         build webrtcvad (and optional cchardet) Pyodide wasm wheels"

vendor: vendor-pypi
	$(NODE) scripts/vendor.mjs

# Download the pure-Python PyPI deps as wheels so the runtime never needs PyPI.
vendor-pypi:
	bash scripts/vendor_pypi.sh

site: vendor
	rm -rf "$(DIST)"
	mkdir -p "$(DIST)"
	cp index.html build.config.json "$(DIST)/"
	cp -R src "$(DIST)/src"
	cp -R vendor "$(DIST)/vendor"
	# The browser loads Python only from vendor/py_sources.json; drop the raw
	# bridge source and any bytecode cache so dist ships just the JS + bundle.
	rm -rf "$(DIST)/src/__pycache__" "$(DIST)/src/ffsubsync_bridge.py"
	@echo "assembled $(DIST)"

serve: site
	@echo "serving $(DIST) at http://localhost:8000 (Ctrl-C to stop)"
	cd "$(DIST)" && python3 -m http.server 8000

# Native, offline-capable correctness gate. Drives the *same* bridge + ffsubsync
# the browser uses; proves the sub-vs-sub algorithm and glue independent of the
# Pyodide packaging.
test:
	cd "$(REPO_ROOT)" && uv run $(TEST_DEPS) python web/tests/native_bridge_test.py

# Native gate for the Phase 2 audio path (PCM -> real VAD -> align).
test-audio:
	cd "$(REPO_ROOT)" && uv run $(TEST_DEPS) python web/tests/native_audio_test.py

# Full browser path (loads Pyodide from CDN, installs wheels from PyPI). Requires
# network and Playwright; intended for CI. Falls back with a clear message.
test-browser: site
	$(NODE) tests/browser_sync.mjs
	$(NODE) tests/browser_audio.mjs

clean:
	rm -rf "$(WEB_DIR)/dist" "$(WEB_DIR)/vendor/py_sources.json"

# --- Phase 2: video/audio reference wasm wheels ------------------------------
# Build the webrtcvad wasm wheel (exact CLI-parity VAD). Needs network + a POSIX
# toolchain; intended for CI. The site works without it (auditok fallback).
wheels webrtcvad-wheel:
	bash scripts/build_wheels.sh

# emsdk setup is handled inside build_wheels.sh (matched to the pinned Pyodide).
emsdk:
	@echo "emsdk is installed on demand by 'make wheels' (see scripts/build_wheels.sh)."

cchardet-wheel:
	@echo "Phase 3 optional target (see the plan's encoding-detection wheel section)."
	@exit 1
