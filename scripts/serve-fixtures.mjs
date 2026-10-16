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
  const headers = { "content-type": "application/json", "set-cookie": "cart=" + id + "; Path=/" };
  if (!carts.has(id)) carts.set(id, []);
  if (path === "/cart/update.js" && req.method === "POST") {
    let body = "";
    for await (const chunk of req) body += chunk;
    const discount = String(JSON.parse(body || "{}").discount ?? "");
    carts.set(id, discount ? discount.split(",").map((c) => c.trim().toUpperCase()).filter(Boolean) : []);
  }
  res.writeHead(200, headers).end(JSON.stringify(cartJson(carts.get(id))));
}

createServer(async (req, res) => {
  const path = new URL(req.url ?? "/", "http://localhost").pathname;
  if (path === "/cart.js" || path === "/cart/update.js") return cartApi(req, res, path);
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
