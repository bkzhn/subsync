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
