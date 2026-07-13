# -*- coding: utf-8 -*-
from datetime import timedelta

import numpy as np
import srt

from ffsubsync.constants import SAMPLE_RATE
from ffsubsync.generic_subtitles import GenericSubtitle
from ffsubsync.split_aligner import compute_split_offsets


def _cue(start_s, end_s, content="hello world"):
    inner = srt.Subtitle(
        index=1,
        start=timedelta(seconds=start_s),
        end=timedelta(seconds=end_s),
        content=content,
    )
    return GenericSubtitle(inner.start, inner.end, inner)


def _reference(intervals, total_seconds):
    arr = np.zeros(int(total_seconds * SAMPLE_RATE) + 2, dtype=float)
    for a, b in intervals:
        arr[int(round(a * SAMPLE_RATE)) : int(round(b * SAMPLE_RATE))] = 1.0
    return arr


def _num_splits(offsets):
    return sum(1 for i in range(1, len(offsets)) if offsets[i] != offsets[i - 1])


def _align(reference, cues, split_penalty, max_offset_seconds=7):
    return compute_split_offsets(
        reference,
        cues,
        sample_rate=SAMPLE_RATE,
        start_seconds=0,
        split_penalty=split_penalty,
        max_offset_samples=int(max_offset_seconds * SAMPLE_RATE),
    )


def test_recovers_mid_file_break():
    # First half aligned at offset 0; second half needs +6s (e.g. a break was
    # removed from the reference), so no single global offset can fix both.
    # Distinct block lengths + a 7s max-offset make each cue's target unique
    # (in particular the second-half cues cannot mirror back onto the first-half
    # reference within the offset window).
    reference = _reference(
        [(1.0, 1.4), (3.0, 3.9), (17.0, 17.6), (19.0, 20.0)], total_seconds=22
    )
    cues = [_cue(1.0, 1.4), _cue(3.0, 3.9), _cue(11.0, 11.6), _cue(13.0, 14.0)]
    offsets = _align(reference, cues, split_penalty=0.5 * SAMPLE_RATE)
    assert offsets == [0, 0, 6 * SAMPLE_RATE, 6 * SAMPLE_RATE]
    assert _num_splits(offsets) == 1


def test_collapses_to_single_offset():
    # Every cue is uniformly late by 5s; the summed rating peaks sharply at +5s,
    # so a large penalty (which forbids splitting) yields one global offset.
    reference = _reference(
        [(6.0, 6.4), (8.0, 8.9), (10.0, 10.6), (12.0, 13.0)], total_seconds=14
    )
    cues = [_cue(1.0, 1.4), _cue(3.0, 3.9), _cue(5.0, 5.6), _cue(7.0, 8.0)]
    offsets = _align(reference, cues, split_penalty=1e9)
    assert offsets == [5 * SAMPLE_RATE] * 4
    assert _num_splits(offsets) == 0


def test_already_aligned_is_noop():
    reference = _reference([(1.0, 1.4), (3.0, 3.9)], total_seconds=6)
    cues = [_cue(1.0, 1.4), _cue(3.0, 3.9)]
    offsets = _align(reference, cues, split_penalty=0.5 * SAMPLE_RATE)
    assert offsets == [0, 0]
    assert _num_splits(offsets) == 0


def test_length_penalty_prefers_matching_block():
    # One cue of length 1s. The reference has a same-sized block at +10s and a long
    # 5s block at +3s. Pure overlap is a flat 1s for any offset that drops the cue
    # inside the long block, so its argmax tie-breaks to the (wrong) low offset +3.
    # The length penalty charges reference speech just outside the cue edges, so the
    # exactly-sized block at +10 (whose neighbours are silent) wins.
    reference = _reference([(3.0, 8.0), (10.0, 11.0)], total_seconds=13)
    cues = [_cue(0.0, 1.0)]

    pure = _align(reference, cues, split_penalty=1e9, max_offset_seconds=12)
    assert pure == [3 * SAMPLE_RATE]

    penalized = compute_split_offsets(
        reference,
        cues,
        sample_rate=SAMPLE_RATE,
        start_seconds=0,
        split_penalty=1e9,
        length_penalty=0.25,
        max_offset_samples=12 * SAMPLE_RATE,
    )
    assert penalized == [10 * SAMPLE_RATE]


def test_subsample_improves_fractional_offset():
    # The reference block is grid-aligned ([5.00, 6.00]) but the cue is offset from
    # the sample grid by fractions of a sample, so its ideal shift is non-integer.
    # Whole-sample search can only get within ~1 sample; sub-sample search recovers
    # the fractional shift and thus strictly more overlap.
    reference = _reference([(5.0, 6.0)], total_seconds=13)
    cues = [_cue(0.003, 1.007)]

    whole, whole_score = compute_split_offsets(
        reference, cues, sample_rate=SAMPLE_RATE, start_seconds=0,
        split_penalty=1e9, max_offset_samples=10 * SAMPLE_RATE, return_score=True,
    )
    fine, fine_score = compute_split_offsets(
        reference, cues, sample_rate=SAMPLE_RATE, start_seconds=0,
        split_penalty=1e9, max_offset_samples=10 * SAMPLE_RATE,
        offset_step_samples=0.1, return_score=True,
    )

    # Sub-sample recovers essentially the full 1s (100 samples) of overlap...
    assert fine_score > whole_score + 0.2
    assert fine_score > 99.9
    # ...at an offset near 4.99-5.00s but not snapped to a whole 10ms sample.
    fine_seconds = fine[0] / float(SAMPLE_RATE)
    assert 4.99 <= fine_seconds <= 5.0


def test_empty_input():
    assert (
        compute_split_offsets(
            _reference([(1, 2)], total_seconds=3),
            [],
            sample_rate=SAMPLE_RATE,
            start_seconds=0,
            split_penalty=1.0,
            max_offset_samples=100,
        )
        == []
    )
