import { describe, expect, it } from "vitest";
import { AgentControl } from "../../src/agent/control";
import type { Action, ActionResult } from "../../src/actions/executor";
import { isMasked, mergeCandidates, normalizeCode, originLabel } from "../../src/coupons/candidates";
import {
  couponStatusText,
  couponSummary,
  discoveryLine,
  openCouponTester,
  parseCodes,
  parseTotal,
  runCouponSearch,
  type CartApi,
  type CartState,
  type CouponPage,
} from "../../src/coupons/finder";
import { shopifyCartInfo } from "../../src/coupons/shopify";
import { buildSnapshot, type SnapNode, type Snapshot } from "../../src/snapshot/snapshot";

const PCT: Record<string, number> = { SAVE10: 10, SAVE20: 20 };

/** Fake shop cart: Total is 100 minus the discount of the last applied code. */
function shop(opts: { captchaAfter?: string; noForm?: boolean } = {}): CouponPage & { acts: Action[]; ordered: number } {
  let typed = "";
  let total = 100;
  let captcha = false;
  const s = {
    acts: [] as Action[],
    ordered: 0,
    async snapshot(): Promise<Snapshot> {
      return {
        url: "https://shop.test/cart",
        title: "Cart",
        text: captcha ? "Please verify you are human." : "Subtotal: $100.00\nTotal: $" + total.toFixed(2),
        elements: opts.noForm
          ? []
          : [
              { ref: "e1", tag: "input", role: "textbox", name: "Coupon code", type: "text" },
              { ref: "e2", tag: "button", role: "button", name: "Apply" },
              { ref: "e3", tag: "button", role: "button", name: "Place order" },
            ],
        truncated: false,
      };
    },
    async act(a: Action): Promise<ActionResult> {
      s.acts.push(a);
      if (a.type === "type") typed = a.text;
      if (a.type === "click" && a.ref === "e2") {
        total = 100 - (PCT[typed] ?? 0);
        if (typed === opts.captchaAfter) captcha = true;
      }
      if (a.type === "click" && a.ref === "e3") s.ordered++;
      return { ok: true, action: a.type, message: "ok" };
    },
  };
  return s;
}

describe("parseTotal", () => {
  it("reads Total and ignores Subtotal", () => {
    expect(parseTotal("Subtotal: $100.00\nTotal: $80.00")).toBe(80);
    expect(parseTotal("Subtotal: $100.00")).toBeNull();
    expect(parseTotal("Order total $1,234.50")).toBe(1234.5);
  });

  // Diagnostics run #20: Shopify checkout puts "Total" and "USD $170.00" in
  // separate cells, and shows "Total savings" once a code applies.
  it("reads a total on the next line after a currency code", () => {
    expect(parseTotal("Subtotal\n$170.00\nShipping\nEnter shipping address\nTotal\nUSD $170.00")).toBe(170);
  });
  it("never reads Total savings or Total discount as the total", () => {
    expect(parseTotal("Total\nUSD $136.00\nTotal savings\n$34.00")).toBe(136);
    expect(parseTotal("Total: $90.00\nTotal discount: $10.00")).toBe(90);
  });
});

describe("parseCodes", () => {
  it("keeps uppercase code-like tokens, dedupes, drops words", () => {
    expect(parseCodes("SAVE10\nsave20 is lower\nWELCOME5, SAVE10\nNONE")).toEqual(["SAVE10", "WELCOME5"]);
  });
  it("caps the count", () => {
    const many = Array.from({ length: 30 }, (_, i) => "CODE" + (100 + i)).join(" ");
    expect(parseCodes(many)).toHaveLength(10);
  });
});

describe("runCouponSearch", () => {
  const names = ["WELCOME5", "SAVE10", "FREESHIP", "SAVE20", "BOGUS99"];
  const five = names.map((code) => ({ code, origin: "verified" as const, sourceUrl: "https://deals.test/" + code.toLowerCase() }));

  it("tries each code once, keeps the larger saving, never clicks order", async () => {
    const p = shop();
    const seen: string[] = [];
    const out = await runCouponSearch({ page: p, codes: five, settleMs: 0, onAttempt: (a) => seen.push(a.code) });
    expect(out.status).toBe("done");
    expect(out.baseline).toBe(100);
    expect(seen).toEqual(names);
    expect(out.attempts.map((a) => a.total)).toEqual([100, 90, 100, 80, 100]);
    expect(out.best?.code).toBe("SAVE20");
    expect(out.applied).toBe(true);
    expect(p.ordered).toBe(0);
    expect(p.acts.some((a) => a.type === "click" && a.ref === "e3")).toBe(false);
    // Winner re-applied last: the box ends on the best code.
    const typedCodes = p.acts.filter((a) => a.type === "type").map((a) => (a as { text: string }).text);
    expect(typedCodes[typedCodes.length - 1]).toBe("SAVE20");
  });

  it("reports no saving when no code works", async () => {
    const out = await runCouponSearch({ page: shop(), codes: ["NOPE1", "NOPE2"].map((code) => ({ code, origin: "verified" as const, sourceUrl: "https://deals.test/x" })), settleMs: 0 });
    expect(out.best).toBeUndefined();
    expect(out.message).toBe("No code lowered the total.");
    expect(out.attempts.every((a) => a.saving === 0)).toBe(true);
  });

  it("stops with no_form when there is no coupon box", async () => {
    const out = await runCouponSearch({ page: shop({ noForm: true }), codes: five, settleMs: 0 });
    expect(out.status).toBe("no_form");
    expect(out.message).toBe("No coupon box found on this page. Open the cart or checkout page first.");
  });

  // Live sweep 2026-10-17: Nomad, Javvy Coffee, Peak Design, Pura and Chubbies
  // take codes only at checkout; their cart drawers have a Checkout button and no box.
  it("points at the checkout page when a cart has a Checkout button and no coupon box", async () => {
    const p = shop({ noForm: true });
    const page: CouponPage = {
      snapshot: async () => ({ ...(await p.snapshot()), url: "https://shop.test/?openCart=true", title: "Your Cart", elements: [{ ref: "e9", tag: "button", role: "button", name: "Secure Checkout" }] }),
      act: p.act,
    };
    const out = await runCouponSearch({ page, codes: five, settleMs: 0 });
    expect(out.status).toBe("no_form");
    expect(out.message).toBe("No coupon box on this cart. This store takes codes on its checkout page: open Checkout (nothing is bought until you confirm there) and run Find coupons again.");
    expect(p.ordered).toBe(0);
  });

  it("refuses an order-like button as the apply target", async () => {
    const p = shop();
    const snap = await p.snapshot();
    snap.elements = snap.elements
      .filter((e) => e.name !== "Apply")
      .map((e) => (e.name === "Place order" ? { ...e, name: "Apply and place order" } : e));
    const out = await runCouponSearch({ page: { snapshot: async () => snap, act: p.act }, codes: five, settleMs: 0 });
    expect(out.status).toBe("no_form");
    expect(p.ordered).toBe(0);
  });

  it("hard-stops on a CAPTCHA mid-run", async () => {
    const p = shop({ captchaAfter: "SAVE10" });
    const out = await runCouponSearch({ page: p, codes: five, settleMs: 0 });
    expect(out.status).toBe("captcha");
    expect(out.attempts.map((a) => a.code)).toEqual(["WELCOME5", "SAVE10"]);
  });

  it("halts before the next code on Stop", async () => {
    const control = new AgentControl();
    const out = await runCouponSearch({
      page: shop(),
      codes: five,
      control,
      settleMs: 0,
      onAttempt: () => control.stop(),
    });
    expect(out.status).toBe("stopped");
    expect(out.attempts).toHaveLength(1);
  });
});

// Owner rule 2026-10-17: never guess. Every tested code was seen on a page,
// and the page, the words around the code and any conditions travel with it.
describe("candidates and evidence", () => {
  it("keeps the source, the quote and the conditions on every attempt, and labels where each code came from", async () => {
    const out = await runCouponSearch({
      page: shop(),
      codes: [
        { code: "SAVE10", origin: "verified", sourceUrl: "https://deals.test/a", context: "SAVE10 10% off", conditions: "new customers" },
        { code: "SAVE20", origin: "reported", sourceUrl: "https://deals.test/b" },
        { code: "NOPE5", origin: "store", sourceUrl: "https://shop.test/" },
      ],
      settleMs: 0,
    });
    expect(out.attempts[0]).toMatchObject({ sourceUrl: "https://deals.test/a", context: "SAVE10 10% off", conditions: "new customers" });
    expect(out.attempts.map((a) => originLabel(a))).toEqual(["seen on deals.test", "deals.test (reported by the search)", "the store's own site (shop.test)"]);
    expect(out.best?.code).toBe("SAVE20");
    expect(couponSummary(out)).toContain("| SAVE20 | saves $20.00, total $80.00 | [deals.test (reported by the search)](https://deals.test/b) |");
    expect(couponSummary(out)).toContain("Didn't work: NOPE5.");
    expect(couponSummary(out)).not.toMatch(/guess/i);
  });

  it("merges by code, keeping the best-supported origin and counting the pages that showed it", () => {
    const merged = mergeCandidates(
      [{ code: "beefy15", origin: "reported", sourceUrl: "https://y.test", conditions: "sitewide" }],
      [
        { code: "BEEFY15", origin: "verified", sourceUrl: "https://x.test", context: "BEEFY15 15% off" },
        { code: "RACH", origin: "reported", sourceUrl: "https://y.test" },
      ],
    );
    expect(merged).toEqual([
      { code: "BEEFY15", origin: "verified", sourceUrl: "https://x.test", context: "BEEFY15 15% off", conditions: "sitewide", sources: 2 },
      { code: "RACH", origin: "reported", sourceUrl: "https://y.test", sources: 1 },
    ]);
  });

  it("drops a candidate without a page, and never builds a code from a masked one", () => {
    expect(mergeCandidates([{ code: "SAVE10", origin: "reported", sourceUrl: "" }])).toEqual([]);
    expect(isMasked("SAVE1***")).toBe(true);
    expect(isMasked("WELC•••")).toBe(true);
    expect(isMasked("XXXX20")).toBe(true);
    expect(isMasked("SAVE10")).toBe(false);
    expect(normalizeCode("MASKED")).toBeNull();
  });

  it("opens the tester before any search so a page without a coupon box fails fast", async () => {
    const p = shop({ noForm: true });
    const t = await openCouponTester(p, { settleMs: 0 });
    expect(t).toEqual({ error: "no_form", message: "No coupon box found on this page. Open the cart or checkout page first." });
    const ok = await openCouponTester(shop(), { settleMs: 0 });
    expect("error" in ok).toBe(false);
    if (!("error" in ok)) {
      expect(ok.baseline).toBe(100);
      const out = await runCouponSearch({ page: p, tester: ok, codes: [{ code: "SAVE10", origin: "verified", sourceUrl: "https://deals.test/a" }], settleMs: 0 });
      expect(out.best?.code).toBe("SAVE10");
    }
  });

  it("says plainly how the codes were found", () => {
    expect(discoveryLine({ brand: "Beefy", searched: true, store: 1, verified: 2, reported: 1, masked: 1, dropped: 2 })).toBe(
      "I searched the web for Beefy codes. Found 4 codes: 1 code on the store's own site, 2 codes read on the pages that post them and 1 code the search reported from pages it returned. 1 code shown masked or behind a button could not be read, so it was not tested. 2 codes the search mentioned without a page it had opened were left out.",
    );
    expect(discoveryLine({ brand: "Beefy", searched: true, store: 0, verified: 0, reported: 0, masked: 0, dropped: 0 })).toBe("I searched the web for Beefy codes. No code posted for Beefy could be found.");
    expect(discoveryLine({ brand: "Beefy", searched: true, error: { code: "auth_invalid", message: "The web search failed. The API key was rejected." }, store: 0, verified: 0, reported: 0, masked: 0, dropped: 0 })).toBe(
      "The web search ended early (The web search failed. The API key was rejected). No code posted for Beefy could be found.",
    );
  });
});

describe("batches", () => {
  const many = Array.from({ length: 30 }, (_, i) => ({ code: "NOPE" + (i + 10), origin: "reported" as const, sourceUrl: "https://deals.test/list" }));

  // Owner, 2026-10-17: the best code among all the codes found wins, not the
  // first batch's best. Once a code saves money every found code is still
  // tested, without asking; only a run where nothing worked asks to search again.
  it("keeps testing every found code after a saving, without asking, and applies the best of all of them", async () => {
    const codes = [
      ...many.slice(0, 2),
      { code: "SAVE10", origin: "verified" as const, sourceUrl: "https://deals.test/a" },
      ...many.slice(2, 27),
      { code: "SAVE20", origin: "reported" as const, sourceUrl: "https://deals.test/b" },
      ...many.slice(27),
    ];
    let asked = 0;
    let searched = 0;
    const out = await runCouponSearch({
      page: shop(),
      codes,
      settleMs: 0,
      batchSize: 25,
      askMore: async () => {
        asked++;
        return true;
      },
      findMore: async () => {
        searched++;
        return [];
      },
    });
    expect(asked).toBe(0);
    expect(searched).toBe(0);
    expect(out.attempts).toHaveLength(32);
    expect(out.untested).toBe(0);
    expect(out.best?.code).toBe("SAVE20");
    expect(out.applied).toBe(true);
    expect(couponSummary(out)).toContain("I tested **32 codes**. **SAVE20** is the best");
    expect(couponSummary(out)).toContain("you save $20.00, 20% off");
  });

  it("when none worked and the queue runs short, finds codes not tried yet to fill the next 25", async () => {
    const asked: Array<{ tried: number; remaining: number; next: number }> = [];
    const known: string[][] = [];
    const out = await runCouponSearch({
      page: shop(),
      codes: many,
      settleMs: 0,
      batchSize: 25,
      askMore: async (st) => {
        asked.push({ tried: st.tried, remaining: st.remaining, next: st.next });
        return asked.length === 1;
      },
      findMore: async (k) => {
        known.push(k);
        return [{ code: "NOPE10", origin: "reported", sourceUrl: "https://deals.test/list" }, ...Array.from({ length: 30 }, (_, i) => ({ code: "FRESH" + (i + 10), origin: "reported" as const, sourceUrl: "https://deals.test/more" }))];
      },
    });
    expect(asked).toEqual([
      { tried: 25, remaining: 5, next: 25 },
      { tried: 50, remaining: 10, next: 25 },
    ]);
    expect(known).toHaveLength(1);
    expect(known[0]).toHaveLength(30);
    expect(out.attempts).toHaveLength(50);
    expect(out.attempts.slice(25, 30).map((a) => a.code)).toEqual(["NOPE35", "NOPE36", "NOPE37", "NOPE38", "NOPE39"]);
    expect(out.attempts[30]?.code).toBe("FRESH10");
    expect(new Set(out.attempts.map((a) => a.code)).size).toBe(50);
  });

  it("finds more even when every queued code was tried, and stops when none are left to find", async () => {
    let asked = 0;
    const out = await runCouponSearch({
      page: shop(),
      codes: many.slice(0, 25),
      settleMs: 0,
      batchSize: 25,
      askMore: async (st) => {
        asked++;
        expect(st).toMatchObject({ tried: 25, remaining: 0, next: 25 });
        return true;
      },
      findMore: async () => [],
    });
    expect(asked).toBe(1);
    expect(out.status).toBe("done");
    expect(out.attempts).toHaveLength(25);
    expect(out.exhausted).toBe(true);
    expect(couponSummary(out)).toContain("I tested **25 codes** and none lowered your total of $100.00, so your cart is unchanged. I couldn't find any more codes to try.");
  });

  it("asks after each batch and stops when the user says no", async () => {
    const asked: number[] = [];
    const out = await runCouponSearch({
      page: shop(),
      codes: many,
      settleMs: 0,
      batchSize: 25,
      askMore: async (st) => {
        asked.push(st.tried);
        return false;
      },
    });
    expect(asked).toEqual([25]);
    expect(out.attempts).toHaveLength(25);
    expect(out.untested).toBe(5);
    expect(couponSummary(out)).toContain("I tested **25 codes** and none lowered your total of $100.00, so your cart is unchanged. 5 more codes were left untested.");
  });

  it("continues when the user says yes", async () => {
    const out = await runCouponSearch({ page: shop(), codes: many, settleMs: 0, batchSize: 25, askMore: async () => true });
    expect(out.attempts).toHaveLength(30);
  });
});

/** Fake Shopify cart: BEEFY15 = 15% off, KETO = 10% off, everything else rejected. */
function shopify(opts: { start?: string[]; rateLimitAfter?: number; stack?: boolean } = {}): CartApi & { calls: string[]; reloads: number; codes: string[] } {
  const base = 159.78;
  const pct: Record<string, number> = { BEEFY15: 15, KETO: 10 };
  let codes = opts.start ?? [];
  const state = (): CartState => {
    // Without stacking only the first valid code counts; with it, every valid code does.
    const valid = codes.filter((c) => pct[c]).slice(0, opts.stack ? undefined : 1);
    const off = valid.reduce((sum, c) => sum + (pct[c] ?? 0), 0);
    return {
      total: valid.length ? Math.round(base * (1 - off / 100) * 100) / 100 : 151.8,
      currency: "USD",
      codes: codes.map((c) => ({ code: c, applicable: !!pct[c] && (opts.stack || valid[0] === c) })),
    };
  };
  const api = {
    calls: [] as string[],
    reloads: 0,
    get codes() {
      return codes;
    },
    async info() {
      return state();
    },
    async update(discount: string) {
      api.calls.push(discount);
      if (opts.rateLimitAfter && api.calls.length > opts.rateLimitAfter) return { rateLimited: true as const };
      codes = discount ? discount.split(",") : [];
      return state();
    },
    async reload() {
      api.reloads++;
    },
  };
  return api;
}

describe("Shopify cart path", () => {
  const page = (cart: CartApi): CouponPage => ({
    cart,
    snapshot: async () => {
      throw new Error("page path must not be used");
    },
    act: async () => {
      throw new Error("page path must not be used");
    },
  });
  const cands = ["RACH", "BEEFY15", "KETO", "WELCOME10"].map((code) => ({ code, origin: "reported" as const, sourceUrl: "https://deals.test/beefy" }));

  it("tests each code through the cart API, applies the best, and reloads the cart", async () => {
    const cart = shopify();
    const out = await runCouponSearch({ page: page(cart), codes: cands });
    expect(out.method).toBe("shopify");
    expect(out.baseline).toBe(151.8);
    expect(out.attempts.filter((a) => !a.combo).map((a) => a.accepted)).toEqual([false, true, true, false]);
    expect(out.best?.code).toBe("BEEFY15");
    expect(out.best?.total).toBe(135.81);
    expect(out.applied).toBe(true);
    expect(cart.codes).toEqual(["BEEFY15"]);
    expect(cart.reloads).toBe(1);
    const text = couponSummary(out);
    expect(text).toContain("I tested **4 codes**. **BEEFY15** is the best: your total drops from **$151.80** to **$135.81**");
    expect(text).toContain("It's applied to your cart, and I didn't go to checkout.");
    expect(text).toContain("| KETO |");
    expect(text).toContain("Didn't work: RACH, WELCOME10.");
  });

  // Stores whose cart API takes two codes: the best code is tried together
  // with the next best, and the pair wins only when the total drops further.
  it("tries the best code together with the next best and keeps the pair when the store stacks them", async () => {
    const cart = shopify({ stack: true });
    const out = await runCouponSearch({ page: page(cart), codes: cands });
    const combo = out.attempts.find((a) => a.combo);
    expect(combo).toMatchObject({ code: "BEEFY15,KETO", combo: ["BEEFY15", "KETO"], accepted: true });
    expect(out.best?.code).toBe("BEEFY15,KETO");
    expect(out.applied).toBe(true);
    expect(cart.codes).toEqual(["BEEFY15", "KETO"]);
    expect(couponSummary(out)).toContain("**BEEFY15** + **KETO** together is the best");
    // The pair has no page of its own: its row says what it is, not "seen on its page".
    expect(originLabel(combo!)).toBe("both codes, applied together");
    expect(couponSummary(out)).toMatch(/\| BEEFY15 \+ KETO \| [^|]+ \| both codes, applied together \|/);
  });

  it("keeps the single best code when the store refuses the pair", async () => {
    const cart = shopify();
    const out = await runCouponSearch({ page: page(cart), codes: cands });
    const combo = out.attempts.find((a) => a.combo);
    expect(combo).toMatchObject({ accepted: false, note: "The store does not combine these codes." });
    expect(out.best?.code).toBe("BEEFY15");
    expect(cart.codes).toEqual(["BEEFY15"]);
  });

  // Live sweep 2026-10-17: Lineage Provisions' cart answered a total of 0 and 50 codes were "tested" against it.
  it("refuses to test against a cart whose total is 0", async () => {
    const cart: CartApi = { info: async () => ({ total: 0, currency: "USD", codes: [] }), update: async () => null, reload: async () => undefined };
    const out = await runCouponSearch({ page: page(cart), codes: cands });
    expect(out.status).toBe("error");
    expect(out.message).toBe("The cart total is $0.00, so no code could lower it. Add an item to the cart first.");
    expect(out.attempts).toHaveLength(0);
  });

  it("puts the cart's original code back when nothing beats it", async () => {
    const cart = shopify({ start: ["OLDCODE"] });
    const out = await runCouponSearch({ page: page(cart), codes: [{ code: "NOPE10", origin: "reported", sourceUrl: "https://deals.test/beefy" }] });
    expect(out.best).toBeUndefined();
    expect(cart.codes).toEqual(["OLDCODE"]);
    expect(cart.reloads).toBe(1);
  });

  it("stops when the store rate-limits", async () => {
    const cart = shopify({ rateLimitAfter: 2 });
    const out = await runCouponSearch({ page: page(cart), codes: cands });
    expect(out.status).toBe("rate_limited");
    expect(out.attempts).toHaveLength(2);
  });
});

// Diagnostics run #20: a Shopify checkout page with a ZIP code field before
// the discount box, an Apply button that stays disabled until a code is typed,
// and a total drawn one character per span. Synthetic store and codes.
function checkout(): CouponPage & { zip: string; ordered: number } {
  const pct: Record<string, number> = { SAVE10: 10, SAVE20: 20 };
  let typed = "";
  let applied = "";
  let refs = new Map<string, SnapNode>();
  const t = (text: string): SnapNode => ({ tag: "#text", attrs: {}, text, children: [] });
  const n = (tag: string, attrs: Record<string, string> = {}, children: SnapNode[] = [], value?: string): SnapNode => ({
    tag,
    attrs,
    children,
    ...(value !== undefined ? { value } : {}),
  });
  const price = (v: number): SnapNode[] => {
    const s = "$" + v.toFixed(2);
    return [
      n("abbr", {}, [t("USD")]),
      n("strong", {}, [n("span", { "aria-hidden": "true" }, [t(s)])]),
      n("strong", {}, [n("span", { "aria-label": s }, s.split("").map((c) => n("span", {}, [t(c)])))]),
    ];
  };
  const p = {
    zip: "",
    ordered: 0,
    async snapshot(): Promise<Snapshot> {
      const total = 170 * (1 - (pct[applied] ?? 0) / 100);
      const tree = n("body", {}, [
        n("main", {}, [
          n("input", { id: "email", type: "email", placeholder: "Email", autocomplete: "shipping email" }),
          n("input", { id: "zip", type: "text", name: "postalCode", placeholder: "ZIP code", autocomplete: "shipping postal-code" }, [], p.zip),
          n("button", { id: "pay", type: "submit" }, [t("Pay now")]),
        ]),
        n("aside", {}, [
          n("button", { id: "toggle", type: "button" }, [t("Add discount")]),
          n("input", { id: "code", type: "text", name: "reductions", placeholder: "Discount code or gift card" }, [], typed),
          n("button", { id: "apply", type: "submit", "aria-label": "Apply Discount Code", ...(typed ? {} : { disabled: "" }) }, [t("Apply")]),
          n("div", { role: "row" }, [n("div", {}, [t("Subtotal")]), n("div", {}, [t("$170.00")])]),
          n("div", { role: "row" }, [n("div", {}, [n("strong", {}, [t("Total")])]), n("div", {}, [n("div", {}, price(total))])]),
          ...(applied && pct[applied] ? [n("div", {}, [t("Total savings")]), n("div", {}, [t("$" + (170 - total).toFixed(2))])] : []),
        ]),
      ]);
      const next = new Map<string, SnapNode>();
      const snap = buildSnapshot(tree, { url: "https://shop.test/checkouts/cn/x", title: "Checkout", onRef: (r, node) => next.set(r, node) });
      refs = next;
      return snap;
    },
    async act(a: Action): Promise<ActionResult> {
      const id = "ref" in a && a.ref ? refs.get(a.ref)?.attrs.id : undefined;
      if (a.type === "type" && id === "zip") p.zip = a.text;
      if (a.type === "type" && id === "code") typed = a.text;
      if (a.type === "click" && id === "apply") {
        if (!typed) return { ok: false, action: "click", message: "disabled", error: "disabled" };
        applied = typed.toUpperCase();
        typed = "";
      }
      if (a.type === "click" && id === "pay") p.ordered++;
      return { ok: true, action: a.type, message: "ok" };
    },
  };
  return p;
}

describe("Shopify checkout page (page path)", () => {
  it("uses the discount box, not the ZIP code field, reads the split total, and applies the best code", async () => {
    const p = checkout();
    const codes = ["WELCOME5", "SAVE10", "SAVE20", "NOPE99"].map((code) => ({ code, origin: "verified" as const, sourceUrl: "https://deals.test/x" }));
    const out = await runCouponSearch({ page: p, codes, settleMs: 0 });
    expect(out.method).toBe("page");
    expect(out.baseline).toBe(170);
    expect(out.attempts.map((a) => a.total)).toEqual([170, 153, 136, 170]);
    expect(out.best?.code).toBe("SAVE20");
    expect(out.applied).toBe(true);
    expect(p.zip).toBe("");
    expect(p.ordered).toBe(0);
  });
});

describe("shopifyCartInfo", () => {
  const cart = JSON.stringify({ total_price: 17000, currency: "USD", discount_codes: [] });
  const reply = (body: string, type: string): Response => new Response(body, { status: 200, headers: { "content-type": type } });

  // Real Shopify stores answer /cart.js as text/javascript (checked 2026-10-16).
  it("reads the cart when the store labels the JSON as JavaScript", async () => {
    expect(await shopifyCartInfo(async () => reply(cart, "text/javascript; charset=utf-8"))).toEqual({ total: 170, currency: "USD", codes: [] });
    expect(await shopifyCartInfo(async () => reply(cart, "application/json"))).toEqual({ total: 170, currency: "USD", codes: [] });
  });

  it("returns null when /cart.js is not a Shopify cart", async () => {
    expect(await shopifyCartInfo(async () => reply("<!doctype html><p>Not found</p>", "text/html"))).toBeNull();
    expect(await shopifyCartInfo(async () => reply("window.cart = {};", "text/javascript"))).toBeNull();
    expect(await shopifyCartInfo(async () => reply(JSON.stringify({ items: [] }), "application/json"))).toBeNull();
  });
});

describe("couponStatusText", () => {
  it("never exposes an internal status code", () => {
    for (const s of ["done", "no_form", "no_codes", "search_failed", "captcha", "stopped", "rate_limited", "error"] as const) {
      const text = couponStatusText(s);
      expect(text).not.toMatch(/_/);
      expect(text).toMatch(/^Coupon search .+\.$/);
    }
  });
});
