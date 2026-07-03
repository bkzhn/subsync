Using ffsubsync as a library
============================

Everything the command line does is available programmatically through
:func:`ffsubsync.run`. It accepts an :class:`argparse.Namespace` — the easiest way
to build one is to parse an argument list with the same parser the CLI uses.

.. code-block:: python

   import ffsubsync
   from ffsubsync.ffsubsync import make_parser

   args = make_parser().parse_args(["ref.mkv", "-i", "in.srt", "-o", "out.srt"])
   result = ffsubsync.run(args)

   print(result["sync_was_successful"])
   print(result["offset_seconds"], result["framerate_scale_factor"])

``run`` returns a dictionary describing the outcome: ``retval`` (a process-style
exit code), ``sync_was_successful``, and the computed ``offset_seconds`` and
``framerate_scale_factor``.

Reporting progress
------------------

To surface progress in your own UI, pass a ``progress_handler``. It is called
repeatedly while the reference audio is being decoded with a
:class:`~ffsubsync.speech_transformers.ProgressInfo`:

.. code-block:: python

   import ffsubsync
   from ffsubsync.ffsubsync import make_parser

   def on_progress(info: ffsubsync.ProgressInfo) -> None:
       # info.processed_seconds / info.total_seconds (total may be None);
       # info.fraction is a 0.0-1.0 ratio (None when the total is unknown).
       if info.fraction is not None:
           print(f"{info.fraction:.0%}")

   args = make_parser().parse_args(["ref.mkv", "-i", "in.srt", "-o", "out.srt"])
   result = ffsubsync.run(args, progress_handler=on_progress)

The handler is invoked only for the video/audio reference path (the dominant cost
of a sync); the subtitle-reference path is effectively instantaneous. Exceptions
raised inside the handler are logged and swallowed, so a buggy handler can never
abort syncing.

API reference
-------------

.. autofunction:: ffsubsync.run

.. autoclass:: ffsubsync.ProgressInfo
   :members:
