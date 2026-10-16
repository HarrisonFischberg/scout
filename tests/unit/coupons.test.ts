import { describe, expect, it } from "vitest";
import { AgentControl } from "../../src/agent/loop";
import type { Action, ActionResult } from "../../src/actions/executor";
import { suggestCodes } from "../../src/coupons/codes";
import { brandTokens, mergeCandidates, originLabel, patternCodes } from "../../src/coupons/candidates";
import {
  couponStatusText,
  couponSummary,
  parseCodes,
  parseTotal,
  runCouponSearch,
  type CartApi,
  type CartState,
  type CouponPage,
} from "../../src/coupons/finder";
import type { ChatRequest, ProviderClient, StreamEvent } from "../../src/providers";
import type { Snapshot } from "../../src/snapshot/snapshot";

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
  const five = names.map((code) => ({ code, origin: "sourced" as const, sourceUrl: "https://deals.test/" + code.toLowerCase() }));

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
    const out = await runCouponSearch({ page: shop(), codes: ["NOPE1", "NOPE2"].map((code) => ({ code, origin: "sourced" as const, sourceUrl: "https://deals.test/x" })), settleMs: 0 });
    expect(out.best).toBeUndefined();
    expect(out.message).toBe("No code lowered the total.");
    expect(out.attempts.every((a) => a.saving === 0)).toBe(true);
  });

  it("stops with no_form when there is no coupon box", async () => {
    const out = await runCouponSearch({ page: shop({ noForm: true }), codes: five, settleMs: 0 });
    expect(out.status).toBe("no_form");
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

// Owner decision 2026-10-16 (T031): find as many codes as possible and test
// them, guesses included; the store decides which work. Replaces the T019
// rule that only codes with a searched source page were tried.
describe("candidates and labels", () => {
  it("keeps the source URL on every attempt and labels guesses honestly", async () => {
    const out = await runCouponSearch({
      page: shop(),
      codes: [
        { code: "SAVE10", origin: "sourced", sourceUrl: "https://deals.test/a" },
        { code: "SAVE20", origin: "pattern" },
      ],
      settleMs: 0,
    });
    expect(out.attempts[0]?.sourceUrl).toBe("https://deals.test/a");
    expect(out.attempts.map((a) => originLabel(a))).toEqual(["deals.test", "Guess (common pattern)"]);
    expect(out.best?.code).toBe("SAVE20");
  });

  it("builds store-name patterns, hint percentages first", () => {
    expect(brandTokens("getbeefy.co")).toEqual(["BEEFY", "GETBEEFY"]);
    const codes = patternCodes("getbeefy.co", [15]);
    expect(codes.slice(0, 3)).toEqual(["BEEFY15", "BEEFY10", "BEEFY20"]);
    expect(codes).toContain("WELCOME10");
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("merges by code, keeping the best-supported origin", () => {
    const merged = mergeCandidates(
      [{ code: "beefy15", origin: "pattern" }],
      [{ code: "BEEFY15", origin: "sourced", sourceUrl: "https://x.test" }, { code: "RACH", origin: "unverified", sourceUrl: "https://y.test" }],
    );
    expect(merged).toEqual([
      { code: "BEEFY15", origin: "sourced", sourceUrl: "https://x.test" },
      { code: "RACH", origin: "unverified", sourceUrl: "https://y.test" },
    ]);
  });
});

describe("batches", () => {
  const many = Array.from({ length: 30 }, (_, i) => ({ code: "NOPE" + (i + 10), origin: "pattern" as const }));

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
    expect(couponSummary(out)).toContain("I tested **25 codes** and none lowered your total of $100.00. 5 more codes were left untested.");
  });

  it("continues when the user says yes", async () => {
    const out = await runCouponSearch({ page: shop(), codes: many, settleMs: 0, batchSize: 25, askMore: async () => true });
    expect(out.attempts).toHaveLength(30);
  });
});

/** Fake Shopify cart: BEEFY15 = 15% off, KETO = 10% off, everything else rejected. */
function shopify(opts: { start?: string[]; rateLimitAfter?: number } = {}): CartApi & { calls: string[]; reloads: number; codes: string[] } {
  const base = 159.78;
  const pct: Record<string, number> = { BEEFY15: 15, KETO: 10 };
  let codes = opts.start ?? [];
  const state = (): CartState => {
    const valid = codes.find((c) => pct[c]);
    return {
      total: valid ? Math.round(base * (1 - (pct[valid] ?? 0) / 100) * 100) / 100 : 151.8,
      currency: "USD",
      codes: codes.map((c) => ({ code: c, applicable: !!pct[c] })),
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
  const cands = ["RACH", "BEEFY15", "KETO", "WELCOME10"].map((code) => ({ code, origin: "pattern" as const }));

  it("tests each code through the cart API, applies the best, and reloads the cart", async () => {
    const cart = shopify();
    const out = await runCouponSearch({ page: page(cart), codes: cands });
    expect(out.method).toBe("shopify");
    expect(out.baseline).toBe(151.8);
    expect(out.attempts.map((a) => a.accepted)).toEqual([false, true, true, false]);
    expect(out.best?.code).toBe("BEEFY15");
    expect(out.best?.total).toBe(135.81);
    expect(out.applied).toBe(true);
    expect(cart.codes).toEqual(["BEEFY15"]);
    expect(cart.reloads).toBe(1);
    const text = couponSummary(out);
    expect(text).toContain("I tested **4 codes**. **BEEFY15** is the best: your total drops from **$151.80** to **$135.81**");
    expect(text).toContain("It's applied to your cart, and I didn't go to checkout.");
    expect(text).toContain("| KETO |");
    expect(text).toContain("Didn't work: 2 guessed codes.");
  });

  it("puts the cart's original code back when nothing beats it", async () => {
    const cart = shopify({ start: ["OLDCODE"] });
    const out = await runCouponSearch({ page: page(cart), codes: [{ code: "NOPE10", origin: "pattern" }] });
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

describe("suggestCodes", () => {
  function fake(events: StreamEvent[], seen: { req?: ChatRequest } = {}): ProviderClient {
    return {
      id: "anthropic",
      async *stream(req) {
        seen.req = req;
        yield* events;
      },
    };
  }

  it("asks for a deep search, labels codes by how well they are sourced, adds hint and pattern guesses", async () => {
    const seen: { req?: ChatRequest } = {};
    const provider = fake(
      [
        { type: "source", url: "https://deals.test/page" },
        { type: "text", delta: "RACH | https://deals.test/page\n" },
        { type: "text", delta: "LUNA | https://not-returned.test/x\nHINT | 15 | https://simplycodes.test/store\n" },
        { type: "usage", usage: { inputTokens: 12, outputTokens: 4 } },
      ],
      seen,
    );
    const r = await suggestCodes(provider, "m", "getbeefy.co");
    expect(seen.req).toMatchObject({ webSearch: true, webSearchMaxUses: 8, webFetch: true });
    expect(r.codes.slice(0, 3)).toEqual([
      { code: "RACH", origin: "sourced", sourceUrl: "https://deals.test/page" },
      { code: "LUNA", origin: "unverified", sourceUrl: "https://not-returned.test/x" },
      { code: "BEEFY15", origin: "hint", sourceUrl: "https://simplycodes.test/store" },
    ]);
    expect(r.codes.some((c) => c.code === "WELCOME10" && c.origin === "pattern")).toBe(true);
    expect(r.found).toBe(2);
    expect(r.inputTokens).toBe(12);
  });

  it("with search disabled makes no model call but still offers pattern guesses", async () => {
    const seen: { req?: ChatRequest } = {};
    const r = await suggestCodes(fake([], seen), "m", "getbeefy.co", undefined, { webSearch: false });
    expect(seen.req).toBeUndefined();
    expect(r.searched).toBe(false);
    expect(r.found).toBe(0);
    expect(r.codes.every((c) => c.origin === "pattern")).toBe(true);
    expect(r.codes[0]?.code).toBe("BEEFY10");
  });
});

describe("couponStatusText", () => {
  it("never exposes an internal status code", () => {
    for (const s of ["done", "no_form", "no_codes", "captcha", "stopped", "rate_limited", "error"] as const) {
      const text = couponStatusText(s);
      expect(text).not.toMatch(/_/);
      expect(text).toMatch(/^Coupon search .+\.$/);
    }
  });
});
