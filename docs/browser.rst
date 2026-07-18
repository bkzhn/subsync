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

Video / audio references use WebRTC VAD — the same as the CLI default — compiled to
WebAssembly. If that component is unavailable, video / audio references are disabled
(subtitle references still work); use the command-line tool for those. See
:ref:`vad-backends` for background on the detectors.

Everything the command-line tool does is still available locally; the browser build
simply packages the same ffsubsync code to run without an install.

Privacy
-------

All syncing happens locally in your browser tab; your subtitle and video / audio
files are read directly from disk into the page and are never uploaded. Two kinds of
network traffic do occur:

- the one-time download of the WebAssembly runtime and support libraries; and
- anonymous, aggregate `Google Analytics <https://www.googletagmanager.com>`_ usage
  events — that a sync was started or completed, that the output was downloaded,
  whether the reference was a subtitle or a video / audio file, and which options
  (``--gss``, ``--no-fix-framerate``, ``--split-penalty``) were toggled — so the
  maintainer can see how often each feature is used.

**Filenames, file contents, and file sizes are never sent over the network.** The
command-line tool makes no analytics calls at all.

For developers
--------------

The site is a static bundle built from the ``web/`` directory of the
`repository <https://github.com/smacke/ffsubsync>`_. See ``web/README.md`` for how
to build it (``make site``), serve it locally (``make serve``), and run the tests
(``make test``).
