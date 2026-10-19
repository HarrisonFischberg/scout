import { expect, test, type Page } from "@playwright/test";
import { withWorker } from "./worker";

// Loads the built popup (run `npm run build` first) with a stubbed `browser`
// namespace. The provider is mocked at the network layer: no live API call.
const PAGE = { url: "https://shop.test/a", title: "Test shop", text: "Widget costs $10. Free shipping." };

function sse(events: Array<Record<string, unknown>>): string {
  return events.map((e) => "event: " + String(e.type) + "\ndata: " + JSON.stringify(e) + "\n\n").join("");
}

const ANSWER = sse([
  { type: "message_start", message: { usage: { input_tokens: 30, output_tokens: 1 } } },
  { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
  { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "The widget costs **$10**" } },
  { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: " with free shipping." } },
  { type: "content_block_stop", index: 0 },
  { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 12 } },
  { type: "message_stop" },
]);

async function openPopup(page: Page, opts: { key: string | null }): Promise<{ bodies: string[] }> {
  const bodies: string[] = [];
  await page.addInitScript(
    ({ key, pageData }) => {
      const stub = {
        runtime: {
          sendMessage: async () => ({ ok: true }),
          sendNativeMessage: async () => (key ? { ok: true, value: key } : { ok: true }),
          onMessage: { addListener() {} },
        },
        // Sharing with the provider already allowed (consent.spec.ts covers asking).
        storage: { local: { get: async (k: string | string[]) => (([] as string[]).concat(k).includes("aiConsent") ? { aiConsent: { anthropic: { at: 1, version: 2 }, openai: { at: 1, version: 2 } } } : {}), set: async () => undefined, clear: async () => undefined } },
        tabs: { query: async () => [{ id: 1, url: pageData.url, title: pageData.title, active: true }] },
        scripting: {
          executeScript: async (injection: { func?: unknown }) => {
            const g = globalThis as unknown as { __injected?: string[] };
            (g.__injected ??= []).push(String(injection.func));
            return [{ result: pageData }];
          },
        },
      };
      (globalThis as unknown as { browser: unknown }).browser = stub;
    },
    { key: opts.key, pageData: PAGE },
  );
  await page.route("**/popup.html", (r) => r.fulfill({ path: "apple/Extension/Resources/popup.html", contentType: "text/html" }));
  await page.route("**/popup.js", (r) => r.fulfill({ path: "apple/Extension/Resources/popup.js", contentType: "text/javascript" }));
  await page.route("https://api.anthropic.com/**", async (r) => {
    bodies.push(r.request().postData() ?? "");
    await r.fulfill({ status: 200, contentType: "text/event-stream", body: ANSWER });
  });
  await withWorker(page);
  await page.goto("/popup.html");
  return { bodies };
}

test("no key: explains setup and offers no composer", async ({ page }) => {
  await openPopup(page, { key: null });
  await expect(page.getByRole("heading", { name: "Add your API key to start" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add API key" })).toBeVisible();
  await expect(page.getByLabel("Ask about this page")).toBeHidden();
});

test("ask about the page streams a Markdown answer", async ({ page }) => {
  const { bodies } = await openPopup(page, { key: "sk-test-synthetic" });
  await page.getByLabel("Ask about this page").fill("How much is the widget?");
  await page.getByRole("button", { name: "Send" }).click();
  const log = page.getByRole("log", { name: "Conversation" });
  await expect(log.getByText("with free shipping.")).toBeVisible();
  await expect(log.locator("strong")).toHaveText("$10");
  expect(bodies).toHaveLength(1);
  expect(bodies[0]).toContain("untrusted_page_content");
  expect(bodies[0]).toContain("Widget costs $10.");
});

test("an answer shows the moving indicator until its first words", async ({ page }) => {
  await openPopup(page, { key: "sk-test-synthetic" });
  let release: () => void = () => undefined;
  const gate = new Promise<void>((r) => (release = r));
  await page.route("https://api.anthropic.com/**", async (r) => {
    await gate;
    await r.fulfill({ status: 200, contentType: "text/event-stream", body: ANSWER });
  });
  await page.getByLabel("Ask about this page").fill("How much is the widget?");
  await page.getByRole("button", { name: "Send" }).click();
  const log = page.getByRole("log", { name: "Conversation" });
  await expect(log.locator(".msg.assistant .thinking .pulse")).toHaveCount(1);
  await expect(log.locator(".msg.assistant .thinking")).toHaveText("Thinking…");
  release();
  await expect(log.getByText("with free shipping.")).toBeVisible();
  await expect(log.locator(".pulse")).toHaveCount(0);
});

test("summarize button works", async ({ page }) => {
  await openPopup(page, { key: "sk-test-synthetic" });
  await page.getByRole("button", { name: "Summarize this page" }).click();
  await expect(page.getByRole("log").getByText("with free shipping.")).toBeVisible();
});

test("scrolling up while an answer types out stays where the user put it", async ({ page }) => {
  await openPopup(page, { key: "sk-test-synthetic" });
  const long = Array.from({ length: 40 }, (_, i) => "Paragraph " + (i + 1) + " of the summary, with enough words to wrap.").join("\n\n");
  await page.unroute("https://api.anthropic.com/**");
  await page.route("https://api.anthropic.com/**", (r) =>
    r.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: sse([
        { type: "message_start", message: { usage: { input_tokens: 30, output_tokens: 1 } } },
        { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
        { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: long } },
        { type: "content_block_stop", index: 0 },
        { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 400 } },
        { type: "message_stop" },
      ]),
    }),
  );
  await page.getByRole("button", { name: "Summarize this page" }).click();
  const thread = page.locator("#thread");
  const gap = (): Promise<number> => thread.evaluate((t) => t.scrollHeight - t.scrollTop - t.clientHeight);
  // While it types, the thread follows the new text.
  await expect.poll(() => thread.evaluate((t) => t.scrollHeight > t.clientHeight + 200), { timeout: 15_000 }).toBe(true);
  expect(await gap()).toBeLessThan(24);
  // The user scrolls up to read from the top; typing goes on and does not pull them back down.
  await thread.hover();
  await page.mouse.wheel(0, -5000);
  await expect.poll(() => thread.evaluate((t) => t.scrollTop)).toBe(0);
  const typedBefore = await thread.evaluate((t) => t.textContent?.length ?? 0);
  await page.waitForTimeout(1000);
  expect(await thread.evaluate((t) => t.textContent?.length ?? 0)).toBeGreaterThan(typedBefore);
  expect(await thread.evaluate((t) => t.scrollTop)).toBe(0);
  // Scrolling back to the bottom follows the new text again.
  await page.mouse.wheel(0, 100_000);
  await page.waitForTimeout(500);
  expect(await gap()).toBeLessThan(24);
});

test("keyboard only: type, Enter sends, focus returns to the field", async ({ page }) => {
  await openPopup(page, { key: "sk-test-synthetic" });
  await expect(page.getByLabel("Ask about this page")).toBeFocused();
  await page.keyboard.type("Shipping?");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("log").getByText("with free shipping.")).toBeVisible();
  await expect(page.getByLabel("Ask about this page")).toBeFocused();
});

test("provider 401 shows a readable error", async ({ page }) => {
  await openPopup(page, { key: "sk-test-synthetic" });
  await page.unroute("https://api.anthropic.com/**");
  await page.route("https://api.anthropic.com/**", (r) => r.fulfill({ status: 401, body: "{}" }));
  await page.getByLabel("Ask about this page").fill("Hi");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText("The API key was rejected.")).toBeVisible();
});

test.describe("touch device", () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 402, height: 874 } });

  // On iPhone, focusing the field on open raises the keyboard over the popup.
  test("does not auto-focus the question field on open", async ({ page }) => {
    await openPopup(page, { key: "sk-test-synthetic" });
    await expect(page.getByLabel("Ask about this page")).toBeVisible();
    await expect(page.getByLabel("Ask about this page")).not.toBeFocused();
  });

  // Owner decision 2026-10-18: no page blur on iPhone. Safari tells a panel
  // that was never tapped that it has closed only about half a second after
  // its sheet has gone, so the blur outlived the sheet.
  test.describe("iPhone screen", () => {
    test.use({ screen: { width: 402, height: 874 } });
    test("never blurs the page behind the panel, before or after a tap", async ({ page }) => {
      await openPopup(page, { key: "sk-test-synthetic" });
      await expect(page.getByLabel("Ask about this page")).toBeVisible();
      await page.getByRole("button", { name: "New chat" }).tap();
      await page.waitForTimeout(200);
      const injected = await page.evaluate(() => (globalThis as unknown as { __injected?: string[] }).__injected ?? []);
      expect(injected.filter((src) => src.includes("backdrop-filter"))).toEqual([]);
    });
  });

  // Owner item 6 (2026-10-17): Safari's sheet bar already names Scout, so the
  // chat header drops its own icon and title but keeps New chat and Settings.
  test("the chat header shows no repeated name, only New chat and Settings", async ({ page }) => {
    await openPopup(page, { key: "sk-test-synthetic" });
    const header = page.locator("#chat-view > header");
    await expect(header.locator("img")).toBeHidden();
    await expect(page.getByRole("heading", { name: "Scout AI Assistant", level: 1 })).toHaveCSS("width", "1px");
    await expect(page.getByRole("button", { name: "New chat" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Settings" })).toBeVisible();
  });
});

test("on Mac the chat header keeps the icon and the name", async ({ page }) => {
  await openPopup(page, { key: "sk-test-synthetic" });
  await expect(page.locator("#chat-view > header img")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Scout AI Assistant", level: 1 })).toBeVisible();
});

// T018: with OpenAI chosen but only an Anthropic key saved, the popup used
// Anthropic without saying so. The fallback must be visible.
test("a provider fallback is announced in the conversation", async ({ page }) => {
  await page.addInitScript(() => {
    (globalThis as unknown as { browser: unknown }).browser = {
      runtime: {
        sendMessage: async () => ({ ok: true }),
        sendNativeMessage: async (_app: string, m: { type: string; account?: string }) =>
          m.type === "keychain.get" && m.account === "anthropic" ? { ok: true, value: "sk-test-synthetic" } : { ok: true },
        onMessage: { addListener() {} },
      },
      tabs: { query: async () => [{ id: 1 }] },
      scripting: { executeScript: async () => [{ result: null }] },
      storage: {
        local: {
          get: async () => ({ settings: { provider: "openai", model: "gpt-5", retention: "7" }, aiConsent: { anthropic: { at: 1, version: 2 } } }),
          set: async () => undefined,
          clear: async () => undefined,
        },
      },
    };
  });
  await page.route("**/popup.html", (r) => r.fulfill({ path: "apple/Extension/Resources/popup.html", contentType: "text/html" }));
  await page.route("**/popup.js", (r) => r.fulfill({ path: "apple/Extension/Resources/popup.js", contentType: "text/javascript" }));
  await withWorker(page);
  await page.goto("/popup.html");
  await expect(page.getByLabel("Ask about this page")).toBeVisible();
  await expect(
    page.getByRole("log").getByText("No OpenAI key is saved, so Scout is using your Anthropic key."),
  ).toBeVisible();
});
