"""Native correctness test for the browser bridge's sync logic.

We cannot run Pyodide headlessly in this environment (no npm network), but the
bridge module is plain, runtime-agnostic Python driving the real ffsubsync, so a
native run against a known synthetic offset proves the sub-vs-sub path and the
bridge glue. The browser path reuses the exact same bridge + ffsubsync code.

Run with: uv run python web/tests/native_bridge_test.py
"""

import os
import sys
import tempfile

# Make the bridge importable and redirect its MEMFS-style workdir to a temp dir.
HERE = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, os.path.join(HERE, "..", "src"))
sys.path.insert(0, REPO_ROOT)  # import the local (vendored) ffsubsync sources

import ffsubsync_bridge as bridge  # noqa: E402

bridge._WORK_DIR = tempfile.mkdtemp(prefix="ffs_bridge_")


def make_srt(offset_seconds: float, n: int = 40) -> bytes:
    """A simple SRT: one 1s cue every 2s, all shifted by ``offset_seconds``."""
    lines = []
    for i in range(n):
        start = i * 2.0 + offset_seconds
        end = start + 1.0
        lines.append(str(i + 1))
        lines.append("{} --> {}".format(_ts(start), _ts(end)))
        lines.append("line {}".format(i + 1))
        lines.append("")
    return "\n".join(lines).encode("utf-8")


def _ts(t: float) -> str:
    if t < 0:
        t = 0.0
    h = int(t // 3600)
    m = int((t % 3600) // 60)
    s = int(t % 60)
    ms = int(round((t - int(t)) * 1000))
    return "{:02d}:{:02d}:{:02d},{:03d}".format(h, m, s, ms)


def main() -> int:
    reference = make_srt(0.0)
    # Input subtitles arrive 5s late relative to the reference.
    delayed = make_srt(5.0)
    expected_offset = -5.0

    result = bridge.sync_subtitles(
        "reference.srt", reference, "input.srt", delayed
    )

    print("ok:", result["ok"])
    print("offset_seconds:", result["offset_seconds"])
    print("framerate_scale_factor:", result["framerate_scale_factor"])
    print("output_name:", result["output_name"])
    print("output_text[:120]:", repr(result["output_text"][:120]))
    if result["error"]:
        print("error:", result["error"])

    assert result["ok"], "sync should succeed"
    off = result["offset_seconds"]
    assert off is not None, "offset should be set"
    assert abs(off - expected_offset) < 0.25, (
        "expected offset ~%.2f, got %.3f" % (expected_offset, off)
    )
    assert result["output_text"].strip(), "output should be non-empty"
    assert "-->" in result["output_text"], "output should be SRT"
    print("\nPASS: detected offset %.3fs matches expected %.1fs" % (off, expected_offset))
    return 0


if __name__ == "__main__":
    sys.exit(main())
