# ffsubsync in the browser (WebAssembly / Pyodide)

A backendless static site that runs [ffsubsync](https://github.com/smacke/ffsubsync)
entirely client-side via [Pyodide](https://pyodide.org). Subtitle files never leave
the user's machine.

## 👉 Try it: https://smacke.github.io/ffsubsync

No install, no upload. Pick a correctly-synced reference subtitle and an out-of-sync
subtitle, click **Sync subtitles**, and download the corrected file. First load pulls
the WebAssembly runtime (a few MB) from a CDN and caches it. To run it locally instead,
see [Build & run](#build--run) below.

**Status: Phase 1 — subtitle-vs-subtitle sync.** This path is pure numpy + subtitle
parsing (no ffmpeg, no VAD), so it works today with only pure-Python deps. Video/audio
references (ffmpeg.wasm + a `webrtcvad` wasm wheel) are Phase 2 — see the project plan.

## How it works

- The **local** `ffsubsync/` package (this checkout, not the PyPI wheel) is bundled by
  `scripts/vendor.mjs` into `vendor/py_sources.json` and written into the Pyodide
  filesystem at runtime — so the site matches this repo's ffsubsync exactly.
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
make test          # native correctness gate (uv) — drives the same bridge + ffsubsync,
                   # proves the sub-vs-sub algorithm offline, no browser needed
make test-browser  # full Pyodide path in headless Chromium (Playwright; needs network)
```

CI (`.github/workflows/build-site.yml`) runs both, builds the bundle, and deploys
`dist/site` to GitHub Pages on the `web-wasm` branch. The ffmpeg core is kept
single-threaded so Pages needs no COOP/COEP headers.

## Phase 2 (planned)

- `make webrtcvad-wheel` — build a `webrtcvad` Pyodide wasm wheel from the vendored WebRTC
  VAD C source (exact CLI-parity VAD; `auditok` is the pure-Python fallback).
- ffmpeg.wasm audio decode (large local files via WORKERFS, read lazily — never loaded
  whole into memory) → PCM → VAD → same aligner.
