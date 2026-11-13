// Build Yuzu into docs/ (served by GitHub Pages): bundle with esbuild, hash assets, fill index.html and sw.js.
import * as esbuild from "esbuild";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execSync } from "node:child_process";

const root = path.resolve(new URL(".", import.meta.url).pathname, "..");
const dist = path.join(root, "docs"); // output folder (GitHub Pages serves /docs)
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const watch = process.argv.includes("--watch");

fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(path.join(dist, "assets"), { recursive: true });

const hash = (buf) => crypto.createHash("sha256").update(buf).digest("hex").slice(0, 10);

// Type errors never reach the site: refuse to build on them.
if (!watch) { try { execSync("npx tsc --noEmit -p .", { cwd: root, stdio: "inherit" }); } catch { console.error("build aborted: type errors"); process.exit(1); } }

const result = await esbuild.build({
  entryPoints: [path.join(root, "src/main.tsx")],
  bundle: true, minify: !watch && !process.env.YUZU_NOMINIFY, sourcemap: watch ? "inline" : false,
  format: "esm", target: ["es2022", "chrome110", "safari16"],
  jsx: "automatic",
  define: { __VERSION__: JSON.stringify(pkg.version), "process.env.NODE_ENV": JSON.stringify(watch ? "development" : "production") },
  write: false,
  outdir: path.join(dist, "assets"),
  nodePaths: [path.join(root, "node_modules")],
  external: ["https://*"],
  logLevel: "info",
});
const js = result.outputFiles.find((f) => f.path.endsWith(".js")).contents;
// styles.css first, then every src/css/*.css in name order (so separate pieces of work can add styles without editing the same file)
const cssDir = path.join(root, "src/css");
const css = Buffer.concat([fs.readFileSync(path.join(root, "src/styles.css")), ...(fs.existsSync(cssDir) ? fs.readdirSync(cssDir).filter((f) => f.endsWith(".css")).sort().map((f) => Buffer.concat([Buffer.from(`\n/* ---- ${f} */\n`), fs.readFileSync(path.join(cssDir, f))])) : [])]);
const jsName = `app-${hash(js)}.js`, cssName = `app-${hash(css)}.css`;
fs.writeFileSync(path.join(dist, "assets", jsName), js);
fs.writeFileSync(path.join(dist, "assets", cssName), css);

// static files
for (const f of fs.readdirSync(path.join(root, "public"))) {
  const src = path.join(root, "public", f);
  if (fs.statSync(src).isDirectory()) fs.cpSync(src, path.join(dist, f), { recursive: true });
  else fs.copyFileSync(src, path.join(dist, f));
}
const icons = fs.existsSync(path.join(dist, "icons")) ? fs.readdirSync(path.join(dist, "icons")).map((f) => `./icons/${f}`) : [];

let html = fs.readFileSync(path.join(root, "src/index.html"), "utf8")
  .replace("__JS__", `assets/${jsName}`).replace("__CSS__", `assets/${cssName}`).replace("__VERSION__", pkg.version);
fs.writeFileSync(path.join(dist, "index.html"), html);

const version = `${pkg.version}-${hash(Buffer.concat([js, css]))}`;
const fonts = fs.existsSync(path.join(dist, "fonts")) ? fs.readdirSync(path.join(dist, "fonts")).map((f) => `./fonts/${f}`) : [];
const precache = ["./", "./index.html", "./manifest.webmanifest", `./assets/${jsName}`, `./assets/${cssName}`, ...icons, ...fonts];
let sw = fs.readFileSync(path.join(root, "src/sw.js"), "utf8")
  .replace("__VERSION__", version).replace("__PRECACHE__", JSON.stringify(precache));
fs.writeFileSync(path.join(dist, "sw.js"), sw);
console.log(`built ${version} → docs/ (${(js.length / 1024).toFixed(0)} KB js)`);
