import { expect, test, type Page } from "@playwright/test";
import { withWorker } from "./worker";

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
async function openPanel(page: Page, tab: { id: number; incognito?: boolean }, afterWorker?: () => Promise<unknown>): Promise<void> {
  await page.addInitScript(
    ({ key, pageData, firstTab }) => {
      const g = globalThis as unknown as Record<string, unknown>;
      const ss = g.sessionStorage as Storage;
      const fake = JSON.parse(ss.getItem("__fake") ?? JSON.stringify({ data: { aiConsent: { anthropic: { at: 1, version: 2 }, openai: { at: 1, version: 2 } } } }));
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
          // runtime.connect and the worker come from tests/e2e/worker.ts.
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
  await withWorker(page);
  await afterWorker?.();
  await page.goto("/popup.html");
}

/** panel.hello messages the panel posted on its port, across reloads (tests/e2e/worker.ts logs them). */
async function portHellos(page: Page): Promise<Array<{ name: string; type: string; payload: { tabId: number } }>> {
  const log = await page.evaluate(() => JSON.parse(sessionStorage.getItem("__scoutPortLog") ?? "[]") as Array<{ name: string; type: string; payload: { tabId: number } }>);
  return log.filter((m) => m.type === "panel.hello");
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
  await expect(page.getByRole("list", { name: "Suggestions" })).toBeVisible();
  await expect(log.getByText("What moved the market today?")).toHaveCount(0);

  await switchTab(page, { id: 1 });
  await expect(log.getByText("What moved the market today?")).toBeVisible();

  // The panel said hello on the scout-panel port with the tab it shows.
  const hellos = await portHellos(page);
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

test("the panel works in Private Browsing like in any other tab, and marks the chat as private", async ({ page }) => {
  await openPanel(page, { id: 3, incognito: true });
  await expect(page.getByRole("list", { name: "Suggestions" })).toBeVisible();
  await expect(page.locator("#composer")).toBeVisible();
  await expect(page.getByRole("button", { name: "Settings" })).toBeVisible();
  const hellos = await portHellos(page);
  expect(hellos.map((h) => [h.name, h.type, h.payload.tabId])).toEqual([["scout-panel", "panel.hello", 3]]);
  // Its conversation is listed for deletion when the tab closes (src/panel/state.ts).
  const stored = await page.evaluate(() => (globalThis as unknown as { __fake: { data: Record<string, unknown> } }).__fake.data);
  const conv = (stored.tabState as Record<string, { conv: string }>)["3"]?.conv;
  expect(conv).toBeTruthy();
  expect(stored.privateConversations).toEqual({ "3": [conv] });
});

// Owner request 2026-10-18: Scout should be usable sooner after Safari starts
// from cold. Each Keychain read wakes the app's native handler, slow the first
// time, so the panel reads both keys once, in parallel, as it opens.
test("opening the panel reads the saved keys in one parallel round, not one after another", async ({ page }) => {
  await page.addInitScript(() => {
    const g = globalThis as unknown as Record<string, unknown>;
    const reads: Array<{ start: number; end?: number }> = [];
    g.__keyReads = reads;
    let real: { runtime: { sendNativeMessage: (app: string, m: { type: string }) => Promise<unknown> } } | undefined;
    Object.defineProperty(g, "browser", {
      configurable: true,
      get: () => real,
      set: (v: typeof real) => {
        real = v;
        if (!v) return;
        const send = v.runtime.sendNativeMessage;
        v.runtime.sendNativeMessage = async (app, m) => {
          if (m.type !== "keychain.get") return send(app, m);
          const r: { start: number; end?: number } = { start: performance.now() };
          reads.push(r);
          await new Promise((res) => setTimeout(res, 400));
          r.end = performance.now();
          return send(app, m);
        };
      },
    });
  });
  await openPanel(page, { id: 1 });
  await expect(page.getByLabel("Ask about this page")).toBeVisible();
  const reads = await page.evaluate(() => (globalThis as unknown as { __keyReads: Array<{ start: number; end?: number }> }).__keyReads);
  expect(reads).toHaveLength(2);
  // Both started before either finished.
  const firstEnd = Math.min(...reads.map((r) => r.end ?? Infinity));
  expect(reads.every((r) => r.start < firstEnd)).toBe(true);
});

// Owner request 2026-10-18: from Safari not running to Scout open took 2-5 s
// on iPhone; it should be immediate. A cold phone answers every storage call
// slowly and the Keychain read even more slowly (it starts the app's native
// handler). The question box must not wait for the Keychain.
test("on a slow cold start the question box shows before the Keychain answers", async ({ page }) => {
  const STORAGE_MS = 30;
  const KEYCHAIN_MS = 800;
  await page.addInitScript(
    ({ storageMs, keychainMs }) => {
      const g = globalThis as unknown as Record<string, unknown>;
      const marks: Record<string, number> = {};
      g.__marks = marks;
      const wait = (ms: number) => new Promise((res) => setTimeout(res, ms));
      type B = {
        runtime: { sendNativeMessage: (app: string, m: { type: string }) => Promise<unknown> };
        storage: { local: { get: (k: unknown) => Promise<unknown>; set: (i: unknown) => Promise<void> } };
      };
      let real: B | undefined;
      Object.defineProperty(g, "browser", {
        configurable: true,
        get: () => real,
        set: (v: B) => {
          real = v;
          if (!v) return;
          const send = v.runtime.sendNativeMessage;
          v.runtime.sendNativeMessage = async (app, m) => {
            if (m.type === "keychain.get") {
              await wait(keychainMs);
              marks.keys = performance.now();
            }
            return send(app, m);
          };
          const { get, set } = v.storage.local;
          v.storage.local.get = async (k) => (await wait(storageMs), get(k));
          v.storage.local.set = async (i) => (await wait(storageMs), set(i));
        },
      });
      new MutationObserver(() => {
        const c = document.getElementById("composer");
        if (c && !c.hidden && marks.composer === undefined) marks.composer = performance.now();
      }).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ["hidden"] });
    },
    { storageMs: STORAGE_MS, keychainMs: KEYCHAIN_MS },
  );
  const marks = () => page.evaluate(() => (globalThis as unknown as { __marks: Record<string, number> }).__marks);
  // First open: nothing is known yet, so the panel waits for the Keychain once.
  await openPanel(page, { id: 1 });
  await expect(page.getByLabel("Ask about this page")).toBeVisible();
  const first = await marks();
  // Every later open (Safari restarted, panel opened again).
  await page.reload();
  await expect(page.getByLabel("Ask about this page")).toBeVisible();
  await expect.poll(async () => (await marks()).keys).toBeGreaterThan(0);
  const later = await marks();
  console.log(`question box shown after ${Math.round(first.composer ?? -1)} ms (first open), ${Math.round(later.composer ?? -1)} ms (later open); Keychain answered at ${Math.round(later.keys ?? -1)} ms`);
  expect(later.composer).toBeLessThan(later.keys ?? 0);
  expect(later.composer).toBeLessThan(KEYCHAIN_MS);

  // A question sent before the Keychain answers goes out once it does.
  await page.route("https://api.anthropic.com/v1/messages", (r) =>
    r.fulfill({ status: 200, contentType: "text/event-stream", body: sse("Answered after the key arrived.") }),
  );
  await page.reload();
  await page.getByLabel("Ask about this page").fill("What moved the market today?");
  await page.getByLabel("Ask about this page").press("Enter");
  await expect(page.getByRole("log").getByText("Answered after the key arrived.")).toBeVisible();
  const sent = await marks();
  expect(sent.composer).toBeLessThan(sent.keys ?? 0);
});

test("a key hint that is out of date falls back to the no-key screen", async ({ page }) => {
  await page.addInitScript(() => {
    const g = globalThis as unknown as Record<string, unknown>;
    let real: { runtime: { sendNativeMessage: (app: string, m: { type: string }) => Promise<unknown> } } | undefined;
    Object.defineProperty(g, "browser", {
      configurable: true,
      get: () => real,
      set: (v: typeof real) => {
        real = v;
        if (!v) return;
        // The key was removed outside Scout; the hint still says it is there.
        v.runtime.sendNativeMessage = async () => ({ ok: true });
        const fake = g.__fake as { data: Record<string, unknown> };
        fake.data.keyHint = { anthropic: true, openai: false };
      },
    });
  });
  await openPanel(page, { id: 1 });
  await expect(page.getByText("No API key saved.").first()).toBeVisible();
  await expect(page.locator("#composer")).toBeHidden();
  await expect.poll(() => page.evaluate(() => (globalThis as unknown as { __fake: { data: Record<string, unknown> } }).__fake.data.keyHint)).toEqual({
    anthropic: false,
    openai: false,
  });
});

// Quick ask (owner request 2026-10-18): on iPhone the page tab's box hands the
// question to the worker, which opens this panel; the panel then runs it.
async function openPanelWithQuickAsk(page: Page, tabId: number, ask: { kind: string; question: string }): Promise<void> {
  // Runs after the spec's stub and the worker harness: the page asks
  // as soon as the worker listens, as the tab's content script would.
  await openPanel(page, { id: tabId }, () => page.addInitScript(
    ({ tabId, ask }) => {
      const b = (globalThis as unknown as { browser: Record<string, Record<string, unknown>> }).browser;
      b.action = { openPopup: async () => undefined, setTitle: async () => undefined, setIcon: async () => undefined };
      const runtime = b.runtime!;
      const add = (runtime.onMessage as { addListener(f: (m: unknown, s: unknown) => unknown): void }).addListener;
      runtime.onMessage = {
        addListener: (f: (m: unknown, s: unknown) => unknown) => {
          void f({ type: "panel.ask", request_id: "qa1", payload: ask }, { id: "scout-test", url: "https://stocks.test/markets", tab: { id: tabId } });
          add(f);
        },
      };
    },
    { tabId, ask },
  ));
}

test("a question asked in the page's quick ask box runs as soon as the panel opens, once", async ({ page }) => {
  await page.route("https://api.anthropic.com/v1/messages", (r) =>
    r.fulfill({ status: 200, contentType: "text/event-stream", body: sse("Markets rose on tech earnings.") }),
  );
  await openPanelWithQuickAsk(page, 3, { kind: "ask", question: "What moved the market today?" });
  const log = page.getByRole("log");
  await expect(log.getByText("Markets rose on tech earnings.")).toBeVisible();
  await expect(log.getByText("What moved the market today?")).toHaveCount(1);
});

test("Summarize this page from the quick ask box summarizes in the panel", async ({ page }) => {
  await page.route("https://api.anthropic.com/v1/messages", (r) =>
    r.fulfill({ status: 200, contentType: "text/event-stream", body: sse("The page lists today's index moves.") }),
  );
  await openPanelWithQuickAsk(page, 4, { kind: "summarize", question: "" });
  const log = page.getByRole("log");
  await expect(log.getByText("Summarize page")).toBeVisible();
  await expect(log.getByText("The page lists today's index moves.")).toBeVisible();
});
