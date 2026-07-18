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

## The wasm wheels (webrtcvad + cchardet)

`make wheels` cross-compiles ffsubsync's C-extension deps to Pyodide `wasm32` wheels (see
`scripts/build_wheels.sh`) so the browser uses the same native libraries as the CLI:

- **webrtcvad** — from [py-webrtcvad](https://github.com/wiseman/py-webrtcvad); the same
  default VAD as the CLI. When absent, video/audio references are disabled (subtitle
  references still work).
- **cchardet** — from [faust-cchardet](https://github.com/faust-streaming/cChardet) (a
  Cython wrapper around the uchardet C++ library, kept in a git submodule). Gives exact
  CLI-parity encoding detection: `subtitle_parser` prefers `cchardet` over
  `charset-normalizer`. When absent, `charset-normalizer` (a Pyodide core package) handles
  detection in-browser, so this wheel is best-effort — a build failure never blocks deploy.

Building needs network + a POSIX toolchain (emsdk is installed on demand) and a Python 3.13
host, so it normally runs in CI; the built `.whl`s land in `vendor/wheels/` and are served
with the site. `make webrtcvad-wheel` / `make cchardet-wheel` build just one. Version pins
(Pyodide, py-webrtcvad, faust-cchardet, ffmpeg.wasm) all live in `build.config.json`.
