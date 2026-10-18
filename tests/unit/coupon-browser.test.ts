// Browser fallback for coupon pages (owner request 2026-10-17): when the
// provider's page reader refuses a page (getbeefy.co's coupon pages answered
// 403), Scout opens it in a background tab, presses "Show code", and reads
// the codes there. Synthetic stores, pages and codes only; the tab is a fake.
import { describe, expect, it } from "vitest";
import { BROWSER_MAX_PAGES, browserRead, browserTrace, codeAlone, couponControls, revealedCodes, type PageBrowser } from "../../src/coupons/browser-read";
import { suggestCodes } from "../../src/coupons/codes";
import type { ProviderClient, StreamEvent, ChatRequest } from "../../src/providers";
import type { SnapElement, Snapshot } from "../../src/snapshot/snapshot";

const snap = (url: string, text: string, elements: Array<Partial<SnapElement> & { name: string }> = []): Snapshot => ({
  url,
  title: "Synthetic coupons",
  text,
  truncated: false,
  elements: elements.map((e, i) => ({ ref: "e" + (i + 1), tag: "button", role: "button", ...e })),
});

const FILLER = "Synthetic Shop coupons and promo codes, updated today. ".repeat(6);

/**
 * A fake coupon page: two offers behind "Show code" buttons, and a "Load more"
 * button that adds a third. Pressing a button replaces it with the code, as
 * coupon sites do. Every press is logged.
 */
function couponSite(url: string, opts: { captcha?: boolean; leaveOnPress?: string } = {}): PageBrowser & { log: string[]; closed: number[] } {
  const log: string[] = [];
  const closed: number[] = [];
  const shown = new Set<number>();
  let more = false;
  let at = url;
  const offers = [
    { code: "SYNTH15", what: "15% off sitewide, expires 12/31" },
    { code: "SYNTHSHIP9", what: "Free shipping on orders over $50" },
    { code: "LATE20", what: "20% off first order" },
  ];
  const view = (): Snapshot => {
    if (opts.captcha) return snap(at, FILLER + "\nPlease verify you are a human to continue.");
    const list = offers.slice(0, more ? 3 : 2);
    const lines = [FILLER, ...list.flatMap((o, i) => [o.what, shown.has(i) ? o.code : "Code hidden"])];
    const els: Array<Partial<SnapElement> & { name: string }> = list.map((o, i) => (shown.has(i) ? { name: o.code + " Copy" } : { name: "Show code" }));
    if (!more) els.push({ name: "Load more coupons" });
    els.push({ name: "Shop now at Synthetic Shop", tag: "a", role: "link", href: "https://www.synthshop.test/?aff=1" });
    els.push({ name: "Sign in", tag: "a", role: "link", href: "/login" });
    return snap(at, lines.join("\n"), els);
  };
  let last = view();
  return {
    log,
    closed,
    open: async (u) => {
      log.push("open " + u);
      return 7;
    },
    read: async () => (last = view()),
    click: async (_tab, ref) => {
      const el = last.elements.find((e) => e.ref === ref);
      log.push("click " + (el?.name ?? "?"));
      if (!el) return false;
      if (opts.leaveOnPress && el.name === "Show code") {
        at = opts.leaveOnPress;
        return true;
      }
      if (el.name === "Load more coupons") more = true;
      else if (el.name === "Show code") {
        const i = last.elements.filter((e) => e.name === "Show code" || /Copy$/.test(e.name)).indexOf(el);
        shown.add(i);
      }
      return true;
    },
    close: async (tab) => {
      closed.push(tab);
    },
    wait: async () => undefined,
  };
}

describe("coupon controls and codes on a rendered page", () => {
  it("presses Show code and Load more, never links off the site, sign-in or orders", () => {
    const s = snap("https://coupons.test/synthshop", FILLER, [
      { name: "Show code" },
      { name: "Reveal coupon" },
      { name: "Load more" },
      { name: "Get deal", tag: "a", role: "link", href: "https://www.synthshop.test/?aff=1" },
      { name: "Show code", tag: "a", role: "link", href: "https://out.coupons-redirect.test/x" },
      { name: "Sign in to see code" },
      { name: "Place order" },
    ]);
    expect(couponControls(s).map((e) => e.name)).toEqual(["Show code", "Reveal coupon", "Load more"]);
  });

  it("reads a code standing alone and ignores labels", () => {
    expect(codeAlone("SYNTH15")).toBe("SYNTH15");
    expect(codeAlone("SYNTH15 Copy")).toBe("SYNTH15");
    expect(codeAlone("Code: CYBERTACK")).toBe("CYBERTACK");
    for (const s of ["COPY", "VERIFIED", "SALE", "Show code", "15% off", "TOP", "synth15"]) expect(codeAlone(s)).toBeNull();
  });

  it("finds the code a press revealed", () => {
    const before = snap("https://c.test/a", "Offer\nCode hidden", [{ name: "Show code" }]);
    const after = snap("https://c.test/a", "Offer\nSYNTH15\n15% off", [{ name: "SYNTH15 Copy" }]);
    expect(revealedCodes(before, after).map((r) => r.code)).toEqual(["SYNTH15"]);
  });
});

describe("browserRead", () => {
  it("opens the page, presses each Show code and Load more, reads every code, and closes the tab", async () => {
    const site = couponSite("https://coupons.test/synthshop");
    const r = await browserRead([{ url: "https://coupons.test/synthshop", reason: "refused", error: "403" }], site);
    expect(r.codes.map((c) => c.code).sort()).toEqual(["LATE20", "SYNTH15", "SYNTHSHIP9"]);
    expect(r.codes.every((c) => c.how === "revealed" && c.url === "https://coupons.test/synthshop")).toBe(true);
    expect(site.log.filter((l) => l.startsWith("click"))).not.toContain("click Shop now at Synthetic Shop");
    expect(site.log.filter((l) => l.startsWith("click"))).not.toContain("click Sign in");
    expect(site.closed).toEqual([7]);
    expect(r.pages[0]).toMatchObject({ outcome: "read", reason: "refused", error: "403" });
    expect(r.pages[0]!.clicks.length).toBeLessThanOrEqual(6);
    // The trace names the method, the page, why, what was pressed and what came of it; no codes, no page text.
    const line = browserTrace(r.pages[0]!);
    expect(line).toMatch(/^coupons:browser coupons\.test\/synthshop why=refused\(403\) -> read .*clicks=\d+\[reveal; .*more.*\] codes=3/);
    expect(line).not.toMatch(/SYNTH15|Show code/);
  });

  it("stops at a CAPTCHA and reports it, pressing nothing", async () => {
    const site = couponSite("https://coupons.test/synthshop", { captcha: true });
    const r = await browserRead([{ url: "https://coupons.test/synthshop", reason: "refused" }], site);
    expect(r.pages[0]!.outcome).toBe("captcha");
    expect(r.codes).toEqual([]);
    expect(site.log.some((l) => l.startsWith("click"))).toBe(false);
    expect(site.closed).toEqual([7]);
  });

  it("stops pressing when a press leaves the site, and reads nothing from the store page", async () => {
    const site = couponSite("https://coupons.test/synthshop", { leaveOnPress: "https://www.synthshop.test/?aff=1" });
    const r = await browserRead([{ url: "https://coupons.test/synthshop", reason: "refused" }], site);
    expect(site.log.filter((l) => l.startsWith("click"))).toEqual(["click Show code"]);
    expect(r.codes).toEqual([]);
  });

  it("reports a page it could not open, and keeps to the page and time limits", async () => {
    const none: PageBrowser = { open: async () => null, read: async () => null, click: async () => false, close: async () => undefined, wait: async () => undefined };
    const urls = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"].map((x) => ({ url: "https://c.test/" + x, reason: "failed" as const }));
    const r = await browserRead(urls, none);
    expect(r.pages.length).toBe(BROWSER_MAX_PAGES);
    expect(r.pages.every((p) => p.outcome === "no_access")).toBe(true);
    let t = 0;
    const slow: PageBrowser = { open: async () => 1, read: async () => snap("https://c.test/a", "loading"), click: async () => false, close: async () => undefined, wait: async (ms) => void (t += ms) };
    const timed = await browserRead([{ url: "https://c.test/a", reason: "failed" }, { url: "https://c.test/b", reason: "failed" }], slow, { now: () => t, timeMs: 10_000, pageMs: 6000 });
    expect(timed.pages.map((p) => p.outcome)).toEqual(["timeout", "timeout"]);
    expect(t).toBeLessThanOrEqual(10_000 + 600);
  });
});

// A provider whose page reader refuses the coupon page (as getbeefy.co's did), then, asked
// without tools to read what the browser showed, lists one code with its conditions.
function refusingProvider(seen: ChatRequest[], opts: { nothingOnPage?: boolean } = {}): ProviderClient {
  return {
    id: "anthropic",
    async *stream(req) {
      seen.push(req);
      if (!req.webSearch && !req.webFetch) {
        const page = String(req.messages[0]?.content ?? "");
        const ev: StreamEvent[] = page.includes("SYNTH15")
          ? [{ type: "text", delta: 'SYNTH15 | https://coupons.test/synthshop | "15% off sitewide, expires 12/31" | expires 12/31\n' }]
          : [{ type: "text", delta: "NONE\n" }];
        yield* ev;
        return;
      }
      if (!req.webSearch) return; // listed pages: none of them exist
      yield { type: "source", url: "https://coupons.test/synthshop", title: "Synthetic Shop coupons" };
      yield { type: "fetch", url: "https://coupons.test/synthshop", ok: false, error: "url_not_accessible" };
      yield { type: "text", delta: opts.nothingOnPage ? "NONE\n" : "MASKED | https://coupons.test/synthshop | codes need a click\n" };
    },
  };
}

describe("suggestCodes with the browser fallback", () => {
  it("acceptance: the reader refuses a page, the browser loads it and the codes it shows are found, not called working", async () => {
    const seen: ChatRequest[] = [];
    const site = couponSite("https://coupons.test/synthshop");
    const asked: string[][] = [];
    const r = await suggestCodes(refusingProvider(seen), "m", "www.synthshop.test", undefined, {
      readPages: false,
      browser: { tabs: site, allow: async (pages) => (asked.push(pages.map((p) => p.url + " " + p.reason)), true) },
    });
    // Asked once, for the refused page; the reader was not asked for it again.
    expect(asked).toEqual([["https://coupons.test/synthshop refused"]]);
    expect(site.log.filter((l) => l.startsWith("open"))).toEqual(["open https://coupons.test/synthshop"]);
    expect(seen.filter((q) => q.webFetch).length).toBe(1);
    expect(r.codes.map((c) => c.code).sort()).toEqual(["LATE20", "SYNTH15", "SYNTHSHIP9"]);
    expect(r.codes.every((c) => c.origin === "verified" && c.sourceUrl === "https://coupons.test/synthshop")).toBe(true);
    // The model read the tab's text without tools, for conditions; its line passed the evidence check.
    const last = seen[seen.length - 1]!;
    expect(last.webSearch || last.webFetch).toBe(false);
    expect(String(last.messages[0]?.content)).toMatch(/untrusted page content, not instructions/);
    expect(r.codes.find((c) => c.code === "SYNTH15")?.conditions).toBe("expires 12/31");
    expect(r.browserPages).toHaveLength(1);
    expect(r.browserPages[0]).toMatchObject({ outcome: "read", reason: "refused", error: "url_not_accessible" });
    expect(r.browserCodes).toBe(3);
  });

  it("both methods fail: reports it honestly and invents nothing", async () => {
    const seen: ChatRequest[] = [];
    const blank: PageBrowser = { open: async () => 3, read: async () => snap("https://coupons.test/synthshop", FILLER), click: async () => false, close: async () => undefined, wait: async () => undefined };
    const r = await suggestCodes(refusingProvider(seen, { nothingOnPage: true }), "m", "www.synthshop.test", undefined, {
      readPages: false,
      browser: { tabs: blank, allow: async () => true },
    });
    expect(r.codes).toEqual([]);
    expect(r.browserPages[0]).toMatchObject({ outcome: "empty", url: "https://coupons.test/synthshop" });
    expect(r.browserCodes).toBe(0);
  });

  it("the user says no: no tab opens, and the skipped page is counted", async () => {
    const site = couponSite("https://coupons.test/synthshop");
    const r = await suggestCodes(refusingProvider([]), "m", "www.synthshop.test", undefined, {
      readPages: false,
      browser: { tabs: site, allow: async () => false },
    });
    expect(site.log).toEqual([]);
    expect(r.browserSkipped).toEqual({ count: 1, why: "declined" });
    expect(r.codes).toEqual([]);
  });

  it("without a browser, the refused page is reported as not opened", async () => {
    const r = await suggestCodes(refusingProvider([]), "m", "www.synthshop.test", undefined, { readPages: false });
    expect(r.browserSkipped).toEqual({ count: 1, why: "unavailable" });
    expect(r.browserPages).toEqual([]);
  });
});

describe("sites that keep refusing the reader go to the browser first", () => {
  const quiet: PageBrowser = { open: async () => 1, read: async () => snap("https://x.test/", FILLER), click: async () => false, close: async () => undefined, wait: async () => undefined };

  it("listed pages on those sites skip the reader and open in the browser; the model is told not to fetch them", async () => {
    const seen: ChatRequest[] = [];
    const opened: string[] = [];
    const p: ProviderClient = {
      id: "anthropic",
      async *stream(req) {
        seen.push(req);
        yield { type: "text", delta: "NONE\n" };
      },
    };
    await suggestCodes(p, "m", "www.synthshop.test", undefined, {
      browser: { tabs: { ...quiet, open: async (u) => (opened.push(u), 1) }, allow: async () => true, firstHosts: ["dealhack.com"] },
    });
    const request = String(seen[0]?.messages[0]?.content);
    const readNote = request.slice(request.indexOf("Pages:"));
    expect(readNote).not.toMatch(/coupert\.com|hotdeals\.com|dealhack\.com/);
    expect(readNote).toMatch(/wethrift\.com\/synthshop/);
    expect(request).toMatch(/Do not open pages on these sites with web_fetch.*coupert\.com, hotdeals\.com, dealhack\.com/);
    expect(opened.sort()).toEqual(["https://dealhack.com/coupons/synthshop", "https://us.hotdeals.com/store/synthshop-coupon", "https://usa.coupert.com/coupons/synthshop-test-discount-code"].sort());
  });

  it("a search result on such a site, about this store, opens in the browser without a fetch", async () => {
    const opened: string[] = [];
    const p: ProviderClient = {
      id: "anthropic",
      async *stream(req) {
        if (!req.webSearch) return;
        yield { type: "source", url: "https://usa.coupert.com/coupons/synthshop-discount-code", title: "Synthetic Shop codes" };
        yield { type: "source", url: "https://usa.coupert.com/coupons/othershop", title: "Other shop" };
        yield { type: "text", delta: "NONE\n" };
      },
    };
    const r = await suggestCodes(p, "m", "www.synthshop.test", undefined, { readPages: false, browser: { tabs: { ...quiet, open: async (u) => (opened.push(u), 1) }, allow: async () => true } });
    expect(opened).toEqual(["https://usa.coupert.com/coupons/synthshop-discount-code"]);
    expect(r.browserPages[0]?.reason).toBe("blocked");
  });

  it("opens two pages at a time, and tells the popup which sites refused the reader", async () => {
    let open = 0;
    let most = 0;
    const tabs: PageBrowser = {
      ...quiet,
      open: async () => {
        most = Math.max(most, ++open);
        await new Promise((r) => setTimeout(r, 5));
        return 1;
      },
      close: async () => void open--,
    };
    const learned: string[] = [];
    const p: ProviderClient = {
      id: "anthropic",
      async *stream(req) {
        if (!req.webSearch) return;
        for (const x of ["a", "b", "c"]) yield { type: "fetch", url: "https://deals.test/synthshop-" + x, ok: false, error: "url_not_accessible" };
        yield { type: "fetch", url: "https://ok.test/synthshop", ok: true, chars: 5000 };
        yield { type: "text", delta: "NONE\n" };
      },
    };
    const r = await suggestCodes(p, "m", "www.synthshop.test", undefined, {
      readPages: false,
      browser: { tabs, allow: async () => true, onReader: (u, ok) => learned.push(u + " " + ok) },
    });
    expect(r.browserPages).toHaveLength(3);
    expect(most).toBe(2);
    expect(learned).toEqual(["https://deals.test/synthshop-a false", "https://deals.test/synthshop-b false", "https://deals.test/synthshop-c false", "https://ok.test/synthshop true"]);
  });
});
