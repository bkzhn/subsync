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
  return { pyodide, config };
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
