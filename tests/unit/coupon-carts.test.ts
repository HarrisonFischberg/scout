// Store cart APIs beyond Shopify (owner, 2026-10-16: coupons on every site).
// Fake WooCommerce Store API and BigCommerce Storefront API; synthetic codes.
import { describe, expect, it } from "vitest";
import { bigCommerceCartInfo, bigCommerceCartUpdate, storeCartInfo, storeCartUpdate, wooCartInfo, wooCartUpdate } from "../../src/coupons/carts";

type Call = { url: string; method: string; headers: Record<string, string>; body?: string };
const reply = (status: number, body: unknown, headers: Record<string, string> = {}): Response =>
  new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

/** WooCommerce: SAVE10 = 10% off; coupons stack; changes need the nonce from GET /cart. */
function woo(opts: { root?: "pretty" | "plain"; rateLimit?: boolean } = {}) {
  let coupons: string[] = [];
  const calls: Call[] = [];
  const valid: Record<string, number> = { save10: 10, save20: 20 };
  const cart = () => {
    const off = coupons.reduce((s, c) => s + (valid[c] ?? 0), 0);
    return { coupons: coupons.map((code) => ({ code })), totals: { total_price: String(Math.round(15000 * (1 - off / 100))), currency_code: "EUR", currency_minor_unit: 2 } };
  };
  const prefix = opts.root === "plain" ? "/?rest_route=/wc/store/v1" : "/wp-json/wc/store/v1";
  const f = async (url: string, init: RequestInit = {}): Promise<Response> => {
    calls.push({ url, method: init.method ?? "GET", headers: (init.headers ?? {}) as Record<string, string>, ...(init.body ? { body: String(init.body) } : {}) });
    if (!url.startsWith(prefix)) return reply(404, "<html>not found</html>", { "content-type": "text/html" });
    const path = url.slice(prefix.length);
    if (path === "/cart" && (init.method ?? "GET") === "GET") return reply(200, cart(), { Nonce: "n-123" });
    if ((init.headers as Record<string, string>).Nonce !== "n-123") return reply(401, { code: "woocommerce_rest_missing_nonce" });
    if (opts.rateLimit) return reply(429, {});
    const code = String(JSON.parse(String(init.body)).code).toLowerCase();
    if (path === "/cart/apply-coupon") {
      if (!valid[code]) return reply(400, { code: "woocommerce_rest_cart_coupon_error", message: 'Coupon "' + code + '" does not exist!' });
      coupons = [...new Set([...coupons, code])];
      return reply(200, cart());
    }
    if (path === "/cart/remove-coupon") {
      coupons = coupons.filter((c) => c !== code);
      return reply(200, cart());
    }
    return reply(404, {});
  };
  return { f, calls, get coupons() { return coupons; } };
}

/** BigCommerce: SAVE10 = $10 off; one checkout id = the cart id. */
function bigcommerce() {
  let coupons: string[] = [];
  const calls: Call[] = [];
  const f = async (url: string, init: RequestInit = {}): Promise<Response> => {
    const method = init.method ?? "GET";
    calls.push({ url, method, headers: (init.headers ?? {}) as Record<string, string> });
    if (url === "/api/storefront/carts") {
      return reply(200, [{ id: "cart-1", cartAmount: 100 - (coupons.includes("SAVE10") ? 10 : 0), currency: { code: "USD" }, coupons: coupons.map((code) => ({ code })) }]);
    }
    const m = /^\/api\/storefront\/checkouts\/cart-1\/coupons(?:\/(.+))?$/.exec(url);
    if (!m) return reply(404, "nope", { "content-type": "text/html" });
    if (method === "POST") {
      const code = String(JSON.parse(String(init.body)).couponCode);
      if (code !== "SAVE10") return reply(400, { status: 400, title: "The coupon code you entered is not valid." });
      coupons = [code];
      return reply(200, {});
    }
    if (method === "DELETE") {
      coupons = coupons.filter((c) => c !== decodeURIComponent(m[1] ?? ""));
      return reply(200, {});
    }
    return reply(405, {});
  };
  return { f, calls, get coupons() { return coupons; } };
}

describe("WooCommerce Store API", () => {
  it("reads the cart in the store's currency and minor units", async () => {
    expect(await wooCartInfo(woo().f)).toEqual({ total: 150, currency: "EUR", codes: [], platform: "woocommerce" });
    expect(await wooCartInfo(woo({ root: "plain" }).f)).toMatchObject({ total: 150, platform: "woocommerce" });
  });

  it("tests one code at a time: takes the last one off, sends the nonce, reports refusals", async () => {
    const w = woo();
    expect(await wooCartUpdate("SAVE10", w.f)).toMatchObject({ total: 135, codes: [{ code: "save10", applicable: true }] });
    // Codes stack in WooCommerce: the next try removes SAVE10 first.
    expect(await wooCartUpdate("SAVE20", w.f)).toMatchObject({ total: 120, codes: [{ code: "save20", applicable: true }] });
    expect(await wooCartUpdate("NOPE", w.f)).toMatchObject({ total: 150, codes: [{ code: "NOPE", applicable: false }] });
    expect(w.calls.filter((c) => c.method === "POST").every((c) => c.headers.Nonce === "n-123")).toBe(true);
    expect(await wooCartUpdate("", w.f)).toMatchObject({ total: 150, codes: [] });
  });

  it("reports the store asking to slow down", async () => {
    expect(await wooCartUpdate("SAVE10", woo({ rateLimit: true }).f)).toEqual({ rateLimited: true });
  });

  it("is not mistaken for a store that has no such API", async () => {
    expect(await wooCartInfo(async () => reply(200, "<html>shop</html>", { "content-type": "text/html" }))).toBeNull();
    expect(await wooCartInfo(async () => reply(200, { name: "Some WordPress site" }))).toBeNull();
  });
});

describe("BigCommerce Storefront API", () => {
  it("reads the cart and applies, swaps, and clears codes on its checkout", async () => {
    const b = bigcommerce();
    expect(await bigCommerceCartInfo(b.f)).toEqual({ total: 100, currency: "USD", codes: [], platform: "bigcommerce" });
    expect(await bigCommerceCartUpdate("SAVE10", b.f)).toMatchObject({ total: 90, codes: [{ code: "SAVE10", applicable: true }] });
    expect(await bigCommerceCartUpdate("NOPE", b.f)).toMatchObject({ total: 100, codes: [{ code: "NOPE", applicable: false }] });
    expect(b.coupons).toEqual([]);
    expect(b.calls.some((c) => c.method === "DELETE" && c.url.endsWith("/coupons/SAVE10"))).toBe(true);
  });
});

describe("whichever the store runs", () => {
  it("finds WooCommerce after Shopify's cart is missing and keeps using it", async () => {
    const w = woo();
    const f = async (url: string, init?: RequestInit) => (url === "/cart.js" ? reply(404, "<html></html>", { "content-type": "text/html" }) : w.f(url, init));
    expect(await storeCartInfo(f)).toMatchObject({ platform: "woocommerce" });
    expect(await storeCartUpdate("SAVE10", f)).toMatchObject({ total: 135, platform: "woocommerce" });
  });

  it("finds BigCommerce last and returns null on a store with no known cart API", async () => {
    const b = bigcommerce();
    expect(await storeCartInfo(b.f)).toMatchObject({ platform: "bigcommerce" });
    expect(await storeCartInfo(async () => reply(404, "<html></html>", { "content-type": "text/html" }))).toBeNull();
    expect(await storeCartUpdate("SAVE10", async () => reply(404, ""))).toBeNull();
  });
});
