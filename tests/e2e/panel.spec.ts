import { expect, test, type Page } from "@playwright/test";

// Part 1: the Scout panel keeps one conversation per tab, says hello to the
// background worker over the "scout-panel" port, is off in Private Browsing,
// and answers off-page questions as a normal chat. Stubbed browser APIs,
// synthetic data, provider mocked at the network layer.
const KEY = "sk-ant-test-synthetic-PANEL-00000";
const STOCK_PAGE = { url: "https://stocks.test/markets", title: "Markets today", text: "S&P 500 up 1.2%. Nasdaq up 0.8%." };

function sse(text: string): string {
  const ev = [
    { type: "message_start", message: { usage: { input_tokens: 20, output_tokens: 1 } } },
    { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
    { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } },
    { type: "content_block_stop", index: 0 },
    { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 5 } },
    { type: "message_stop" },
  ];
  return ev.map((e) => "event: " + e.type + "\ndata: " + JSON.stringify(e) + "\n\n").join("");
}

// The tab the popup opens on and whether it is private come from
// sessionStorage, so a test can "switch tabs" and reload (reopen the panel).
async function openPanel(page: Page, tab: { id: number; incognito?: boolean }): Promise<void> {
  await page.addInitScript(
    ({ key, pageData, firstTab }) => {
      const g = globalThis as unknown as Record<string, unknown>;
      const ss = g.sessionStorage as Storage;
      const fake = JSON.parse(ss.getItem("__fake") ?? JSON.stringify({ data: { aiConsent: { anthropic: { at: 1, version: 1 }, openai: { at: 1, version: 1 } } }, hellos: [] }));
      const save = () => ss.setItem("__fake", JSON.stringify(fake));
      const tab = JSON.parse(ss.getItem("__tab") ?? JSON.stringify(firstTab));
      g.__fake = fake;
      g.browser = {
        runtime: {
          id: "scout-test",
          getURL: (p: string) => location.origin + "/" + p,
          sendMessage: async () => ({ ok: true }),
          sendNativeMessage: async (_app: string, m: { type: string }) => (m.type === "keychain.get" ? { ok: true, value: key } : { ok: true }),
          onMessage: { addListener() {} },
          connect: ({ name }: { name: string }) => {
            const listeners: Array<(m: unknown) => void> = [];
            return {
              name,
              postMessage: (m: { type: string; request_id: string; payload: { tabId: number } }) => {
                fake.hellos.push({ name, ...m });
                save();
                setTimeout(() => listeners.forEach((f) => f({ type: "panel.ack", request_id: m.request_id, payload: { tabId: m.payload.tabId } })), 0);
              },
              disconnect() {},
              onMessage: { addListener: (f: (m: unknown) => void) => listeners.push(f) },
              onDisconnect: { addListener() {} },
            };
          },
        },
        tabs: { query: async () => [{ id: tab.id, windowId: 1, url: pageData.url, title: pageData.title, active: true, incognito: tab.incognito === true }] },
        permissions: { request: async () => true, getAll: async () => ({ origins: [] }), remove: async () => true },
        scripting: { executeScript: async () => [{ result: pageData }] },
        storage: {
          local: {
            get: async (k: string | string[]) => {
              const list = Array.isArray(k) ? k : [k];
              return JSON.parse(JSON.stringify(Object.fromEntries(list.filter((x) => x in fake.data).map((x) => [x, fake.data[x]]))));
            },
            set: async (items: Record<string, unknown>) => {
              Object.assign(fake.data, JSON.parse(JSON.stringify(items)));
              save();
            },
            clear: async () => {
              fake.data = {};
              save();
            },
          },
        },
      };
    },
    { key: KEY, pageData: STOCK_PAGE, firstTab: tab },
  );
  await page.route("**/popup.html", (r) => r.fulfill({ path: "apple/Extension/Resources/popup.html", contentType: "text/html" }));
  await page.route("**/popup.js", (r) => r.fulfill({ path: "apple/Extension/Resources/popup.js", contentType: "text/javascript" }));
  await page.route("**/icons/**", (r) => r.fulfill({ status: 200, contentType: "image/png", body: "" }));
  await page.route("https://api.anthropic.com/v1/models**", (r) => r.fulfill({ status: 401, body: "{}" }));
  await page.goto("/popup.html");
}

async function switchTab(page: Page, tab: { id: number; incognito?: boolean }): Promise<void> {
  await page.evaluate((t) => sessionStorage.setItem("__tab", JSON.stringify(t)), tab);
  await page.reload();
}

test("each tab keeps its own conversation, restored when the panel reopens on it", async ({ page }) => {
  await page.route("https://api.anthropic.com/v1/messages", (r) =>
    r.fulfill({ status: 200, contentType: "text/event-stream", body: sse("Answer for this tab.") }),
  );
  await openPanel(page, { id: 1 });
  const log = page.getByRole("log");
  await page.getByLabel("Ask about this page").fill("What moved the market today?");
  await page.getByLabel("Ask about this page").press("Enter");
  await expect(log.getByText("Answer for this tab.")).toBeVisible();

  await switchTab(page, { id: 2 });
  await expect(page.getByRole("heading", { name: "How can I help?" })).toBeVisible();
  await expect(log.getByText("What moved the market today?")).toHaveCount(0);

  await switchTab(page, { id: 1 });
  await expect(log.getByText("What moved the market today?")).toBeVisible();

  // The panel said hello on the scout-panel port with the tab it shows.
  const hellos = await page.evaluate(() => (globalThis as unknown as { __fake: { hellos: Array<{ name: string; type: string; payload: { tabId: number } }> } }).__fake.hellos);
  expect(hellos.map((h) => [h.name, h.type, h.payload.tabId])).toEqual([
    ["scout-panel", "panel.hello", 1],
    ["scout-panel", "panel.hello", 2],
    ["scout-panel", "panel.hello", 1],
  ]);
});

test("an off-page question goes out as a normal chat message, with the page only as optional context", async ({ page }) => {
  let body: { system?: string; messages?: Array<{ content: string }> } = {};
  await page.route("https://api.anthropic.com/v1/messages", (r) => {
    body = JSON.parse(r.request().postData() ?? "{}");
    return r.fulfill({ status: 200, contentType: "text/event-stream", body: sse("Vitamin D is commonly taken as 600 to 2,000 IU a day. How old are you?") });
  });
  await openPanel(page, { id: 5 });
  await page.getByLabel("Ask about this page").fill("hey, I want to take vitamin D");
  await page.getByLabel("Ask about this page").press("Enter");
  await expect(page.getByRole("log").getByText("How old are you?")).toBeVisible();
  expect(body.system).toContain("answer it like a normal chat assistant from your own knowledge");
  expect(body.messages?.[body.messages.length - 1]?.content).toContain("User message: hey, I want to take vitamin D");
});

test("the panel is off in Private Browsing, with a short explanation", async ({ page }) => {
  await openPanel(page, { id: 3, incognito: true });
  await expect(page.getByRole("heading", { name: "Off in Private Browsing" })).toBeVisible();
  await expect(page.locator("#status")).toHaveText("Scout for Safari is off in Private Browsing.");
  await expect(page.locator("#composer")).toBeHidden();
  await expect(page.getByRole("button", { name: "Settings" })).toBeHidden();
  const hellos = await page.evaluate(() => (globalThis as unknown as { __fake: { hellos: unknown[] } }).__fake.hellos);
  expect(hellos).toEqual([]);
});
