import { test } from "@playwright/test";
import { join, resolve } from "node:path";

// Review-only: the Scout pieces drawn on a web page (page button, Scout-mode glow and toast), on the shop fixture.
const ROOT = resolve(new URL(".", import.meta.url).pathname, "../..");
const RES = join(ROOT, "apple/Extension/Resources");
const OUT = resolve(ROOT, process.env.OUT ?? "impeccable-review/before");
const PLATS = {
  mac: { viewport: { width: 1100, height: 700 }, deviceScaleFactor: 2 },
  iphone: { viewport: { width: 393, height: 740 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
};
for (const [plat, opts] of Object.entries(PLATS)) {
  for (const scheme of ["light", "dark"] as const) {
    test.describe(`${plat} ${scheme}`, () => {
      test.use({ ...opts, colorScheme: scheme });
      test("page button and Scout glow", async ({ page }) => {
        await page.addInitScript(() => {
          const g = globalThis as unknown as Record<string, unknown>;
          const data: Record<string, unknown> = { pageButton: { on: true } };
          g.browser = {
            runtime: { id: "scout-test", getURL: (p: string) => location.origin + "/" + p,
              sendMessage: async (m: { type: string; request_id: string }) => ({ type: m.type + ".result", request_id: m.request_id, payload: { ok: true } }),
              onMessage: { addListener() {} } },
            extension: { inIncognitoContext: false },
            storage: { local: { get: async (k: string | string[]) => Object.fromEntries((Array.isArray(k) ? k : [k]).filter((x) => x in data).map((x) => [x, data[x]])), set: async () => {} }, onChanged: { addListener() {} } },
          };
        });
        await page.goto("/shop.html");
        await page.addStyleTag({ content: "body{font-family:Inter,sans-serif}" });
        await page.addScriptTag({ path: join(RES, "edge.js") });
        await page.waitForTimeout(1200);
        await page.screenshot({ path: join(OUT, `${plat}-${scheme}-16-page-button.png`) });
        await page.addScriptTag({ path: join(RES, "content.js") });
        await page.addScriptTag({ path: join(RES, "overlay.js") });
        await page.evaluate(() => (window as unknown as { __safariScoutOverlay: (r: unknown) => Promise<unknown> }).__safariScoutOverlay({ type: "overlay:show", taskId: "t1", state: "running" }));
        await page.waitForTimeout(900);
        await page.screenshot({ path: join(OUT, `${plat}-${scheme}-17-scout-glow.png`) });
      });
    });
  }
}
