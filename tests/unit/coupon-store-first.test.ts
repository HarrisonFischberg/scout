// The store's own site first (owner's sproos log 2026-10-29): the cart was on
// sproos.co and checkout on shop.app, so Scout searched coupon pages for
// "shop.app" (42 codes for the wrong store, all refused) and tested the
// store's own FLASH30, printed on sproos.co/pages/about, 44th. Synthetic
// stores, pages and codes only.
import { describe, expect, it } from "vitest";
import { AgentControl } from "../../src/agent/control";
import type { PageBrowser } from "../../src/coupons/browser-read";
import type { CouponCandidate } from "../../src/coupons/candidates";
import { runCouponSearch, type CartState, type CouponAttempt, type CouponTester } from "../../src/coupons/finder";
import { runCouponJob, type CouponEvent } from "../../src/coupons/job";
import { identifyMerchant } from "../../src/coupons/merchant";
import { ownSitePages, readOwnSite } from "../../src/coupons/own-site";
import {
  coldSites,
  countSites,
  looksLikeCreatorCode,
  noteRefused,
  parseRefused,
  rankPending,
  REFUSED_KEY,
  REFUSED_MS,
  SITE_MISSES,
  SITE_STATS_KEY,
} from "../../src/coupons/priority";
import type { CouponPage } from "../../src/coupons/tab-page";
import type { ProviderClient } from "../../src/providers";
import type { Snapshot } from "../../src/snapshot/snapshot";

const snap = (url: string, text: string, hrefs: string[] = []): Snapshot => ({
  url,
  title: "",
  text,
  elements: hrefs.map((href, i) => ({ ref: "e" + i, tag: "a", role: "link", name: "", href })),
  truncated: false,
});

/** A quiet page browser serving fixed pages. */
const site = (pages: Record<string, Snapshot>, opened: string[] = []): PageBrowser => {
  const tabs = new Map<number, Snapshot>();
  let next = 1;
  return {
    quiet: true,
    open: async (url) => {
      opened.push(url);
      const p = pages[url];
      if (!p) return null;
      tabs.set(next, p);
      return next++;
    },
    read: async (t) => tabs.get(t) ?? null,
    click: async () => false,
    close: async (t) => void tabs.delete(t),
    wait: async () => undefined,
  };
};

describe("the real store behind a hosted checkout", () => {
  it("finds sproos.co from the links on a shop.app checkout", () => {
    const m = identifyMerchant("https://shop.app/checkout/123/cn/abc", {
      siteName: "sproos!",
      links: ["https://sproos.co", "https://shop.app/terms", "https://www.instagram.com", "https://sproos.co"],
    });
    expect(m.domain).toBe("sproos.co");
    expect(m.brand).toBe("sproos!");
  });

  it("uses the page the shopper came from, and ignores sites without the store's name", () => {
    expect(identifyMerchant("https://checkout.stripe.com/c/pay/cs_1", { title: "Melin", referrer: "https://www.melin.com" }).domain).toBe("melin.com");
    expect(identifyMerchant("https://shop.app/checkout/1", { siteName: "sproos!", links: ["https://www.paypal.com", "https://help.shopify.com", "https://cdn.example.com"] }).domain).toBe("shop.app");
  });

  it("leaves a store's own domain alone", () => {
    expect(identifyMerchant("https://sproos.co/cart", { siteName: "sproos!", links: ["https://other-sproos-fan.com"] }).domain).toBe("sproos.co");
  });
});

describe("reading the store's own site", () => {
  const home = snap("https://sproos.co/", "Free shipping on all orders", [
    "/pages/about",
    "/pages/contact",
    "/policies/refund-policy",
    "/pages/student-discount",
    "https://www.wethrift.com/sproos",
    "/collections/all",
    "/pages/about#team",
  ]);

  it("picks the store's own promotion pages, promotion words first", () => {
    expect(ownSitePages(home, "sproos.co")).toEqual(["https://sproos.co/pages/student-discount", "https://sproos.co/pages/about"]);
  });

  it("reads codes from the home page and the pages it links to", async () => {
    const r = await readOwnSite(
      site({
        "https://sproos.co/": home,
        "https://sproos.co/pages/about": snap("https://sproos.co/pages/about", "Our story. Use code FLASH30 for 30% off filtered showers with a subscription."),
      }),
      "sproos.co",
    );
    expect(r.codes.map((c) => [c.code, c.url])).toEqual([["FLASH30", "https://sproos.co/pages/about"]]);
    expect(r.pages).toBe(2);
  });

  it("gives up quietly when the site can't be read", async () => {
    expect(await readOwnSite(site({}), "sproos.co")).toEqual({ codes: [], pages: 0 });
  });
});

const cand = (code: string, origin: CouponCandidate["origin"], sourceUrl = ""): CouponCandidate => ({ code, origin, sourceUrl: sourceUrl || (origin === "guess" ? "" : "https://" + code.toLowerCase() + ".test/") });
const miss = (code: string, sourceUrl: string): CouponAttempt => ({ code, origin: "verified", sourceUrl, total: 254.01, saving: 0, accepted: false, note: "" });
const ctx = { merchant: { domain: "sproos.co", names: ["sproos"] } };

describe("testing order", () => {
  it("puts the store's own codes and store-name codes ahead of creator codes, and guesses last in their own order", () => {
    const order = rankPending(
      [
        cand("SPROOS20", "guess"),
        cand("NANCYCHU10", "verified", "https://www.wethrift.com/codes/sproos.co"),
        cand("NEW20", "guess"),
        cand("SPROOS10", "reported", "https://sproos.valuecom.com/"),
        cand("FLASH30", "store", "https://sproos.co/pages/about"),
      ],
      [],
      ctx,
    ).map((c) => c.code);
    expect(order).toEqual(["FLASH30", "SPROOS10", "NANCYCHU10", "SPROOS20", "NEW20"]);
  });

  it("tells creator codes from promotions", () => {
    expect(looksLikeCreatorCode("NANCYCHU10", ["SPROOS"])).toBe(true);
    expect(looksLikeCreatorCode("KATIE20", ["SPROOS"])).toBe(true);
    for (const c of ["HOLIDAY20", "WELCOME10", "SAVENOW15", "SPROOS10", "FLASH30", "BDAY30"]) expect(looksLikeCreatorCode(c, ["SPROOS"])).toBe(false);
  });

  it("sends a site to the back after five misses in a row, and keeps it there only while none of its codes saved", () => {
    const hd = "https://www.hotdeals.com/coupons/sproos";
    const fails = Array.from({ length: SITE_MISSES }, (_, i) => miss("HD" + i + "X", hd));
    expect([...coldSites(fails)]).toEqual(["hotdeals.com"]);
    expect(coldSites(fails.slice(1)).size).toBe(0);
    const order = rankPending([cand("HOTCODE", "verified", hd), cand("OTHER", "reported", "https://x.test/")], fails, ctx).map((c) => c.code);
    expect(order).toEqual(["OTHER", "HOTCODE"]);
    // Still ahead of guesses: every code found online is tested before any guess.
    expect(rankPending([cand("SPROOS15", "guess"), cand("HOTCODE", "verified", hd)], fails, ctx).map((c) => c.code)).toEqual(["HOTCODE", "SPROOS15"]);
  });

  it("ranks a site that never worked on this device below one that did", () => {
    const sites = { "hotdeals.com": { tried: 40, worked: 0, at: 1 }, "wethrift.com": { tried: 40, worked: 6, at: 1 } };
    const order = rankPending([cand("AAA10X", "verified", "https://hotdeals.com/a"), cand("BBB10X", "verified", "https://wethrift.com/b")], [], { ...ctx, sites }).map((c) => c.code);
    expect(order).toEqual(["BBB10X", "AAA10X"]);
  });

  it("remembers codes the store refused for a day, and counts each site's tries", () => {
    const now = 1_000_000;
    const won: CouponAttempt = { code: "FLASH30", origin: "verified", sourceUrl: "https://wethrift.com/x", total: 222, saving: 32.01, accepted: null, note: "" };
    const r = noteRefused({}, "sproos.co", [miss("KATIE20", "https://couponbind.com/x"), won], now);
    expect(r).toEqual({ "sproos.co": { KATIE20: now } });
    expect(parseRefused(r, now + REFUSED_MS + 1)).toEqual({});
    expect(rankPending([cand("KATIE20", "verified"), cand("OTHER", "verified")], [], { ...ctx, refused: r["sproos.co"] }).map((c) => c.code)).toEqual(["OTHER", "KATIE20"]);
    expect(countSites({}, [miss("KATIE20", "https://www.couponbind.com/x"), won], now)).toEqual({
      "couponbind.com": { tried: 1, worked: 0, at: now },
      "wethrift.com": { tried: 1, worked: 1, at: now },
    });
  });
});

describe("re-applying the winner", () => {
  const tester = (failFirst: number): CouponTester & { applies: number } => {
    let total = 100;
    const t = {
      method: "page",
      baseline: 100,
      applies: 0,
      async tryCode(code: string) {
        total = code === "WIN" ? 80 : 100;
        return { total, accepted: code === "WIN" ? null : false };
      },
      async apply() {
        t.applies++;
        return t.applies <= failFirst ? null : 80;
      },
      async finish() {},
    };
    return t;
  };
  const page = {} as CouponPage;

  it("tries once more after a short wait when the first re-apply misses", async () => {
    const t = tester(1);
    const out = await runCouponSearch({ page, tester: t, codes: [cand("LOSE", "verified"), cand("WIN", "verified")], reapplyRetryMs: 0 });
    expect(out.applied).toBe(true);
    expect(out.reapplied).toBe("retry");
    expect(t.applies).toBe(2);
  });

  it("says it couldn't re-apply only after both tries", async () => {
    const t = tester(5);
    const out = await runCouponSearch({ page, tester: t, codes: [cand("WIN", "verified")], reapplyRetryMs: 0 });
    expect(out.applied).toBe(false);
    expect(out.reapplied).toBe("failed");
    expect(out.message).toContain("could not be re-applied");
  });
});

describe("a whole run on a shop.app checkout (from the owner's sproos log)", () => {
  it("searches for sproos.co, tests the code from the store's own site first, and saves what it learned", async () => {
    let cart: CartState = { total: 254.01, currency: "USD", codes: [], platform: "shopify" };
    const off: Record<string, number> = { FLASH30: 222, SPROOS10: 228.32 };
    const checkout: CouponPage = {
      snapshot: () => Promise.resolve(snap("https://shop.app/checkout/1/cn/x", "Total $254.01", ["https://sproos.co/cart"])),
      act: async (a) => ({ ok: true, action: a.type, message: "ok" }),
      cart: {
        info: async () => cart,
        update: async (code) => {
          cart = { ...cart, total: off[code] ?? 254.01, codes: code ? [{ code, applicable: code in off }] : [] };
          return cart;
        },
        reload: async () => undefined,
      },
      storeCodes: async () => [],
      meta: async () => ({ siteName: "sproos!", links: ["https://sproos.co"] }),
    };
    const asked: string[] = [];
    const search: ProviderClient = {
      id: "anthropic",
      async *stream(req) {
        if (!req.webSearch) return;
        asked.push(JSON.stringify(req));
        yield { type: "source", url: "https://www.hotdeals.test/sproos", page: "Sproos codes: KATIE20, NANCYCHU10, SPROOS10" };
        yield { type: "text", delta: "KATIE20 | https://www.hotdeals.test/sproos\nNANCYCHU10 | https://www.hotdeals.test/sproos\nSPROOS10 | https://www.hotdeals.test/sproos\n" };
      },
    };
    const home = snap("https://sproos.co/", "Filtered shower heads", ["/pages/about"]);
    const about = snap("https://sproos.co/pages/about", "Flash sale: use code FLASH30 for 30% off.");
    const stored: Record<string, unknown> = {};
    const events: CouponEvent[] = [];
    const done = await runCouponJob({
      page: checkout,
      provider: search,
      model: "m",
      control: new AgentControl(),
      tabs: site({ "https://sproos.co/": home, "https://sproos.co/pages/about": about }),
      allowBrowser: async () => false,
      storage: { get: async (k) => (k in stored ? { [k]: stored[k] } : {}), set: async (items) => void Object.assign(stored, items) },
      askMore: async () => false,
      emit: (e) => void events.push(e),
    });
    const tried = events.flatMap((e) => (e.kind === "attempt" && !e.attempt.combo ? [e.attempt] : []));
    expect(asked.length).toBeGreaterThan(0);
    expect(asked.every((r) => r.includes("sproos.co") && !r.includes("/shop.app"))).toBe(true);
    expect(tried[0]).toMatchObject({ code: "FLASH30", origin: "store", sourceUrl: "https://sproos.co/pages/about" });
    // The store-name code goes ahead of the creator codes from the same page.
    const online = tried.filter((a) => a.origin !== "guess" && a.origin !== "store").map((a) => a.code);
    expect(online[0]).toBe("SPROOS10");
    expect(done.summary).toContain("FLASH30");
    await new Promise((r) => setTimeout(r, 20));
    expect(Object.keys((stored[REFUSED_KEY] as Record<string, unknown>) ?? {})).toEqual(["sproos.co"]);
    expect(stored[SITE_STATS_KEY]).toHaveProperty(["hotdeals.test"]);
  }, 60_000);
});
