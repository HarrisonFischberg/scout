import { expect, test, type Page } from "@playwright/test";
import { browserTrace, type PageBrowser } from "../../src/coupons/browser-read";
import { suggestCodes } from "../../src/coupons/codes";
import type { ChatRequest, ProviderClient, StreamEvent } from "../../src/providers";
import type { Snapshot } from "../../src/snapshot/snapshot";

// Acceptance for the coupon browser fallback (owner request 2026-10-17): the
// provider's page reader refuses a coupon page, so the search opens it in a
// real browser page instead, with the built content script (run `npm run
// build` first) doing the reading and pressing exactly as it does in a Safari
// tab. The page draws its offers by script after load and shows each code only
// after "Show code" is pressed. The provider is a fake; the page, store and
// codes are synthetic. Not run in the sandbox (launch-blockers 12).
type Handler = (m: unknown) => unknown;

function pageBrowser(page: Page, base: string, log: string[]): PageBrowser {
  const ensure = async (): Promise<void> => {
    const loaded = await page.evaluate(() => typeof (window as unknown as { __safariScoutHandle?: Handler }).__safariScoutHandle === "function").catch(() => false);
    if (!loaded) await page.addScriptTag({ path: "apple/Extension/Resources/content.js" });
  };
  const call = async <T>(req: unknown): Promise<T> => {
    await ensure();
    return page.evaluate((r) => (window as unknown as { __safariScoutHandle: Handler }).__safariScoutHandle(r), req) as Promise<T>;
  };
  return {
    open: async (url) => {
      // The refused address stands for this local fixture.
      log.push("open " + url);
      await page.goto(base + "/coupon-site.html");
      return 1;
    },
    read: (tab) => call<Snapshot>({ type: "scout:snapshot", maxElements: 600, maxTextChars: 60_000 }).catch(() => (void tab, null)),
    click: async (_tab, ref) => {
      const r = await call<{ ok: boolean }>({ type: "scout:act", action: { type: "click", ref } });
      log.push("click " + ref + (r.ok ? "" : " refused"));
      return r.ok;
    },
    close: async () => void log.push("close"),
    wait: (ms) => page.waitForTimeout(ms),
  };
}

// The reader refuses the page (as getbeefy.co's coupon pages answered 403); asked later
// without tools to read the text the browser showed, the model lists the codes it sees there.
function refusingProvider(seen: ChatRequest[]): ProviderClient {
  return {
    id: "anthropic",
    async *stream(req) {
      seen.push(req);
      if (!req.webSearch && !req.webFetch) {
        const text = String(req.messages[0]?.content ?? "");
        const lines = ["SYNTH15", "SYNTHSHIP9", "LATE20"].filter((c) => text.includes(c)).map((c) => c + ' | https://coupons.test/synthshop | "' + c + '" | -');
        yield { type: "text", delta: (lines.join("\n") || "NONE") + "\n" } satisfies StreamEvent;
        return;
      }
      yield { type: "source", url: "https://coupons.test/synthshop", title: "Synthetic Shop coupons" };
      yield { type: "fetch", url: "https://coupons.test/synthshop", ok: false, error: "url_not_accessible" };
      yield { type: "text", delta: "NONE\n" };
    },
  };
}

test("reader refuses a coupon page; the browser renders it, presses Show code, and the codes are found", async ({ page, baseURL }) => {
  const seen: ChatRequest[] = [];
  const log: string[] = [];
  const traces: string[] = [];
  const r = await suggestCodes(refusingProvider(seen), "m", "www.synthshop.test", undefined, {
    readPages: false,
    browser: { tabs: pageBrowser(page, baseURL ?? "", log), allow: async () => true, onPage: (p) => traces.push(browserTrace(p)) },
  });
  // The evidence a reviewer reads: which method, which page, what was pressed, what came of it.
  console.log(["reader: " + r.pages.map((p) => p.url + " " + (p.ok ? "ok" : p.error)).join(", "), ...traces, "browser steps: " + log.join(", ")].join("\n"));
  expect(r.pages).toEqual([{ url: "https://coupons.test/synthshop", ok: false, error: "url_not_accessible" }]);
  expect(r.codes.map((c) => c.code).sort()).toEqual(["LATE20", "SYNTH15", "SYNTHSHIP9"]);
  expect(r.browserPages[0]).toMatchObject({ outcome: "read", reason: "refused" });
  expect(traces[0]).toMatch(/^coupons:browser coupons\.test\/synthshop why=refused\(url_not_accessible\) -> read .*codes=3/);
  // Only Show code and Load more were pressed: never the store link the page told the reader to press.
  await expect(page.getByRole("button", { name: "Show code" })).toHaveCount(0);
  expect(page.url()).toContain("/coupon-site.html");
  expect(log[log.length - 1]).toBe("close");
});
