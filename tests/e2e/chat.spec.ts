import { expect, test, type Page } from "@playwright/test";

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
        tabs: { query: async () => [{ id: 1 }] },
        scripting: { executeScript: async () => [{ result: pageData }] },
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
  await page.goto("/popup.html");
  return { bodies };
}

test("no key: explains setup and offers no composer", async ({ page }) => {
  await openPopup(page, { key: null });
  await expect(page.getByText("Add an API key to start.")).toBeVisible();
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

test("summarize button works", async ({ page }) => {
  await openPopup(page, { key: "sk-test-synthetic" });
  await page.getByRole("button", { name: "Summarize page" }).click();
  await expect(page.getByRole("log").getByText("with free shipping.")).toBeVisible();
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
          get: async () => ({ settings: { provider: "openai", model: "gpt-5", retention: "7" } }),
          set: async () => undefined,
          clear: async () => undefined,
        },
      },
    };
  });
  await page.route("**/popup.html", (r) => r.fulfill({ path: "apple/Extension/Resources/popup.html", contentType: "text/html" }));
  await page.route("**/popup.js", (r) => r.fulfill({ path: "apple/Extension/Resources/popup.js", contentType: "text/javascript" }));
  await page.goto("/popup.html");
  await expect(page.locator("#status")).toContainText("Using anthropic");
  await expect(
    page.getByRole("log").getByText("No OpenAI key is saved, so AssistAnt is using your Anthropic key."),
  ).toBeVisible();
});
