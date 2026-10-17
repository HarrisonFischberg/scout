import { expect, test, type Page } from "@playwright/test";
import { withWorker } from "./worker";

// App Store Review Guideline 5.1.2(i): Scout for Safari asks once per provider
// before it sends anything to Anthropic or OpenAI. Loads the built popup (run
// `npm run build` first) with a stubbed `browser` namespace; every request to
// a provider API is recorded by the network layer. Synthetic keys and pages,
// no live API call.
const PAGE = { url: "https://shop.test/a", title: "Test shop", text: "Widget costs $10. Free shipping." };
const KEY = "sk-ant-test-synthetic-0123456789abcdef";
const OPENAI_KEY = "sk-test-synthetic-0123456789abcdef";
const ALLOWED = { at: Date.UTC(2026, 9, 16), version: 2 };

function sse(events: Array<Record<string, unknown>>): string {
  return events.map((e) => "event: " + String(e.type) + "\ndata: " + JSON.stringify(e) + "\n\n").join("");
}
const ANSWER = sse([
  { type: "message_start", message: { usage: { input_tokens: 30, output_tokens: 1 } } },
  { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
  { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "The widget costs $10." } },
  { type: "content_block_stop", index: 0 },
  { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 8 } },
  { type: "message_stop" },
]);

interface Calls {
  anthropic: string[];
  openai: string[];
}

async function openPopup(page: Page, opts: { keys?: Record<string, string>; data?: Record<string, unknown> } = {}): Promise<Calls> {
  const calls: Calls = { anthropic: [], openai: [] };
  await page.addInitScript(
    ({ keys, data, pageData }) => {
      const g = globalThis as unknown as Record<string, unknown>;
      // Survive reloads inside one test (simulates reopening the popup).
      const store = (g.sessionStorage as Storage).getItem("__fake");
      const fake = store ? JSON.parse(store) : { keys, data, reads: 0 };
      const save = () => (g.sessionStorage as Storage).setItem("__fake", JSON.stringify(fake));
      save();
      g.__fake = fake;
      g.browser = {
        runtime: {
          sendMessage: async () => ({ ok: true }),
          sendNativeMessage: async (_app: string, m: { type: string; account: string; value?: string }) => {
            if (m.type === "keychain.get") return fake.keys[m.account] ? { ok: true, value: fake.keys[m.account] } : { ok: true };
            if (m.type === "keychain.set") { fake.keys[m.account] = m.value; save(); return { ok: true }; }
            if (m.type === "keychain.delete") { delete fake.keys[m.account]; save(); return { ok: true }; }
            return { ok: true };
          },
          onMessage: { addListener() {} },
        },
        tabs: { query: async () => [{ id: 1, url: pageData.url, title: pageData.title, active: true }] },
        permissions: { request: async () => true, getAll: async () => ({ origins: [] }), remove: async () => true },
        // Counts every page read or content-script injection.
        scripting: { executeScript: async () => { fake.reads++; save(); return [{ result: pageData }]; } },
        storage: {
          local: {
            get: async (k: string | string[]) => {
              const list = Array.isArray(k) ? k : [k];
              return JSON.parse(JSON.stringify(Object.fromEntries(list.filter((x) => x in fake.data).map((x) => [x, fake.data[x]]))));
            },
            set: async (items: Record<string, unknown>) => { Object.assign(fake.data, JSON.parse(JSON.stringify(items))); save(); },
            clear: async () => { fake.data = {}; save(); },
          },
        },
      };
    },
    { keys: opts.keys ?? { anthropic: KEY }, data: opts.data ?? {}, pageData: PAGE },
  );
  await page.route("**/popup.html", (r) => r.fulfill({ path: "apple/Extension/Resources/popup.html", contentType: "text/html" }));
  await page.route("**/popup.js", (r) => r.fulfill({ path: "apple/Extension/Resources/popup.js", contentType: "text/javascript" }));
  await page.route("**/icons/**", (r) => r.fulfill({ status: 200, contentType: "image/png", body: "" }));
  await page.route("https://api.anthropic.com/**", async (r) => {
    calls.anthropic.push(r.request().url());
    if (r.request().url().includes("/v1/models")) await r.fulfill({ status: 200, contentType: "application/json", body: '{"data":[]}' });
    else await r.fulfill({ status: 200, contentType: "text/event-stream", body: ANSWER });
  });
  await page.route("https://api.openai.com/**", async (r) => {
    calls.openai.push(r.request().url());
    await r.fulfill({ status: 401, body: "{}" });
  });
  await withWorker(page);
  await page.goto("/popup.html");
  return calls;
}

const stored = (page: Page): Promise<Record<string, unknown> | undefined> =>
  page.evaluate(() => (globalThis as unknown as { __fake: { data: { aiConsent?: Record<string, unknown> } } }).__fake.data.aiConsent);
const reads = (page: Page): Promise<number> => page.evaluate(() => (globalThis as unknown as { __fake: { reads: number } }).__fake.reads);

test("the first request asks first, and nothing reaches Anthropic before Allow", async ({ page }) => {
  const calls = await openPopup(page);
  await page.getByLabel("Ask about this page").fill("How much is the widget?");
  await page.getByRole("button", { name: "Send" }).click();

  const dialog = page.getByRole("dialog", { name: "Share with Anthropic?" });
  await expect(dialog).toBeVisible();
  // Focus starts on the heading: neither choice is preselected.
  await expect(dialog.getByRole("heading", { name: "Share with Anthropic?" })).toBeFocused();
  await expect(dialog.getByRole("button", { name: "Allow" })).not.toBeFocused();
  await expect(dialog.getByRole("button", { name: "Not now" })).not.toBeFocused();
  await expect(dialog).toContainText("Your messages");
  await expect(dialog).toContainText("the page's address, title, description, and text");
  await expect(dialog).toContainText("What you typed into forms, password fields, and hidden fields are left out");
  await expect(dialog).toContainText("A screenshot of the visible page, only when you allow it for that site.");
  await expect(dialog).toContainText("Titles and addresses of your open tabs, only if you turn on tab search in Settings.");
  await expect(dialog).toContainText("Your API key, only to sign in to Anthropic");
  await expect(dialog).not.toContainText("OpenAI");
  await expect(dialog.getByRole("link", { name: "Anthropic privacy policy" })).toHaveAttribute("href", "https://www.anthropic.com/legal/privacy");
  await expect(dialog.getByRole("link", { name: "How Anthropic handles API data" })).toHaveAttribute("href", "https://www.anthropic.com/legal/commercial-terms");
  expect(calls.anthropic).toHaveLength(0);
  expect(await reads(page)).toBe(0);
  expect(await stored(page)).toBeUndefined();

  await dialog.getByRole("button", { name: "Allow" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("log").getByText("The widget costs $10.")).toBeVisible();
  expect(calls.anthropic).toHaveLength(1);
  expect(await stored(page)).toMatchObject({ anthropic: { version: 2 } });
  expect(await stored(page)).not.toHaveProperty("openai");

  // Asked once: reopening the popup and asking again sends without a prompt.
  await page.reload();
  await page.getByLabel("Ask about this page").fill("And shipping?");
  await page.getByRole("button", { name: "Send" }).click();
  await expect.poll(() => calls.anthropic.length).toBe(2);
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("Not now sends nothing, keeps the question, and returns focus", async ({ page }) => {
  const calls = await openPopup(page);
  const field = page.getByLabel("Ask about this page");
  await field.fill("How much is the widget?");
  await field.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Share with Anthropic?" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Not now" }).click();
  await expect(dialog).toBeHidden();
  await expect(field).toBeFocused();
  await expect(field).toHaveValue("How much is the widget?");
  await expect(page.locator("#status")).toHaveText("Nothing was sent. Scout for Safari asks before it shares anything with Anthropic.");
  expect(calls.anthropic).toHaveLength(0);
  expect(await reads(page)).toBe(0);
  expect(await stored(page)).toBeUndefined();

  // Escape is Not now, and focus goes back to the field.
  await field.press("Enter");
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(field).toBeFocused();
  expect(calls.anthropic).toHaveLength(0);
  expect(await stored(page)).toBeUndefined();
});

test("keyboard: Option+Tab stays inside the dialog and reaches the link and both buttons", async ({ page }) => {
  await openPopup(page);
  await page.getByLabel("Ask about this page").fill("Hi");
  await page.getByLabel("Ask about this page").press("Enter");
  const dialog = page.getByRole("dialog", { name: "Share with Anthropic?" });
  await expect(dialog).toBeVisible();
  const seen = new Set<string>();
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press("Alt+Tab");
    const where = await page.evaluate(() => {
      const a = document.activeElement as HTMLElement | null;
      if (!a || a === document.body) return null;
      return { inside: !!a.closest("#consent"), name: a.textContent?.trim() ?? "" };
    });
    if (!where) continue;
    expect(where.inside, "focus left the dialog: " + where.name).toBe(true);
    seen.add(where.name);
  }
  expect([...seen]).toEqual(expect.arrayContaining(["Anthropic privacy policy", "How Anthropic handles API data", "Allow", "Not now"]));
});

test("Summarize, Control Browser, and Find coupons also ask first and read nothing before Allow", async ({ page }) => {
  const calls = await openPopup(page);
  const dialog = page.getByRole("dialog", { name: "Share with Anthropic?" });

  await page.getByRole("button", { name: "Summarize this page" }).click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Not now" }).click();

  await page.getByRole("button", { name: "Find coupons" }).click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Not now" }).click();

  await page.getByRole("radio", { name: "Control Browser" }).check();
  await page.getByLabel("Ask about this page").fill("Fill in the form");
  await page.getByRole("button", { name: "Start task" }).click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Not now" }).click();
  await expect(dialog).toBeHidden();

  expect(calls.anthropic).toHaveLength(0);
  expect(calls.openai).toHaveLength(0);
  expect(await reads(page)).toBe(0);
  expect(await stored(page)).toBeUndefined();
});

test("consent is per provider: switching to OpenAI asks again before any OpenAI request", async ({ page }) => {
  const calls = await openPopup(page, {
    keys: { anthropic: KEY, openai: OPENAI_KEY },
    data: { settings: { provider: "anthropic", model: "claude-sonnet-5-5", retention: "7" }, aiConsent: { anthropic: ALLOWED } },
  });
  await page.getByLabel("Ask about this page").fill("How much?");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByRole("log").getByText("The widget costs $10.")).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(calls.anthropic).toHaveLength(1);

  await page.getByRole("button", { name: "Settings" }).click();
  // Opening Settings (Anthropic allowed) loads Anthropic's model list once.
  await expect(page.locator("#model-help")).not.toHaveText("Loading models…");
  const n = calls.anthropic.length;
  await page.getByRole("radio", { name: "OpenAI" }).check();
  await expect(page.locator("#key-label")).toHaveText("OpenAI API key");
  await page.getByRole("button", { name: "Back to chat" }).click();

  await page.getByLabel("Ask about this page").fill("How much?");
  await page.getByRole("button", { name: "Send" }).click();
  const dialog = page.getByRole("dialog", { name: "Share with OpenAI?" });
  await expect(dialog).toBeVisible();
  await expect(dialog).not.toContainText("Anthropic");
  await expect(dialog.getByRole("link", { name: "OpenAI privacy policy" })).toHaveAttribute("href", "https://openai.com/policies/row-privacy-policy/");
  await expect(dialog.getByRole("link", { name: "How OpenAI handles API data" })).toHaveAttribute("href", "https://openai.com/enterprise-privacy/");
  expect(calls.openai).toHaveLength(0);

  await dialog.getByRole("button", { name: "Allow" }).click();
  await expect.poll(() => calls.openai.length).toBe(1);
  expect(calls.openai[0]).toContain("api.openai.com/v1/responses");
  expect(calls.anthropic).toHaveLength(n);
  expect(await stored(page)).toMatchObject({ anthropic: { version: 2 }, openai: { version: 2 } });
});

test("withdrawing in Settings blocks every request until the user allows again", async ({ page }) => {
  const calls = await openPopup(page, { data: { aiConsent: { anthropic: ALLOWED } } });
  await page.getByLabel("Ask about this page").fill("How much?");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByRole("log").getByText("The widget costs $10.")).toBeVisible();
  expect(calls.anthropic).toHaveLength(1);

  await page.getByRole("button", { name: "Settings" }).click();
  const list = page.locator("#consent-list");
  await expect(list).toContainText("Anthropic: allowed on");
  await expect(list).toContainText("OpenAI: not allowed");
  // Opening Settings (allowed) loads the model list from Anthropic once.
  await expect(page.locator("#model-help")).not.toHaveText("Loading models…");
  const n = calls.anthropic.length;
  await page.getByRole("button", { name: "Withdraw permission to share with Anthropic" }).click();
  await expect(page.locator("#consent-status")).toHaveText("Withdrawn. Scout for Safari sends nothing to Anthropic until you allow it again.");
  await expect(list).toContainText("Anthropic: not allowed");
  await expect(page.locator("#sharing-title")).toBeFocused();
  await expect.poll(() => stored(page)).toEqual({});

  // Refreshing the model list is a provider request too: blocked.
  await page.getByRole("button", { name: "Refresh model list" }).click();
  await expect(page.locator("#model-help")).toContainText("after you allow sharing with Anthropic");

  await page.getByRole("button", { name: "Back to chat" }).click();
  await page.getByLabel("Ask about this page").fill("How much?");
  await page.getByRole("button", { name: "Send" }).click();
  const dialog = page.getByRole("dialog", { name: "Share with Anthropic?" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Not now" }).click();
  expect(calls.anthropic).toHaveLength(n);

  await page.getByRole("button", { name: "Send" }).click();
  await dialog.getByRole("button", { name: "Allow" }).click();
  await expect.poll(() => calls.anthropic.length).toBe(n + 1);
});

test("testing a new key asks first; Not now neither tests nor saves it", async ({ page }) => {
  const calls = await openPopup(page, { keys: {} });
  await page.getByRole("button", { name: "Add API key" }).click();
  await page.locator("#key-input").fill(KEY);
  await page.getByRole("button", { name: "Test and save" }).click();
  const dialog = page.getByRole("dialog", { name: "Share with Anthropic?" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Not now" }).click();
  await expect(page.locator("#key-status")).toHaveText(
    "The key was not tested or saved. Scout for Safari tests it with Anthropic only after you allow sharing.",
  );
  // Focus is back in the key form (the field or the button that opened the dialog).
  expect(await page.evaluate(() => !!document.activeElement?.closest("#key-form"))).toBe(true);
  expect(calls.anthropic).toHaveLength(0);
  expect(await page.evaluate(() => (globalThis as unknown as { __fake: { keys: object } }).__fake.keys)).toEqual({});

  await page.getByRole("button", { name: "Test and save" }).click();
  await dialog.getByRole("button", { name: "Allow" }).click();
  await expect(page.locator("#key-status")).toHaveText("Anthropic key works and is saved in your Keychain.");
  expect(calls.anthropic[0]).toContain("api.anthropic.com/v1/models");
});
