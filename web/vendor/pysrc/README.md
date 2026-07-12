# Vendored pure-Python modules

These modules are dependencies of ffsubsync that are published on PyPI as an
**sdist only** (no pure-Python wheel), so `micropip` — which installs wheels —
cannot fetch them at runtime. They are pure Python, so we bundle their source
directly into the Pyodide filesystem via `scripts/vendor.mjs`.

- `srt.py` — the [`srt`](https://pypi.org/project/srt/) library (MIT licensed),
  a single-module SRT parser/composer. Upstream: https://github.com/cdown/srt

To update: reinstall the desired version into a scratch dir and copy the module
here, e.g. `uv pip install --target /tmp/x srt && cp /tmp/x/srt.py srt.py`.
