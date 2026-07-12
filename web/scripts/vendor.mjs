// Vendor the local ffsubsync Python sources + the browser bridge into a single
// JSON bundle the browser (or Node test) can fetch once and unpack into the
// Pyodide filesystem. Using the *local* sources (not the PyPI wheel) keeps the
// site faithful to this checkout's ffsubsync, including local modifications.
//
// Usage: node web/scripts/vendor.mjs
// Output: web/vendor/py_sources.json  -> { "ffsubsync/xxx.py": "<text>", ... }

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const webDir = path.resolve(here, "..");
const repoRoot = path.resolve(webDir, "..");

const ffsubsyncPkg = path.join(repoRoot, "ffsubsync");
const bridgeSrc = path.join(webDir, "src", "ffsubsync_bridge.py");
const outDir = path.join(webDir, "vendor");
const outFile = path.join(outDir, "py_sources.json");

async function main() {
  const sources = {};

  const entries = await fs.readdir(ffsubsyncPkg);
  for (const name of entries.sort()) {
    if (!name.endsWith(".py")) continue;
    const text = await fs.readFile(path.join(ffsubsyncPkg, name), "utf8");
    sources[`ffsubsync/${name}`] = text;
  }
  if (!sources["ffsubsync/__init__.py"]) {
    throw new Error(`no ffsubsync package found at ${ffsubsyncPkg}`);
  }

  sources["ffsubsync_bridge.py"] = await fs.readFile(bridgeSrc, "utf8");

  await fs.mkdir(outDir, { recursive: true });
  await fs.writeFile(outFile, JSON.stringify(sources));
  const count = Object.keys(sources).length;
  console.log(`vendored ${count} python files -> ${path.relative(repoRoot, outFile)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
