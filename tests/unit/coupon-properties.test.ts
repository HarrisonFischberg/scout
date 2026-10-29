// Property tests for Find coupons on a store's cart API (QA 2026-10-29).
// Random stores (seeded, so a failure replays): percentage, fixed and
// minimum-spend codes, expired codes, stacking or not, a code the shopper
// already applied, and codes the store "accepts" without lowering the total.
// The production runCouponSearch and cart tester run unchanged against them.
import { describe, expect, it } from "vitest";
import { runCouponSearch, type CartApi, type CartState, type CouponPage } from "../../src/coupons/finder";

/** mulberry32: small, seeded, good enough to vary test stores. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Rule = { kind: "pct"; v: number } | { kind: "fixed"; v: number } | { kind: "min"; v: number; min: number } | { kind: "expired" } | { kind: "hollow" };

function randomStore(seed: number) {
  const r = rng(seed);
  const pick = <T,>(xs: T[]): T => xs[Math.floor(r() * xs.length)]!;
  const subtotal = Math.round((10 + r() * 290) * 100) / 100;
  const stack = r() < 0.3;
  const rules: Record<string, Rule> = {};
  const n = 1 + Math.floor(r() * 8);
  for (let i = 0; i < n; i++) {
    const kind = pick(["pct", "fixed", "min", "expired", "hollow", "pct"]);
    rules["C" + seed + "X" + i] =
      kind === "pct"
        ? { kind, v: pick([5, 10, 15, 20, 25, 33]) }
        : kind === "fixed"
          ? { kind, v: pick([1, 5, 10, 25, 500]) }
          : kind === "min"
            ? { kind, v: pick([5, 15, 30]), min: pick([25, 100, 250]) }
            : { kind } as Rule;
  }
  const names = Object.keys(rules);
  // Half the stores start with a code the shopper applied themselves.
  const start = r() < 0.5 && names.length ? [pick(names)] : [];
  // The store also lists codes nobody can use.
  const junk = Array.from({ length: Math.floor(r() * 4) }, (_, i) => "JUNK" + seed + "N" + i);
  return { subtotal, stack, rules, start, candidates: [...names, ...junk].sort(() => r() - 0.5) };
}

function cartOf(store: ReturnType<typeof randomStore>): CartApi & { codes: string[]; totalNow(): number } {
  let codes = [...store.start];
  const applies = (c: string): boolean => {
    const rule = store.rules[c];
    return !!rule && rule.kind !== "expired" && (rule.kind !== "min" || store.subtotal >= rule.min);
  };
  const off = (c: string): number => {
    const rule = store.rules[c]!;
    if (rule.kind === "pct" || rule.kind === "min") return (store.subtotal * rule.v) / 100;
    if (rule.kind === "fixed") return rule.v;
    return 0; // "hollow": accepted, takes nothing off
  };
  const state = (): CartState => {
    const valid = codes.filter(applies).slice(0, store.stack ? undefined : 1);
    const total = Math.max(0, Math.round((store.subtotal - valid.reduce((s, c) => s + off(c), 0)) * 100) / 100);
    return { total, currency: "USD", platform: "shopify", codes: codes.map((c) => ({ code: c, applicable: valid.includes(c) })) };
  };
  return {
    get codes() {
      return codes;
    },
    totalNow: () => state().total,
    info: async () => state(),
    update: async (d: string) => {
      codes = d ? d.split(",") : [];
      return state();
    },
    reload: async () => undefined,
  };
}

const pageOf = (cart: CartApi): CouponPage => ({
  cart,
  // No coupon box on the page: the winner goes in through the cart API.
  snapshot: async () => ({ url: "https://shop.test/cart", title: "Cart", nodes: [] }) as never,
  act: async () => ({ ok: false, error: "not_found" }) as never,
});

describe("Find coupons on random stores (seeded)", () => {
  const SEEDS = Array.from({ length: 300 }, (_, i) => i + 1);

  it("never leaves the cart worse, never claims an unverified win, and keeps the shopper's code when it is best", async () => {
    for (const seed of SEEDS) {
      const store = randomStore(seed);
      const cart = cartOf(store);
      const before = cart.totalNow();
      const out = await runCouponSearch({ page: pageOf(cart), codes: store.candidates.map((code) => ({ code, origin: "reported" as const })) });
      const after = cart.totalNow();
      const ctx = "seed " + seed + " " + JSON.stringify(store);

      expect(after, ctx).toBeLessThanOrEqual(before + 0.005);
      if (before === 0) {
        // Nothing to lower: stops before testing, cart untouched.
        expect(out.attempts, ctx).toEqual([]);
        expect(cart.codes, ctx).toEqual(store.start);
        continue;
      }
      expect(out.baseline, ctx).toBe(before);
      if (out.applied) {
        // A claimed win is the cart's real total, and lower than where it started.
        expect(out.best?.total, ctx).toBe(after);
        expect(after, ctx).toBeLessThan(before);
        for (const c of out.best!.combo ?? [out.best!.code]) expect(store.candidates, ctx).toContain(c);
      } else {
        // No win: the shopper's own codes are back, exactly.
        expect(cart.codes, ctx).toEqual(store.start);
        expect(after, ctx).toBe(before);
      }
      // The best possible single code was found when one beats the start.
      const bestSingle = Math.min(
        ...store.candidates.map((c) => {
          const probe = cartOf({ ...store, start: [c] });
          return probe.totalNow();
        }),
      );
      if (bestSingle < before - Math.max(0.1, before * 0.0025)) expect(after, ctx).toBeLessThanOrEqual(bestSingle + 0.005);
      // Every code is tried at most once on its own.
      const singles = out.attempts.filter((a) => !a.combo).map((a) => a.code);
      expect(new Set(singles).size, ctx).toBe(singles.length);
    }
  });
});

describe("the cart changes during a run (QA 2026-10-29)", () => {
  it("does not credit the shopper's own change to a code, and says the comparison no longer holds", async () => {
    // $100 cart; BIG20 = 20% off, SMALL10 = 10% off. After two codes the shopper removes a $40 item.
    let subtotal = 100;
    let codes: string[] = [];
    let updates = 0;
    const pct: Record<string, number> = { BIG20: 20, SMALL10: 10 };
    const state = (): CartState => {
      const valid = codes.filter((c) => pct[c]).slice(0, 1);
      const total = Math.round(subtotal * (1 - (valid[0] ? pct[valid[0]]! : 0) / 100) * 100) / 100;
      return { total, currency: "USD", platform: "shopify", codes: codes.map((c) => ({ code: c, applicable: valid.includes(c) })) };
    };
    const cart: CartApi = {
      info: async () => state(),
      update: async (d) => {
        codes = d ? d.split(",") : [];
        if (++updates === 2) subtotal = 60;
        return state();
      },
      reload: async () => undefined,
    };
    const out = await runCouponSearch({ page: pageOf(cart), codes: ["BIG20", "NOPE", "SMALL10"].map((code) => ({ code, origin: "reported" as const })) });
    // SMALL10 on the smaller cart ($54) must not be reported as saving $46 on the $100 cart.
    expect(out.applied).toBe(false);
    expect(out.message).toMatch(/cart changed/i);
    expect(codes).toEqual([]);
  });
});
