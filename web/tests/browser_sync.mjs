// Headless browser test of the full Pyodide path: serve dist/site, drive the UI
// with two synthetic SRTs offset by a known amount, and assert the detected
// offset. Requires network (Pyodide CDN + PyPI wheels) and Playwright, so it is
// intended for CI. Run via: make test-browser
//
// Exits 0 on success, non-zero on failure.

import http from "node:http";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const siteDir = path.resolve(here, "..", "dist", "site");
const EXPECTED_OFFSET = -5.0;
const PORT = 8123;

const MIME = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".json": "application/json",
  ".srt": "application/x-subrip",
};

function ts(t) {
  if (t < 0) t = 0;
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = Math.floor(t % 60);
  const ms = Math.round((t - Math.floor(t)) * 1000);
  const p = (n, w = 2) => String(n).padStart(w, "0");
  return `${p(h)}:${p(m)}:${p(s)},${p(ms, 3)}`;
}

function makeSrt(offset, n = 40) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const start = i * 2.0 + offset;
    out.push(String(i + 1), `${ts(start)} --> ${ts(start + 1)}`, `line ${i + 1}`, "");
  }
  return out.join("\n");
}

async function startServer() {
  const server = http.createServer(async (req, res) => {
    try {
      const rel = decodeURIComponent(req.url.split("?")[0]).replace(/^\/+/, "");
      const full = path.join(siteDir, rel || "index.html");
      const data = await fs.readFile(full);
      res.setHeader("Content-Type", MIME[path.extname(full)] || "application/octet-stream");
      res.end(data);
    } catch {
      res.statusCode = 404;
      res.end("not found");
    }
  });
  await new Promise((r) => server.listen(PORT, r));
  return server;
}

async function main() {
  let chromium;
  try {
    ({ chromium } = await import("playwright"));
  } catch {
    console.error(
      "Playwright not installed. Run `npm i -D playwright && npx playwright install chromium`.",
    );
    process.exit(2);
  }

  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "ffs-browser-"));
  const refPath = path.join(tmp, "reference.srt");
  const inPath = path.join(tmp, "input.srt");
  await fs.writeFile(refPath, makeSrt(0.0));
  await fs.writeFile(inPath, makeSrt(5.0));

  const server = await startServer();
  const browser = await chromium.launch();
  const page = await browser.newPage();
  page.on("console", (m) => console.log("[page]", m.text()));

  let failed = false;
  try {
    await page.goto(`http://localhost:${PORT}/index.html`);
    // Wait until the worker reports the engine is ready.
    await page.waitForFunction(
      () => document.getElementById("status").textContent.includes("Ready"),
      { timeout: 180000 },
    );
    await page.setInputFiles("#ref-file", refPath);
    await page.setInputFiles("#input-file", inPath);
    await page.click("#sync-btn");
    await page.waitForSelector("#result:not([hidden])", { timeout: 120000 });
    const offsetText = await page.textContent("#offset");
    const match = offsetText.match(/offset\s*([-+]?[0-9.]+)s/);
    if (!match) throw new Error(`could not parse offset from "${offsetText}"`);
    const offset = parseFloat(match[1]);
    console.log(`detected offset: ${offset}s (expected ~${EXPECTED_OFFSET})`);
    if (Math.abs(offset - EXPECTED_OFFSET) > 0.25) {
      throw new Error(`offset ${offset} != expected ${EXPECTED_OFFSET}`);
    }
    console.log("PASS: browser sync produced the expected offset");
  } catch (err) {
    failed = true;
    console.error("FAIL:", err);
  } finally {
    await browser.close();
    server.close();
  }
  process.exit(failed ? 1 : 0);
}

main();
