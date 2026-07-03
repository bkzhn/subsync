Advanced options
================

This page groups the more advanced flags by the problem they solve. For the
exhaustive, auto-generated list of every option, see the :doc:`cli` reference.

.. _framerate-correction:

Framerate correction
--------------------

Subtitles authored against a differently-encoded copy of a video (for example,
25 fps PAL subtitles played over a 23.976 fps release) drift progressively: they
start roughly aligned but grow more and more out of sync toward the end. A single
constant offset can't fix this — the *rate* is wrong, not just the start point.

By default ffsubsync tries a handful of common framerate ratios in addition to a
straight offset, so ordinary PAL/NTSC-style mismatches are corrected
automatically. Two flags adjust this behavior:

- ``--gss`` uses `golden-section search
  <https://en.wikipedia.org/wiki/Golden-section_search>`_ to hunt for the optimal
  framerate ratio continuously, instead of only evaluating the handful of common
  discrete ratios. Reach for it when you suspect a framerate mismatch that the
  default ratios don't cover.
- ``--no-fix-framerate`` disables framerate correction entirely and assumes the
  reference and subtitles share a framerate. This constrains the search to a pure
  offset, which can help when a spurious framerate "correction" is making a
  borderline sync worse.
- ``--skip-infer-framerate-ratio`` leaves the discrete-ratio search in place but
  skips the heuristic that guesses a ratio from the reference/subtitle duration
  ratio.

.. _vad-backends:

Voice-activity detectors (``--vad``)
------------------------------------

When the reference is video or audio, ffsubsync labels speech with a
voice-activity detector. ``--vad`` selects the backend:

``webrtc`` (default fallback)
   The VAD built into `WebRTC <https://webrtc.org/>`_ — fast, dependency-light,
   and a good default. This is what the default ``subs_then_webrtc`` falls back
   to when no embedded subtitles are present.

``auditok``
   An energy-based detector from `auditok
   <https://github.com/amsehili/auditok>`_. It detects *all* audio rather than
   voice specifically, which is usually worse but can outperform a true VAD on
   low-quality audio where speech detection struggles. (auditok is GPLv3 and is
   imported lazily only when selected.)

``silero``
   The neural `silero <https://github.com/snakers4/silero-vad>`_ VAD. More robust
   on noisy audio, but requires PyTorch — install it with the ``torch`` extra
   (see :doc:`installation`).

``fused``, ``fused:weighted``, ``fused:intersection``, ``fused:union``
   Combine the WebRTC and silero detectors. ``weighted`` (the default ``fused``
   strategy) blends them as ``0.6 * silero + 0.4 * webrtc``; ``intersection``
   marks speech only where *both* agree (conservative); ``union`` marks speech
   where *either* fires (aggressive). These also require the ``torch`` extra.

Each detector also has a ``subs_then_`` variant that prefers embedded text
subtitles before falling back to that audio VAD; see :doc:`reference_types`.

.. _quality-gate:

The quality gate (bulk syncing)
-------------------------------

When syncing many files unattended, a confidently-wrong sync is worse than no
change at all. ``--skip-sync-on-low-quality`` leaves the subtitles untouched when
the winning alignment looks untrustworthy, instead of writing a probably-wrong
result. Three thresholds define "untrustworthy":

- ``--min-score`` (default ``0.0``) rejects alignments scoring below the given
  value. The score's magnitude isn't normalized, but its *sign* is meaningful, so
  the default of ``0.0`` rejects only anti-correlated (clearly wrong) alignments.
- ``--quality-max-offset-seconds`` (default ``30.0``) rejects an alignment whose
  offset exceeds this many seconds, on the assumption that huge shifts are
  usually spurious.
- ``--max-framerate-deviation`` (default ``0.1``) rejects an alignment whose
  framerate scale factor deviates from 1.0 by more than this. The default permits
  every framerate correction ffsubsync would legitimately make, so it never
  rejects a real one; tighten it only when you know the framerate should not
  change.

When an alignment is rejected, ffsubsync writes the original, unshifted
subtitles and reports the sync as unsuccessful.

.. _long-and-remote-references:

Long and remote references
--------------------------

Extracting audio from a long — or remotely-streamed — reference is the slow part
of a sync. Three flags cut that cost:

- ``--max-duration-seconds N`` processes only the first ``N`` seconds of the
  reference (measured from ``--start-seconds``). Because ffmpeg stops reading —
  and therefore downloading — once that duration is reached, this is especially
  effective for remote references.

  .. code-block:: console

     $ ffs "https://example.com/video.mp4" -i in.srt -o out.srt --max-duration-seconds 600

- ``--extract-audio-first`` copies the remote audio track to a local temp file
  (no re-encode) before running detection, instead of holding a network stream
  open throughout. On flaky connections this is often more stable. It is ignored
  for local references and composes with ``--max-duration-seconds``.

- ``--multi-segment-sync`` samples several short segments spread across the whole
  reference and runs detection on just those. Unlike ``--max-duration-seconds``,
  it can still catch desync that only appears later in the runtime, because each
  segment keeps its true timeline position — so the framerate-ratio and offset
  search is unchanged and a framerate mismatch is still corrected.

  .. code-block:: console

     $ ffs "https://example.com/video.mp4" -i in.srt -o out.srt --multi-segment-sync

  Tune it with ``--segment-count N`` (default 8), ``--skip-intro-outro`` (skip the
  first 30 s and last 60 s, which often lack dialogue), and ``--parallel-workers N``
  (overlap segment downloads, default 4). It applies to video/audio references
  only.

Applying a fixed offset
-----------------------

``--apply-offset-seconds N`` adds a constant ``N``-second shift to the computed
offset. Combined with a reference, it nudges the automatic result. With **no**
reference, it becomes a pure manual shift with no alignment step at all:

.. code-block:: console

   $ ffs -i in.srt -o out.srt --apply-offset-seconds 3.5

Reusing a speech signal
-----------------------

``--serialize-speech`` saves the reference's computed speech signal to a
compressed ``<reference>.npz`` array. You can then pass that ``.npz`` back as the
reference (see :doc:`reference_types`) to sync additional subtitles against the
same video without re-decoding its audio.

``--make-test-case`` goes further, bundling the serialized speech together with
the input and output subtitles into an archive — useful for filing a reproducible
bug report.

Other useful flags
------------------

- ``--overwrite-input`` rewrites the input subtitle in place instead of writing a
  separate output file. Required when you pass multiple ``-i`` inputs.
- ``--merge-with-reference`` merges the reference subtitles into the synced
  output (valid only when the reference is itself a subtitle file).
- ``--extract-subs-from-stream`` skips syncing altogether and just extracts a
  subtitle track from the reference via ffmpeg.
- ``--suppress-output-if-offset-less-than N`` writes nothing when the computed
  offset is smaller than ``N`` — handy for skipping no-op rewrites in bulk jobs.
- ``--strict`` refuses to parse subtitle files with formatting problems instead
  of doing its best.
- ``--ffmpeg-path`` points ffsubsync at a specific ffmpeg/ffprobe location
  (otherwise the system ``PATH`` is used).
- ``--log-dir-path`` saves an ``ffsubsync.log`` file to an existing directory for
  later inspection.
- ``--start-seconds`` and ``--max-subtitle-seconds`` bound, respectively, where
  processing begins and the longest plausible single-subtitle duration.
