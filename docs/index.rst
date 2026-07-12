.. ffsubsync documentation master file, created by
   sphinx-quickstart on Mon Dec  2 17:06:18 2019.
   You can adapt this file completely to your liking, but it should at least
   contain the root `toctree` directive.

Welcome to FFsubsync's documentation!
=====================================

**FFsubsync** performs language-agnostic automatic synchronization of subtitles
with video, so that subtitles are aligned to the correct starting point within
the video.

.. list-table::
   :header-rows: 1

   * - Turn this...
     - ...into this
   * - .. image:: https://raw.githubusercontent.com/smacke/ffsubsync/master/resources/img/tearing-me-apart-wrong.gif
          :alt: Unsynchronized subtitles
     - .. image:: https://raw.githubusercontent.com/smacke/ffsubsync/master/resources/img/tearing-me-apart-correct.gif
          :alt: Synchronized subtitles

Point it at a video (or a correctly-synced subtitle file) and an out-of-sync
subtitle, and it figures out the time offset — and, if needed, a framerate
correction — that lines them up:

.. code-block:: console

   $ ffs video.mp4 -i unsynchronized.srt -o synchronized.srt

Prefer not to install anything? There is now a **browser version** that runs
ffsubsync entirely client-side via WebAssembly — nothing is uploaded, and your
files never leave your machine: https://smacke.github.io/ffsubsync. See :doc:`browser`.

The rest of these docs walk from a five-minute quickstart through the more
advanced knobs (reference types, voice-activity detectors, the bulk-sync quality
gate) and include a deep dive on :doc:`character encoding <encoding>`, an area
where ffsubsync is unusually robust compared to other subtitle sync tools.

New here? Start with :doc:`installation` and :doc:`usage`. Looking for a
specific flag? Jump to the :doc:`cli`.

.. toctree::
   :maxdepth: 2
   :caption: Contents:

   installation
   browser
   usage
   reference_types
   advanced
   encoding
   library
   how_it_works
   cli

Indices and tables
==================

* :ref:`genindex`
* :ref:`modindex`
* :ref:`search`
