import { test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { withWorker } from "../../tests/e2e/worker";

// App Store panel captures (not part of the test suite). Release build, light,
// each device's default look. OUT folder; files <dev>-<shot>.png.
const ROOT = resolve(new URL(".", import.meta.url).pathname, "../..");
const RES = join(ROOT, "apple/Extension/Resources");
const OUT = resolve(process.env.OUT ?? join(ROOT, "build/appstore-panels"));
const FONTS = join(ROOT, "impeccable-review/tools/fonts");
const now = Date.now();
const H = 3600_000;

const SUMMARY = [
  "**Yosemite in autumn: the short version**",
  "",
  "- **Fewer crowds:** after Labor Day the valley is quieter, and weekday parking is easy.",
  "- **Tioga Road** usually stays open until the first big snow, often in November.",
  "- **Campsites** in the valley still need a reservation, even in October.",
  "- **Waterfalls run low** by fall, so go for the color: black oaks and dogwoods turn gold and red.",
  "",
  "| Best for | Where |",
  "|---|---|",
  "| Fall color | Cook's Meadow |",
  "| Sunrise | Tunnel View |",
  "| Short hike | Mirror Lake loop (5 mi) |",
].join("\n");

const ANSWER = [
  "Yes, it's a fair price. This is a **merino wool hiking sock** 3-pack for **$42.00**, about $14 a pair.",
  "",
  "- Cushioned sole, 71% merino",
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

const DEVS = {
  mac: { look: "glasshouse", ctx: { viewport: { width: 400, height: 640 }, deviceScaleFactor: 3 } },
  ipad: { look: "glasshouse", ctx: { viewport: { width: 400, height: 640 }, deviceScaleFactor: 3, hasTouch: true } },
  iphone: { look: "glasshouse", ctx: { viewport: { width: 393, height: 720 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true } },
} as const;

async function open(page: Page, look: string, answer: string, pageData: { url: string; title: string }): Promise<void> {
  const data: Record<string, unknown> = {
    settings: { provider: "anthropic", model: "claude-haiku-5-5", retention: "30" },
    aiConsent: { anthropic: { at: now - 72 * H, version: 2 }, openai: { at: now - 72 * H, version: 2 } },
    look,
  };
  await page.addInitScript((l) => localStorage.setItem("scout.look", l), look);
  await page.addInitScript(
    ({ data, pageData }) => {
      const g = globalThis as unknown as Record<string, unknown>;
      const fake = { keys: { anthropic: "sk-ant-test-synthetic-0000" } as Record<string, string>, data };
      g.browser = {
        runtime: {
          sendMessage: async () => ({ ok: true }),
          sendNativeMessage: async (_a: string, m: { type: string; account: string }) => (m.type === "keychain.get" && fake.keys[m.account] ? { ok: true, value: fake.keys[m.account] } : { ok: true }),
          onMessage: { addListener() {} },
        },
        tabs: { query: async () => [{ id: 1, url: pageData.url, title: pageData.title, active: true }], create: async (p: { url: string }) => ({ id: 3, url: p.url }) },
        permissions: { request: async () => true, getAll: async () => ({ origins: ["https://trailco.test/*"] }), remove: async () => true },
        scripting: { executeScript: async () => [{ result: { ...pageData, text: "Page text." } }] },
        storage: {
          local: {
            get: async (k: string | string[] | null) => {
              const list = k === null ? Object.keys(fake.data) : Array.isArray(k) ? k : [k];
              return JSON.parse(JSON.stringify(Object.fromEntries(list.filter((x) => x in fake.data).map((x) => [x, fake.data[x]]))));
            },
            set: async (items: Record<string, unknown>) => { Object.assign(fake.data, JSON.parse(JSON.stringify(items))); },
            remove: async () => {},
            clear: async () => {},
          },
          onChanged: { addListener() {} },
        },
      };
    },
    { data, pageData },
  );
  await page.route("**/popup.html*", async (r) => {
    let html = await readFile(join(RES, "popup.html"), "utf8");
    const faces = [400, 600, 700, 800, 900].map((w) => `@font-face{font-family:"SF Pro Rounded";font-weight:${w};src:url(/rf/nunito-latin-${w}-normal.woff2)}`).join("")
      + `@font-face{font-family:"New York";src:local("Bitstream Charter")}@font-face{font-family:"SF Mono";font-weight:400;src:url(/rf/jetbrains-mono-latin-400-normal.woff2)}`;
    html = html.replace("</head>", `<style>${faces}body{font-family:Inter,"SF Pro Text",-apple-system,system-ui,sans-serif!important}</style></head>`);
    await r.fulfill({ body: html, contentType: "text/html" });
  });
  await page.route("**/popup.js", (r) => r.fulfill({ path: join(RES, "popup.js"), contentType: "text/javascript" }));
  await page.route("**/icons/**", async (r) => {
    const name = new URL(r.request().url()).pathname.split("/").pop()!;
    try { await r.fulfill({ body: await readFile(join(RES, "icons", name)), contentType: "image/png" }); } catch { await r.fulfill({ status: 404 }); }
  });
  await page.route("**/rf/*", (r) => r.fulfill({ path: join(FONTS, new URL(r.request().url()).pathname.split("/").pop()!), contentType: "font/woff2" }));
  await page.route("https://api.anthropic.com/v1/models**", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: [{ id: "claude-haiku-5-5", display_name: "Claude Haiku 5.5" }] }) }));
  await page.route("https://api.anthropic.com/v1/messages", (r) => r.fulfill({ status: 200, contentType: "text/event-stream", body: sse(answer) }));
  await withWorker(page);
  await page.goto("http://127.0.0.1:4317/popup.html");
  await page.waitForTimeout(400);
}

async function ask(page: Page, q: string, waitText: string): Promise<void> {
  await page.locator("#question").fill(q);
  await page.locator("#question").press("Enter");
  await page.getByText(waitText).first().waitFor({ timeout: 30000 });
  await page.locator("#stop").waitFor({ state: "hidden", timeout: 30000 });
  await page.waitForTimeout(500);
  await page.evaluate(() => document.getElementById("thread")!.scrollTo(0, 0));
}

const DONE = '<svg class="i done-mark" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="m8 12.5 2.5 2.5L16 9.5"/></svg>';
const PULSE = '<span class="pulse" aria-hidden="true"><i></i><i></i><i></i></span>';
const CHEV = '<svg class="chev" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>';
const PAGE = '<svg class="i" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="16" rx="3"/><path d="M4 9h16"/></svg>';

async function stage(page: Page, html: string): Promise<void> {
  await page.evaluate((html) => {
    document.getElementById("empty")?.setAttribute("hidden", "");
    document.documentElement.removeAttribute("data-chat-empty");
    document.getElementById("log")!.innerHTML = html;
    document.getElementById("send")?.setAttribute("hidden", "");
    document.getElementById("stop")?.removeAttribute("hidden");
  }, html);
}

for (const [dev, d] of Object.entries(DEVS)) {
  test.describe(dev, () => {
    test.use({ ...d.ctx, colorScheme: "light" });
    const shot = (page: Page, n: string) => page.waitForTimeout(400).then(() => page.screenshot({ path: join(OUT, `${dev}-${n}.png`) }));

    test("summary", async ({ page }) => {
      await open(page, d.look, SUMMARY, { url: "https://parks.test/yosemite-autumn", title: "Yosemite in autumn" });
      await ask(page, "Summarize this page", "Mirror Lake");
      await shot(page, "1-summary");
    });
    test("ask", async ({ page }) => {
      await open(page, d.look, ANSWER, { url: "https://trailco.test/merino-socks", title: "Merino hiking socks, 3-pack" });
      await ask(page, "Is this a good price?", "Outdoor Depot");
      await shot(page, "2-ask");
    });
    test("scout mode", async ({ page }) => {
      await open(page, d.look, ANSWER, { url: "https://campsites.test/reserve", title: "Reserve a campsite" });
      await stage(page, `<div class="msg user"><span class="mode">Scout</span>Book site 14 for Friday and Saturday with my details</div>
        <div class="trace" id="task"><button type="button" class="trace-head" aria-expanded="true">${PULSE}<span>Working 34s</span>${CHEV}</button>
        <div class="trace-body">
        <div class="step">${PAGE}<span>Browsed · 7 actions</span></div>
        <p class="say">Filled in your name, dates and 2 adults. Total: $64.00.</p>
        <details class="steps"><summary>Steps (9)</summary><ol></ol></details></div></div>`);
      await page.evaluate(() => {
        const c = document.getElementById("confirm")!;
        c.hidden = false;
        document.getElementById("confirm-what")!.textContent = "Click “Reserve and pay” on campsites.test ($64.00)";
        document.getElementById("confirm-reason")!.textContent = "This makes a payment. Scout always asks before buying.";
      });
      await shot(page, "3-scout-mode");
    });
    test("coupons", async ({ page }) => {
      await open(page, d.look, ANSWER, { url: "https://trailco.test/cart", title: "Your cart" });
      await stage(page, `<div class="msg user">Find coupons</div>
        <p class="coupon-step">${DONE}<span>Read your cart: $64.00 at Trail &amp; Co</span></p>
        <p class="coupon-step">${DONE}<span>Searched 38 coupon sites, found 11 codes</span></p>
        <p class="coupon-step busy">${PULSE}<span>Trying codes at checkout · 6 of 11</span></p>
        <div class="trace"><button type="button" class="trace-head" aria-expanded="true"><span>Working 48s</span>${CHEV}</button>
        <div class="trace-body">
          <div class="attempt good"><span class="code">TRAIL15</span><span> · $54.40 · saves $9.60 · Works, 15% off · </span><a href="#">blog</a></div>
          <div class="attempt"><span class="code">WELCOME10</span><span> · $64.00 · New customers only · </span><a href="#">store email</a></div>
          <div class="attempt"><span class="code">FREESHIP</span><span> · $64.00 · Expired · guess</span></div>
          <div class="attempt"><span class="code">SOCKS20</span><span> · $64.00 · Not valid · </span><a href="#">forum</a></div>
          <div class="controls"><button class="btn" type="button">Stop</button></div>
        </div></div>`);
      await shot(page, "4-coupons");
    });
    test("settings", async ({ page }) => {
      await open(page, d.look, ANSWER, { url: "https://trailco.test/", title: "Trail & Co" });
      await page.locator("#settings-open").click();
      await page.waitForTimeout(300);
      await page.locator("#provider-title").evaluate((n) => n.scrollIntoView({ block: "start" }));
      await shot(page, "5-settings");
    });
  });
}
