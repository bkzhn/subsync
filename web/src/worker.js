// Module Web Worker: runs Pyodide + ffsubsync off the main thread so the UI
// stays responsive while the (multi-MB) runtime loads and syncing runs.

import { bootEngine, syncWithEngine } from "./ffsubsync_engine.mjs";

let engine = null;

self.onmessage = async (event) => {
  const msg = event.data || {};
  try {
    if (msg.type === "init") {
      engine = await bootEngine({
        configUrl: msg.configUrl,
        onStatus: (status) => post({ type: "status", status }),
      });
      post({ type: "ready" });
    } else if (msg.type === "sync") {
      if (!engine) throw new Error("engine not initialized");
      post({ type: "status", status: "syncing…" });
      const result = syncWithEngine(engine, msg.payload);
      post({ type: "result", result });
    }
  } catch (err) {
    post({ type: "error", error: String((err && err.stack) || err) });
  }
};

function post(message) {
  self.postMessage(message);
}
