// Boots Pyodide and drives the vendored ffsubsync via the Python bridge.
// Kept free of DOM/worker specifics so it can be reused from a Web Worker (the
// browser app) or, in principle, a Node test harness.

export async function bootEngine({ configUrl, onStatus } = {}) {
  const status = (s) => onStatus && onStatus(s);

  status("fetching config…");
  const config = await (await fetch(configUrl)).json();

  status("loading Python runtime…");
  const { loadPyodide } = await import(config.pyodideCdn + "pyodide.mjs");
  const pyodide = await loadPyodide({ indexURL: config.pyodideCdn });

  status("loading numpy…");
  await pyodide.loadPackage(config.corePackages);

  status("installing subtitle libraries…");
  const micropip = pyodide.pyimport("micropip");
  // pysubs2 / srt / auditok are pure-Python; ffmpeg-python is pure-Python too
  // (only builds CLI args — we never invoke the binary on this path).
  await micropip.install(config.pipPackages);

  // Optional: the webrtcvad wasm wheel (exact CLI-parity VAD for the audio path).
  // Absent until built in CI; the app falls back to auditok when it's missing.
  const capabilities = { webrtcvad: false };
  if (config.wheelManifest) {
    try {
      const manifestUrl = new URL(config.wheelManifest, configUrl);
      const wheels = await (await fetch(manifestUrl)).json();
      for (const name of wheels || []) {
        status(`installing ${name}…`);
        await micropip.install(new URL(config.wheelDir + name, configUrl).href);
      }
      if ((wheels || []).length) {
        capabilities.webrtcvad = pyodide.runPython(
          "def _c():\n try:\n  import webrtcvad; return True\n except Exception:\n  return False\n_c()",
        );
      }
    } catch (e) {
      status("no webrtcvad wheel (using auditok fallback)");
    }
  }

  status("loading ffsubsync…");
  const sources = await (
    await fetch(new URL(config.pySourcesManifest, configUrl))
  ).json();
  const FS = pyodide.FS;
  FS.mkdirTree("/lib");
  for (const [rel, text] of Object.entries(sources)) {
    const full = "/lib/" + rel;
    FS.mkdirTree(full.slice(0, full.lastIndexOf("/")));
    FS.writeFile(full, text);
  }
  pyodide.runPython('import sys; sys.path.insert(0, "/lib")');
  // Warm import so any load error surfaces here rather than mid-sync.
  pyodide.runPython("import ffsubsync_bridge");

  status("ready");
  return { pyodide, config, capabilities };
}

export function syncWithEngine(engine, { refName, refBytes, inName, inBytes, options = {} }) {
  const { pyodide } = engine;
  const opts = pyodide.toPy(options);
  pyodide.globals.set("_ref_name", refName);
  pyodide.globals.set("_in_name", inName);
  pyodide.globals.set("_ref_bytes", refBytes);
  pyodide.globals.set("_in_bytes", inBytes);
  pyodide.globals.set("_opts", opts);
  let proxy;
  try {
    proxy = pyodide.runPython(`
import ffsubsync_bridge
ffsubsync_bridge.sync_subtitles(
    _ref_name, _ref_bytes, _in_name, _in_bytes,
    **dict(_opts),
)
`);
    return proxy.toJs({ dict_converter: Object.fromEntries });
  } finally {
    if (proxy) proxy.destroy();
    if (opts && opts.destroy) opts.destroy();
  }
}

// Sync against decoded audio PCM (mono s16le at frameRate) from a video/audio
// reference. `vad` is "webrtc" or "auditok".
export function syncAudioWithEngine(
  engine,
  { pcm, frameRate, inName, inBytes, vad, options = {} },
) {
  const { pyodide } = engine;
  const opts = pyodide.toPy(options);
  pyodide.globals.set("_pcm", pcm);
  pyodide.globals.set("_frame_rate", frameRate);
  pyodide.globals.set("_in_name", inName);
  pyodide.globals.set("_in_bytes", inBytes);
  pyodide.globals.set("_vad", vad);
  pyodide.globals.set("_opts", opts);
  let proxy;
  try {
    proxy = pyodide.runPython(`
import ffsubsync_bridge
ffsubsync_bridge.sync_with_audio(
    _pcm, _frame_rate, _in_name, _in_bytes, vad=_vad,
    **dict(_opts),
)
`);
    return proxy.toJs({ dict_converter: Object.fromEntries });
  } finally {
    if (proxy) proxy.destroy();
    if (opts && opts.destroy) opts.destroy();
  }
}
