// Module Web Worker: runs Pyodide + ffsubsync (and, for the audio path,
// ffmpeg.wasm) off the main thread so the UI stays responsive.

import {
  bootEngine,
  syncWithEngine,
  syncAudioWithEngine,
} from "./ffsubsync_engine.mjs";
import { decodeAudioToPcm } from "./ffmpeg_decode.mjs";

let engine = null;

self.onmessage = async (event) => {
  const msg = event.data || {};
  try {
    if (msg.type === "init") {
      engine = await bootEngine({
        configUrl: msg.configUrl,
        onStatus: (status) => post({ type: "status", status }),
      });
      post({ type: "ready", capabilities: engine.capabilities });
    } else if (msg.type === "sync") {
      if (!engine) throw new Error("engine not initialized");
      post({ type: "status", status: "syncing…" });
      post({ type: "result", result: syncWithEngine(engine, msg.payload) });
    } else if (msg.type === "syncAudio") {
      if (!engine) throw new Error("engine not initialized");
      const { refFile, inName, inBytes, vad, options } = msg.payload;
      const pcm = await decodeAudioToPcm(engine.config.ffmpeg, refFile, {
        status: (status) => post({ type: "status", status }),
      });
      post({ type: "status", status: "detecting speech + aligning…" });
      const result = syncAudioWithEngine(engine, {
        pcm,
        frameRate: engine.config.ffmpeg.frameRate,
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
