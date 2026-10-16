// Renders design/icons/*.svg to the PNG sizes Safari needs, using Playwright's
// WebKit (already a dev dependency). Output: src/icons/ (extension) and
// apple/App/Assets.xcassets/AppIcon.appiconset/ (host app: Dock, Command-Tab,
// Finder, iOS home screen). Also writes a light/dark toolbar preview to
// build/icon-preview.png for a visual check.
import { webkit } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const out = join(root, "src", "icons");
await mkdir(out, { recursive: true });

const jobs = [
  { svg: "binoculars-toolbar.svg", name: "toolbar", sizes: [16, 19, 32, 38, 48, 64] },
  { svg: "binoculars-icon.svg", name: "icon", sizes: [48, 64, 96, 128, 256, 512] },
];

const browser = await webkit.launch();
const page = await browser.newPage();
for (const job of jobs) {
  const svg = await readFile(join(root, "design", "icons", job.svg), "utf8");
  for (const size of job.sizes) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(
      `<html><body style="margin:0;background:transparent">${svg.replace("<svg ", `<svg width="${size}" height="${size}" `)}</body></html>`,
    );
    await page.screenshot({ path: join(out, `${job.name}-${size}.png`), omitBackground: true });
  }
}

// Host app icons. macOS: every size in the asset catalog. iOS: one opaque
// 1024 (rendered as JPEG, then converted to PNG so it has no alpha channel).
const appIcons = join(root, "apple", "App", "Assets.xcassets", "AppIcon.appiconset");
await mkdir(appIcons, { recursive: true });
const macSvg = await readFile(join(root, "design", "icons", "binoculars-appicon-mac.svg"), "utf8");
for (const size of [16, 32, 64, 128, 256, 512, 1024]) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;background:transparent">${macSvg.replace("<svg ", `<svg width="${size}" height="${size}" `)}</body></html>`);
  await page.screenshot({ path: join(appIcons, `mac-${size}.png`), omitBackground: true });
}
const iosSvg = await readFile(join(root, "design", "icons", "binoculars-appicon-ios.svg"), "utf8");
await page.setViewportSize({ width: 1024, height: 1024 });
await page.setContent(`<html><body style="margin:0;background:#F5F3FF">${iosSvg.replace("<svg ", '<svg width="1024" height="1024" ')}</body></html>`);
const jpg = join(root, "build", "ios-1024.jpg");
await mkdir(join(root, "build"), { recursive: true });
await page.screenshot({ path: jpg, type: "jpeg", quality: 100 });
execFileSync("sips", ["-s", "format", "png", jpg, "--out", join(appIcons, "ios-1024.png")], { stdio: "ignore" });
await rm(jpg);

// Preview at real toolbar size (16 and 32 for retina) on light and dark bars.
const t = await readFile(join(root, "design", "icons", "binoculars-toolbar.svg"), "utf8");
const i = await readFile(join(root, "design", "icons", "binoculars-icon.svg"), "utf8");
const icon = (s, n) => s.replace("<svg ", `<svg width="${n}" height="${n}" `);
await page.setViewportSize({ width: 520, height: 230 });
await page.setContent(`<html><body style="margin:0;font:12px -apple-system">
  <div style="display:flex;gap:18px;align-items:center;padding:14px;background:#f2f2f7">${icon(t, 16)}${icon(t, 19)}${icon(t, 32)}<span>light toolbar</span>${icon(i, 64)}</div>
  <div style="display:flex;gap:18px;align-items:center;padding:14px;background:#2b2d33;color:#ddd">${icon(t, 16)}${icon(t, 19)}${icon(t, 32)}<span>dark toolbar</span>${icon(i, 64)}</div>
  <div style="padding:8px 14px">${icon(t, 96)}${icon(i, 96)}</div></body></html>`);
await mkdir(join(root, "build"), { recursive: true });
await page.screenshot({ path: join(root, "build", "icon-preview.png") });
await browser.close();
console.log("icons rendered to " + out);
