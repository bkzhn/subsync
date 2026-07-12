// Boots Pyodide and drives the vendored ffsubsync via the Python bridge.
// Kept free of DOM/worker specifics so it can be reused from a Web Worker (the
// browser app) or, in principle, a Node test harness.

export async function bootEngine({ configUrl, onStatus } = {}) {
  const status = (s) => onStatus && onStatus(s);

  // Cache-busting: configUrl carries ?v=<build>; append it to our other
  // same-origin fetches (but NOT wheel URLs — micropip parses the filename from
  // the URL, and those are already content-addressed by name+version).
  const v = new URL(configUrl).searchParams.get("v") || "";
  const withV = (u) => (v ? u + (u.includes("?") ? "&" : "?") + "v=" + v : u);

  status("fetching config…");
  const config = await (await fetch(configUrl)).json();

  status("loading Python runtime…");
  const { loadPyodide } = await import(config.pyodideCdn + "pyodide.mjs");
  const pyodide = await loadPyodide({ indexURL: config.pyodideCdn });

  status("loading runtime packages…");
  // corePackages (numpy, micropip, charset-normalizer, typing-extensions, tqdm,
  // setuptools) come from the Pyodide CDN, not PyPI.
  await pyodide.loadPackage(config.corePackages);

  // Install every vendored wheel from *our own origin* — never PyPI. This covers
  // the pure-Python deps (pysubs2, ffmpeg-python + future) and, when built, the
  // webrtcvad wasm wheel. deps=False guarantees micropip never contacts PyPI, so
  // the site works even where PyPI is blocked.
  status("installing libraries…");
  const capabilities = { webrtcvad: false, webrtcvadError: "" };
  let wheels = [];
  if (config.wheelManifest) {
    try {
      wheels = (await (await fetch(withV(new URL(config.wheelManifest, configUrl).href))).json()) || [];
    } catch (_) {
      wheels = [];
    }
  }
  if (wheels.length) {
    const urls = wheels.map((name) => new URL(config.wheelDir + name, configUrl).href);
    const pyUrls = pyodide.toPy(urls);
    pyodide.globals.set("_wheel_urls", pyUrls);
    await pyodide.runPythonAsync(
      "import micropip; await micropip.install(list(_wheel_urls), deps=False)",
    );
    if (pyUrls.destroy) pyUrls.destroy();
    // webrtcvad (if bundled) — report whether it actually imports (needs setuptools
    // for its pkg_resources import, which is in corePackages).
    const probe = pyodide.runPython(`
def _probe():
    try:
        import webrtcvad  # noqa: F401
        return (True, "")
    except Exception:
        import traceback
        return (False, traceback.format_exc())
_probe()
`);
    const [ok, err] = probe.toJs();
    probe.destroy();
    capabilities.webrtcvad = ok;
    if (!ok) {
      capabilities.webrtcvadError = err;
      console.warn("webrtcvad not available:\n" + err);
    }
  }

  status("loading ffsubsync…");
  const sources = await (
    await fetch(withV(new URL(config.pySourcesManifest, configUrl).href))
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
