import { test, type Page, type BrowserContextOptions } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { withWorker } from "../../tests/e2e/worker";
import AxeBuilder from "@axe-core/playwright";
import { appendFile } from "node:fs/promises";

// Review-only screenshots of the Scout panel in every main state, light and
// dark, Mac popover and iPhone sheet sizes. Synthetic data, stubbed browser
// APIs, provider mocked at the network layer (same harness as the e2e specs).
//   OUT    output folder (default impeccable-review/before)
//   THEME  optional CSS file injected after the panel's own styles (prototypes)
//   SHOTS  optional comma list of state names to capture (default all)
const ROOT = resolve(new URL(".", import.meta.url).pathname, "../..");
const RES = join(ROOT, "apple/Extension/Resources");
const OUT = resolve(ROOT, process.env.OUT ?? "impeccable-review/before");
const THEME = process.env.THEME ? resolve(ROOT, process.env.THEME) : "";
const THEME_JS = process.env.THEME_JS ? resolve(ROOT, process.env.THEME_JS) : "";
const FONTS = join(ROOT, "impeccable-review/tools/fonts");
const LOOK = process.env.LOOK ?? "";
const ONLY = process.env.SHOTS ? new Set(process.env.SHOTS.split(",")) : null;
const KEY = "sk-ant-test-synthetic-REVIEW-0000";
const now = Date.now();
const H = 3600_000;

const ANSWER = [
  "This is a **merino wool hiking sock** from Trail & Co, sold as a 3-pack for **$42.00** (about $14 a pair).",
  "",
  "- Cushioned sole, 71% merino, 26% nylon",
  "- Free shipping over $50; 60-day returns",
  "- 4.7 stars from 1,284 reviews; most mention warmth and fit",
  "",
  "| Store | Price |",
  "|---|---:|",
  "| Trail & Co | **$42.00** |",
  "| Outdoor Depot | $47.99 |",
].join("\n");

function sse(text: string): string {
  const ev = [
    { type: "message_start", message: { usage: { input_tokens: 820, output_tokens: 1 } } },
    { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
    { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } },
    { type: "content_block_stop", index: 0 },
    { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 120 } },
    { type: "message_stop" },
  ];
  return ev.map((e) => "event: " + e.type + "\ndata: " + JSON.stringify(e) + "\n\n").join("");
}

const HISTORY = [
  { at: now - 30 * H, question: "Compare these two standing desks", answer: "The Flexi is cheaper.", kind: "chat", conv: "c1", site: "desks.test" },
  { at: now - 5 * H, question: "Find coupons", answer: "SAVE15 saved $6.30.", kind: "coupons", conv: "c2", site: "trailco.test" },
  { at: now - 3 * H, question: "Summarize this page: one or two sentences", answer: "A recipe for sourdough.", kind: "chat", conv: "c3", site: "bake.test" },
  { at: now - 40 * 60_000, question: "What are the return rules on this store?", answer: "60 days, free.", kind: "chat", conv: "c4", site: "trailco.test" },
];

type Plat = "mac" | "iphone";
const PLATS: Record<Plat, BrowserContextOptions> = {
  mac: { viewport: { width: 400, height: 600 }, deviceScaleFactor: 2 },
  iphone: { viewport: { width: 393, height: Number(process.env.PH ?? 740) }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
};

interface Opts {
  keys?: Record<string, string>;
  url?: string;
  title?: string;
  favIconUrl?: string;
  messages?: "answer" | "hang" | "error";
  consent?: boolean;
  history?: boolean;
  path?: string;
}

async function open(page: Page, o: Opts = {}): Promise<void> {
  const pageData = { url: o.url ?? "https://trailco.test/merino-socks", title: o.title ?? "Merino hiking socks, 3-pack", text: "Merino hiking socks. $42.00.", favIconUrl: o.favIconUrl };
  const data: Record<string, unknown> = {
    settings: { provider: "anthropic", model: "claude-haiku-5-5", retention: "30" },
    ...(o.consent === false ? {} : { aiConsent: { anthropic: { at: now - 72 * H, version: 2 }, openai: { at: now - 72 * H, version: 2 } } }),
    ...(o.history ? { history: HISTORY } : {}),
    ...(LOOK ? { look: LOOK } : {}),
  };
  if (LOOK) await page.addInitScript((l) => localStorage.setItem("scout.look", l), LOOK);
  await page.addInitScript(
    ({ keys, data, pageData }) => {
      const g = globalThis as unknown as Record<string, unknown>;
      const fake = { keys, data } as { keys: Record<string, string>; data: Record<string, unknown> };
      g.__fake = fake;
      g.browser = {
        runtime: {
          sendMessage: async () => ({ ok: true }),
          sendNativeMessage: async (_a: string, m: { type: string; account: string; value?: string }) => {
            if (m.type === "keychain.get") return fake.keys[m.account] ? { ok: true, value: fake.keys[m.account] } : { ok: true };
            if (m.type === "keychain.set") { fake.keys[m.account] = m.value!; return { ok: true }; }
            return { ok: true };
          },
          onMessage: { addListener() {} },
        },
        tabs: {
          query: async () => [
            { id: 1, url: pageData.url, title: pageData.title, active: true, favIconUrl: pageData.favIconUrl },
            { id: 2, url: "https://outdoordepot.test/socks", title: "Outdoor Depot socks", active: false },
          ],
          create: async (p: { url: string }) => ({ id: 3, url: p.url }),
        },
        permissions: { request: async () => true, getAll: async () => ({ origins: ["https://trailco.test/*", "https://www.amazon.com/*"] }), remove: async () => true },
        scripting: { executeScript: async () => [{ result: pageData }] },
        storage: {
          local: {
            get: async (k: string | string[] | null) => {
              const list = k === null ? Object.keys(fake.data) : Array.isArray(k) ? k : [k];
              return JSON.parse(JSON.stringify(Object.fromEntries(list.filter((x) => x in fake.data).map((x) => [x, fake.data[x]]))));
            },
            set: async (items: Record<string, unknown>) => { Object.assign(fake.data, JSON.parse(JSON.stringify(items))); },
            remove: async () => {},
            clear: async () => { fake.data = {}; },
          },
          onChanged: { addListener() {} },
        },
      };
    },
    { keys: o.keys ?? { anthropic: KEY }, data, pageData },
  );
  const theme = THEME ? await readFile(THEME, "utf8") : "";
  await page.route("**/popup.html*", async (r) => {
    let html = await readFile(join(RES, "popup.html"), "utf8");
    // Linux has no SF Pro: Inter stands in for the system font in these captures.
    // Stand-ins for the Apple fonts the looks name: SF Pro Rounded, New York, SF Mono.
    const faces = [400, 600, 700, 800, 900].map((w) => `@font-face{font-family:"SF Pro Rounded";font-weight:${w};src:url(/rf/nunito-latin-${w}-normal.woff2)}`).join("")
      + `@font-face{font-family:"New York";src:local("Bitstream Charter")}@font-face{font-family:"SF Mono";font-weight:400;src:url(/rf/jetbrains-mono-latin-400-normal.woff2)}@font-face{font-family:"SF Mono";font-weight:600 700;src:url(/rf/jetbrains-mono-latin-600-normal.woff2)}`;
    const font = `<style id="review-font">${faces}body{font-family:Inter,"SF Pro Text",-apple-system,system-ui,sans-serif!important}</style>`;
    html = html.replace("</head>", font + (theme ? `<style id="review-theme">${theme}</style>` : "") + "</head>");
    await r.fulfill({ body: html, contentType: "text/html" });
  });
  await page.route("**/popup.js", (r) => r.fulfill({ path: join(RES, "popup.js"), contentType: "text/javascript" }));
  await page.route("**/icons/**", async (r) => {
    const name = new URL(r.request().url()).pathname.split("/").pop()!;
    try { await r.fulfill({ body: await readFile(join(RES, "icons", name)), contentType: "image/png" }); } catch { await r.fulfill({ status: 404 }); }
  });
  await page.route("**/rf/*", (r) => r.fulfill({ path: join(FONTS, new URL(r.request().url()).pathname.split("/").pop()!), contentType: "font/woff2" }));
  await page.route("https://icons.test/**", (r) => r.fulfill({ status: 404 }));
  await page.route("https://api.anthropic.com/v1/models**", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: [{ id: "claude-haiku-5-5", display_name: "Claude Haiku 5.5" }, { id: "claude-sonnet-5-5", display_name: "Claude Sonnet 5.5" }, { id: "claude-opus-5-5", display_name: "Claude Opus 5.5" }] }) }));
  await page.route("https://api.anthropic.com/v1/messages", async (r) => {
    if (o.messages === "hang") return; // never answers: the Thinking state
    if (o.messages === "error") return r.fulfill({ status: 529, contentType: "application/json", body: JSON.stringify({ type: "error", error: { type: "overloaded_error", message: "Overloaded" } }) });
    await r.fulfill({ status: 200, contentType: "text/event-stream", body: sse(ANSWER) });
  });
  await withWorker(page);
  await page.goto(o.path ?? "http://127.0.0.1:4317/popup.html");
  await page.waitForTimeout(400);
  if (THEME_JS) await page.addScriptTag({ content: await readFile(THEME_JS, "utf8") });
}

async function shot(page: Page, plat: Plat, scheme: string, name: string): Promise<void> {
  await page.waitForTimeout(350);
  if (process.env.AXE) {
    const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
    const rows = r.violations.map((v) => ({ shot: `${plat}-${scheme}-${name}`, id: v.id, impact: v.impact, nodes: v.nodes.length, sample: v.nodes[0]?.target.join(" "), summary: v.nodes[0]?.failureSummary?.split("\n").slice(0, 2).join(" ") }));
    await appendFile(process.env.AXE, rows.map((x) => JSON.stringify(x)).join("\n") + (rows.length ? "\n" : ""));
  }
  await page.screenshot({ path: join(OUT, `${plat}-${scheme}-${name}.png`) });
}

async function ask(page: Page, q: string): Promise<void> {
  await page.locator("#question").fill(q);
  await page.locator("#question").press("Enter");
}

/** A Find coupons run as the panel draws it, staged from the same classes popup.ts uses (no live run in the cloud). */
async function stageCoupons(page: Page): Promise<void> {
  await page.evaluate(() => {
    document.getElementById("empty")?.setAttribute("hidden", "");
    document.documentElement.removeAttribute("data-chat-empty");
    const log = document.getElementById("log")!;
    const done = '<svg class="i done-mark" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="m8 12.5 2.5 2.5L16 9.5"/></svg>';
    log.innerHTML = `
      <div class="msg user">Find coupons</div>
      <p class="coupon-step">${done}<span>Read your cart: $64.00 at Trail &amp; Co</span></p>
      <p class="coupon-step">${done}<span>Searched 38 coupon sites, found 11 codes</span></p>
      <p class="coupon-step busy"><span class="pulse"><i></i><i></i><i></i></span><span>Trying codes at checkout · 6 of 11</span></p>
      <div class="trace"><button type="button" class="trace-head" aria-expanded="true"><span>Working 48s</span><svg class="i chev" viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></svg></button>
        <div class="trace-body">
          <div class="attempt good"><span class="code">TRAIL15</span><span> · $54.40 · saves $9.60 · Works, 15% off · </span><a href="#">retailmenot</a></div>
          <div class="attempt"><span class="code">WELCOME10</span><span> · $64.00 · New customers only · </span><a href="#">store email</a></div>
          <div class="attempt"><span class="code">FREESHIP</span><span> · $64.00 · Expired · guess</span></div>
          <div class="attempt"><span class="code">SOCKS20</span><span> · $64.00 · Not valid · </span><a href="#">couponfollow</a></div>
          <div class="controls"><button class="btn" type="button">Take control</button><button class="btn" type="button">Stop</button></div>
        </div></div>`;
    document.getElementById("send")?.setAttribute("hidden", "");
    document.getElementById("stop")?.removeAttribute("hidden");
  });
}

/** The sensitive-action card (spec 8.4), shown with sample text. */
async function stageConfirm(page: Page): Promise<void> {
  await page.evaluate(() => {
    document.getElementById("empty")?.setAttribute("hidden", "");
    const log = document.getElementById("log")!;
    log.innerHTML = `<div class="msg user"><span class="mode">Scout</span>Add the 3-pack to my cart and check out</div>`;
    const c = document.getElementById("confirm")!;
    c.hidden = false;
    document.getElementById("confirm-what")!.textContent = "Click “Place order” on trailco.test ($64.00)";
    document.getElementById("confirm-reason")!.textContent = "This submits a purchase. Scout always asks before buying.";
  });
}

const SCHEMES = ["light", "dark"] as const;
for (const plat of Object.keys(PLATS) as Plat[]) {
  for (const scheme of SCHEMES) {
    test.describe(`${plat} ${scheme}`, () => {
      test.use({ ...PLATS[plat], colorScheme: scheme });
      const want = (n: string) => !ONLY || ONLY.has(n);

      test("no key", async ({ page }) => {
        test.skip(!want("01-no-key"));
        await open(page, { keys: {} });
        await shot(page, plat, scheme, "01-no-key");
      });
      test("new chat + menus", async ({ page }) => {
        await open(page, { history: true });
        if (want("02-new-chat")) await shot(page, plat, scheme, "02-new-chat");
        if (want("09-plus-menu")) {
          await page.locator("#plus").click();
          await shot(page, plat, scheme, "09-plus-menu");
          await page.keyboard.press("Escape");
          await page.locator("#plus-menu").evaluate((n) => ((n as HTMLElement).hidden = true));
        }
        if (want("10-models")) {
          await page.locator("#model-pill").click();
          await shot(page, plat, scheme, "10-models");
          await page.locator("#model-menu-close").click();
        }
        if (want("11-chats")) {
          await page.locator("#chats-open").click();
          await shot(page, plat, scheme, "11-chats");
          await page.locator("#chats-close").click();
        }
        if (want("07-scout-mode")) {
          await page.locator('.segmented input[value="scout"]').check({ force: true });
          await page.locator("#question").fill("Add the 3-pack to my cart and find the cheapest shipping");
          await shot(page, plat, scheme, "07-scout-mode");
        }
      });
      test("store suggestions", async ({ page }) => {
        test.skip(!want("03-store"));
        await open(page, { url: "https://www.amazon.com/dp/B0SOCKS", title: "Amazon.com: Merino socks", favIconUrl: "https://icons.test/a.png" });
        await shot(page, plat, scheme, "03-store");
      });
      test("answer", async ({ page }) => {
        test.skip(!want("04-answer"));
        await open(page);
        await ask(page, "What is this product and is it a good price?");
        await page.getByText("Outdoor Depot").waitFor({ timeout: 30000 });
        await page.locator("#stop").waitFor({ state: "hidden", timeout: 30000 });
        await shot(page, plat, scheme, "04-answer");
      });
      test("thinking", async ({ page }) => {
        test.skip(!want("05-thinking"));
        await open(page, { messages: "hang" });
        await ask(page, "What is this product and is it a good price?");
        await page.waitForTimeout(800);
        await shot(page, plat, scheme, "05-thinking");
      });
      test("error", async ({ page }) => {
        test.skip(!want("06-error"));
        await open(page, { messages: "error" });
        await ask(page, "What is this product and is it a good price?");
        await page.locator(".msg.error").first().waitFor({ timeout: 20000 });
        await shot(page, plat, scheme, "06-error");
      });
      test("coupons", async ({ page }) => {
        test.skip(!want("08-coupons"));
        await open(page);
        await stageCoupons(page);
        await shot(page, plat, scheme, "08-coupons");
      });
      test("confirm", async ({ page }) => {
        test.skip(!want("14-confirm"));
        await open(page);
        await stageConfirm(page);
        await shot(page, plat, scheme, "14-confirm");
      });
      test("settings", async ({ page }) => {
        test.skip(!want("12-settings"));
        await open(page);
        await page.locator("#settings-open").click();
        await shot(page, plat, scheme, "12-settings");
      });
      test("consent", async ({ page }) => {
        test.skip(!want("13-consent"));
        await open(page, { consent: false });
        await ask(page, "What is this product?");
        await page.locator("#consent[open]").waitFor({ timeout: 8000 });
        await shot(page, plat, scheme, "13-consent");
      });
      if (plat === "mac") {
        test("standalone page", async ({ page }) => {
          test.skip(!want("15-page"));
          await page.setViewportSize({ width: 1100, height: 700 });
          await open(page, { path: "http://127.0.0.1:4317/popup.html?view=page", history: true });
          await ask(page, "What is this product and is it a good price?");
          await page.getByText("Outdoor Depot").waitFor({ timeout: 30000 });
          await page.locator("#stop").waitFor({ state: "hidden", timeout: 30000 });
          await shot(page, plat, scheme, "15-page");
        });
      }
    });
  }
}
