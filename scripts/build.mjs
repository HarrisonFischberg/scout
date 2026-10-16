// Bundles src/ into the Safari extension Resources folder and copies static files.
import { build } from "esbuild";
import { copyFile } from "node:fs/promises";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const src = join(root, "src");
const out = join(root, "apple", "Extension", "Resources");

await build({
  entryPoints: {
    background: join(src, "background.ts"),
    popup: join(src, "popup.ts"),
  },
  outdir: out,
  bundle: true,
  format: "iife",
  target: "safari16",
  platform: "browser",
  logLevel: "warning",
});

for (const file of ["manifest.json", "popup.html"]) {
  await copyFile(join(src, file), join(out, file));
}

console.log(`built extension to ${out}`);
