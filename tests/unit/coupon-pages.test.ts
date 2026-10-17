// Owner, 2026-10-16: Find coupons "needs to work on every single website".
// The page path (any store without a known cart API) must cope with the ways
// checkouts differ: a coupon box behind a "Have a promo code?" toggle, stores
// that take seconds to update the total, codes that stack, error messages,
// prices in other currencies and formats, and controls the rules cannot name.
// Fake stores below; synthetic codes and amounts only.
import { describe, expect, it } from "vitest";
import type { Action, ActionResult } from "../../src/actions/executor";
import { findForm, newLines, removeTarget, revealTargets, storeReply } from "../../src/coupons/form";
import { couponSummary, runCouponSearch, type CouponPage } from "../../src/coupons/finder";
import { locateView, parseLocate } from "../../src/coupons/locate";
import { formatMoney, parseAmount, readTotal } from "../../src/coupons/money";
import type { SnapElement, Snapshot } from "../../src/snapshot/snapshot";

const snap = (elements: SnapElement[], text = ""): Snapshot => ({ url: "https://shop.test/checkout", title: "Checkout", text, elements, truncated: false });
const el = (ref: string, role: string, name: string, extra: Partial<SnapElement> = {}): SnapElement => ({
  ref,
  tag: role === "textbox" ? "input" : role === "link" ? "a" : "button",
  role,
  name,
  ...(role === "textbox" ? { type: "text" } : {}),
  ...extra,
});

describe("totals in any currency and format", () => {
  it("reads amounts the way stores print them", () => {
    expect(readTotal("Subtotal $120.00\nTotal $99.00")).toEqual({ amount: 99, currency: "$" });
    expect(readTotal("Zwischensumme 120,00 €\nGesamtsumme 1.234,56 €")).toEqual({ amount: 1234.56, currency: "€" });
    expect(readTotal("Total\nUSD $170.00")).toEqual({ amount: 170, currency: "$" });
    expect(readTotal("Order total: £89")).toEqual({ amount: 89, currency: "£" });
    // Live sweep 2026-10-17 (Brumate): a cart drawer whose only total sits on the Checkout button.
    expect(readTotal("BrüMate E-Gift Card $10\nYou're only $80 away from free shipping!\nAdd Discount Code\nCheckout - $10")).toEqual({ amount: 10, currency: "$" });
    expect(readTotal("CHECKOUT+ · $25.69")).toEqual({ amount: 25.69, currency: "$" });
    expect(readTotal("Pay now €12,50")).toEqual({ amount: 12.5, currency: "€" });
    // A labelled total wins over the button amount (order protection can sit in the button's figure);
    // the button amount wins over a Subtotal; a Subtotal alone is still not a total.
    expect(readTotal("Total $20.00\nCHECKOUT+ · $25.69")).toEqual({ amount: 20, currency: "$" });
    expect(readTotal("Subtotal $20.00\nCHECKOUT+ · $25.69")).toEqual({ amount: 25.69, currency: "$" });
    expect(readTotal("Subtotal $20.00\nShipping calculated at checkout")).toBeNull();
    expect(readTotal("You're only $80 away from free shipping!")).toBeNull();
    expect(readTotal("Total ¥12,800")).toEqual({ amount: 12800, currency: "¥" });
    expect(readTotal("Amount due CHF 99.00")).toEqual({ amount: 99, currency: "CHF" });
    expect(readTotal("Total 499,00 kr")).toEqual({ amount: 499, currency: "kr" });
    expect(readTotal("Estimated total (2 items) CA$45.50")).toEqual({ amount: 45.5, currency: "CA$" });
    expect(readTotal("Total 1 234,50 €")).toEqual({ amount: 1234.5, currency: "€" });
  });

  it("never reads a subtotal, savings, or item count as the total", () => {
    expect(readTotal("Subtotal $120.00")).toBeNull();
    expect(readTotal("Total savings $20.00")).toBeNull();
    expect(readTotal("Total items 3")).toBeNull();
    expect(readTotal("Total $80.00\nTotal savings $20.00")?.amount).toBe(80);
  });

  it("uses the store's own label for the total when the usual words are missing", () => {
    expect(readTotal("Zu zahlen: 45,90 €")).toBeNull();
    expect(readTotal("Zu zahlen: 45,90 €", "Zu zahlen")).toEqual({ amount: 45.9, currency: "€" });
  });

  it("parses separators by position and formats in the store's currency", () => {
    expect(parseAmount("1.234,56")).toBe(1234.56);
    expect(parseAmount("1,234.56")).toBe(1234.56);
    expect(parseAmount("12,800")).toBe(12800);
    expect(parseAmount("99")).toBe(99);
    expect(formatMoney(99, "€")).toBe("€99.00");
    expect(formatMoney(99, "EUR")).toBe("€99.00");
    expect(formatMoney(99, "USD")).toBe("$99.00");
    expect(formatMoney(99)).toBe("$99.00");
  });
});

describe("finding the coupon box", () => {
  it("finds boxes and Apply buttons named in other languages or with an icon", () => {
    const de = snap([el("e1", "textbox", "Gutscheincode"), el("e2", "button", "Einlösen")]);
    expect(findForm(de)?.apply.ref).toBe("e2");
    const icon = snap([el("e1", "textbox", "Promo code"), el("e2", "button", "→"), el("e3", "button", "Place order")]);
    expect(findForm(icon)?.apply.ref).toBe("e2");
  });

  it("never picks an order, payment, or remove control as Apply", () => {
    const s = snap([el("e1", "textbox", "Promo code"), el("e2", "button", "Pay"), el("e3", "button", "Remove")]);
    expect(findForm(s)).toBeNull();
  });

  it("finds the toggle that shows a hidden box, never a link that leaves the page or an order button", () => {
    const s = snap([
      el("e1", "link", "Coupons", { href: "/pages/coupons" }),
      el("e2", "link", "Click here to enter your code", { href: "#" }),
      el("e3", "button", "Add a promo code"),
      el("e4", "button", "Show order summary", { expanded: false }),
      el("e5", "button", "Place order and apply discount"),
    ]);
    expect(revealTargets(s).map((e) => e.ref)).toEqual(["e2", "e3", "e4"]);
  });

  it("removes only a coupon, never a product", () => {
    const woo = snap([el("e1", "link", "Remove item", { href: "/cart?remove_item=abc" }), el("e2", "link", "[Remove]", { href: "/cart?remove_coupon=save10" })]);
    expect(removeTarget(woo, "SAVE10")?.ref).toBe("e2");
    const magento = snap([el("e1", "button", "Remove"), el("e2", "button", "Cancel Coupon")]);
    expect(removeTarget(magento, "SAVE10")?.ref).toBe("e2");
    const shopify = snap([el("e1", "button", "Remove Synthetic bracket"), el("e2", "button", "Remove SAVE10")]);
    expect(removeTarget(shopify, "SAVE10")?.ref).toBe("e2");
    expect(removeTarget(snap([el("e1", "button", "Remove")]), "SAVE10")).toBeNull();
    // Live sweep 2026-10-17, Brumate: the applied code is a "× CODE" pill with no "Remove" text.
    const drawer = snap([el("e1", "button", "× Synthetic bracket"), el("e2", "button", "× LL10-XEEG0MNF"), el("e3", "button", "SAVE10 ×")]);
    expect(removeTarget(drawer, "LL10-XEEG0MNF")?.ref).toBe("e2");
    expect(removeTarget(drawer, "SAVE10")?.ref).toBe("e3");
    expect(removeTarget(drawer, "XMAS20")).toBeNull();
    // Brumate's drawer, as the snapshot names it: the × button's SVG title, next to a product's remove button.
    const brumate = snap([el("e1", "button", "Close cart drawer"), el("e2", "button", "Remove Paragon Hydration Pack from cart"), el("e3", "button", "Remove discount"), el("e4", "button", "Checkout - $139.99")]);
    expect(removeTarget(brumate, "LL10-XEEG0MNF")?.ref).toBe("e3");
    expect(removeTarget(snap([el("e1", "button", "Xtra 20")]), "TRA 20")).toBeNull();
  });

  it("reads what the store just said", () => {
    expect(storeReply(newLines("Total $100.00", "That code isn't valid.\nTotal $100.00"))).toBe("rejected");
    expect(storeReply("Coupon code \"x\" does not exist!")).toBe("rejected");
    expect(storeReply("Der Gutscheincode ist ungültig.")).toBe("rejected");
    expect(storeReply("Applying…")).toBe("busy");
    expect(storeReply("SAVE10 applied")).toBe("accepted");
    expect(storeReply(newLines("Enter a valid code", "Enter a valid code"))).toBeNull();
  });
});

// A configurable fake checkout. Waits are virtual: each "wait" action is one tick.
interface StoreOpts {
  pct: Record<string, number>;
  base?: number;
  fmt?: (n: number) => string;
  /** The box shows only after the toggle is clicked. */
  hidden?: boolean;
  /** Ticks (waits of any length) before a new total shows. */
  lag?: number;
  /** Shows an error line for codes it refuses. */
  message?: boolean;
  /** Codes add up instead of replacing each other. */
  stack?: boolean;
  /** Each applied code gets a "Remove CODE" button. */
  removable?: boolean;
  /** The "Remove CODE" button does nothing. */
  brokenRemove?: boolean;
  /** The coupon box disappears while a code is applied (a drawer that shows a pill instead). */
  boxGoneWhenApplied?: boolean;
  inputName?: string;
  applyName?: string;
}

function store(o: StoreOpts): CouponPage & { applied: string[]; clicks: string[]; ordered: number } {
  const base = o.base ?? 100;
  const fmt = o.fmt ?? ((n: number) => "$" + n.toFixed(2));
  let open = !o.hidden;
  let typed = "";
  let msg = "";
  let shown = base;
  let pending: { total: number; at: number } | null = null;
  let tick = 0;
  const s = {
    applied: [] as string[],
    clicks: [] as string[],
    ordered: 0,
    async snapshot(): Promise<Snapshot> {
      if (pending && tick >= pending.at) {
        shown = pending.total;
        pending = null;
      }
      const els: SnapElement[] = [];
      if (!open) els.push(el("t1", "button", "Have a promo code?", { expanded: false }));
      if (open && !(o.boxGoneWhenApplied && s.applied.length)) els.push(el("i1", "textbox", o.inputName ?? "Discount code"), el("a1", "button", o.applyName ?? "Apply"));
      if (o.removable || o.brokenRemove) s.applied.forEach((c, i) => els.push(el("r" + (i + 1), "button", "Remove " + c)));
      els.push(el("p1", "button", "Place order"));
      // Like real stores, each applied code is listed in the order summary.
      const lines = s.applied.map((c) => "Discount (" + c + ")");
      return snap(els, ["Subtotal " + fmt(base), ...lines, msg, "Total " + fmt(shown)].filter(Boolean).join("\n"));
    },
    async act(a: Action): Promise<ActionResult> {
      const ok = { ok: true, action: a.type, message: "ok" };
      if (a.type === "wait") tick++;
      if (a.type === "type") {
        typed = a.text;
        msg = "";
      }
      if (a.type !== "click") return ok;
      s.clicks.push(a.ref);
      const settle = (): void => {
        const off = s.applied.reduce((sum, c) => sum + (o.pct[c] ?? 0), 0);
        pending = { total: Math.round(base * (1 - off / 100) * 100) / 100, at: tick + (o.lag ?? 0) };
      };
      if (a.ref === "t1") open = true;
      if (a.ref === "p1") s.ordered++;
      if (a.ref === "a1") {
        if (o.pct[typed]) {
          s.applied = o.stack ? [...s.applied.filter((c) => c !== typed), typed] : [typed];
          msg = "";
        } else if (o.message) msg = "Sorry, " + typed + " isn't a valid code.";
        settle();
      }
      if (a.ref.startsWith("r") && !o.brokenRemove) {
        s.applied.splice(Number(a.ref.slice(1)) - 1, 1);
        settle();
      }
      return ok;
    },
  };
  return s;
}

const codes = (...list: string[]) => list.map((code) => ({ code, origin: "verified" as const, sourceUrl: "https://deals.test/" }));

describe("the page path on different kinds of checkout", () => {
  it("opens a coupon box hidden behind a toggle", async () => {
    const p = store({ pct: { SAVE10: 10 }, hidden: true, message: true });
    const out = await runCouponSearch({ page: p, codes: codes("NOPE", "SAVE10"), settleMs: 900 });
    expect(p.clicks[0]).toBe("t1");
    expect(out.best?.code).toBe("SAVE10");
    expect(out.applied).toBe(true);
    expect(p.ordered).toBe(0);
  });

  it("waits for a slow store instead of calling a working code a failure", async () => {
    // The total changes 4 ticks (about 1.2 s) after Apply; a fixed 0.4 s wait missed it.
    const p = store({ pct: { SAVE20: 20 }, lag: 4 });
    const out = await runCouponSearch({ page: p, codes: codes("SAVE20"), settleMs: 2500 });
    expect(out.attempts[0]).toMatchObject({ code: "SAVE20", total: 80, saving: 20 });
    expect(out.best?.code).toBe("SAVE20");
  });

  it("moves on as soon as the store says a code is invalid", async () => {
    const p = store({ pct: {}, message: true });
    const out = await runCouponSearch({ page: p, codes: codes("NOPE1", "NOPE2"), settleMs: 2500 });
    expect(out.attempts.map((a) => [a.accepted, a.note])).toEqual([
      [false, "Not accepted by the store."],
      [false, "Not accepted by the store."],
    ]);
  });

  it("takes a working code off before the next, so stacked codes are measured one at a time", async () => {
    const p = store({ pct: { SAVE10: 10, SAVE20: 20 }, stack: true, removable: true });
    const out = await runCouponSearch({ page: p, codes: codes("SAVE10", "SAVE20"), settleMs: 300 });
    expect(out.attempts.map((a) => a.total)).toEqual([90, 80]);
    expect(out.best?.code).toBe("SAVE20");
    expect(p.applied).toEqual(["SAVE20"]);
  });

  it("stops when the store stacks the next code on a kept one it offers no safe remove button for", async () => {
    const p = store({ pct: { SAVE10: 10, SAVE20: 20 }, stack: true, message: true });
    const out = await runCouponSearch({ page: p, codes: codes("SAVE10", "NOPE", "SAVE20", "NOPE2"), settleMs: 300 });
    // A refused code leaves the kept one on: not the kept code's total, and not a reason to stop.
    expect(out.attempts.map((a) => [a.code, a.total, a.accepted])).toEqual([
      ["SAVE10", 90, null],
      ["NOPE", null, false],
    ]);
    expect(out.attempts[1]?.note).toBe("The store kept SAVE10 on the order and did not take this code in its place.");
    expect(out.best?.code).toBe("SAVE10");
    expect(out.applied).toBe(true);
    expect(couponSummary(out)).toContain("added SAVE20 on top of it, so the total now counts both codes");
  });

  // Live sweep 2026-10-17, Brumate (second run): the summary must say which step
  // failed when a code stays on, so the next diagnosis needs no screenshot.
  it("names the step that failed when a kept code cannot be taken off", async () => {
    const broken = store({ pct: { SAVE10: 10, SAVE20: 20 }, brokenRemove: true, message: true });
    const a = await runCouponSearch({ page: broken, codes: codes("SAVE10", "SAVE20"), settleMs: 300, maxSettleMs: 300 });
    expect(a.attempts.map((x) => x.code)).toEqual(["SAVE10"]);
    expect(a.note).toBe("The store kept the earlier code on the order: I pressed its remove control, but the total did not go back, so I stopped testing there.");
    const gone = store({ pct: { SAVE10: 10, SAVE20: 20 }, boxGoneWhenApplied: true, message: true });
    const b = await runCouponSearch({ page: gone, codes: codes("SAVE10", "SAVE20"), settleMs: 300 });
    expect(b.attempts.map((x) => x.code)).toEqual(["SAVE10"]);
    expect(b.note).toBe(
      "The store kept the earlier code on the order and shows no remove button I can use safely, and its coupon box is not available while that code is on, so I stopped testing there.",
    );
    expect(b.best?.code).toBe("SAVE10");
    expect(b.applied).toBe(true);
  });

  // Live sweep 2026-10-17, Brumate: a drawer with no remove control that swaps
  // the applied code for the next working one. Testing used to stop at code 1 of 24.
  it("keeps testing when the store swaps a kept code for the next working one", async () => {
    const p = store({ pct: { SAVE10: 10, SAVE20: 20 }, message: true });
    const out = await runCouponSearch({ page: p, codes: codes("SAVE10", "NOPE", "SAVE20", "NOPE2"), settleMs: 300 });
    expect(out.attempts.map((a) => [a.code, a.total])).toEqual([
      ["SAVE10", 90],
      ["NOPE", null],
      ["SAVE20", 80],
      ["NOPE2", null],
    ]);
    expect(out.note).toBeUndefined();
    expect(out.best?.code).toBe("SAVE20");
    expect(out.applied).toBe(true);
    expect(p.applied).toEqual(["SAVE20"]);
    expect(p.ordered).toBe(0);
  });

  it("measures savings in euros and says them in euros", async () => {
    const p = store({ pct: { RABATT15: 15 }, base: 200, fmt: (n) => n.toFixed(2).replace(".", ",") + " €", inputName: "Gutscheincode", applyName: "Einlösen" });
    const out = await runCouponSearch({ page: p, codes: codes("RABATT15"), settleMs: 300 });
    expect(out.currency).toBe("€");
    expect(couponSummary(out)).toContain("your total drops from **€200.00** to **€170.00**");
  });

  it("asks the model once when the rules find no box, and still checks what it names", async () => {
    const p = store({ pct: { SAVE10: 10 }, inputName: "Enter it here", applyName: "Let's go", message: true });
    let asked = 0;
    const out = await runCouponSearch({
      page: p,
      codes: codes("SAVE10"),
      settleMs: 300,
      locate: async (s) => {
        asked++;
        return parseLocate('{"coupon_input": "i1", "apply_button": "a1", "reveal_control": null, "total_label": null}', s);
      },
    });
    expect(asked).toBe(1);
    expect(out.best?.code).toBe("SAVE10");
  });

  it("never clicks an order button the model names as Apply", async () => {
    const p = store({ pct: { SAVE10: 10 }, inputName: "Enter it here", applyName: "Let's go" });
    const out = await runCouponSearch({
      page: p,
      codes: codes("SAVE10"),
      settleMs: 300,
      locate: async (s) => parseLocate('{"coupon_input": "i1", "apply_button": "p1"}', s),
    });
    expect(out.status).toBe("no_form");
    expect(p.ordered).toBe(0);
  });
});

describe("what the model is shown", () => {
  it("lists controls without values and only the lines about totals and codes", () => {
    const s = snap(
      [el("e1", "textbox", "Email", { value: "pat@example.test" }), el("e2", "textbox", "Promo code"), el("e3", "button", "Apply")],
      "Ship to 12 Synthetic Lane, Springfield\nPromo code\nSubtotal $50.00\nTotal $55.00\nsk-ant-api03-SYNTHETICSYNTHETIC",
    );
    const view = locateView(s);
    expect(view).toContain('e2 textbox/text: "Promo code"');
    expect(view).toContain("Total $55.00");
    expect(view).not.toContain("pat@example.test");
    expect(view).not.toContain("Synthetic Lane");
    expect(view).not.toContain("sk-ant-api03");
  });

  it("drops refs that are not on the page and labels that are too long", () => {
    const s = snap([el("e1", "textbox", "Code")]);
    expect(parseLocate('{"coupon_input": "e9", "total_label": "' + "x".repeat(80) + '"}', s)).toBeNull();
    expect(parseLocate('Sure! {"coupon_input": "e1", "total_label": "Zu zahlen"}', s)).toEqual({ input: "Code", totalLabel: "Zu zahlen" });
    expect(parseLocate("no json", s)).toBeNull();
  });
});
