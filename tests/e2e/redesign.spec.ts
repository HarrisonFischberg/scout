import { expect, test, type Page } from "@playwright/test";

// T021–T026: chat-first popup. Stubbed browser APIs, in-memory Keychain and
// storage, provider mocked at the network layer. Synthetic data only.
const PAGE = { url: "https://shop.test/a", title: "Test shop", text: "Widget costs $10." };
const GOOD_KEY = "sk-ant-test-synthetic-GOODKEY-0000";

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

async function openPopup(page: Page, opts: { keys?: Record<string, string>; data?: Record<string, unknown> } = {}): Promise<void> {
  await page.addInitScript(
    ({ keys, data, pageData }) => {
      const g = globalThis as unknown as Record<string, unknown>;
      // Survive reloads inside one test (simulates reopening the popup).
      const store = (g.sessionStorage as Storage).getItem("__fake");
      const fake = store ? JSON.parse(store) : { keys, data };
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
        scripting: { executeScript: async () => [{ result: pageData }] },
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
    { keys: opts.keys ?? {}, data: opts.data ?? {}, pageData: PAGE },
  );
  await page.route("**/popup.html", (r) => r.fulfill({ path: "apple/Extension/Resources/popup.html", contentType: "text/html" }));
  await page.route("**/popup.js", (r) => r.fulfill({ path: "apple/Extension/Resources/popup.js", contentType: "text/javascript" }));
  await page.route("**/icons/**", (r) => r.fulfill({ status: 200, contentType: "image/png", body: "" }));
  await page.route("https://api.anthropic.com/v1/models**", (r) =>
    r.fulfill({ status: r.request().headers()["x-api-key"] === GOOD_KEY ? 200 : 401, body: "{}" }),
  );
  await page.route("https://api.anthropic.com/v1/messages", (r) =>
    r.fulfill({ status: 200, contentType: "text/event-stream", body: sse("The widget costs **$10**.") }),
  );
  await page.goto("/popup.html");
}

test("no key: Add API key opens Settings at the key field; a bad key is explained; a good key is saved to the Keychain only", async ({ page }) => {
  await openPopup(page);
  await page.getByRole("button", { name: "Add API key" }).click();
  const field = page.getByLabel("Anthropic API key");
  await expect(field).toBeFocused();

  await field.fill("not-a-key");
  await page.getByRole("button", { name: "Test and save" }).click();
  await expect(page.locator("#key-error")).toHaveText("That doesn't look like an Anthropic key. Anthropic keys start with sk-ant-.");
  await expect(field).toHaveAttribute("aria-invalid", "true");

  await field.fill("sk-ant-test-synthetic-WRONGKEY-000");
  await page.getByRole("button", { name: "Test and save" }).click();
  await expect(page.locator("#key-error")).toContainText("Anthropic rejected this key.");

  await field.fill(GOOD_KEY);
  await page.getByRole("button", { name: "Test and save" }).click();
  await expect(page.locator("#key-status")).toHaveText("Anthropic key works and is saved in your Keychain.");
  await expect(field).toHaveValue("");
  const fake = await page.evaluate(() => (globalThis as unknown as { __fake: { keys: object; data: object } }).__fake);
  expect(fake.keys).toEqual({ anthropic: GOOD_KEY });
  expect(JSON.stringify(fake.data)).not.toContain(GOOD_KEY);

  await page.getByRole("button", { name: "Back to chat" }).click();
  await expect(page.locator("#status")).toContainText("Ready. Using anthropic");
  await expect(page.getByRole("heading", { name: "How can I help?" })).toBeVisible();
});

test("Control Browser mode shows a bold chip and switches the send action", async ({ page }) => {
  await openPopup(page, { keys: { anthropic: GOOD_KEY } });
  await expect(page.locator("#mode-chip")).toBeHidden();
  await page.getByRole("radio", { name: "Control Browser" }).check();
  await expect(page.locator("#mode-chip")).toBeVisible();
  await expect(page.locator("#mode-chip span")).toHaveText("Control Browser");
  expect(await page.locator("#mode-chip").evaluate((n) => getComputedStyle(n).fontWeight)).toBe("700");
  await expect(page.getByRole("button", { name: "Start task" })).toBeVisible();
  await expect(page.getByLabel("Ask about this page")).toHaveAttribute("placeholder", "Tell AssistAnt what to do on this page…");
  await page.getByRole("button", { name: "Back to Chat mode" }).click();
  await expect(page.locator("#mode-chip")).toBeHidden();
  await expect(page.getByRole("radio", { name: "Chat" })).toBeChecked();
  await expect(page.getByRole("button", { name: "Send" })).toBeVisible();
});

test("the conversation is saved and comes back when the popup reopens; New chat starts fresh", async ({ page }) => {
  await openPopup(page, { keys: { anthropic: GOOD_KEY } });
  await page.getByLabel("Ask about this page").fill("How much is the widget?");
  await page.getByLabel("Ask about this page").press("Enter");
  await expect(page.getByRole("log").getByText("The widget costs")).toBeVisible();

  await page.reload();
  const log = page.getByRole("log");
  await expect(log.getByText("How much is the widget?")).toBeVisible();
  await expect(log.getByText("The widget costs")).toBeVisible();

  await page.getByRole("button", { name: "New chat" }).click();
  await expect(log.getByText("How much is the widget?")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "How can I help?" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("log").getByText("How much is the widget?")).toHaveCount(0);
});

test("the + menu opens by keyboard, Escape closes it and returns focus", async ({ page }) => {
  await openPopup(page, { keys: { anthropic: GOOD_KEY } });
  const plus = page.getByRole("button", { name: "More actions" });
  await plus.focus();
  await page.keyboard.press("Enter");
  await expect(plus).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByRole("button", { name: "Summarize page" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Summarize page" })).toBeHidden();
  await expect(plus).toBeFocused();
  await expect(plus).toHaveAttribute("aria-expanded", "false");
});

test("Settings and Back keep focus where the user expects", async ({ page }) => {
  await openPopup(page, { keys: { anthropic: GOOD_KEY } });
  await page.getByRole("button", { name: "Settings" }).click();
  await expect(page.getByRole("heading", { name: "Settings" })).toBeFocused();
  await expect(page.locator("#key-status")).toHaveText("Anthropic key saved in your Keychain.");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Settings" })).toBeFocused();
  await expect(page.getByRole("heading", { name: "How can I help?" })).toBeVisible();
});

test("only the selected mode is highlighted", async ({ page }) => {
  await openPopup(page, { keys: { anthropic: GOOD_KEY } });
  const chatLabel = page.locator("fieldset.segmented label", { hasText: "Chat" }).first();
  const controlLabel = page.locator("fieldset.segmented label", { hasText: "Control Browser" });
  await expect(chatLabel).toHaveClass(/\bon\b/);
  await expect(controlLabel).not.toHaveClass(/\bon\b/);
  await page.getByRole("radio", { name: "Control Browser" }).check();
  await expect(controlLabel).toHaveClass(/\bon\b/);
  await expect(chatLabel).not.toHaveClass(/\bon\b/);
});

test("a restored conversation opens scrolled to the newest message", async ({ page }) => {
  const now = Date.now();
  const history = Array.from({ length: 6 }, (_, i) => ({
    at: now - 60000 + i,
    question: "Question number " + i,
    answer: "Answer number " + i + "\n\n- point one\n- point two\n- point three",
    kind: "chat",
  }));
  await openPopup(page, { keys: { anthropic: GOOD_KEY }, data: { history } });
  const last = page.getByRole("log").getByText("Answer number 5");
  await expect(last).toBeInViewport();
});

test("the newest message stays in view when the composer grows", async ({ page }) => {
  const now = Date.now();
  const history = Array.from({ length: 6 }, (_, i) => ({
    at: now - 60000 + i, question: "Question number " + i, answer: "Answer number " + i + "\n\n- a\n- b\n- c", kind: "chat",
  }));
  await openPopup(page, { keys: { anthropic: GOOD_KEY }, data: { history } });
  await page.getByRole("radio", { name: "Control Browser" }).check();
  await page.getByLabel("Ask about this page").fill("one\ntwo\nthree\nfour");
  await expect(page.getByRole("log").getByText("Answer number 5")).toBeInViewport();
  await expect(page.getByRole("log").locator("li").last()).toBeInViewport();
});

test("scrolling up to read is respected while the composer grows", async ({ page }) => {
  const now = Date.now();
  const history = Array.from({ length: 6 }, (_, i) => ({
    at: now - 60000 + i, question: "Question number " + i, answer: "Answer number " + i + "\n\n- a\n- b\n- c", kind: "chat",
  }));
  await openPopup(page, { keys: { anthropic: GOOD_KEY }, data: { history } });
  await expect(page.getByRole("log").getByText("Answer number 5")).toBeInViewport();
  await page.locator("#thread").evaluate(async (t) => {
    t.scrollTop = 0;
    await new Promise((r) => setTimeout(r, 300));
    t.dispatchEvent(new Event("scroll"));
  });
  await page.getByLabel("Ask about this page").fill("one\ntwo\nthree\nfour");
  await expect(page.getByRole("log").getByText("Question number 0")).toBeInViewport();
});
