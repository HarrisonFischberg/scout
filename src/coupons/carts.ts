// Store cart APIs beyond Shopify (coupon finder): WooCommerce's Store API and
// BigCommerce's Storefront API. Like shopify.ts, these run in the content
// script on the store's own origin with the user's session, the same requests
// the store's own coupon box sends. They never touch checkout or payment.
import type { CartState } from "./finder";
import { shopifyCartInfo, shopifyCartUpdate } from "./shopify";

type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;
type Update = CartState | { rateLimited: true } | null;

const JSON_HEADERS = { accept: "application/json" };

async function json(r: Response): Promise<unknown> {
  try {
    return JSON.parse(await r.text());
  } catch {
    return null;
  }
}

const wanted = (discount: string): string[] =>
  discount
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean);
const same = (a: string, b: string): boolean => a.toUpperCase() === b.toUpperCase();

/** Applied codes plus the requested ones the store refused. */
function withRefused(state: CartState, asked: string[]): CartState {
  const codes = [...state.codes];
  for (const c of asked) if (!codes.some((x) => same(x.code, c))) codes.push({ code: c, applicable: false });
  return { ...state, codes };
}

// ---------- WooCommerce Store API (/wp-json/wc/store/v1) ----------

const WOO_ROOTS = ["/wp-json/wc/store/v1", "/?rest_route=/wc/store/v1"];

function wooState(j: unknown): CartState | null {
  const c = j as { totals?: { total_price?: unknown; currency_code?: unknown; currency_minor_unit?: unknown }; coupons?: unknown } | null;
  const t = c?.totals;
  if (!t || typeof t.total_price !== "string" || !Array.isArray(c?.coupons)) return null;
  const minor = typeof t.currency_minor_unit === "number" ? t.currency_minor_unit : 2;
  const total = Number(t.total_price) / 10 ** minor;
  if (!Number.isFinite(total)) return null;
  const codes = (c.coupons as Array<{ code?: unknown }>).flatMap((x) => (typeof x?.code === "string" ? [{ code: x.code, applicable: true }] : []));
  return { total, currency: typeof t.currency_code === "string" ? t.currency_code : null, codes, platform: "woocommerce" };
}

// Both forms take the route path appended: "/wp-json/wc/store/v1/cart", "/?rest_route=/wc/store/v1/cart".
const wooUrl = (root: string, path: string): string => root + path;

/** WooCommerce cart and the nonce its Store API wants on changes, or null when this is not a WooCommerce store. */
async function wooCart(f: FetchFn): Promise<{ root: string; nonce: string; state: CartState } | null> {
  for (const root of WOO_ROOTS) {
    try {
      const r = await f(wooUrl(root, "/cart"), { credentials: "same-origin", headers: JSON_HEADERS });
      if (!r.ok) continue;
      const state = wooState(await json(r));
      if (!state) continue;
      return { root, nonce: r.headers.get("Nonce") ?? r.headers.get("X-WC-Store-API-Nonce") ?? "", state };
    } catch {
      // try the next form of the API root
    }
  }
  return null;
}

export async function wooCartInfo(f: FetchFn = fetch): Promise<CartState | null> {
  return (await wooCart(f))?.state ?? null;
}

/** Leaves exactly the codes in `discount` ("" clears) on the WooCommerce cart. */
export async function wooCartUpdate(discount: string, f: FetchFn = fetch): Promise<Update> {
  const cart = await wooCart(f);
  if (!cart) return null;
  const asked = wanted(discount);
  let state = cart.state;
  const call = async (path: string, code: string): Promise<Response> =>
    f(wooUrl(cart.root, path), {
      method: "POST",
      credentials: "same-origin",
      headers: { ...JSON_HEADERS, "content-type": "application/json", Nonce: cart.nonce, "X-WC-Store-API-Nonce": cart.nonce },
      body: JSON.stringify({ code }),
    });
  try {
    for (const c of state.codes.filter((x) => !asked.some((a) => same(a, x.code)))) {
      const r = await call("/cart/remove-coupon", c.code);
      if (r.status === 429) return { rateLimited: true };
      state = (r.ok && wooState(await json(r))) || state;
    }
    for (const code of asked.filter((a) => !state.codes.some((x) => same(x.code, a)))) {
      const r = await call("/cart/apply-coupon", code);
      if (r.status === 429) return { rateLimited: true };
      // A refused code answers 400 with an error; the cart is unchanged.
      if (r.ok) state = wooState(await json(r)) ?? state;
    }
  } catch {
    return null;
  }
  return withRefused(state, asked);
}

// ---------- BigCommerce Storefront API (/api/storefront) ----------

interface BcCart {
  id: string;
  cartAmount: number;
  currency: string | null;
  codes: string[];
}

async function bcCart(f: FetchFn): Promise<BcCart | null> {
  try {
    const r = await f("/api/storefront/carts", { credentials: "same-origin", headers: JSON_HEADERS });
    if (!r.ok) return null;
    const list = await json(r);
    const c = Array.isArray(list) ? (list[0] as Record<string, unknown> | undefined) : undefined;
    if (!c || typeof c.id !== "string" || typeof c.cartAmount !== "number") return null;
    const currency = (c.currency as { code?: unknown } | undefined)?.code;
    const codes = Array.isArray(c.coupons) ? (c.coupons as Array<{ code?: unknown }>).flatMap((x) => (typeof x?.code === "string" ? [x.code] : [])) : [];
    return { id: c.id, cartAmount: c.cartAmount, currency: typeof currency === "string" ? currency : null, codes };
  } catch {
    return null;
  }
}

const bcState = (c: BcCart): CartState => ({
  total: c.cartAmount,
  currency: c.currency,
  codes: c.codes.map((code) => ({ code, applicable: true })),
  platform: "bigcommerce",
});

export async function bigCommerceCartInfo(f: FetchFn = fetch): Promise<CartState | null> {
  const c = await bcCart(f);
  return c ? bcState(c) : null;
}

/** Leaves exactly the codes in `discount` ("" clears) on the BigCommerce cart (coupons live on its checkout). */
export async function bigCommerceCartUpdate(discount: string, f: FetchFn = fetch): Promise<Update> {
  const cart = await bcCart(f);
  if (!cart) return null;
  const asked = wanted(discount);
  const base = "/api/storefront/checkouts/" + encodeURIComponent(cart.id) + "/coupons";
  try {
    for (const code of cart.codes.filter((x) => !asked.some((a) => same(a, x)))) {
      const r = await f(base + "/" + encodeURIComponent(code), { method: "DELETE", credentials: "same-origin", headers: JSON_HEADERS });
      if (r.status === 429) return { rateLimited: true };
    }
    for (const code of asked.filter((a) => !cart.codes.some((x) => same(x, a)))) {
      const r = await f(base, {
        method: "POST",
        credentials: "same-origin",
        headers: { ...JSON_HEADERS, "content-type": "application/json" },
        body: JSON.stringify({ couponCode: code }),
      });
      if (r.status === 429) return { rateLimited: true };
    }
  } catch {
    return null;
  }
  const after = await bcCart(f);
  return after ? withRefused(bcState(after), asked) : null;
}

// ---------- Whichever the store runs ----------

let platform: "shopify" | "woocommerce" | "bigcommerce" | null = null;

/** The store's cart through its own API, trying Shopify, WooCommerce, then BigCommerce; null on other stores. */
export async function storeCartInfo(f: FetchFn = fetch): Promise<CartState | null> {
  const shopify = await shopifyCartInfo(f);
  if (shopify) {
    platform = "shopify";
    return { ...shopify, platform: "shopify" };
  }
  const woo = await wooCartInfo(f);
  if (woo) {
    platform = "woocommerce";
    return woo;
  }
  const bc = await bigCommerceCartInfo(f);
  if (bc) {
    platform = "bigcommerce";
    return bc;
  }
  platform = null;
  return null;
}

/** Sets the cart's codes through the API `storeCartInfo` found. */
export async function storeCartUpdate(discount: string, f: FetchFn = fetch): Promise<Update> {
  if (platform === "woocommerce") return wooCartUpdate(discount, f);
  if (platform === "bigcommerce") return bigCommerceCartUpdate(discount, f);
  if (platform === "shopify") {
    const r = await shopifyCartUpdate(discount, f);
    return r && !("rateLimited" in r) ? { ...r, platform: "shopify" } : r;
  }
  return null;
}
