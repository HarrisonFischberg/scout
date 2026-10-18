// Stores whose coupon box is only at checkout (owner's choice 2026-10-17):
// Scout presses the cart's own Checkout control and waits for the checkout
// page. Nothing is typed; express wallets and order buttons are never pressed.
import { describe, expect, it } from "vitest";
import { checkoutTarget, goToCheckout } from "../../src/coupons/finder";
import type { Action, ActionResult } from "../../src/actions/executor";
import type { SnapElement, Snapshot } from "../../src/snapshot/snapshot";

const snap = (url: string, text: string, elements: Array<Partial<SnapElement> & { name: string }>): Snapshot => ({
  url,
  title: "Cart",
  text,
  truncated: false,
  elements: elements.map((e, i) => ({ ref: "e" + (i + 1), tag: "button", role: "button", ...e })),
});
const LONG = "Your order summary. Subtotal $40.00. Shipping calculated at the next step. ".repeat(4);

describe("checkoutTarget", () => {
  it("picks the plain Checkout control, never an express wallet or an order button", () => {
    const s = snap("https://shop.test/cart", LONG, [
      { name: "Shop Pay" },
      { name: "Express checkout" },
      { name: "PayPal Checkout" },
      { name: "Continue to checkout", tag: "a", role: "link", href: "/checkout" },
      { name: "Check out" },
      { name: "Place order" },
    ]);
    expect(checkoutTarget(s)?.name).toBe("Check out");
    expect(checkoutTarget(snap("https://shop.test/cart", LONG, [{ name: "Continue to checkout", tag: "a", role: "link", href: "/checkout" }]))?.name).toBe("Continue to checkout");
    expect(checkoutTarget(snap("https://shop.test/cart", LONG, [{ name: "Apple Pay" }, { name: "Buy now" }, { name: "Checkout", disabled: true }]))).toBeNull();
  });
});

function fakeStore(after: Snapshot | null, opts: { refuse?: boolean } = {}) {
  const acts: Action[] = [];
  let pressed = false;
  const cart = snap("https://shop.test/cart", LONG, [{ name: "Checkout" }, { name: "Shop Pay" }]);
  return {
    acts,
    cart,
    page: {
      snapshot: async () => (pressed && after ? after : cart),
      act: async (a: Action): Promise<ActionResult> => {
        acts.push(a);
        if (a.type === "click") {
          if (opts.refuse) return { ok: false, action: "click", error: "disabled", message: "Disabled." } as ActionResult;
          pressed = true;
        }
        return { ok: true, action: a.type, message: "ok" } as ActionResult;
      },
    },
  };
}

describe("goToCheckout", () => {
  it("presses Checkout once, types nothing, and returns the checkout page", async () => {
    const store = fakeStore(snap("https://shop.test/checkouts/abc", LONG, [{ name: "Discount code", tag: "input", role: "textbox", type: "text" }, { name: "Pay now" }]));
    const r = await goToCheckout(store.page, store.cart, { pollMs: 1 });
    expect(r).toEqual({ ok: true, url: "https://shop.test/checkouts/abc" });
    expect(store.acts.filter((a) => a.type === "click")).toEqual([{ type: "click", ref: "e1" }]);
    expect(store.acts.some((a) => a.type === "type")).toBe(false);
  });

  it("stops at a checkout that asks for a password or a CAPTCHA", async () => {
    const login = fakeStore(snap("https://shop.test/account/login", LONG, [{ name: "Password", tag: "input", role: "textbox", type: "password", redacted: true }]));
    expect(await goToCheckout(login.page, login.cart, { pollMs: 1 })).toMatchObject({ ok: false, why: "sign_in" });
    const bot = fakeStore(snap("https://shop.test/checkpoint", LONG + " Please verify you are a human.", []));
    expect(await goToCheckout(bot.page, bot.cart, { pollMs: 1 })).toMatchObject({ ok: false, why: "captcha" });
  });

  it("says so when the button does not respond or no page opens", async () => {
    const refused = fakeStore(null, { refuse: true });
    expect(await goToCheckout(refused.page, refused.cart, { pollMs: 1, timeoutMs: 20 })).toMatchObject({ ok: false, why: "refused" });
    const stuck = fakeStore(null);
    expect(await goToCheckout(stuck.page, stuck.cart, { pollMs: 1, timeoutMs: 20 })).toMatchObject({ ok: false, why: "no_page" });
  });
});
