// Diagnostic: boot the pinned Pyodide, report its platform tags, then try to
// micropip-install every deployed wasm wheel (webrtcvad, cchardet) and import
// them — printing the exact error. Run: node tests/wheel_probe.mjs
// (serves dist/site; needs network).

import http from "node:http";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const siteDir = path.resolve(here, "..", "dist", "site");
const PORT = 8137;
const MIME = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json", ".whl": "application/octet-stream", ".wasm": "application/wasm" };

const PROBE_HTML = `<!doctype html><meta charset=utf8><body><script type=module>
const log = (m) => { (window.__log ||= []).push(m); };
try {
  const cfg = await (await fetch('/build.config.json')).json();
  const { loadPyodide } = await import(cfg.pyodideCdn + 'pyodide.mjs');
  const pyodide = await loadPyodide({ indexURL: cfg.pyodideCdn });
  await pyodide.loadPackage(['micropip','setuptools']);
  const micropip = pyodide.pyimport('micropip');
  window.__platform = pyodide.runPython(\`
import sysconfig, sys
tags = []
try:
    from packaging.tags import sys_tags
    tags = [str(t) for t in list(sys_tags())[:6]]
except Exception as e:
    tags = ['<no packaging.tags: %s>' % e]
{'get_platform': sysconfig.get_platform(), 'sys_platform': sys.platform, 'top_tags': tags}
\`).toJs({dict_converter: Object.fromEntries});
  const manifest = await (await fetch('/vendor/wheels/manifest.json')).json();
  window.__manifest = manifest;
  const wheelUrls = manifest.map((n) => new URL('/vendor/wheels/' + n, location.href).href);
  try {
    await micropip.install(wheelUrls);
    window.__install = 'ok';
    window.__import = pyodide.runPython(\`
def _p():
    out = {}
    try:
        import webrtcvad
        out['webrtcvad'] = ['ok', getattr(webrtcvad, '__version__', '?')]
    except Exception:
        import traceback; out['webrtcvad'] = ['n/a', traceback.format_exc()]
    try:
        import cchardet
        out['cchardet'] = ['ok', cchardet.detect(b'Hello, world!')]
    except Exception:
        import traceback; out['cchardet'] = ['n/a', traceback.format_exc()]
    out
\`).toJs({dict_converter: Object.fromEntries});
  } catch (e) {
    window.__install = 'FAILED: ' + (e && e.message || e);
  }
} catch (e) {
  window.__fatal = String(e && e.stack || e);
}
window.__done = true;
</script></body>`;

const server = http.createServer(async (req, res) => {
  const url = req.url.split("?")[0];
  if (url === "/probe.html") { res.setHeader("Content-Type", "text/html"); return res.end(PROBE_HTML); }
  try {
    const full = path.join(siteDir, decodeURIComponent(url).replace(/^\/+/, "") || "index.html");
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
await page.goto(`http://localhost:${PORT}/probe.html`);
await page.waitForFunction(() => window.__done === true, null, { timeout: 240000 });
const out = await page.evaluate(() => ({
  platform: window.__platform, manifest: window.__manifest,
  install: window.__install, import: window.__import,
  fatal: window.__fatal, log: window.__log,
}));
console.log("\n===== PROBE RESULT =====");
console.log(JSON.stringify(out, null, 2));
await browser.close();
server.close();
