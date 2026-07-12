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
#. Choose a **reference subtitle** — a correctly-synced ``.srt`` (or ``.ass`` /
   ``.ssa`` / etc.) in any language.
#. Choose the **subtitles to sync** — the out-of-sync file you want to fix.
#. Click **Sync subtitles**, then download the corrected file. The detected time
   offset (and framerate correction, if any) is shown alongside the result.

This is the reference-subtitle workflow described in :doc:`reference_types`: it
aligns two subtitle files by cross-correlating their speech patterns, which is
pure numeric computation and needs neither ffmpeg nor audio extraction.

Current scope and roadmap
-------------------------

The browser version currently supports **subtitle-vs-subtitle** syncing. Syncing
directly against a **video or audio** reference in the browser is in progress: it
requires decoding audio with `ffmpeg.wasm <https://ffmpegwasm.netlify.app/>`_ and a
WebAssembly voice-activity detector. Until that lands, use the command-line tool
(see :doc:`installation`) for video/audio references.

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
