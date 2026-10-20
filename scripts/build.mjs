// Bundles src/ into the Safari extension Resources folder and copies static files.
// SCOUT_TARGET=chrome or firefox builds that browser's package into dist/<target>/
// plus a store zip instead (scripts/targets.mjs).
import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { CHROME_SHIM, ESBUILD_TARGET, TARGETS, manifestFor } from "./targets.mjs";

const root = new URL("..", import.meta.url).pathname;
const src = join(root, "src");
const target = process.env.SCOUT_TARGET || "safari";
if (!TARGETS.includes(target)) throw new Error(`SCOUT_TARGET must be one of ${TARGETS.join(", ")}`);
const out = target === "safari" ? join(root, "apple", "Extension", "Resources") : join(root, "dist", target);
if (target !== "safari") {
  await rm(out, { recursive: true, force: true });
  await mkdir(out, { recursive: true });
}
const manifest = JSON.parse(await readFile(join(src, "manifest.json"), "utf8"));
// Debug builds include local diagnostics (src/diagnostics.ts). Release builds
// (`npm run build:release`) compile them out entirely.
const release = process.env.SCOUT_BUILD === "release";

await build({
  entryPoints: {
    background: join(src, "background.ts"),
    popup: join(src, "popup.ts"),
    content: join(src, "content.ts"),
    edge: join(src, "edge.ts"),
    overlay: join(src, "overlay.ts"),
  },
  outdir: out,
  bundle: true,
  format: "iife",
  target: ESBUILD_TARGET[target],
  ...(target === "chrome" ? { banner: { js: CHROME_SHIM } } : {}),
  platform: "browser",
  logLevel: "warning",
  // Needed so `if (__SCOUT_DEBUG__)` branches are removed, not just skipped.
  minifySyntax: release,
  treeShaking: true,
  define: {
    __SCOUT_DEBUG__: release ? "false" : "true",
    __SCOUT_VERSION__: JSON.stringify(manifest.version),
    __SCOUT_TARGET__: JSON.stringify(target),
  },
});

await writeFile(join(out, "manifest.json"), JSON.stringify(manifestFor(target, manifest), null, 2) + "\n");
// Toolbar + extension icons (rendered from design/icons by scripts/render-icons.mjs).
await cp(join(src, "icons"), join(out, "icons"), { recursive: true });
const popupHtml = await readFile(join(src, "popup.html"), "utf8");
await writeFile(
  join(out, "popup.html"),
  release ? popupHtml.replace(/\s*<!-- debug:start[\s\S]*?<!-- debug:end -->/g, "") : popupHtml,
);

console.log(`built ${target} extension to ${out} (${release ? "release" : "debug"})`);

// Store package: the folder's contents zipped at the root, as both stores expect.
if (target !== "safari") {
  const zip = join(root, "dist", `scout-${target}-${manifest.version}${release ? "" : "-debug"}.zip`);
  await rm(zip, { force: true });
  execFileSync("zip", ["-qr", "-X", zip, "."], { cwd: out });
  console.log(`packaged ${zip}`);
}
