Installation
============

ffsubsync is a Python package that shells out to `ffmpeg <https://www.ffmpeg.org/>`_
for audio extraction. Installation is therefore two steps: install ffmpeg, then
install the Python package.

Install ffmpeg
--------------

ffmpeg (and its companion ``ffprobe``) must be available before ffsubsync can
read a video or audio reference. On macOS with `Homebrew <https://brew.sh/>`_:

.. code-block:: console

   $ brew install ffmpeg

On Debian/Ubuntu:

.. code-block:: console

   $ sudo apt install ffmpeg

Windows users should make sure ``ffmpeg`` is on the ``PATH`` and can be invoked
from the command line. If ffmpeg lives somewhere unusual, you can always point
ffsubsync at it explicitly with ``--ffmpeg-path`` (see :doc:`advanced`).

.. note::

   ffmpeg is only required when the reference is a video or audio file. If you
   sync against an already-correct subtitle file (see :doc:`reference_types`),
   no audio is extracted and ffmpeg is not needed.

Install ffsubsync
-----------------

ffsubsync is compatible with Python 3.6 and newer. Grab it from PyPI:

.. code-block:: console

   $ pip install ffsubsync

Installing the package registers three equivalent console commands — ``ffs``,
``subsync``, and ``ffsubsync`` — all of which do the same thing. The rest of
these docs use ``ffs`` for brevity.

To live on the bleeding edge, install the latest revision straight from GitHub:

.. code-block:: console

   $ pip install git+https://github.com/smacke/ffsubsync@latest

The optional torch extra
------------------------

The neural ``silero`` and ``fused`` voice-activity detectors (see
:ref:`vad-backends`) require `PyTorch <https://pytorch.org/>`_, which is **not**
installed by default because it is large. Pull it in with the ``torch`` extra:

.. code-block:: console

   $ pip install "ffsubsync[torch]"

or install ``torch`` yourself alongside a plain ffsubsync install. The default
WebRTC detector needs none of this.

Encoding detectors
------------------

The character-encoding detectors ffsubsync uses to read subtitle files are
ordinary dependencies and install automatically. There is one cross-version
wrinkle — the fastest detector is only available on Python < 3.13 — which is
covered in detail in :doc:`encoding`.

Docker
------

Prebuilt images are published to the GitHub Container Registry if you would
rather not install anything locally:

.. code-block:: console

   $ docker pull ghcr.io/smacke/ffsubsync:latest
   $ docker run --rm -v "$PWD":/video ghcr.io/smacke/ffsubsync:latest \
       video.mp4 -i unsynchronized.srt -o synchronized.srt

Mount the directory containing your video and subtitles into ``/video``. You can
also build the image yourself from a checkout with ``docker build -t ffsubsync .``,
optionally pinning a released version with
``--build-arg FFSUBSYNC_VERSION=0.4.31``.
