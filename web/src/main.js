// UI glue: wires the file inputs + options to the Pyodide worker and renders
// the synced result. No data leaves the browser — everything runs in the worker
// (Pyodide for alignment, ffmpeg.wasm for audio decoding).

const els = {
  ref: document.getElementById("ref-file"),
  refLabel: document.getElementById("ref-label"),
  input: document.getElementById("input-file"),
  noFixFramerate: document.getElementById("no-fix-framerate"),
  gss: document.getElementById("gss"),
  syncBtn: document.getElementById("sync-btn"),
  status: document.getElementById("status"),
  progress: document.getElementById("progress"),
  progressFill: document.getElementById("progress-fill"),
  progressPct: document.getElementById("progress-pct"),
  result: document.getElementById("result"),
  offset: document.getElementById("offset"),
  download: document.getElementById("download"),
};

const SUBTITLE_ACCEPT = ".srt,.ass,.ssa,.ttml,.vtt,.sub";
const VIDEO_ACCEPT = "video/*,audio/*,.mkv,.mp4,.avi,.mov,.webm,.m4v,.mka,.mp3,.aac,.flac,.wav,.ogg";

// Cache-busting: index.html loads this as main.js?v=<build>. Thread that version
// onto everything we load so a new deploy never mixes fresh + stale modules.
const V = new URL(import.meta.url).searchParams.get("v") || "";
const withV = (url) => (V ? url + (url.includes("?") ? "&" : "?") + "v=" + V : url);

const configUrl = withV(new URL("./build.config.json", document.baseURI).href);
const worker = new Worker(
  withV(new URL("./src/worker.js", document.baseURI).href),
  { type: "module" },
);

let engineReady = false;
let capabilities = { webrtcvad: false };
let ffmpegConfig = null;

worker.onmessage = (event) => {
  const msg = event.data || {};
  if (msg.type === "status") {
    setStatus(msg.status);
  } else if (msg.type === "ready") {
    engineReady = true;
    capabilities = msg.capabilities || capabilities;
    ffmpegConfig = msg.ffmpeg || null;
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

worker.onerror = (e) =>
  setStatus("Worker failed to load: " + (e.message || e.filename || e), true);
worker.onmessageerror = () => setStatus("Worker message error", true);

setStatus("Loading Python runtime (first load downloads a few MB)…");
worker.postMessage({
  type: "init",
  configUrl,
  engineUrl: withV(new URL("./src/ffsubsync_engine.mjs", document.baseURI).href),
});

for (const input of [els.ref, els.input]) {
  input.addEventListener("change", refreshButton);
}
for (const radio of document.querySelectorAll('input[name="ref-type"]')) {
  radio.addEventListener("change", onRefTypeChange);
}
els.syncBtn.addEventListener("click", onSync);

function refType() {
  return document.querySelector('input[name="ref-type"]:checked').value;
}

function onRefTypeChange() {
  const isVideo = refType() === "video";
  els.ref.accept = isVideo ? VIDEO_ACCEPT : SUBTITLE_ACCEPT;
  els.refLabel.innerHTML = isVideo
    ? 'Reference video / audio <span class="hint">— a correctly-timed movie or audio track</span>'
    : 'Reference subtitles <span class="hint">— a correctly-timed .srt / .ass / .ssa</span>';
  els.ref.value = "";
  refreshButton();
}

function refreshButton() {
  els.syncBtn.disabled = !(engineReady && els.ref.files[0] && els.input.files[0]);
}

async function onSync() {
  const refFile = els.ref.files[0];
  const inFile = els.input.files[0];
  if (!refFile || !inFile) return;
  setBusy(true);
  els.result.hidden = true;

  const options = {
    output_encoding: "utf-8",
    no_fix_framerate: !!els.noFixFramerate.checked,
    gss: !!els.gss.checked,
  };

  // The input subtitle is always small — read it into memory.
  setStatus("Reading input subtitles…");
  const inBytes = new Uint8Array(await inFile.arrayBuffer());

  if (refType() === "video") {
    if (!capabilities.webrtcvad) {
      setStatus(
        "Video/audio sync needs the WebRTC VAD component, which isn't available " +
          "in this build. Use a subtitle reference, or build the webrtcvad wheel.",
        true,
      );
      setBusy(false);
      return;
    }
    // Decode audio on the main thread with ffmpeg.wasm (it spawns its own worker;
    // nesting that inside the Pyodide worker hangs). The reference File is mounted
    // lazily via WORKERFS — never fully read into memory — then only the decoded
    // PCM is transferred to the Pyodide worker for VAD + alignment.
    let pcm;
    showProgress();
    try {
      const { decodeAudioToPcm } = await import(
        withV(new URL("./ffmpeg_decode.mjs", import.meta.url).href)
      );
      // Resolve the vendored module paths to absolute URLs against the site root.
      const ff = {
        ...ffmpegConfig,
        module: withV(new URL(ffmpegConfig.module, document.baseURI).href),
        util: withV(new URL(ffmpegConfig.util, document.baseURI).href),
      };
      pcm = await decodeAudioToPcm(ff, refFile, {
        status: setStatus,
        onProgress: setProgress,
      });
    } catch (e) {
      console.error(e);
      hideProgress();
      setStatus("audio decode failed: " + (e && e.message || e), true);
      setBusy(false);
      return;
    }
    // Decode done; the VAD/align phase has no measurable progress, so drop back
    // to the text status.
    hideProgress();
    worker.postMessage(
      {
        type: "syncAudioPcm",
        payload: {
          pcm,
          frameRate: ffmpegConfig.frameRate,
          inName: inFile.name,
          inBytes,
          vad: "webrtc",
          options,
        },
      },
      [pcm.buffer, inBytes.buffer],
    );
  } else {
    setStatus("Reading reference…");
    const refBytes = new Uint8Array(await refFile.arrayBuffer());
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
      [refBytes.buffer, inBytes.buffer],
    );
  }
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

// Show the decode progress bar, starting indeterminate (ffmpeg.wasm loads before
// any progress events arrive).
function showProgress() {
  els.progress.hidden = false;
  els.progress.classList.add("indeterminate");
  els.progressFill.style.width = "0%";
  els.progressPct.textContent = "";
  els.progress.removeAttribute("aria-valuenow");
}

// Drive the bar from ffmpeg's 0–1 progress. A non-finite or out-of-range value
// (duration unknown) keeps the bar indeterminate rather than showing a bogus %.
function setProgress(fraction) {
  if (Number.isFinite(fraction) && fraction > 0 && fraction <= 1) {
    const pct = Math.round(fraction * 100);
    els.progress.classList.remove("indeterminate");
    els.progressFill.style.width = pct + "%";
    els.progressPct.textContent = pct + "%";
    els.progress.setAttribute("aria-valuenow", String(pct));
  }
}

function hideProgress() {
  els.progress.hidden = true;
  els.progress.classList.remove("indeterminate");
}

function setBusy(busy) {
  els.syncBtn.disabled = busy;
  els.syncBtn.textContent = busy ? "Syncing…" : "Sync subtitles";
  if (!busy) {
    hideProgress();
    refreshButton();
  }
}
