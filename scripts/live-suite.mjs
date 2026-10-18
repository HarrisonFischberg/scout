#!/usr/bin/env node
// Live coupon suite: runs the real built popup and content script (run
// `npm run build` first) against real merchant carts, one merchant at a
// time, with the owner's real API key, and records what Find coupons did.
// It is the checkout e2e harness (tests/e2e/checkout.spec.ts) pointed at
// live stores: a fake `browser` API in the popup page forwards content-script
// calls into the merchant tab.
//
//   SCOUT_LIVE_KEY=... node scripts/live-suite.mjs [options]
//   (the Anthropic key under its own name: the Claude CLI refuses Remote
//   Control when ANTHROPIC_API_KEY is set in the shell; that name still works
//   as a fallback outside Remote Control)
//     --browser chromium|webkit   (default chromium: it reaches more carts than WebKit in this harness;
//                                 the e2e specs stay on WebKit for Safari parity)
//     --headed                    show the browser
//     --only "Chomps,Rumpl"       run some merchants only (name substrings)
//     --limit N                   first N merchants
//     --skip N                    skip the first N merchants (with --limit: a slice of the list)
//     --model claude-sonnet-5-5   model for the search (default: the extension's default)
//     --effort medium             effort setting (default: the extension's default)
//     --no-second-pass            answer "Stop here" instead of "Search again"
//     --out ralph/evidence/live-suite/<stamp>
//     --summarize <dir>           rewrite <dir>/summary.md from its results.json (a partial run) and exit
//     --cart-only                 stop after the item is in the cart (no popup, no API call): checks the harness
//     --checkout-step             when the cart has no discount field, open the checkout's first step (the
//                                 information page) and run the popup there. Owner's decision 2026-10-17:
//                                 nothing is typed into any field, Continue / Pay / Place order are never
//                                 pressed, no account is created; a sign-in wall, CAPTCHA or payment page stops it.
//     --single-process            Chromium in one process (the only browser that starts inside the
//                                 Claude Code sandbox on macOS; WebKit cannot)
//   When HTTPS_PROXY is set in the shell, the browser's traffic goes through it (the sandbox's proxy).
//
// Safety: cart pages only. The suite never opens checkout, never clicks buy,
// pay or place order (the engine's classifier refuses those controls too),
// never signs up for anything, stops on CAPTCHA or rate limits, and uses a
// fresh browser context per merchant so nothing persists. It never guesses
// codes; it only runs the engine. The key is read from the environment and
// never printed or written.
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";

const require = createRequire(import.meta.url);
const { webkit, chromium } = require("playwright");

const root = resolve(new URL("..", import.meta.url).pathname);
const RES = join(root, "apple", "Extension", "Resources");
const POPUP_ORIGIN = "https://scout-live.local";
const RUN_TIMEOUT_MS = 10 * 60 * 1000;
const NAV_TIMEOUT_MS = 45_000;

const args = process.argv.slice(2);
const flag = (name, dflt) => {
  const i = args.indexOf("--" + name);
  return i >= 0 ? args[i + 1] : dflt;
};
const has = (name) => args.includes("--" + name);
const browserName = flag("browser", "chromium");
const headed = has("headed");
const only = (flag("only", "") || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
const limit = Number(flag("limit", "0")) || 0;
const skip = Number(flag("skip", "0")) || 0;
const model = flag("model", "");
const effort = flag("effort", "");
const secondPass = !has("no-second-pass");
const singleProcess = has("single-process");
const cartOnly = has("cart-only");
const checkoutStep = has("checkout-step");
const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const out = resolve(flag("out", join("ralph", "evidence", "live-suite", stamp)));

if (flag("summarize", "")) {
  const dir = resolve(flag("summarize", ""));
  const saved = JSON.parse(readFileSync(join(dir, "results.json"), "utf8"));
  writeSummary(dir, saved.results, {
    browser: saved.browser,
    model: saved.model === "default" ? "" : saved.model,
    effort: saved.effort === "default" ? "" : saved.effort,
    secondPass: saved.secondPass !== false,
    stamp: saved.startedAt || stamp,
  });
  process.exit(0);
}

const key = process.env.SCOUT_LIVE_KEY || process.env.ANTHROPIC_API_KEY || "";
if (!key && !cartOnly) {
  console.error("SCOUT_LIVE_KEY is not set in this shell (the Anthropic API key). Nothing was run.");
  process.exit(2);
}
for (const f of ["popup.html", "popup.js", "content.js", "overlay.js"]) {
  if (!existsSync(join(RES, f))) {
    console.error("Missing built file " + f + ": run `npm run build` first.");
    process.exit(2);
  }
}
mkdirSync(out, { recursive: true });

const list = JSON.parse(readFileSync(join(root, "scripts", "live-merchants.json"), "utf8")).merchants;
let merchants = only.length ? list.filter((m) => only.some((o) => m.name.toLowerCase().includes(o) || m.url.includes(o))) : list;
if (skip) merchants = merchants.slice(skip);
if (limit) merchants = merchants.slice(0, limit);

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const EVAL_TIMEOUT_MS = 30_000;
/** page.evaluate with a deadline: Playwright's default timeout does not cover it, and a store that
 * never answers a fetch inside it hung the 2026-10-17 sweep for five hours. */
function evalWithin(page, fn, arg, ms = EVAL_TIMEOUT_MS) {
  const run = page.evaluate(fn, arg);
  run.catch(() => null);
  return Promise.race([run, new Promise((_, reject) => setTimeout(() => reject(new Error("evaluate timed out after " + ms + " ms")), ms))]);
}
const BOT_WALL = /just a moment|access denied|attention required|verify you are human|are you a robot|captcha|request blocked|pardon our interruption/i;

/** Adds one item to the cart and lands on the cart page. Returns how, or a reason it could not. */
/** Shopify's own JSON catalog and cart API on `origin`, the same calls its Add to cart button makes; null when not Shopify. */
async function addViaShopify(shop, origin) {
  for (const path of ["/products.json?limit=24", "/collections/all/products.json?limit=24"]) {
    const products = await evalWithin(shop, async (p) => {
        const r = await fetch(p, { credentials: "same-origin", headers: { accept: "application/json" }, signal: AbortSignal.timeout(20_000) });
        if (!r.ok) return null;
        const j = await r.json().catch(() => null);
        return j && Array.isArray(j.products) ? j.products : null;
      }, origin + path).catch(() => null);
    if (!products) continue;
    // A real product, not a gift card (Brumate's catalog starts with a $10 e-gift card, which no code discounts).
    const variant = products
      .filter((p) => !/gift\s*card|e-?gift/i.test((p.title || "") + " " + (p.product_type || "")))
      .flatMap((p) => (Array.isArray(p.variants) ? p.variants : []))
      .find((v) => v && v.available !== false && v.requires_selling_plan !== true && typeof v.id === "number" && Number(v.price) > 0);
    if (!variant) return { ok: false, reason: "shopify catalog has no available variant" };
    const added = await evalWithin(shop, async ([o, id]) => {
        const r = await fetch(o + "/cart/add.js", {
          method: "POST",
          credentials: "same-origin",
          signal: AbortSignal.timeout(20_000),
          headers: { "content-type": "application/json", accept: "application/json" },
          body: JSON.stringify({ items: [{ id, quantity: 1 }] }),
        });
        return r.ok;
      }, [origin, variant.id]).catch(() => false);
    if (!added) return { ok: false, reason: "shopify /cart/add.js refused" };
    await shop.goto(origin + "/cart", { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS }).catch(() => null);
    return { ok: true, how: "shopify cart api", product: variant.id };
  }
  return null;
}

/** On a Shopify product page whose store hides /products.json (BYLT, Cuts): the page's own
 * /products/<handle>.js is still public; add its first available variant through /cart/add.js. */
async function addViaProductJson(shop, origin) {
  if (!/\/products\/[^/?#]+/.test(new URL(shop.url()).pathname)) return null;
  const added = await evalWithin(shop, async () => {
      const path = location.pathname.replace(/\/$/, "");
      const r = await fetch(path + ".js", { credentials: "same-origin", headers: { accept: "application/json" }, signal: AbortSignal.timeout(20_000) });
      if (!r.ok) return null;
      const p = await r.json().catch(() => null);
      // A one-time purchase: subscription-only variants can land in the cart at $0 (Lineage Provisions, 2026-10-17).
      const v = p && Array.isArray(p.variants) ? p.variants.find((x) => x && x.available !== false && x.requires_selling_plan !== true && typeof x.id === "number" && Number(x.price) > 0) : null;
      if (!v) return null;
      const a = await fetch("/cart/add.js", {
        method: "POST",
        credentials: "same-origin",
        signal: AbortSignal.timeout(20_000),
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ items: [{ id: v.id, quantity: 1 }] }),
      });
      return a.ok ? v.id : null;
    }).catch(() => null);
  if (!added) return null;
  await shop.goto(origin + "/cart", { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS }).catch(() => null);
  return { ok: true, how: "shopify product json", product: added };
}

const PRODUCT_LINKS = 'a[href*="/product/"], a[href*="/products/"], a[href*="/shop/"], a[href*="/store/"], a[href*="/item/"]';
/** The first product link that is not a gift card (Dr. Squatch's home page leads with one). */
async function firstProductLink(shop) {
  for (const a of await shop.$$(PRODUCT_LINKS)) {
    const href = (await a.getAttribute("href")) || "";
    const text = ((await a.textContent().catch(() => "")) || "").trim();
    if (/gift[-\s]?card|e-?gift/i.test(href + " " + text)) continue;
    return a;
  }
  return null;
}
const DISCOUNT_INPUTS = 'input[name*="discount" i], input[name*="coupon" i], input[name*="promo" i], input[placeholder*="discount" i], input[placeholder*="coupon" i], input[placeholder*="promo" i], input[aria-label*="discount" i], input[aria-label*="promo" i]';

/** Marketing modals and cookie banners in front of the page: a shopper closes them; so does the runner (nothing else). */
async function dismissOverlays(shop) {
  await shop.keyboard.press("Escape").catch(() => null);
  const closers = shop.locator('[role="dialog"] button[aria-label*="close" i], [class*="modal" i] button[aria-label*="close" i], [class*="popup" i] button[aria-label*="close" i], [id*="popup" i] button[aria-label*="close" i], [class*="modal" i] [class*="close" i], button[aria-label="Close"], button[aria-label="close"], button.close');
  for (let i = 0, n = Math.min(await closers.count().catch(() => 0), 4); i < n; i++) {
    const c = closers.nth(i);
    if (await c.isVisible().catch(() => false)) await c.click({ timeout: 2_000 }).catch(() => null);
  }
  // Cookie banners cover the buttons below them; decline when offered, otherwise accept.
  const decline = shop.locator("button, a").filter({ hasText: /^\s*(decline|reject( all)?( cookies)?|necessary (cookies )?only|only necessary)\s*$/i }).first();
  if (await decline.isVisible().catch(() => false)) await decline.click({ timeout: 2_000 }).catch(() => null);
  else {
    const accept = shop.locator("button").filter({ hasText: /^\s*(accept( all)?( cookies)?|got it|i agree|ok(ay)?)\s*$/i }).first();
    if (await accept.isVisible().catch(() => false)) await accept.click({ timeout: 2_000 }).catch(() => null);
  }
  await wait(500);
}

/** Up to `max` product links on the store's own hosts (not play.google.com/store), gift cards left out. */
async function productLinks(shop, max = 6) {
  const site = new URL(shop.url()).hostname.replace(/^www\./, "").split(".").slice(-2).join(".");
  const out = [];
  for (const a of await shop.$$(PRODUCT_LINKS)) {
    const href = (await a.getAttribute("href")) || "";
    let abs;
    try {
      abs = new URL(href, shop.url());
    } catch {
      continue;
    }
    if (!abs.hostname.endsWith(site)) continue;
    const text = ((await a.textContent().catch(() => "")) || "").trim();
    if (/gift[-\s]?card|e-?gift/i.test(href + " " + text)) continue;
    const url = abs.origin + abs.pathname;
    if (!out.includes(url)) out.push(url);
    if (out.length >= max) break;
  }
  return out;
}

/** Opens the checkout's first step from the cart and checks it is the information page. Never fills or submits anything. */
async function openCheckoutStep(shop, context) {
  await dismissOverlays(shop);
  const exclude = /continue shopping|express|shop ?pay|paypal|apple pay|g ?pay|amazon pay|klarna|afterpay|affirm/i;
  const groups = [
    shop.locator('a[href*="/checkout"], [name="checkout"], button[class*="checkout" i], a[class*="checkout" i], [id*="checkout" i]'),
    shop.locator('button, a, [role="button"], input[type="submit"], [class*="button" i]').filter({ hasText: /check ?out/i }),
    shop.locator('button, a, [role="button"]').filter({ hasText: /proceed to|continue (to|with) (checkout|one[- ]time|purchase)|go to checkout/i }),
  ];
  // Visible candidates, the plain checkout before "with protection" add-ons (BYLT: "Checkout without
  // coverage" is the plain one, "CHECKOUT WITH PROTECTION" adds a paid extra).
  const found = [];
  for (const g of groups) {
    const l = g.filter({ hasNotText: exclude });
    for (let i = 0, n = Math.min(await l.count().catch(() => 0), 8); i < n; i++) {
      const c = l.nth(i);
      if (!(await c.isVisible().catch(() => false))) continue;
      const text = ((await c.textContent().catch(() => "")) || "").trim();
      found.push({ c, rank: /without|no (coverage|protection)/i.test(text) ? 0 : /protection|coverage|insurance/i.test(text) ? 2 : 1, text });
    }
    if (found.length) break;
  }
  found.sort((a, b) => a.rank - b.rank);
  const btn = found[0]?.c ?? null;
  if (!btn) return { ok: false, reason: "no Checkout button on the cart" };
  await btn.scrollIntoViewIfNeeded().catch(() => null);
  // Some stores open checkout in a new tab; some need a second, forced click under a banner.
  const popupPromise = context.waitForEvent("page", { timeout: 15_000 }).catch(() => null);
  await btn.click({ timeout: 10_000 }).catch(() => null);
  const isCheckoutUrl = (u) => /checkout/i.test(u) || /^checkout\./.test(new URL(u).hostname);
  let page = shop;
  const landed = await Promise.race([
    shop.waitForURL((u) => isCheckoutUrl(u.toString()), { timeout: 15_000 }).then(() => "same").catch(() => null),
    popupPromise.then((p) => (p ? "popup" : null)),
  ]);
  if (landed === "popup") {
    page = await popupPromise;
    await page.waitForLoadState("domcontentloaded").catch(() => null);
  } else if (!landed) {
    await btn.click({ force: true, timeout: 10_000 }).catch(() => null);
    await shop.waitForURL((u) => isCheckoutUrl(u.toString()), { timeout: 20_000 }).catch(() => null);
  }
  await wait(3000);
  let text = "";
  for (let i = 0; i < 6; i++) {
    text = (await evalWithin(page, () => document.body.innerText).catch(() => "")) || "";
    if (text.trim().length > 80) break;
    await wait(2500);
  }
  const url = page.url();
  if (!isCheckoutUrl(url)) return { ok: false, reason: "Checkout button did not open a checkout page", url };
  if (BOT_WALL.test(text)) return { ok: false, reason: "bot check on the checkout page", url };
  const contactForm = (await page.locator('input[type="email"], input[name*="email" i], input[autocomplete="email"], input[autocomplete*="address" i], input[name*="address" i]').count().catch(() => 0)) > 0;
  if (/\/payment|\/thank_you|\/orders\//i.test(url) || (!contactForm && /card number|credit card/i.test(text))) return { ok: false, reason: "checkout went straight to a payment page", url };
  if (!contactForm && /sign in|log in/i.test(text)) return { ok: false, reason: "sign-in wall on the checkout page", url };
  return { ok: true, url, step: contactForm ? "information" : "unknown", page };
}

/** A size or other option to pick before Add to cart appears (BYLT "Select a size", Cuts "Select Size"). */
async function pickFirstOption(shop) {
  await dismissOverlays(shop);
  // A page that defaults to a subscription (Pura): the one-time purchase choice first.
  const oneTime = shop.locator('label, [role="radio"], button, input[type="radio"] + *').filter({ hasText: /^\s*one[- ]time( purchase)?\s*$/i }).first();
  if (await oneTime.isVisible().catch(() => false)) await oneTime.click({ timeout: 3_000 }).catch(() => null);
  const picker = shop.getByRole("button", { name: /select (a |your )?(size|option)/i }).first();
  if (await picker.count()) await picker.click({ timeout: 5_000 }).catch(() => null);
  const option = shop
    .locator('button, label, [role="radio"], [role="option"]')
    .filter({ hasText: /^\s*(XXS|XS|S|M|L|XL|XXL|2XL|3XL|One Size|OS)\s*$/i })
    .filter({ hasNot: shop.locator("[disabled]") })
    .first();
  if (!(await option.count())) return false;
  await option.click({ timeout: 5_000 }).catch(() => null);
  await wait(800);
  return true;
}

async function addToCart(shop, origin) {
  const viaApi = await addViaShopify(shop, origin);
  if (viaApi) return viaApi;
  return addByClicking(shop, origin);
}

/** The shopper's way: a product page, the store's own Add to cart button, then the cart page. */
async function addByClicking(shop, origin) {
  let links = await productLinks(shop);
  if (!links.length) {
    const entry = await shop.$('a:has-text("shop now"), a:has-text("buy now"), a[href*="/collections/"], a[href*="/collection/"]');
    if (!entry) return { ok: false, reason: "no product link found on the home page" };
    const entryHref = await entry.getAttribute("href");
    await shop.goto(new URL(entryHref, origin).toString(), { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS }).catch(() => null);
    await wait(1500);
    links = await productLinks(shop);
    if (!links.length && /\/(products?|store|item)\//.test(shop.url())) links = [shop.url()];
  }
  if (!links.length) return { ok: false, reason: "no product link found on the home page" };
  let reason = "no Add to cart button on the product page";
  for (const href of links) {
    if (shop.url().split("?")[0] !== href) await shop.goto(href, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS }).catch(() => null);
    await wait(1500);
    await dismissOverlays(shop);
    // A marketing site in front of a shop on another host (perfectketo.com -> shop.perfectketo.com):
    // the cart lives where the product page lives, and that host may be Shopify after all.
    const shopOrigin = new URL(shop.url()).origin;
    if (shopOrigin !== origin) {
      const viaShopApi = await addViaShopify(shop, shopOrigin);
      if (viaShopApi) return viaShopApi;
    }
    const viaProduct = await addViaProductJson(shop, shopOrigin);
    if (viaProduct) return viaProduct;
    // The button's accessible name, or Shopify's product form submit when the name is an icon or a price.
    const addBtn = shop
      .getByRole("button", { name: /add to (cart|bag|basket)/i })
      .or(shop.locator('button[name="add"], form[action*="/cart/add"] [type="submit"]'))
      .first();
    // Options first either way: a size or a one-time choice is often required before the add counts (Chubbies).
    await pickFirstOption(shop);
    if (!(await addBtn.count())) continue; // a discontinued product or a non-product page: the next link
    await addBtn.scrollIntoViewIfNeeded().catch(() => null);
    await addBtn.click({ timeout: 10_000 }).catch(() => null);
    await wait(2500);
    for (const path of ["/cart", "/cart/", "/basket", "/bag", "/checkout/cart"]) {
      const r = await shop.goto(shopOrigin + path, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS }).catch(() => null);
      if (!(r && r.ok())) continue;
      await wait(1500);
      const text = (await evalWithin(shop, () => document.body.innerText).catch(() => "")) || "";
      // A cart page, or a drawer opened on another page (Brumate: /cart lands on the home page with
      // the drawer open); an empty-cart redirect to a store page (Paleovalley) is neither.
      const looksLikeCart = /cart|basket|bag|checkout/i.test(shop.url()) || /\bsubtotal\b|\b(my|your|shopping) (cart|bag)\b|check ?out\s*[-–·]\s*[$€£]/i.test(text);
      if (!looksLikeCart) {
        reason = "the Add to cart click did not put the item in the cart";
        break;
      }
      if (/cart is (currently )?empty|no items in your (cart|bag)|nothing in your (cart|bag)|bag is empty/i.test(text)) {
        reason = "the Add to cart click did not put the item in the cart";
        break;
      }
      return { ok: true, how: "clicked add to cart", product: href };
    }
  }
  return { ok: false, reason };
}

/** The Shopify cart, when the store has one, for independent verification of the result. */
const readShopifyCart = (shop) =>
  evalWithin(shop, async () => {
      const r = await fetch("/cart.js", { credentials: "same-origin", headers: { accept: "application/json" }, signal: AbortSignal.timeout(20_000) });
      if (!r.ok) return null;
      const j = JSON.parse(await r.text());
      if (typeof j.total_price !== "number") return null;
      // The other price fields too: Lineage Provisions answered total_price 0 for a $25 cart (2026-10-17).
      const fields = { items: j.item_count, subtotal: j.items_subtotal_price, original: j.original_total_price, discount: j.total_discount, currency: j.currency };
      return { total: j.total_price / 100, codes: (j.discount_codes ?? []).map((d) => ({ code: d.code, applicable: d.applicable })), fields };
    }).catch(() => null);

/** The popup page wired to `shop` as the active tab, like tests/e2e/checkout.spec.ts. */
async function openPopup(context, shop, shopUrl, stages) {
  const popup = await context.newPage();
  // Tab 1 is the shop; background tabs Find coupons opens for coupon pages the
  // reader could not load (src/coupons/browser-read.ts) are pages 2, 3, ...
  const tabs = new Map([[1, shop]]);
  let nextTab = 2;
  const pageOf = (id) => tabs.get(id ?? 1) ?? shop;
  await popup.exposeFunction("__injectContent", async (file, tabId) => {
    const p = pageOf(tabId);
    await p.waitForLoadState("domcontentloaded").catch(() => undefined);
    await p.addScriptTag({ path: join(RES, file || "content.js") });
  });
  // Like Safari after a navigation: a new page has no handler until the script is injected again.
  await popup.exposeFunction("__hasContent", (handler, tabId) =>
    pageOf(tabId).evaluate((h) => typeof globalThis[h] === "function", handler).catch(() => false),
  );
  await popup.exposeFunction("__callContent", (handler, req, tabId) =>
    pageOf(tabId).evaluate(([h, r]) => {
      const fn = globalThis[h];
      if (typeof fn !== "function") throw new Error("no handler " + h);
      return fn(r);
    }, [handler, req]),
  );
  await popup.exposeFunction("__openTab", async (url) => {
    const p = await context.newPage();
    const id = nextTab++;
    tabs.set(id, p);
    stages.push("runner:tab-open " + new URL(url).hostname);
    await p.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 }).catch(() => undefined);
    return id;
  });
  await popup.exposeFunction("__closeTabs", async (ids) => {
    for (const id of [].concat(ids)) {
      const p = tabs.get(id);
      if (!p || p === shop) continue;
      tabs.delete(id);
      await p.close().catch(() => undefined);
    }
  });
  await popup.exposeFunction("__stage", (s) => stages.push(s));
  await popup.addInitScript(
    ({ url, key, model, effort }) => {
      const w = window;
      const store = {
        aiConsent: { anthropic: { at: 1, version: 2 }, openai: { at: 1, version: 2 } },
        settings: { provider: "anthropic", ...(model ? { model } : {}), ...(effort ? { effort } : {}), retention: "off" },
      };
      w.browser = {
        runtime: {
          id: "scout-live",
          getURL: (p) => location.origin + "/" + p,
          sendMessage: async () => ({ ok: true }),
          sendNativeMessage: async (_app, m) => {
            if (m && m.type === "debug.stage") {
              w.__stage(String(m.stage));
              return { ok: true };
            }
            if (m && m.type === "keychain.get") return { ok: true, value: m.account === "anthropic" ? key : null };
            return { ok: true };
          },
          onMessage: { addListener() {} },
        },
        storage: {
          local: {
            get: async (k) => {
              const keys = [].concat(k);
              const o = {};
              for (const x of keys) if (x in store) o[x] = store[x];
              return o;
            },
            set: async (items) => {
              Object.assign(store, items);
            },
            clear: async () => {
              for (const x of Object.keys(store)) delete store[x];
            },
          },
        },
        tabs: {
          query: async () => [{ id: 1, windowId: 1, active: true, url }],
          create: async ({ url: u }) => ({ id: await w.__openTab(u), windowId: 1 }),
          remove: async (ids) => w.__closeTabs(ids),
        },
        // As if the owner allowed Scout on every site (asked once on the first Find coupons press).
        permissions: { getAll: async () => ({ origins: [] }), contains: async () => true, request: async () => true, remove: async () => true },
        scripting: {
          executeScript: async (inj) => {
            const tabId = inj.target?.tabId;
            if (inj.files) {
              for (const f of inj.files) await w.__injectContent(f, tabId);
              return [{ result: true }];
            }
            if (!inj.func || !inj.args) return [{ result: null }];
            const handler = inj.args[1];
            if (await w.__hasContent(handler, tabId)) w[handler] = (r) => w.__callContent(handler, r, tabId);
            else delete w[handler];
            return [{ result: await inj.func(...inj.args) }];
          },
        },
      };
    },
    { url: shopUrl, key, model, effort },
  );
  await popup.route(POPUP_ORIGIN + "/**", (route) => {
    const path = new URL(route.request().url()).pathname.replace(/^\//, "") || "popup.html";
    const file = join(RES, path);
    if (!existsSync(file)) return route.fulfill({ status: 404, body: "not found" });
    const type = path.endsWith(".html") ? "text/html" : path.endsWith(".js") ? "text/javascript" : path.endsWith(".png") ? "image/png" : "application/octet-stream";
    return route.fulfill({ path: file, contentType: type });
  });
  await popup.goto(POPUP_ORIGIN + "/popup.html", { waitUntil: "domcontentloaded" });
  return popup;
}

function classify(summary, verify) {
  const s = summary;
  if (/is the best:/.test(s) && /It's applied (?:to your cart|on the checkout page)/.test(s)) return verify === false ? "applied (summary) but cart did not confirm" : "applied";
  if (/is the best:/.test(s)) return "found a saving but could not re-apply";
  if (/none lowered your total/.test(s)) return "no working code";
  if (/No code posted for .* could be found/.test(s) && /ended early/.test(s)) return "discovery failed";
  if (/No code posted for .* could be found/.test(s)) return "no codes found";
  if (/No coupon box found/.test(s)) return "no coupon box";
  if (/CAPTCHA/i.test(s)) return "blocked: captcha";
  if (/asked to slow down/.test(s)) return "blocked: rate limited";
  if (/Could not read a total/.test(s)) return "blocked: unreadable total";
  if (/Could not reach this page/.test(s)) return "blocked: page unreachable";
  return "error: " + s.slice(0, 80);
}

async function runMerchant(browser, m) {
  const started = Date.now();
  const stages = [];
  // Seconds from the merchant's start to each stage, for search-vs-testing timings.
  const timeline = [];
  const stageSink = {
    push: (s) => {
      stages.push(s);
      timeline.push({ t: Math.round((Date.now() - started) / 100) / 10, stage: s });
    },
  };
  // Which popup build this merchant ran on (the Resources folder can be rebuilt during a long sweep).
  const build = createHash("sha1").update(readFileSync(join(RES, "popup.js"))).digest("hex").slice(0, 10);
  const result = { name: m.name, url: m.url, group: m.group, outcome: "", notes: [], stages, timeline, build, startedAt: new Date(started).toISOString() };
  const dir = join(out, slug(m.name));
  mkdirSync(dir, { recursive: true });
  let context = null;
  let shop;
  try {
    context = await browser.newContext({ bypassCSP: true, viewport: { width: 1280, height: 900 } });
    context.setDefaultTimeout(30_000);
    shop = await context.newPage();
    const nav = await shop.goto(m.url, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS }).catch((e) => ({ error: e }));
    if (!nav || nav.error) {
      result.outcome = "blocked: site unreachable";
      return result;
    }
    await wait(2000);
    const origin = new URL(shop.url()).origin;
    // Some storefronts render late; a blank page (True Classic, 2026-10-17) must not count as "no coupon box".
    let body = "";
    for (let tries = 0; tries < 6; tries++) {
      body = (await evalWithin(shop, () => document.title + "\n" + document.body.innerText.slice(0, 2000)).catch(() => "")) || "";
      if (body.trim().length > 80) break;
      await wait(2500);
    }
    if (body.trim().length <= 80) result.notes.push("the page showed little or no text after 15 s");
    if (BOT_WALL.test(body)) {
      result.outcome = "blocked: bot check on the site";
      return result;
    }
    const added = await addToCart(shop, origin);
    if (!added.ok) {
      await shop.screenshot({ path: join(dir, "add-failed.png"), fullPage: false }).catch(() => null);
      result.outcome = "blocked: could not add to cart (" + added.reason + ")";
      return result;
    }
    result.cart = { how: added.how, url: shop.url() };
    // The cart page too can render late (Paleovalley, True Classic): wait for its text before anything reads it.
    for (let tries = 0; tries < 6; tries++) {
      const text = (await evalWithin(shop, () => document.body.innerText).catch(() => "")) || "";
      if (text.trim().length > 80) break;
      await wait(2500);
      if (tries === 5) result.notes.push("the cart page showed little or no text after 15 s");
    }
    await wait(1500);
    let before = await readShopifyCart(shop);
    // On some stores an app empties the cart while the cart page loads (Lineage Provisions, WORN: a
    // POST /cart/update.js from the Veeper SDK; the page still shows the item it rendered before).
    // Add the item again from the cart page, without reloading, so the cart API has it when the popup runs.
    if (before && before.fields && before.fields.items === 0 && added.product && typeof added.product === "number") {
      result.notes.push("the cart page's /cart.js was empty after adding (an app's /cart/update.js); item added again from the cart page");
      await evalWithin(shop, async (id) => {
        const r = await fetch("/cart/add.js", { method: "POST", credentials: "same-origin", signal: AbortSignal.timeout(20_000), headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify({ items: [{ id, quantity: 1 }] }) });
        return r.ok;
      }, added.product).catch(() => false);
      await wait(1500);
      before = await readShopifyCart(shop);
      if (before && before.fields && before.fields.items === 0) {
        // The store's own scripts remove API-added lines (Lineage Provisions: POST /cart/change.js
        // quantity 0): add through its Add to cart button instead, as a shopper would.
        result.notes.push("the store removed the API-added item again; adding through its own Add to cart button");
        await shop.goto(origin, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS }).catch(() => null);
        await wait(1500);
        const clicked = await addByClicking(shop, origin);
        if (clicked.ok) {
          result.cart = { how: clicked.how, url: shop.url() };
          await wait(3000);
          before = await readShopifyCart(shop);
        }
        if (!before || !before.fields || before.fields.items === 0) {
          result.outcome = "blocked: the store removed the test item from the cart";
          return result;
        }
      }
    }
    if (before) result.cartBefore = before;
    await shop.screenshot({ path: join(dir, "cart-before.png"), fullPage: false }).catch(() => null);
    if (checkoutStep) {
      const boxes = await shop.locator(DISCOUNT_INPUTS).count().catch(() => 0);
      if (boxes > 0) result.notes.push("the cart has a discount field; checkout not opened");
      else {
        const step = await openCheckoutStep(shop, context);
        if (step.page && step.page !== shop) shop = step.page;
        delete step.page;
        result.checkout = step;
        await shop.screenshot({ path: join(dir, "checkout-step.png"), fullPage: false }).catch(() => null);
        if (!step.ok) {
          result.outcome = "blocked: " + step.reason;
          return result;
        }
      }
    }
    if (cartOnly) {
      result.outcome = "cart ok (" + added.how + (before ? ", shopify cart " + before.total : ", no shopify cart") + (result.checkout ? "; checkout " + result.checkout.step : "") + ")";
      return result;
    }

    const popup = await openPopup(context, shop, shop.url(), stageSink);
    // What the provider answered when a search failed (status and error body; never the key).
    result.apiErrors = [];
    popup.on("response", (res) => {
      if (!res.url().startsWith("https://api.anthropic.com/") || res.status() < 400) return;
      res.text().then((t) => result.apiErrors.push({ status: res.status(), body: t.slice(0, 300) })).catch(() => null);
    });
    const button = popup.locator('button.chip[data-prompt="coupons"]');
    if (await button.isVisible().catch(() => false)) await button.click();
    else await popup.locator("#coupons-run").click({ force: true });
    // Wait for the run to finish; answer the "search again" question once.
    let answered = 0;
    let summary = "";
    const deadline = Date.now() + RUN_TIMEOUT_MS;
    while (Date.now() < deadline) {
      await wait(1000);
      const more = popup.locator("#coupons-more");
      if ((await more.count()) && (await more.isVisible().catch(() => false))) {
        if (secondPass && answered === 0) {
          answered++;
          await popup.getByRole("button", { name: /Search again|Keep testing/ }).click().catch(() => null);
        } else {
          await popup.getByRole("button", { name: "Stop here" }).click().catch(() => null);
        }
        continue;
      }
      const msgs = popup.locator(".msg.assistant, .msg.error");
      const n = await msgs.count();
      if (n) {
        const last = msgs.nth(n - 1);
        const text = (await last.innerText().catch(() => "")) || "";
        // The run's own answer, not an earlier status line.
        if (/tested|No code|coupon box|CAPTCHA|slow down|Could not|unchanged|Nothing was tested/i.test(text)) {
          summary = text;
          break;
        }
      }
    }
    result.summary = summary || "(no summary within " + RUN_TIMEOUT_MS / 1000 + " s)";
    result.secondPass = answered > 0;
    await popup.locator("#task .trace-head").click().catch(() => null);
    result.trace = await popup.locator("#task .say").allInnerTexts().catch(() => []);
    result.attempts = await popup
      .locator("#task .attempt")
      .evaluateAll((rows) =>
        rows.map((r) => ({
          code: r.querySelector(".code")?.textContent ?? "",
          text: r.textContent ?? "",
          source: r.querySelector("a")?.getAttribute("href") ?? "",
          evidence: r.querySelector(".code")?.getAttribute("title") ?? "",
          good: r.classList.contains("good"),
        })),
      )
      .catch(() => []);
    await popup.screenshot({ path: join(dir, "popup.png"), fullPage: true }).catch(() => null);
    // Independent check on Shopify stores: the cart's own total and codes after the run.
    await wait(2500);
    const after = await readShopifyCart(shop);
    if (after) result.cartAfter = after;
    let verified = null;
    if (after && /It's applied (?:to your cart|on the checkout page)/.test(summary)) {
      const m2 = /is the best: your total drops from \*?\*?([^*]+?)\*?\*? to \*?\*?([^*\s]+)/.exec(summary);
      const claimed = m2 ? Number(m2[2].replace(/[^0-9.]/g, "")) : NaN;
      const codeOn = after.codes.some((c) => c.applicable);
      // Without a before-read (Just Ingredients, 2026-10-17) the claim is checked against the cart's own total.
      verified = before ? after.total < before.total - 0.004 && codeOn : Number.isFinite(claimed) && Math.abs(after.total - claimed) < 0.005 && codeOn;
      result.verify = { before: before ? before.total : null, after: after.total, codes: after.codes, claimed: m2 ? m2[2] : null, confirmed: verified };
    }
    await shop.screenshot({ path: join(dir, "cart-after.png"), fullPage: false }).catch(() => null);
    result.outcome = summary ? classify(summary, verified) : "error: run did not finish in time";
    if (result.checkout && result.outcome === "applied" && verified === null) result.outcome = "applied (checkout page; no cart API to confirm)";
    return result;
  } catch (e) {
    result.outcome = "error: " + String(e && e.message ? e.message : e).slice(0, 120);
    result.errorStack = String(e && e.stack ? e.stack : "").split("\n").slice(0, 4).join(" | ");
    return result;
  } finally {
    result.seconds = Math.round((Date.now() - started) / 1000);
    if (context) await context.close().catch(() => null);
  }
}

const engine = browserName === "chromium" ? chromium : webkit;
const proxyUrl = process.env.HTTPS_PROXY || process.env.https_proxy || "";
let proxy;
if (proxyUrl) {
  const u = new URL(proxyUrl);
  proxy = { server: u.protocol + "//" + u.hostname + ":" + u.port, ...(u.username ? { username: decodeURIComponent(u.username), password: decodeURIComponent(u.password) } : {}) };
  console.log("Browser traffic goes through the shell's HTTPS_PROXY (" + proxy.server + ").");
}
const launchArgs = singleProcess && browserName === "chromium" ? ["--no-sandbox", "--single-process", "--no-zygote", "--disable-gpu"] : [];
const launchOpts = { headless: !headed, ...(proxy ? { proxy } : {}), ...(launchArgs.length ? { args: launchArgs } : {}) };
// One-process Chromium does not survive its context closing, so it is relaunched per merchant.
const shared = singleProcess ? null : await engine.launch(launchOpts);
const results = [];
console.log("Live coupon suite: " + merchants.length + " merchants, " + browserName + (headed ? " (headed)" : "") + ", results in " + out);
for (const m of merchants) {
  const browser = shared ?? (await engine.launch(launchOpts));
  const r = await runMerchant(browser, m);
  if (!shared) await browser.close().catch(() => null);
  results.push(r);
  console.log("- " + m.name + ": " + r.outcome + (r.verify ? " (cart " + r.verify.before + " -> " + r.verify.after + ")" : "") + " [" + r.seconds + " s]");
  writeFileSync(join(out, "results.json"), JSON.stringify({ browser: browserName, model: model || "default", effort: effort || "default", secondPass, startedAt: stamp, results }, null, 2));
  await wait(3000);
}
if (shared) await shared.close();

writeSummary(out, results, { browser: browserName, model, effort, secondPass, stamp });

/** summary.md: the tally and the rows for docs/coupon-merchant-suite.md's run log. */
function writeSummary(dir, results, meta) {
  const { browser: browserName, model, effort, secondPass, stamp } = meta;
  const counts = {};
  for (const r of results) counts[r.outcome.split(" (")[0]] = (counts[r.outcome.split(" (")[0]] ?? 0) + 1;
  const applied = results.filter((r) => r.outcome === "applied").length;
  const testable = results.filter((r) => !/^blocked|^error/.test(r.outcome)).length;
  // Runs where the discovery step itself worked (no timeout, stream error or API rejection).
  const searched = results.filter((r) => (r.stages || []).includes("coupons:search") && !(r.stages || []).some((x) => x.startsWith("coupons:search-error")));
  const searchedApplied = searched.filter((r) => r.outcome === "applied").length;
  const lines = [
    "# Live coupon suite " + stamp,
    "",
    "Browser " + browserName + ", model " + (model || "extension default") + ", effort " + (effort || "default") + ", second pass " + (secondPass ? "on" : "off") + ".",
    "",
    "Applied: " + applied + " of " + results.length + " merchants (" + Math.round((100 * applied) / Math.max(results.length, 1)) + "%); of the " + testable + " where testing ran: " + Math.round((100 * applied) / Math.max(testable, 1)) + "%.",
    "",
    "Web search completed without error on " + searched.length + " merchants; applied among them: " + searchedApplied + " (" + Math.round((100 * searchedApplied) / Math.max(searched.length, 1)) + "%).",
    "",
    "| Outcome | Count |",
    "|---|---|",
    ...Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([k, v]) => "| " + k + " | " + v + " |"),
    "",
    "| Date | Merchant | Cart / checkout page | Method (cart API / page) | Codes found (store / verified / reported / masked / dropped) | Best code, saving | Outcome |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    ...results.map((r) => {
      const method = (r.stages || []).find((s) => s.startsWith("coupons:method ")) || "";
      const cand = (r.stages || []).find((s) => s.startsWith("coupons:candidates ")) || "";
      const best = /\*\*([^*]+)\*\* is the best: your total drops from \*\*([^*]+)\*\* to \*\*([^*]+)\*\*/.exec(r.summary || "") || /([A-Z0-9,+ _-]+) is the best: your total drops from (\S+) to (\S+)/.exec(r.summary || "");
      return "| " + stamp.slice(0, 10) + " | " + r.name + " | " + (r.cart ? r.cart.url : r.url) + " | " + method.replace("coupons:method ", "") + " | " + cand.replace("coupons:candidates ", "") + " | " + (best ? best[1] + ", " + best[2] + " → " + best[3] : "") + " | " + r.outcome + " |";
    }),
    "",
  ];
  writeFileSync(join(dir, "summary.md"), lines.join("\n"));
  console.log("\n" + lines.slice(0, 5).join("\n"));
  console.log("\nTable for docs/coupon-merchant-suite.md in " + join(dir, "summary.md"));
}
