# -*- coding: utf-8 -*-
from unittest.mock import MagicMock, patch

import numpy as np
import pytest

from ffsubsync.constants import SAMPLE_RATE
from ffsubsync.speech_transformers import (
    WhisperSpeechTransformer,
    _build_whisper_filter,
    _escape_ffmpeg_filter_value,
    _ffmpeg_supports_whisper,
    _infer_whisper_language,
    _parse_filter_opts,
)


# ---------------------------------------------------------------------------
# pure helpers (no ffmpeg needed)
# ---------------------------------------------------------------------------
def test_infer_language_explicit_wins():
    assert _infer_whisper_language("/x/ggml-base.en.bin", "es") == "es"


def test_infer_language_en_model():
    assert _infer_whisper_language("/x/ggml-base.en.bin", None) == "en"
    assert _infer_whisper_language("/x/ggml-small.en.bin", None) == "en"


def test_infer_language_multilingual_model_defaults_auto():
    assert _infer_whisper_language("/x/ggml-large-v3.bin", None) == "auto"
    assert _infer_whisper_language("/x/ggml-base.bin", None) == "auto"


def test_escape_colon_and_backslash():
    # C:\models\g.bin  ->  C\:\\models\\g.bin
    assert _escape_ffmpeg_filter_value("C:\\models\\g.bin") == "C\\:\\\\models\\\\g.bin"


def test_escape_single_quote():
    assert _escape_ffmpeg_filter_value("a'b") == "a\\'b"


def test_escape_leaves_plain_path_untouched():
    assert _escape_ffmpeg_filter_value("/home/u/g.bin") == "/home/u/g.bin"


def test_parse_filter_opts_basic():
    assert _parse_filter_opts("queue=12:gpu=false") == {"queue": "12", "gpu": "false"}


def test_parse_filter_opts_skips_malformed():
    assert _parse_filter_opts("queue=12:garbage:temp=0.2") == {
        "queue": "12",
        "temp": "0.2",
    }


def test_parse_filter_opts_respects_escaped_colon():
    # an escaped colon inside a value must not split the option
    assert _parse_filter_opts("path=C\\:/m.bin:queue=5") == {
        "path": "C\\:/m.bin",
        "queue": "5",
    }


def test_build_filter_has_structural_and_defaults():
    f = _build_whisper_filter("/m/g.bin", "en", "/tmp/o.srt", queue=8)
    assert f.startswith("whisper=")
    assert "model=/m/g.bin" in f
    assert "language=en" in f
    assert "queue=8" in f
    assert "format=srt" in f
    assert "destination=/tmp/o.srt" in f
    assert "vad_model" not in f


def test_build_filter_user_overrides_queue():
    f = _build_whisper_filter("/m/g.bin", "en", "/tmp/o.srt", queue=8, extra_opts="queue=12")
    assert "queue=12" in f
    assert "queue=8" not in f


def test_build_filter_user_cannot_override_structural():
    f = _build_whisper_filter(
        "/m/g.bin",
        "en",
        "/tmp/o.srt",
        extra_opts="format=json:destination=/evil.srt:model=/evil.bin",
    )
    assert "format=srt" in f
    assert "format=json" not in f
    assert "destination=/tmp/o.srt" in f
    assert "/evil.srt" not in f
    assert "model=/m/g.bin" in f
    assert "/evil.bin" not in f


def test_build_filter_includes_vad_model_when_given():
    f = _build_whisper_filter("/m/g.bin", "auto", "/tmp/o.srt", vad_model="/m/vad.bin")
    assert "vad_model=/m/vad.bin" in f


# ---------------------------------------------------------------------------
# _ffmpeg_supports_whisper
# ---------------------------------------------------------------------------
def _mock_popen(stdout=b"", stderr=b"", returncode=0):
    proc = MagicMock()
    proc.communicate.return_value = (stdout, stderr)
    proc.returncode = returncode
    return proc


@patch("ffsubsync.speech_transformers.subprocess.Popen")
def test_supports_whisper_true(mock_popen):
    mock_popen.return_value = _mock_popen(
        stdout=b"Filter whisper\n  Transcribe audio using whisper.cpp."
    )
    assert _ffmpeg_supports_whisper("ffmpeg") is True


@patch("ffsubsync.speech_transformers.subprocess.Popen")
def test_supports_whisper_false_unknown_filter(mock_popen):
    mock_popen.return_value = _mock_popen(stderr=b"Unknown filter 'whisper'.\n")
    assert _ffmpeg_supports_whisper("ffmpeg") is False


@patch("ffsubsync.speech_transformers.subprocess.Popen", side_effect=OSError("no ffmpeg"))
def test_supports_whisper_false_when_binary_missing(mock_popen):
    assert _ffmpeg_supports_whisper("ffmpeg") is False


# ---------------------------------------------------------------------------
# WhisperSpeechTransformer.fit error paths + happy path
# ---------------------------------------------------------------------------
def test_fit_raises_when_model_missing(tmp_path):
    t = WhisperSpeechTransformer(model_path=str(tmp_path / "nope.bin"))
    with pytest.raises(ValueError, match="whisper weights not found"):
        t.fit("video.mp4")


@patch("ffsubsync.speech_transformers._ffmpeg_supports_whisper", return_value=False)
def test_fit_raises_when_ffmpeg_lacks_whisper(mock_support, tmp_path):
    model = tmp_path / "ggml-base.en.bin"
    model.write_bytes(b"x")
    t = WhisperSpeechTransformer(model_path=str(model))
    with pytest.raises(ValueError, match="does not support the whisper filter"):
        t.fit("video.mp4")


_CANNED_SRT = b"""1
00:00:01,000 --> 00:00:03,000
Hello there.

2
00:00:05,000 --> 00:00:06,500
General Kenobi.
"""


@patch("ffsubsync.speech_transformers._probe_embedded_subtitle_streams")
@patch("ffsubsync.speech_transformers.subprocess.Popen")
@patch("ffsubsync.speech_transformers._ffmpeg_supports_whisper", return_value=True)
def test_fit_happy_path(mock_support, mock_popen, mock_probe, tmp_path):
    model = tmp_path / "ggml-base.en.bin"
    model.write_bytes(b"x")
    mock_probe.return_value = None  # no embedded subs

    # simulate ffmpeg by writing the canned SRT to the destination path parsed
    # out of the -af whisper filter argument
    def fake_popen(args, **kwargs):
        af = args[args.index("-af") + 1]
        dest = af.split("destination=", 1)[1].split(":", 1)[0]
        with open(dest, "wb") as f:
            f.write(_CANNED_SRT)
        return _mock_popen(returncode=0)

    mock_popen.side_effect = fake_popen

    t = WhisperSpeechTransformer(model_path=str(model))
    t.fit("video.mp4")
    result = t.transform()
    assert isinstance(result, np.ndarray)
    assert result.ndim == 1
    assert np.sum(result) > 0
    # 6.5s of transcript at 100 Hz -> ~650+ samples
    assert len(result) >= int(6.5 * SAMPLE_RATE)
    # num_frames is None so try_sync skips duration-based framerate inference
    assert t.num_frames is None


@patch("ffsubsync.speech_transformers._probe_embedded_subtitle_streams")
@patch("ffsubsync.speech_transformers.subprocess.Popen")
@patch("ffsubsync.speech_transformers._ffmpeg_supports_whisper", return_value=True)
def test_fit_warns_on_embedded_subs(mock_support, mock_popen, mock_probe, tmp_path, caplog):
    model = tmp_path / "ggml-base.en.bin"
    model.write_bytes(b"x")
    mock_probe.return_value = ["0:2"]  # one embedded subtitle stream

    def fake_popen(args, **kwargs):
        af = args[args.index("-af") + 1]
        dest = af.split("destination=", 1)[1].split(":", 1)[0]
        with open(dest, "wb") as f:
            f.write(_CANNED_SRT)
        return _mock_popen(returncode=0)

    mock_popen.side_effect = fake_popen

    import logging

    t = WhisperSpeechTransformer(model_path=str(model))
    with caplog.at_level(logging.WARNING):
        t.fit("video.mkv")
    assert any("already contains" in rec.message for rec in caplog.records)


@patch("ffsubsync.speech_transformers._probe_embedded_subtitle_streams", return_value=None)
@patch("ffsubsync.speech_transformers.subprocess.Popen")
@patch("ffsubsync.speech_transformers._ffmpeg_supports_whisper", return_value=True)
def test_fit_raises_on_ffmpeg_failure(mock_support, mock_popen, mock_probe, tmp_path):
    model = tmp_path / "ggml-base.en.bin"
    model.write_bytes(b"x")
    mock_popen.return_value = _mock_popen(returncode=1, stderr=b"boom\nfatal error")
    t = WhisperSpeechTransformer(model_path=str(model))
    with pytest.raises(ValueError, match="whisper transcription failed"):
        t.fit("video.mp4")


@patch("ffsubsync.speech_transformers._probe_embedded_subtitle_streams", return_value=None)
@patch("ffsubsync.speech_transformers.subprocess.Popen")
@patch("ffsubsync.speech_transformers._ffmpeg_supports_whisper", return_value=True)
def test_fit_raises_on_empty_transcript(mock_support, mock_popen, mock_probe, tmp_path):
    model = tmp_path / "ggml-base.en.bin"
    model.write_bytes(b"x")
    # ffmpeg "succeeds" but writes nothing to destination
    mock_popen.return_value = _mock_popen(returncode=0)
    t = WhisperSpeechTransformer(model_path=str(model))
    with pytest.raises(ValueError, match="produced no subtitles"):
        t.fit("video.mp4")


# ---------------------------------------------------------------------------
# --vad reuse for whisper's VAD model
# ---------------------------------------------------------------------------
def test_resolve_vad_model_uses_existing_path(tmp_path):
    vad = tmp_path / "ggml-silero.bin"
    vad.write_bytes(b"x")
    t = WhisperSpeechTransformer(model_path="m.bin", vad=str(vad))
    assert t._resolve_vad_model() == str(vad)


def test_resolve_vad_model_warns_on_named_choice(caplog):
    import logging

    t = WhisperSpeechTransformer(model_path="m.bin", vad="webrtc")
    with caplog.at_level(logging.WARNING):
        assert t._resolve_vad_model() is None
    assert any("ignored in whisper" in rec.message for rec in caplog.records)


def test_resolve_vad_model_none_when_unset():
    t = WhisperSpeechTransformer(model_path="m.bin", vad=None)
    assert t._resolve_vad_model() is None


# ---------------------------------------------------------------------------
# CLI validation: --vad choices still enforced outside whisper mode
# ---------------------------------------------------------------------------
def test_vad_choices_still_enforced_without_whisper():
    from ffsubsync.ffsubsync import make_parser, validate_args

    args = make_parser().parse_args(["ref.mp4", "-i", "in.srt", "--vad", "bogus"])
    with pytest.raises(ValueError, match="invalid --vad"):
        validate_args(args)


def test_vad_path_allowed_in_whisper_mode(tmp_path):
    from ffsubsync.ffsubsync import make_parser, validate_args

    args = make_parser().parse_args(
        [
            "ref.mp4",
            "-i",
            "in.srt",
            "--whisper-weights",
            "m.bin",
            "--vad",
            "/some/vad/model.bin",
        ]
    )
    # should not raise even though the vad value is not a named choice
    validate_args(args)
