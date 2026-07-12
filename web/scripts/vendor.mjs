// Vendor the local ffsubsync Python sources + the browser bridge into a single
// JSON bundle the browser (or Node test) can fetch once and unpack into the
// Pyodide filesystem. Using the *local* sources (not the PyPI wheel) keeps the
// site faithful to this checkout's ffsubsync, including local modifications.
//
// Also (re)generates vendor/wheels/manifest.json from whatever *.whl are present
// in vendor/wheels/ (the webrtcvad wasm wheel, built separately / in CI). If no
// wheels are present the manifest is an empty list and the site falls back to the
// pure-Python auditok VAD.
//
// Usage: node web/scripts/vendor.mjs
// Output: web/vendor/py_sources.json, web/vendor/wheels/manifest.json

import { promises as fs } from "node:fs";
import { execSync } from "node:child_process";
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

  // ffsubsync's version is derived from git at runtime; there's no git in the
  // browser, so versioneer yields "0+unknown" and get_version() falls into its
  // frozen-binary branch (which reads a resource env var and crashes). Write the
  // _frozen_version module the code looks for first, exactly as a CI freeze would.
  let version = "0.0.0+browser";
  try {
    version = execSync("git describe --tags --always --dirty", { cwd: repoRoot })
      .toString()
      .trim();
  } catch {
    /* not a git checkout; keep the placeholder */
  }
  sources["ffsubsync/_frozen_version.py"] =
    `FFSUBSYNC_VERSION = ${JSON.stringify(version)}\n`;

  // Vendored pure-Python deps that have no PyPI wheel (micropip can only install
  // wheels), bundled as top-level modules — e.g. srt.py. See vendor/pysrc/.
  const pysrcDir = path.join(webDir, "vendor", "pysrc");
  try {
    for (const name of (await fs.readdir(pysrcDir)).sort()) {
      if (!name.endsWith(".py")) continue;
      sources[name] = await fs.readFile(path.join(pysrcDir, name), "utf8");
    }
  } catch {
    /* no vendored pysrc */
  }

  await fs.mkdir(outDir, { recursive: true });
  await fs.writeFile(outFile, JSON.stringify(sources));
  const count = Object.keys(sources).length;
  console.log(`vendored ${count} python files -> ${path.relative(repoRoot, outFile)}`);

  // Vendor @ffmpeg/ffmpeg + @ffmpeg/util (ESM) same-origin. ffmpeg.wasm's worker
  // uses relative imports (./const.js), which break when the module is loaded
  // cross-origin or as a blob — so it must be served from our own origin.
  const cfg = JSON.parse(await fs.readFile(path.join(webDir, "build.config.json"), "utf8"));
  const FF = {
    ffmpeg: {
      pkg: cfg.ffmpeg.ffmpegPkg,
      dir: "ffmpeg",
      files: ["index.js", "classes.js", "const.js", "errors.js", "types.js", "utils.js", "worker.js"],
    },
    util: {
      pkg: cfg.ffmpeg.utilPkg,
      dir: "util",
      files: ["index.js", "const.js", "errors.js", "types.js"],
    },
  };
  for (const { pkg, dir, files } of Object.values(FF)) {
    const destDir = path.join(outDir, dir);
    await fs.mkdir(destDir, { recursive: true });
    for (const name of files) {
      const url = `https://cdn.jsdelivr.net/npm/${pkg}/dist/esm/${name}`;
      const resp = await fetch(url);
      if (!resp.ok) throw new Error(`fetch ${url} -> ${resp.status}`);
      await fs.writeFile(path.join(destDir, name), await resp.text());
    }
    console.log(`vendored ${files.length} files from ${pkg} -> vendor/${dir}/`);
  }

  // Wheels manifest (webrtcvad wasm wheel, if built).
  const wheelDir = path.join(outDir, "wheels");
  await fs.mkdir(wheelDir, { recursive: true });
  const wheels = (await fs.readdir(wheelDir))
    .filter((n) => n.endsWith(".whl"))
    .sort();
  await fs.writeFile(path.join(wheelDir, "manifest.json"), JSON.stringify(wheels));
  console.log(
    wheels.length
      ? `wheels: ${wheels.join(", ")}`
      : "wheels: none (video/audio sync disabled until the webrtcvad wheel is built)",
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
