// Renders design/icons/*.svg to the PNG sizes Safari needs, using Playwright's
// WebKit (already a dev dependency). The monochrome toolbar icons come from
// scripts/render-toolbar-icons.mjs instead. Output: src/icons/ (extension) and
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

// Toolbar icons are rendered by scripts/render-toolbar-icons.mjs (no browser
// needed). These colours only drive the preview below; keep them in step.
const LIGHT_BAR_GLYPH = "#4A4A4F";
const DARK_BAR_GLYPH = "#D8D8DC";
const jobs = [{ svg: "truck-icon.svg", name: "icon", sizes: [48, 64, 96, 128, 256, 512] }];

const browser = await webkit.launch();
const page = await browser.newPage();
for (const job of jobs) {
  const svg = await readFile(join(root, "design", "icons", job.svg), "utf8");
  for (const size of job.sizes) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(
      `<html><body style="margin:0;background:transparent;color:${job.color ?? "#000"}">${svg.replace("<svg ", `<svg width="${size}" height="${size}" style="display:block" `)}</body></html>`,
    );
    await page.screenshot({ path: join(out, `${job.name}-${size}.png`), omitBackground: true });
  }
}

// Host app icons. macOS: every size in the asset catalog. iOS: one opaque
// 1024 (rendered as JPEG, then converted to PNG so it has no alpha channel).
const appIcons = join(root, "apple", "App", "Assets.xcassets", "AppIcon.appiconset");
await mkdir(appIcons, { recursive: true });
const macSvg = await readFile(join(root, "design", "icons", "truck-appicon-mac.svg"), "utf8");
for (const size of [16, 32, 64, 128, 256, 512, 1024]) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;background:transparent">${macSvg.replace("<svg ", `<svg width="${size}" height="${size}" `)}</body></html>`);
  await page.screenshot({ path: join(appIcons, `mac-${size}.png`), omitBackground: true });
}
const iosSvg = await readFile(join(root, "design", "icons", "truck-appicon-ios.svg"), "utf8");
await page.setViewportSize({ width: 1024, height: 1024 });
await page.setContent(`<html><body style="margin:0;background:#F5F3FF">${iosSvg.replace("<svg ", '<svg width="1024" height="1024" ')}</body></html>`);
const jpg = join(root, "build", "ios-1024.jpg");
await mkdir(join(root, "build"), { recursive: true });
await page.screenshot({ path: jpg, type: "jpeg", quality: 100 });
execFileSync("sips", ["-s", "format", "png", jpg, "--out", join(appIcons, "ios-1024.png")], { stdio: "ignore" });
await rm(jpg);

// Preview at real toolbar size (16 and 32 for retina) on light and dark bars,
// normal and active.
const t = await readFile(join(root, "design", "icons", "scout-truck-outline.svg"), "utf8");
const a = await readFile(join(root, "design", "icons", "scout-truck-outline-active.svg"), "utf8");
const i = await readFile(join(root, "design", "icons", "truck-icon.svg"), "utf8");
const icon = (s, n) => s.replace("<svg ", `<svg width="${n}" height="${n}" `);
const row = (bg, fg, label) =>
  `<div style="display:flex;gap:18px;align-items:center;padding:14px;background:${bg};color:${fg}">${icon(t, 16)}${icon(t, 19)}${icon(t, 32)}${icon(a, 16)}${icon(a, 32)}<span>${label}</span>${icon(i, 64)}</div>`;
await page.setViewportSize({ width: 560, height: 230 });
await page.setContent(`<html><body style="margin:0;font:12px -apple-system">
  ${row("#f2f2f7", LIGHT_BAR_GLYPH, "light toolbar (normal, active)")}
  ${row("#2b2d33", DARK_BAR_GLYPH, "dark toolbar (normal, active)")}
  <div style="padding:8px 14px;color:${LIGHT_BAR_GLYPH}">${icon(t, 96)}${icon(a, 96)}${icon(i, 96)}</div></body></html>`);
await mkdir(join(root, "build"), { recursive: true });
await page.screenshot({ path: join(root, "build", "icon-preview.png") });
await browser.close();
console.log("icons rendered to " + out);
