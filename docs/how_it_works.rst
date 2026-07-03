How it works
============

ffsubsync reduces subtitle synchronization to a signal-alignment problem. The
algorithm operates in three steps:

1. **Discretize.** Both the reference (the video's audio stream, or an existing
   subtitle's timings) and the input subtitles are chopped into 10 ms windows.

2. **Label speech.** For each 10 ms window, decide whether it contains speech.
   For subtitles this is trivial — a window is "speech" if any subtitle is on
   screen during it. For an audio reference, ffsubsync uses an off-the-shelf
   voice-activity detector such as the one built into `WebRTC
   <https://webrtc.org/>`_ (see :ref:`vad-backends`).

3. **Align.** The result of step 2 is two binary strings — one for the reference,
   one for the subtitles. ffsubsync scores an alignment as
   *(# reference 1's matched with subtitle 1's)* − *(# reference 1's matched with
   subtitle 0's)* and searches for the shift that maximizes this score.

The best-scoring shift from step 3 is the offset that best syncs the subtitles to
the reference. When framerate correction is enabled (:ref:`framerate-correction`),
ffsubsync repeats the search across candidate framerate ratios and keeps the best
overall result.

Why the FFT
-----------

For anything longer than a short clip these binary strings are huge — millions of
digits for a video over an hour long — so naively scoring every possible shift is
an O(n²) operation and far too slow. The key observation is that "score all
shifts" is exactly a **convolution**, which the Fast Fourier Transform computes in
O(n log n). That is what makes a full-length sync finish in seconds rather than
minutes. The FFT machinery is provided by `numpy <http://www.numpy.org/>`_.

Speed
-----

A typical sync against a video finishes in roughly 20 to 30 seconds, and the
dominant cost is audio extraction, not the alignment itself. If you already have
a correctly-synced reference subtitle (so no audio needs decoding), a sync
usually completes in under a second.

Limitations
-----------

ffsubsync corrects a global offset and framerate — the case where subtitles and
video share the same content but start at different points or run at different
rates. In practice this covers the vast majority of desync, which typically comes
from starting or ending segments (like a recap) being present in one but not the
other.

What it does **not** handle is splits or breaks *in the middle* of the video that
aren't present in the subtitles (or vice versa) — for example, ad breaks cut out
of one copy. Extending the algorithm to handle mid-content breaks robustly is an
open line of work; see `issue #10
<https://github.com/smacke/ffsubsync/issues/10>`_ for discussion.
