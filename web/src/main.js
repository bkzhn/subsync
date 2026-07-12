// UI glue: wires the file inputs + options to the Pyodide worker and renders
// the synced result. No data leaves the browser — everything runs in the worker.

const els = {
  ref: document.getElementById("ref-file"),
  input: document.getElementById("input-file"),
  noFixFramerate: document.getElementById("no-fix-framerate"),
  gss: document.getElementById("gss"),
  syncBtn: document.getElementById("sync-btn"),
  status: document.getElementById("status"),
  result: document.getElementById("result"),
  offset: document.getElementById("offset"),
  download: document.getElementById("download"),
};

const configUrl = new URL("./build.config.json", document.baseURI).href;
const worker = new Worker(new URL("./src/worker.js", document.baseURI), {
  type: "module",
});

let engineReady = false;

worker.onmessage = (event) => {
  const msg = event.data || {};
  if (msg.type === "status") {
    setStatus(msg.status);
  } else if (msg.type === "ready") {
    engineReady = true;
    setStatus("Ready. Pick a reference and a subtitle file to sync.");
    refreshButton();
  } else if (msg.type === "result") {
    renderResult(msg.result);
    setBusy(false);
  } else if (msg.type === "error") {
    setStatus("Error: " + msg.error, true);
    setBusy(false);
  }
};

setStatus("Loading Python runtime (first load downloads a few MB)…");
worker.postMessage({ type: "init", configUrl });

for (const input of [els.ref, els.input]) {
  input.addEventListener("change", refreshButton);
}
els.syncBtn.addEventListener("click", onSync);

function refreshButton() {
  els.syncBtn.disabled = !(engineReady && els.ref.files[0] && els.input.files[0]);
}

async function onSync() {
  const refFile = els.ref.files[0];
  const inFile = els.input.files[0];
  if (!refFile || !inFile) return;
  setBusy(true);
  els.result.hidden = true;
  setStatus("Reading files…");

  const [refBuf, inBuf] = await Promise.all([
    refFile.arrayBuffer(),
    inFile.arrayBuffer(),
  ]);
  const refBytes = new Uint8Array(refBuf);
  const inBytes = new Uint8Array(inBuf);

  const options = {
    output_encoding: "utf-8",
    no_fix_framerate: !!els.noFixFramerate.checked,
    gss: !!els.gss.checked,
  };

  worker.postMessage(
    {
      type: "sync",
      payload: {
        refName: refFile.name,
        inName: inFile.name,
        refBytes,
        inBytes,
        options,
      },
    },
    [refBytes.buffer, inBytes.buffer], // transfer, don't copy
  );
}

function renderResult(result) {
  if (!result || !result.ok) {
    setStatus((result && result.error) || "Sync failed.", true);
    if (result && result.error) console.error(result.error);
    return;
  }
  const offset = Number(result.offset_seconds);
  const scale = Number(result.framerate_scale_factor);
  els.offset.textContent =
    `offset ${offset >= 0 ? "+" : ""}${offset.toFixed(3)}s` +
    (Math.abs(scale - 1) > 1e-6 ? ` · framerate ×${scale.toFixed(3)}` : "");

  const blob = new Blob([result.output_text], {
    type: "application/x-subrip;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  els.download.href = url;
  els.download.download = result.output_name || "synced.srt";
  els.result.hidden = false;
  setStatus("Done.");
}

function setStatus(text, isError = false) {
  els.status.textContent = text;
  els.status.classList.toggle("error", isError);
}

function setBusy(busy) {
  els.syncBtn.disabled = busy;
  els.syncBtn.textContent = busy ? "Syncing…" : "Sync subtitles";
  if (!busy) refreshButton();
}
