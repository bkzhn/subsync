In your browser
===============

ffsubsync can run **entirely in your web browser**, with no backend server and
nothing to install — not even Python or ffmpeg. The Python code is compiled to
WebAssembly and executed client-side via `Pyodide <https://pyodide.org>`_, so your
subtitle files never leave your machine (nothing is uploaded anywhere).

.. rubric:: 👉 https://smacke.github.io/ffsubsync

How to use it
-------------

#. Open https://smacke.github.io/ffsubsync. On first visit the page downloads the
   WebAssembly runtime (a few megabytes); afterwards it is cached.
#. Pick the **reference type** — a correctly-synced subtitle file, or a video / audio
   file.
#. Choose the **reference** (subtitle, or the movie / audio track) and the
   **subtitles to sync** (the out-of-sync file you want to fix).
#. Click **Sync subtitles**, then download the corrected file. The detected time
   offset (and framerate correction, if any) is shown alongside the result.

Subtitle references align two subtitle files by cross-correlating their speech
patterns — pure numeric computation, no audio needed. Video / audio references are
decoded to audio in the browser with `ffmpeg.wasm <https://ffmpegwasm.netlify.app/>`_
and run through a voice-activity detector, exactly as the command-line tool does.

Large video files
-----------------

Nothing is uploaded, and large references are **not** loaded whole into memory: the
file is mounted into ffmpeg.wasm via WORKERFS, which reads it lazily as needed, so
only the (downsampled) decoded audio occupies memory. Multi-gigabyte movies work.

Voice-activity detection
------------------------

The default detector is WebRTC VAD — the same as the CLI default — compiled to
WebAssembly. If that component is unavailable the site automatically falls back to the
pure-Python ``auditok`` energy detector. See :ref:`vad-backends` for the difference.

Everything the command-line tool does is still available locally; the browser build
simply packages the same ffsubsync code to run without an install.

Privacy
-------

All processing happens locally in your browser tab. The only network traffic is the
one-time download of the WebAssembly runtime and support libraries; your subtitle
files are read directly from disk into the page and never transmitted.

For developers
--------------

The site is a static bundle built from the ``web/`` directory of the
`repository <https://github.com/smacke/ffsubsync>`_. See ``web/README.md`` for how
to build it (``make site``), serve it locally (``make serve``), and run the tests
(``make test``).
