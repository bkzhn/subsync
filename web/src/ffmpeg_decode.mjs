// Decode a local video/audio File to mono s16le PCM using ffmpeg.wasm — without
// ever loading the whole file into memory. The File is mounted via WORKERFS,
// which reads it lazily through File.slice(), so multi-GB references work (only
// the decoded audio, which we downsample to `frameRate`, lands in memory).
//
// Returns a Uint8Array of raw PCM samples. Lazily loads ffmpeg.wasm from the CDN
// on first use (it is the largest asset and is not needed for subtitle-vs-subtitle
// syncing).

let _ffmpegPromise = null;

async function getFfmpeg(cfg, status) {
  if (_ffmpegPromise) return _ffmpegPromise;
  _ffmpegPromise = (async () => {
    status && status("loading ffmpeg.wasm…");
    const { FFmpeg } = await import(cfg.ffmpegCdn);
    const { toBlobURL } = await import(cfg.utilCdn);
    const ffmpeg = new FFmpeg();
    // Same-origin blob URLs for the core so the internal worker can load them.
    const [coreURL, wasmURL] = await Promise.all([
      toBlobURL(cfg.coreCdn + "ffmpeg-core.js", "text/javascript"),
      toBlobURL(cfg.coreCdn + "ffmpeg-core.wasm", "application/wasm"),
    ]);
    await ffmpeg.load({ coreURL, wasmURL });
    return ffmpeg;
  })();
  return _ffmpegPromise;
}

export async function decodeAudioToPcm(cfg, file, { status, stream } = {}) {
  const ffmpeg = await getFfmpeg(cfg, status);
  const frameRate = cfg.frameRate || 16000;
  const mountDir = "/mnt";
  const outPath = "/audio.pcm";
  // WORKERFS filenames come from file.name; keep it simple/safe.
  const mounted = `${mountDir}/${file.name}`;

  status && status("decoding audio (this can take a bit on long videos)…");
  try {
    try {
      await ffmpeg.createDir(mountDir);
    } catch {
      /* already exists */
    }
    await ffmpeg.mount("WORKERFS", { files: [file] }, mountDir);

    const args = ["-nostdin", "-i", mounted];
    if (stream) args.push("-map", stream);
    args.push(
      "-vn",
      "-ac", "1",
      "-af", "aresample=async=1",
      "-ar", String(frameRate),
      "-f", "s16le",
      "-acodec", "pcm_s16le",
      outPath,
    );
    const code = await ffmpeg.exec(args);
    if (code !== 0) throw new Error(`ffmpeg exited with code ${code}`);
    const data = await ffmpeg.readFile(outPath); // Uint8Array
    return data;
  } finally {
    try {
      await ffmpeg.deleteFile(outPath);
    } catch {
      /* ignore */
    }
    try {
      await ffmpeg.unmount(mountDir);
    } catch {
      /* ignore */
    }
  }
}
