# ffsubsync in the browser (WebAssembly / Pyodide)

A backendless static site that runs [ffsubsync](https://github.com/smacke/ffsubsync)
entirely client-side via [Pyodide](https://pyodide.org). Subtitle files never leave
the user's machine.

## 👉 Try it: https://smacke.github.io/ffsubsync

No install, no upload. Pick a correctly-synced reference subtitle and an out-of-sync
subtitle, click **Sync subtitles**, and download the corrected file. First load pulls
the WebAssembly runtime (a few MB) from a CDN and caches it. To run it locally instead,
see [Build & run](#build--run) below.

**Status.**
- **Phase 1 — subtitle-vs-subtitle:** stable. Pure numpy + subtitle parsing (no ffmpeg,
  no VAD).
- **Phase 2 — video/audio reference:** implemented. Audio is decoded in-browser by
  `ffmpeg.wasm` (large files mounted lazily via WORKERFS, never loaded whole into
  memory), then WebRTC VAD builds the reference speech signal. The VAD ships as a
  cross-compiled `webrtcvad` wasm wheel (built in CI); when it is unavailable, video/
  audio references are disabled and the UI says so (subtitle references still work).
  ffsubsync's other VAD, `auditok`, is **not** bundled: it has no PyPI wheel and is
  GPLv3, which would relicense this MIT site. The Python pipeline is covered by native
  tests; the ffmpeg.wasm decode is exercised in a real browser via CI.

## How it works

- The **local** `ffsubsync/` package (this checkout, not the PyPI wheel) is bundled by
  `scripts/vendor.mjs` into `vendor/py_sources.json` and written into the Pyodide
  filesystem at runtime — so the site matches this repo's ffsubsync exactly.
- `src/ffmpeg_decode.mjs` decodes a video/audio reference to mono PCM with ffmpeg.wasm;
  `src/ffsubsync_bridge.py:sync_with_audio` runs the VAD over that PCM and rejoins the
  standard alignment path.
- `src/ffsubsync_bridge.py` is a thin, runtime-agnostic entry point that drives the real
  `ffsubsync.run(...)` the same way the CLI does, over Pyodide's in-memory filesystem.
- `src/ffsubsync_engine.mjs` boots Pyodide (numpy via `loadPackage`; `pysubs2` / `srt` /
  `ffmpeg-python` / `auditok` via `micropip`), loads the bundle, and calls the bridge.
- `src/worker.js` runs all of that in a Web Worker; `src/main.js` + `index.html` are the UI.

Version pins (Pyodide, pip packages) live in one place: `build.config.json`.

## Build & run

```sh
make site     # bundle sources + assemble dist/site
make serve    # build, then serve dist/site at http://localhost:8000
```

Open http://localhost:8000, pick a correctly-timed reference subtitle and an out-of-sync
subtitle, and download the synced result. First load pulls the Pyodide runtime (a few MB)
from the CDN and the pure-Python wheels from PyPI; after that it is cached.

## Test

```sh
make test          # native gate: sub-vs-sub alignment (uv, offline)
make test-audio    # native gate: audio path PCM -> real VAD -> align (uv, offline)
make test-browser  # full Pyodide path in headless Chromium (Playwright; needs network)
```

CI (`.github/workflows/build-site.yml`) runs the native + browser tests, cross-compiles
the webrtcvad wasm wheel, builds the bundle, and deploys `dist/site` to GitHub Pages. The
ffmpeg core is kept single-threaded so Pages needs no COOP/COEP headers.

## The webrtcvad wasm wheel

`make wheels` cross-compiles [py-webrtcvad](https://github.com/wiseman/py-webrtcvad) to a
Pyodide `wasm32` wheel (see `scripts/build_wheels.sh`) so the browser uses the same default
VAD as the CLI. It needs network + a POSIX toolchain (emsdk is installed on demand), so it
normally runs in CI; the built `.whl` lands in `vendor/wheels/` and is served with the site.
When the wheel is absent, video/audio references are disabled (subtitle references still
work). Version pins (Pyodide, py-webrtcvad, ffmpeg.wasm) all live in `build.config.json`.

## Phase 3 (optional)

- `make cchardet-wheel` — a `cchardet` (uchardet C++) wasm wheel for exact CLI-parity
  encoding detection. Not needed: `charset-normalizer` already handles detection in-browser.
