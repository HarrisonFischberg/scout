// Codes the page itself shows (owner report 2026-11-02: a bunkerkc.com hat
// page showed KCMO15 and Find coupons found nothing). The fixture is a
// synthetic stand-in with the same shape: the code sits in a hidden
// announcement slide, an image's alt text and a sign-up popup at the end of a
// long page, where the 20,000-character snapshot never reached.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { AgentControl } from "../../src/agent/control";
import { runCouponJob, shownCodesLine, type CouponEvent } from "../../src/coupons/job";
import { pageCodes, pageCodeText } from "../../src/coupons/page-codes";
import { htmlSnapshot, parseHtml } from "../../src/coupons/quiet-read";
import { codesInText } from "../../src/coupons/store";
import type { CouponPage } from "../../src/coupons/tab-page";
import type { CartState } from "../../src/coupons/finder";
import type { ProviderClient } from "../../src/providers";
import { buildSnapshot, type Snapshot } from "../../src/snapshot/snapshot";

const FIXTURE = readFileSync(new URL("../fixtures/bunker-product.html", import.meta.url).pathname, "utf8");
const URL_ = "https://shop.test/melin-odysea-mac-retro-hydro-hat-camo.html";

describe("codes printed near offer words, without 'use code' in front", () => {
  it.each([
    "KC PRIDE: 15% OFF SITEWIDE WITH KCMO15",
    "KCMO15 for 15% off",
    "Take 15% off your order\nKCMO15",
    "Coupon: KCMO15",
    "Use code kcmo15 at checkout",
    "Save 15% · KCMO15 · ends Sunday",
    "Kansas City week: take 15% off with KCMO15",
  ])("finds KCMO15 in %j", (text) => {
    expect(codesInText(text)).toEqual(["KCMO15"]);
  });

  it("leaves product numbers, sizes, units and plain words alone", () => {
    expect(codesInText("SKU: MEL12345 You save $10")).toEqual([]);
    expect(codesInText("Item # AB1234 - 15% off today")).toEqual([]);
    expect(codesInText("Model WH-1000-XM5, save 20% this week")).toEqual([]);
    expect(codesInText("Now 15% off: 16OZ bottle in 3XL and 64GB")).toEqual([]);
    expect(codesInText("15% OFF SITEWIDE THIS WEEKEND ONLY")).toEqual([]);
    expect(codesInText("Order by 10AM for same-day shipping and save")).toEqual([]);
  });

  it("puts 'use code' matches before the looser ones", () => {
    expect(codesInText("15% off with FALL15 today. Promo code: SAVE20")).toEqual(["SAVE20", "FALL15"]);
  });
});

describe("the whole page, hidden parts included", () => {
  it("reproduces the miss: the snapshot Find coupons used has no KCMO15", () => {
    const { root, title } = parseHtml(FIXTURE);
    const snap = buildSnapshot(root, { url: URL_, title });
    expect(snap.text).not.toContain("KCMO15");
    expect(codesInText(snap.text)).toEqual([]);
    // Even a downloaded copy of the page, read like the store's other pages, misses it.
    expect(codesInText(htmlSnapshot(FIXTURE, URL_).text)).toEqual([]);
  });

  it("finds KCMO15 in the hidden slide, the image label and the popup", () => {
    const { root } = parseHtml(FIXTURE);
    const codes = pageCodes(root);
    expect(codes.map((c) => c.code)).toEqual(["KCMO15"]);
    expect(codes[0]!.context).toMatch(/15% off/i);
    expect(pageCodeText(root)).toContain("Code: KCMO15");
  });

  it("reads codes kept in data attributes and read-only boxes, never what a shopper typed", () => {
    const codes = pageCodes({
      tag: "body",
      attrs: {},
      children: [
        { tag: "button", attrs: { "data-coupon-code": "SPRING20" }, children: [{ tag: "#text", attrs: {}, text: "Copy", children: [] }] },
        { tag: "input", attrs: { readonly: "" }, value: "GIFT25", children: [] },
        { tag: "input", attrs: { name: "coupon" }, value: "TYPED99", children: [] },
      ],
    });
    expect(codes.map((c) => c.code)).toEqual(["SPRING20", "GIFT25"]);
  });
});

describe("a run on the product page (no coupon box there)", () => {
  const productPage = (shown: string[]): CouponPage => {
    const text = "Melin Odysea Mac Retro Hydro Hat - Camo. Now: $89.00. Add to Cart";
    const snapshot: Snapshot = { url: URL_, title: "Hat", text, elements: [{ ref: "e1", tag: "button", role: "button", name: "Add to Cart" }], truncated: false };
    return {
      snapshot: async () => snapshot,
      act: async (a) => ({ ok: true, action: a.type, message: "ok" }),
      cart: { info: async () => null, update: async () => null, reload: async () => undefined },
      storeCodes: async () => [],
      pageCodes: async () => shown.map((code) => ({ code, context: "Take 15% off with " + code })),
      meta: async () => ({ siteName: "Synthetic Shop" }),
    };
  };
  const quiet: ProviderClient = {
    id: "anthropic",
    async *stream() {
      yield { type: "text", delta: "{}" };
    },
  };
  const run = (page: CouponPage) =>
    runCouponJob({
      page,
      provider: quiet,
      model: "m",
      control: new AgentControl(),
      tabs: { quiet: true, open: async () => null, read: async () => null, click: async () => false, close: async () => undefined, wait: async () => undefined },
      allowBrowser: async () => false,
      askMore: async () => false,
      emit: () => undefined,
    });

  it("says which code the page shows and where to use it", async () => {
    const done = await run(productPage(["KCMO15"]));
    expect(done.status).toBe("no_form");
    expect(done.message).toContain("This page shows the code KCMO15. Open your cart and run Find coupons there to try it.");
  }, 30_000);

  it("keeps the old message when the page shows no code", async () => {
    const done = await run(productPage([]));
    expect(done.message).not.toContain("This page shows");
  }, 30_000);

  it("lists several codes in one sentence", () => {
    expect(shownCodesLine(["KCMO15", "SAVE10"])).toBe("This page shows the codes KCMO15 and SAVE10. Open your cart and run Find coupons there to try them.");
  });
});

describe("a run on the cart page", () => {
  it("tests the code the page shows first, before any web search code", async () => {
    let cart: CartState = { total: 89, currency: "USD", codes: [], platform: "bigcommerce" };
    const off: Record<string, number> = { KCMO15: 75.65, WEB10: 80.1 };
    const page: CouponPage = {
      snapshot: async () => ({ url: "https://shop.test/cart.php", title: "Cart", text: "Your cart. Total $89.00", elements: [], truncated: false }),
      act: async (a) => ({ ok: true, action: a.type, message: "ok" }),
      cart: {
        info: async () => cart,
        update: async (code) => {
          cart = { ...cart, total: off[code] ?? 89, codes: code ? [{ code, applicable: code in off }] : [] };
          return cart;
        },
        reload: async () => undefined,
      },
      storeCodes: async () => [],
      pageCodes: async () => [{ code: "KCMO15", context: "KC PRIDE: 15% OFF SITEWIDE WITH KCMO15" }],
      meta: async () => ({ siteName: "Synthetic Shop" }),
    };
    const search: ProviderClient = {
      id: "anthropic",
      async *stream(req) {
        if (!req.webSearch) return;
        yield { type: "source", url: "https://deals.test/shop", page: "Synthetic Shop codes: WEB10" };
        yield { type: "text", delta: "WEB10 | https://deals.test/shop\n" };
      },
    };
    const events: CouponEvent[] = [];
    const done = await runCouponJob({
      page,
      provider: search,
      model: "m",
      control: new AgentControl(),
      tabs: { quiet: true, open: async () => null, read: async () => null, click: async () => false, close: async () => undefined, wait: async () => undefined },
      allowBrowser: async () => false,
      askMore: async () => false,
      emit: (e) => void events.push(e),
    });
    const tried = events.flatMap((e) => (e.kind === "attempt" && !e.attempt.combo ? [e.attempt] : []));
    expect(tried[0]).toMatchObject({ code: "KCMO15", origin: "store", sourceUrl: "https://shop.test/cart.php" });
    expect(done.summary).toContain("KCMO15");
  }, 60_000);
});
