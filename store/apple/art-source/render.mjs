// Renders the App Store screenshots in ../screenshots from scene.html, shots.json (the words)
// and the panel captures in build/appstore-panels. From the repo root:
//   npm run build:release
//   npx playwright test -c impeccable-review/tools/appstore.config.ts
//   node store/apple/art-source/render.mjs
import { chromium } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const panels = pathToFileURL(here("../../../build/appstore-panels/")).href;
// Output file, layout, panel capture, layout size in CSS px, and the final pixel size.
const SIZES = [
  { out: (n) => `mac/en-US/${n}.png`, layout: "mac", dev: "mac", w: 1440, h: 900, px: [2880, 1800] },
  { out: (n) => `ios/en-US/${n}-iphone-6.3.png`, layout: "phone", dev: "iphone", w: 402, h: 874, px: [1206, 2622] },
  // The same 402 x 874 layout zoomed to 440 wide; it comes out 0.6 px taller than 956, which the viewport trims.
  { out: (n) => `ios/en-US/${n}-iphone-6.9.png`, layout: "phone", dev: "iphone", w: 402, h: 874, px: [1320, 2868], zoom: 440 / 402 },
  { out: (n) => `ios/en-US/${n}-ipad-13.png`, layout: "pad", dev: "ipad", w: 1032, h: 1376, px: [2064, 2752] },
];
const shots = JSON.parse(readFileSync(here("shots.json"), "utf8"));
const b = await chromium.launch();
for (const z of SIZES) {
  const zoom = z.zoom ?? 1;
  const scale = z.px[0] / Math.round(z.w * zoom);
  const p = await b.newPage({ viewport: { width: z.px[0] / scale, height: z.px[1] / scale }, deviceScaleFactor: scale });
  for (const s of shots) {
    const u = new URL(pathToFileURL(here("scene.html")));
    for (const [k, v] of Object.entries({ layout: z.layout, s: s.s, w: z.w, h: z.h, h1: s.h1, p: s.p, zoom, img: `${panels}${z.dev}-${s.name}.png` })) u.searchParams.set(k, v);
    await p.goto(u.href);
    await p.evaluate(() => document.fonts.ready);
    await p.waitForTimeout(400);
    await p.screenshot({ path: here("../screenshots/" + z.out(s.name)) });
  }
  await p.close();
}
await b.close();
