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
//     --browser webkit|chromium   (default webkit, like Safari)
//     --headed                    show the browser
//     --only "Chomps,Rumpl"       run some merchants only (name substrings)
//     --limit N                   first N merchants
//     --model claude-sonnet-5-5   model for the search (default: the extension's default)
//     --effort medium             effort setting (default: the extension's default)
//     --no-second-pass            answer "Stop here" instead of "Search again"
//     --out ralph/evidence/live-suite/<stamp>
//     --summarize <dir>           rewrite <dir>/summary.md from its results.json (a partial run) and exit
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
const browserName = flag("browser", "webkit");
const headed = has("headed");
const only = (flag("only", "") || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
const limit = Number(flag("limit", "0")) || 0;
const model = flag("model", "");
const effort = flag("effort", "");
const secondPass = !has("no-second-pass");
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
if (!key) {
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
async function addToCart(shop, origin) {
  // Shopify: the store's own JSON catalog and cart API, the same calls its Add to cart button makes.
  for (const path of ["/products.json?limit=24", "/collections/all/products.json?limit=24"]) {
    const products = await evalWithin(shop, async (p) => {
        const r = await fetch(p, { credentials: "same-origin", headers: { accept: "application/json" }, signal: AbortSignal.timeout(20_000) });
        if (!r.ok) return null;
        const j = await r.json().catch(() => null);
        return j && Array.isArray(j.products) ? j.products : null;
      }, path).catch(() => null);
    if (!products) continue;
    const variant = products.flatMap((p) => (Array.isArray(p.variants) ? p.variants : [])).find((v) => v && v.available !== false && typeof v.id === "number" && Number(v.price) > 0);
    if (!variant) return { ok: false, reason: "shopify catalog has no available variant" };
    const added = await evalWithin(shop, async (id) => {
        const r = await fetch("/cart/add.js", {
          method: "POST",
          credentials: "same-origin",
          signal: AbortSignal.timeout(20_000),
          headers: { "content-type": "application/json", accept: "application/json" },
          body: JSON.stringify({ items: [{ id, quantity: 1 }] }),
        });
        return r.ok;
      }, variant.id).catch(() => false);
    if (!added) return { ok: false, reason: "shopify /cart/add.js refused" };
    await shop.goto(origin + "/cart", { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS }).catch(() => null);
    return { ok: true, how: "shopify cart api", product: variant.id };
  }
  // Other stores: open the first product link, press Add to cart, open the cart.
  const productLink = await shop.$('a[href*="/product/"], a[href*="/products/"], a[href*="/shop/"], a[href*="/item/"]');
  if (!productLink) return { ok: false, reason: "no product link found on the home page" };
  const href = await productLink.getAttribute("href");
  await shop.goto(new URL(href, origin).toString(), { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS }).catch(() => null);
  await wait(1500);
  // The button's accessible name, or Shopify's product form submit when the name is an icon or a price.
  const addBtn = shop
    .getByRole("button", { name: /add to (cart|bag|basket)/i })
    .or(shop.locator('button[name="add"], form[action*="/cart/add"] [type="submit"]'))
    .first();
  if (!(await addBtn.count())) return { ok: false, reason: "no Add to cart button on the product page" };
  await addBtn.scrollIntoViewIfNeeded().catch(() => null);
  await addBtn.click({ timeout: 10_000 }).catch(() => null);
  await wait(2500);
  for (const path of ["/cart", "/cart/", "/basket", "/bag", "/checkout/cart"]) {
    const r = await shop.goto(origin + path, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS }).catch(() => null);
    if (r && r.ok()) return { ok: true, how: "clicked add to cart", product: href };
  }
  return { ok: false, reason: "cart page not found after adding" };
}

/** The Shopify cart, when the store has one, for independent verification of the result. */
const readShopifyCart = (shop) =>
  evalWithin(shop, async () => {
      const r = await fetch("/cart.js", { credentials: "same-origin", headers: { accept: "application/json" }, signal: AbortSignal.timeout(20_000) });
      if (!r.ok) return null;
      const j = JSON.parse(await r.text());
      return typeof j.total_price === "number" ? { total: j.total_price / 100, codes: (j.discount_codes ?? []).map((d) => ({ code: d.code, applicable: d.applicable })) } : null;
    }).catch(() => null);

/** The popup page wired to `shop` as the active tab, like tests/e2e/checkout.spec.ts. */
async function openPopup(context, shop, shopUrl, stages) {
  const popup = await context.newPage();
  await popup.exposeFunction("__injectContent", async (file) => {
    await shop.addScriptTag({ path: join(RES, file || "content.js") });
  });
  await popup.exposeFunction("__callContent", (handler, req) =>
    shop.evaluate(([h, r]) => {
      const fn = globalThis[h];
      if (typeof fn !== "function") throw new Error("no handler " + h);
      return fn(r);
    }, [handler, req]),
  );
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
        tabs: { query: async () => [{ id: 1, windowId: 1, active: true, url }] },
        permissions: { getAll: async () => ({ origins: [] }), request: async () => true, remove: async () => true },
        scripting: {
          executeScript: async (inj) => {
            if (inj.files) {
              for (const f of inj.files) await w.__injectContent(f);
              return [{ result: true }];
            }
            if (!inj.func || !inj.args) return [{ result: null }];
            const handler = inj.args[1];
            w[handler] = (r) => w.__callContent(handler, r);
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
  if (/is the best:/.test(s) && /It's applied to your cart/.test(s)) return verify === false ? "applied (summary) but cart did not confirm" : "applied";
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
  const result = { name: m.name, url: m.url, group: m.group, outcome: "", notes: [], stages, timeline, startedAt: new Date(started).toISOString() };
  const context = await browser.newContext({ bypassCSP: true, viewport: { width: 1280, height: 900 } });
  context.setDefaultTimeout(30_000);
  const shop = await context.newPage();
  const dir = join(out, slug(m.name));
  mkdirSync(dir, { recursive: true });
  try {
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
    await wait(1500);
    const before = await readShopifyCart(shop);
    if (before) result.cartBefore = before;
    await shop.screenshot({ path: join(dir, "cart-before.png"), fullPage: false }).catch(() => null);

    const popup = await openPopup(context, shop, shop.url(), stageSink);
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
    if (after && /It's applied to your cart/.test(summary)) {
      const m2 = /is the best: your total drops from \*?\*?([^*]+?)\*?\*? to \*?\*?([^*\s]+)/.exec(summary);
      const claimed = m2 ? Number(m2[2].replace(/[^0-9.]/g, "")) : NaN;
      const codeOn = after.codes.some((c) => c.applicable);
      // Without a before-read (Just Ingredients, 2026-10-17) the claim is checked against the cart's own total.
      verified = before ? after.total < before.total - 0.004 && codeOn : Number.isFinite(claimed) && Math.abs(after.total - claimed) < 0.005 && codeOn;
      result.verify = { before: before ? before.total : null, after: after.total, codes: after.codes, claimed: m2 ? m2[2] : null, confirmed: verified };
    }
    await shop.screenshot({ path: join(dir, "cart-after.png"), fullPage: false }).catch(() => null);
    result.outcome = summary ? classify(summary, verified) : "error: run did not finish in time";
    return result;
  } catch (e) {
    result.outcome = "error: " + String(e && e.message ? e.message : e).slice(0, 120);
    return result;
  } finally {
    result.seconds = Math.round((Date.now() - started) / 1000);
    await context.close().catch(() => null);
  }
}

const engine = browserName === "chromium" ? chromium : webkit;
const browser = await engine.launch({ headless: !headed });
const results = [];
console.log("Live coupon suite: " + merchants.length + " merchants, " + browserName + (headed ? " (headed)" : "") + ", results in " + out);
for (const m of merchants) {
  const r = await runMerchant(browser, m);
  results.push(r);
  console.log("- " + m.name + ": " + r.outcome + (r.verify ? " (cart " + r.verify.before + " -> " + r.verify.after + ")" : "") + " [" + r.seconds + " s]");
  writeFileSync(join(out, "results.json"), JSON.stringify({ browser: browserName, model: model || "default", effort: effort || "default", secondPass, startedAt: stamp, results }, null, 2));
  await wait(3000);
}
await browser.close();

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
