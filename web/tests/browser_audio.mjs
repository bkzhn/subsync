// Full audio-path browser test: drive the deployed UI with a synthesized WAV
// reference (speech-band energy during known cue intervals) + a shifted SRT, and
// assert the recovered offset. Exercises ffmpeg.wasm decode (WORKERFS) -> webrtc
// VAD (wasm wheel) -> alignment, end-to-end in headless Chromium.
//
// Requires the webrtcvad wheel present in dist/site (make wheels) + network.
// Run: node tests/browser_audio.mjs

import http from "node:http";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const siteDir = path.resolve(here, "..", "dist", "site");
const PORT = 8145;
const FRAME_RATE = 16000;
const EXPECTED = -5.0;
const N = 40;
const MIME = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json", ".whl": "application/octet-stream", ".wasm": "application/wasm" };

const ts = (t) => {
  if (t < 0) t = 0;
  const p = (n, w = 2) => String(n).padStart(w, "0");
  return `${p(Math.floor(t / 3600))}:${p(Math.floor((t % 3600) / 60))}:${p(Math.floor(t % 60))},${p(Math.round((t - Math.floor(t)) * 1000), 3)}`;
};
function makeSrt(offset) {
  const o = [];
  for (let i = 0; i < N; i++) { const s = i * 2 + offset; o.push(String(i + 1), `${ts(s)} --> ${ts(s + 1)}`, `line ${i + 1}`, ""); }
  return o.join("\n");
}
function makeWav() {
  const total = N * 2, n = total * FRAME_RATE;
  const pcm = new Int16Array(n);
  for (let i = 0; i < N; i++) {
    const a = Math.floor(i * 2 * FRAME_RATE), b = Math.floor((i * 2 + 1) * FRAME_RATE);
    for (let k = a; k < b; k++) {
      const t = k / FRAME_RATE;
      let v = 0; for (const f of [150, 300, 600, 1200, 2400]) v += Math.sin(2 * Math.PI * f * t);
      pcm[k] = Math.max(-1, Math.min(1, (v / 5) * 0.8)) * 32767;
    }
  }
  const bytes = Buffer.from(pcm.buffer);
  const header = Buffer.alloc(44);
  header.write("RIFF", 0); header.writeUInt32LE(36 + bytes.length, 4); header.write("WAVE", 8);
  header.write("fmt ", 12); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22); header.writeUInt32LE(FRAME_RATE, 24);
  header.writeUInt32LE(FRAME_RATE * 2, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34);
  header.write("data", 36); header.writeUInt32LE(bytes.length, 40);
  return Buffer.concat([header, bytes]);
}

const server = http.createServer(async (req, res) => {
  try {
    const full = path.join(siteDir, decodeURIComponent(req.url.split("?")[0]).replace(/^\/+/, "") || "index.html");
    const data = await fs.readFile(full);
    res.setHeader("Content-Type", MIME[path.extname(full)] || "application/octet-stream");
    res.end(data);
  } catch { res.statusCode = 404; res.end("nf"); }
});
await new Promise((r) => server.listen(PORT, r));

const { chromium } = await import("playwright");
const browser = await chromium.launch();
const page = await browser.newPage();
page.on("console", (m) => console.log("[page]", m.text()));
page.on("pageerror", (e) => console.log("[pageerror]", e.message));

let failed = false;
let lastStatus = "";
const statusPoll = setInterval(async () => {
  try {
    const s = await page.textContent("#status");
    if (s && s !== lastStatus) { lastStatus = s; console.log("[status]", s); }
  } catch { /* page gone */ }
}, 2000);
try {
  await page.goto(`http://localhost:${PORT}/index.html`);
  await page.waitForFunction(() => {
    const s = document.getElementById("status").textContent;
    if (s.startsWith("Error")) throw new Error(s);
    return s.includes("Ready");
  }, null, { timeout: 240000 });

  await page.check('input[name="ref-type"][value="video"]');
  await page.setInputFiles("#ref-file", { name: "reference.wav", mimeType: "audio/wav", buffer: makeWav() });
  await page.setInputFiles("#input-file", { name: "input.srt", mimeType: "application/x-subrip", buffer: Buffer.from(makeSrt(5.0)) });
  await page.click("#sync-btn");
  await page.waitForSelector("#result:not([hidden])", { timeout: 240000 });
  const offsetText = await page.textContent("#offset");
  const m = offsetText.match(/offset\s*([-+]?[0-9.]+)s/);
  if (!m) throw new Error(`no offset in "${offsetText}"`);
  const offset = parseFloat(m[1]);
  console.log(`detected offset: ${offset}s (expected ~${EXPECTED})`);
  if (Math.abs(offset - EXPECTED) > 0.3) throw new Error(`offset ${offset} != ${EXPECTED}`);
  console.log("PASS: browser audio sync (ffmpeg.wasm + webrtc wheel) produced the expected offset");
} catch (err) {
  failed = true;
  console.error("FAIL:", err.message || err);
} finally {
  clearInterval(statusPoll);
  await browser.close();
  server.close();
}
process.exit(failed ? 1 : 0);
