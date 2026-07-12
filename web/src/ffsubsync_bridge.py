"""Browser bridge for ffsubsync.

This module is loaded into the Pyodide runtime and exposes a small, JSON-friendly
entry point that the JS worker calls. For now it only implements the
subtitle-vs-subtitle sync path, which is pure numpy + subtitle parsing and needs
no ffmpeg / VAD (see the plan's Phase 1).

The heavy lifting is delegated to the *real* ffsubsync code (vendored into the
Pyodide filesystem), so browser results match the CLI. We drive it exactly the way
the CLI does: build an argparse.Namespace via ffsubsync's own parser, then call
``ffsubsync.ffsubsync.run``. Input/output files live in Pyodide's in-memory MEMFS.
"""

import os
import traceback

from ffsubsync.ffsubsync import make_parser, run

_WORK_DIR = "/work"


def _ensure_workdir() -> None:
    os.makedirs(_WORK_DIR, exist_ok=True)


def _as_bytes(data) -> bytes:
    """Coerce whatever the JS worker handed us into real Python bytes.

    In the browser, file contents arrive as a JS ``Uint8Array`` (a JsProxy with a
    ``.to_py()`` returning a memoryview); natively they are already bytes. Handle
    both so the same bridge works in tests and in Pyodide.
    """
    if isinstance(data, (bytes, bytearray)):
        return bytes(data)
    to_py = getattr(data, "to_py", None)
    if to_py is not None:
        data = to_py()
    return bytes(data)


def _write(name: str, data) -> str:
    path = os.path.join(_WORK_DIR, name)
    with open(path, "wb") as f:
        f.write(_as_bytes(data))
    return path


def sync_subtitles(
    ref_name: str,
    ref_bytes: bytes,
    in_name: str,
    in_bytes: bytes,
    *,
    reference_encoding=None,
    output_encoding: str = "utf-8",
    no_fix_framerate: bool = False,
    gss: bool = False,
    max_offset_seconds=None,
):
    """Sync ``in_bytes`` against subtitle reference ``ref_bytes``.

    Both inputs are raw file bytes plus their original filenames (the extension
    matters: ffsubsync picks the parser from it). Returns a plain dict that
    survives the Pyodide->JS boundary:

        {
          "ok": bool,
          "offset_seconds": float | None,
          "framerate_scale_factor": float | None,
          "output_name": str,
          "output_text": str,          # synced subtitles (utf-8)
          "error": str | None,
        }
    """
    _ensure_workdir()
    # Keep the caller's extensions so the format is detected correctly.
    ref_path = _write("reference_" + os.path.basename(ref_name), ref_bytes)
    in_path = _write("input_" + os.path.basename(in_name), in_bytes)
    out_path = os.path.join(_WORK_DIR, "output.srt")

    argv = [ref_path, "-i", in_path, "-o", out_path]
    if reference_encoding:
        argv += ["--reference-encoding", reference_encoding]
    if output_encoding:
        argv += ["--output-encoding", output_encoding]
    if no_fix_framerate:
        argv += ["--no-fix-framerate"]
    if gss:
        argv += ["--gss"]
    if max_offset_seconds is not None:
        argv += ["--max-offset-seconds", str(max_offset_seconds)]

    try:
        args = make_parser().parse_args(argv)
        result = run(args)
    except Exception:  # pragma: no cover - defensive; surfaced to the UI
        return {
            "ok": False,
            "offset_seconds": None,
            "framerate_scale_factor": None,
            "output_name": _synced_name(in_name),
            "output_text": "",
            "error": traceback.format_exc(),
        }

    ok = bool(result.get("sync_was_successful")) and os.path.exists(out_path)
    output_text = ""
    if os.path.exists(out_path):
        with open(out_path, "r", encoding="utf-8", errors="replace") as f:
            output_text = f.read()

    return {
        "ok": ok,
        "offset_seconds": result.get("offset_seconds"),
        "framerate_scale_factor": result.get("framerate_scale_factor"),
        "output_name": _synced_name(in_name),
        "output_text": output_text,
        "error": None if ok else "sync did not succeed (see console logs)",
    }


def _synced_name(in_name: str) -> str:
    stem, _ext = os.path.splitext(os.path.basename(in_name))
    return "{}.synced.srt".format(stem)
