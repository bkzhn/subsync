// Module Web Worker: runs Pyodide + ffsubsync off the main thread so the UI stays
// responsive. Audio decoding (ffmpeg.wasm) runs on the *main* thread — ffmpeg.wasm
// spawns its own worker, and nesting that inside this worker is unreliable — so we
// receive already-decoded PCM here.
//
// The engine module is imported inside `init` (not statically), using the
// versioned URL the main thread passes, so cache-busting covers it too and the
// message handler is registered synchronously (no top-level await).

let eng = null; // the engine module
let engine = null; // the booted engine

self.onmessage = async (event) => {
  const msg = event.data || {};
  try {
    if (msg.type === "init") {
      eng = await import(msg.engineUrl);
      engine = await eng.bootEngine({
        configUrl: msg.configUrl,
        onStatus: (status) => post({ type: "status", status }),
      });
      post({
        type: "ready",
        capabilities: engine.capabilities,
        ffmpeg: engine.config.ffmpeg,
      });
    } else if (msg.type === "sync") {
      if (!engine) throw new Error("engine not initialized");
      post({ type: "status", status: "syncing…" });
      post({ type: "result", result: eng.syncWithEngine(engine, msg.payload) });
    } else if (msg.type === "syncAudioPcm") {
      if (!engine) throw new Error("engine not initialized");
      post({ type: "status", status: "detecting speech + aligning…" });
      const { pcm, frameRate, inName, inBytes, vad, options } = msg.payload;
      const result = eng.syncAudioWithEngine(engine, {
        pcm,
        frameRate,
        inName,
        inBytes,
        vad,
        options,
      });
      post({ type: "result", result });
    }
  } catch (err) {
    post({ type: "error", error: String((err && err.stack) || err) });
  }
};

function post(message) {
  self.postMessage(message);
}
