// Module Web Worker: runs Pyodide + ffsubsync off the main thread so the UI stays
// responsive. Audio decoding (ffmpeg.wasm) runs on the *main* thread — ffmpeg.wasm
// spawns its own worker, and nesting that inside this worker is unreliable — so we
// receive already-decoded PCM here.

import {
  bootEngine,
  syncWithEngine,
  syncAudioWithEngine,
} from "./ffsubsync_engine.mjs";

let engine = null;

self.onmessage = async (event) => {
  const msg = event.data || {};
  try {
    if (msg.type === "init") {
      engine = await bootEngine({
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
      post({ type: "result", result: syncWithEngine(engine, msg.payload) });
    } else if (msg.type === "syncAudioPcm") {
      if (!engine) throw new Error("engine not initialized");
      post({ type: "status", status: "detecting speech + aligning…" });
      const { pcm, frameRate, inName, inBytes, vad, options } = msg.payload;
      const result = syncAudioWithEngine(engine, {
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
