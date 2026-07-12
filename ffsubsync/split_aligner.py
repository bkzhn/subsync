# -*- coding: utf-8 -*-
"""alass-style split-penalty alignment.

ffsubsync's default aligner (:class:`ffsubsync.aligners.FFTAligner`) emits a single
global offset for the whole file. That cannot correct a subtitle whose required
offset *changes* partway through -- e.g. a commercial break, an inserted/removed
scene ("director's cut"), or two discs concatenated into one file.

This module implements the core idea from `alass <https://github.com/kaegi/alass>`_:
let every cue take its own offset, but charge a *split penalty* every time two
consecutive cues are assigned different offsets. We maximize::

    sum_i overlap(cue_i @ offset_i)  -  split_penalty * (number of splits)

via dynamic programming, yielding a piecewise-constant offset function. With a large
penalty the optimum collapses to a single global offset (i.e. the default behavior).

The rating of a cue ``[start, end]`` placed at integer sample offset ``o`` against the
reference speech signal is just the overlap length, which -- given the prefix sum of
the reference signal -- is an O(1) lookup::

    rating(cue, o) = ref_cumsum[end + o] - ref_cumsum[start + o]

so the whole DP is ``O(n_cues * n_offsets)`` and fully numpy-vectorizable, with no
dependency beyond numpy.
"""
import logging
from typing import List, Tuple

import numpy as np

from ffsubsync.generic_subtitles import GenericSubtitle
from ffsubsync.speech_transformers import _is_metadata

logging.basicConfig(level=logging.INFO)
logger: logging.Logger = logging.getLogger(__name__)


def _cue_sample_bounds(
    cues: List[GenericSubtitle], sample_rate: int, start_seconds: float
) -> Tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Return per-cue ``(start_sample, end_sample, is_speech)`` arrays.

    Uses the same rounding as :meth:`SubtitleSpeechTransformer.fit` so the sample
    bounds line up with the reference speech signal, and the same ``_is_metadata``
    gate so non-dialogue cues (blank lines, bracketed sound cues, music notes, ...)
    are marked non-speech and contribute no rating.
    """
    n = len(cues)
    starts = np.zeros(n, dtype=np.int64)
    ends = np.zeros(n, dtype=np.int64)
    is_speech = np.zeros(n, dtype=bool)
    for i, sub in enumerate(cues):
        start = int(round((sub.start.total_seconds() - start_seconds) * sample_rate))
        duration = sub.end.total_seconds() - sub.start.total_seconds()
        end = start + int(round(duration * sample_rate))
        starts[i] = start
        ends[i] = end
        is_speech[i] = not _is_metadata(sub.content, i == 0 or i + 1 == n)
    return starts, ends, is_speech


def compute_split_offsets(
    reference: np.ndarray,
    cues: List[GenericSubtitle],
    *,
    sample_rate: int,
    start_seconds: float,
    split_penalty: float,
    max_offset_samples: int,
) -> List[int]:
    """Return one absolute sample offset per cue (aligned 1:1 with ``cues``).

    Parameters
    ----------
    reference:
        The reference speech signal (1.0 where speech is present), as produced by a
        reference pipeline at ``sample_rate`` Hz.
    cues:
        The (already framerate-scaled) subtitle cues to align.
    split_penalty:
        Cost, in *overlap samples*, charged each time consecutive cues take different
        offsets. Larger => fewer splits; very large => a single global offset.
    max_offset_samples:
        Half-width of the candidate offset grid; offsets range over
        ``[-max_offset_samples, +max_offset_samples]``.
    """
    n = len(cues)
    if n == 0:
        return []

    starts, ends, is_speech = _cue_sample_bounds(cues, sample_rate, start_seconds)

    offsets = np.arange(-max_offset_samples, max_offset_samples + 1, dtype=np.int64)
    n_off = len(offsets)

    # Prefix sum of the reference so overlap(cue @ o) is an O(1) difference. Pad both
    # ends so every start+o / end+o lookup stays in-bounds: index k into ref_cumsum
    # after shifting by +pad corresponds to reference position k - pad, and positions
    # outside [0, len(reference)) contribute no speech (flat prefix sum at the ends).
    ref = np.asarray(reference, dtype=np.float64)
    ref = (ref > 0).astype(np.float64)  # treat as a binary speech indicator
    pad = max_offset_samples + 1
    cumsum = np.concatenate(
        [np.zeros(1), np.cumsum(ref)]
    )  # cumsum[k] = sum(ref[:k]); overlap[a, b) = cumsum[b] - cumsum[a]
    # Extend flat on both sides to absorb out-of-range shifted indices.
    left = np.zeros(pad)
    right = np.full(pad, cumsum[-1])
    padded = np.concatenate([left, cumsum, right])

    def _rating_row(i: int) -> np.ndarray:
        if not is_speech[i]:
            return np.zeros(n_off)
        # For each candidate offset, overlap = padded[end+o] - padded[start+o].
        # Index into `padded`: position p in cumsum-space maps to p + pad.
        end_idx = ends[i] + offsets + pad
        start_idx = starts[i] + offsets + pad
        np.clip(end_idx, 0, len(padded) - 1, out=end_idx)
        np.clip(start_idx, 0, len(padded) - 1, out=start_idx)
        return padded[end_idx] - padded[start_idx]

    # Forward DP. dp[o] = best total rating for cues[0..i] with cue i at offset o.
    # back[i] stores, per offset, whether cue i kept the previous cue's offset (-1)
    # or jumped, in which case the previous cue sat at argmax of the previous row.
    dp = _rating_row(0)
    back = np.full((n, n_off), -1, dtype=np.int64)  # row 0 unused (no predecessor)
    prev_argmax = np.empty(n, dtype=np.int64)
    for i in range(1, n):
        best_prev_idx = int(np.argmax(dp))
        prev_argmax[i] = best_prev_idx
        jump_value = dp[best_prev_idx] - split_penalty
        keep_value = dp  # same offset, no penalty
        jumped = jump_value > keep_value
        dp = _rating_row(i) + np.where(jumped, jump_value, keep_value)
        back[i] = np.where(jumped, best_prev_idx, -1)

    # Backtrack.
    offset_idx = np.empty(n, dtype=np.int64)
    cur = int(np.argmax(dp))
    for i in range(n - 1, -1, -1):
        offset_idx[i] = cur
        if i > 0:
            b = back[i, cur]
            cur = int(b) if b >= 0 else cur

    result = [int(offsets[idx]) for idx in offset_idx]
    _log_segments(result, sample_rate)
    return result


def _log_segments(offsets: List[int], sample_rate: int) -> None:
    """Emit a human-readable summary of the piecewise offset function."""
    if not offsets:
        return
    segments: List[Tuple[int, int]] = []  # (count, offset_samples)
    for off in offsets:
        if segments and segments[-1][1] == off:
            segments[-1] = (segments[-1][0] + 1, off)
        else:
            segments.append((1, off))
    n_splits = len(segments) - 1
    logger.info(
        "split alignment: %d segment(s), %d split(s)", len(segments), n_splits
    )
    for count, off in segments:
        logger.info(
            "  %d cue(s) offset %.3fs", count, off / float(sample_rate)
        )
