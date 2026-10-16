import { describe, expect, it } from "vitest";
import { AgentControl } from "../../src/agent/loop";
import type { Action, ActionResult } from "../../src/actions/executor";
import { suggestCodes } from "../../src/coupons/codes";
import { parseCodes, parseTotal, runCouponSearch, type CouponPage } from "../../src/coupons/finder";
import type { ProviderClient } from "../../src/providers";
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
  const five = ["WELCOME5", "SAVE10", "FREESHIP", "SAVE20", "BOGUS99"];

  it("tries each code once, keeps the larger saving, never clicks order", async () => {
    const p = shop();
    const seen: string[] = [];
    const out = await runCouponSearch({ page: p, codes: five, settleMs: 0, onAttempt: (a) => seen.push(a.code) });
    expect(out.status).toBe("done");
    expect(out.baseline).toBe(100);
    expect(seen).toEqual(five);
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
    const out = await runCouponSearch({ page: shop(), codes: ["NOPE1", "NOPE2"], settleMs: 0 });
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

describe("suggestCodes", () => {
  it("parses model text and sums usage", async () => {
    const provider: ProviderClient = {
      id: "anthropic",
      async *stream() {
        yield { type: "text", delta: "SAVE10\nSAVE20\n" };
        yield { type: "usage", usage: { inputTokens: 12, outputTokens: 4 } };
      },
    };
    const r = await suggestCodes(provider, "m", "shop.test");
    expect(r).toEqual({ codes: ["SAVE10", "SAVE20"], inputTokens: 12, outputTokens: 4 });
  });
});
