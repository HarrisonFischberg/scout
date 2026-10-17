// Static server for tests/fixtures. Local only: binds 127.0.0.1.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("../tests/fixtures", import.meta.url)));
const port = Number(process.argv[2] ?? 4173);
const types = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript" };

// Fake Shopify cart API (T031) for tests/fixtures/shopify-cart.html. One cart
// per browser, keyed by a cookie, so parallel tests do not share state.
// Synthetic codes: BEEFY15 = 15% off, KETO10 = 10% off; anything else is rejected.
const SUBTOTAL = 15978; // cents
const PCT = { BEEFY15: 15, KETO10: 10 };
const carts = new Map();
function cartJson(codes) {
  const valid = codes.find((c) => PCT[c]);
  // Without a code the store's automatic 5% bundle discount applies.
  const total = valid ? Math.round(SUBTOTAL * (1 - PCT[valid] / 100)) : Math.round(SUBTOTAL * 0.95);
  return { total_price: total, currency: "USD", discount_codes: codes.map((c) => ({ code: c, applicable: !!PCT[c] })) };
}
async function cartApi(req, res, path) {
  const id = /(?:^|;\s*)cart=([\w-]+)/.exec(req.headers.cookie ?? "")?.[1] ?? Math.random().toString(36).slice(2);
  // Real Shopify stores answer /cart.js as text/javascript (checked 2026-10-16).
  const headers = { "content-type": "text/javascript; charset=utf-8", "set-cookie": "cart=" + id + "; Path=/" };
  if (!carts.has(id)) carts.set(id, []);
  if (path === "/cart/update.js" && req.method === "POST") {
    let body = "";
    for await (const chunk of req) body += chunk;
    const discount = String(JSON.parse(body || "{}").discount ?? "");
    carts.set(id, discount ? discount.split(",").map((c) => c.trim().toUpperCase()).filter(Boolean) : []);
  }
  res.writeHead(200, headers).end(JSON.stringify(cartJson(carts.get(id))));
}

// Fake WooCommerce Store API for tests/fixtures/woo-cart.html, answered only
// for pages that set the cookie platform=woo (so other fixtures stay
// non-WooCommerce). Synthetic codes: save10 = 10%, save20 = 20%; they stack.
// Changes need the nonce from GET /cart, like the real API.
const WOO_PCT = { save10: 10, save20: 20 };
const wooCarts = new Map();
async function wooApi(req, res, route) {
  const id = /(?:^|;\s*)cart=([\w-]+)/.exec(req.headers.cookie ?? "")?.[1] ?? "anon";
  const coupons = wooCarts.get(id) ?? [];
  const json = (status, body, extra = {}) => res.writeHead(status, { "content-type": "application/json", ...extra }).end(JSON.stringify(body));
  const cart = () => {
    const off = coupons.reduce((s, c) => s + (WOO_PCT[c] ?? 0), 0);
    return { coupons: coupons.map((code) => ({ code })), totals: { total_price: String(Math.round(15000 * (1 - off / 100))), currency_code: "EUR", currency_minor_unit: 2 } };
  };
  if (route === "/cart" && req.method === "GET") return json(200, cart(), { Nonce: "fixture-nonce" });
  if (req.method !== "POST") return json(405, {});
  if (req.headers.nonce !== "fixture-nonce") return json(401, { code: "woocommerce_rest_missing_nonce" });
  let body = "";
  for await (const chunk of req) body += chunk;
  const code = String(JSON.parse(body || "{}").code ?? "").toLowerCase();
  if (route === "/cart/apply-coupon") {
    if (!WOO_PCT[code]) return json(400, { code: "woocommerce_rest_cart_coupon_error", message: 'Coupon "' + code + '" does not exist!' });
    if (!coupons.includes(code)) coupons.push(code);
  } else if (route === "/cart/remove-coupon") {
    const i = coupons.indexOf(code);
    if (i >= 0) coupons.splice(i, 1);
  } else return json(404, {});
  wooCarts.set(id, coupons);
  return json(200, cart());
}

createServer(async (req, res) => {
  const path = new URL(req.url ?? "/", "http://localhost").pathname;
  if (path === "/cart.js" || path === "/cart/update.js") return cartApi(req, res, path);
  if (path.startsWith("/wp-json/wc/store/v1/") && /(?:^|;\s*)platform=woo/.test(req.headers.cookie ?? "")) {
    return wooApi(req, res, path.slice("/wp-json/wc/store/v1".length));
  }
  const file = resolve(join(root, normalize(path === "/" ? "/index.html" : path)));
  if (!file.startsWith(root + "/")) {
    res.writeHead(403).end("forbidden");
    return;
  }
  try {
    const body = await readFile(file);
    res.writeHead(200, { "content-type": types[extname(file)] ?? "application/octet-stream" }).end(body);
  } catch {
    res.writeHead(404).end("not found");
  }
}).listen(port, "127.0.0.1");
