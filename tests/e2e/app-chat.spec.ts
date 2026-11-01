import { expect, test, type Page } from "@playwright/test";

// The Scout app's own chat (src/app/chat.ts, owner request 2026-11-01), loaded
// from a file URL as the iOS app loads it (run `npm run build` first). The
// native bridge is stubbed as window.webkit.messageHandlers.scout; Anthropic
// is mocked at the network layer: no live API call.
const PAGE = new URL("../../apple/App/Chat/chat.html", import.meta.url).href;
const KEY = "sk-ant-test-synthetic-key-0000000000";

function sse(events: Array<Record<string, unknown>>): string {
  return events.map((e) => "event: " + String(e.type) + "\ndata: " + JSON.stringify(e) + "\n\n").join("");
}

const ANSWER = sse([
  { type: "message_start", message: { usage: { input_tokens: 40, output_tokens: 1 } } },
  { type: "content_block_start", index: 0, content_block: { type: "server_tool_use", id: "s1", name: "web_search", input: {} } },
  { type: "content_block_stop", index: 0 },
  {
    type: "content_block_start",
    index: 1,
    content_block: {
      type: "web_search_tool_result",
      tool_use_id: "s1",
      content: [
        { type: "web_search_result", url: "https://www.weather.example/paris", title: "Paris weather" },
        { type: "web_search_result", url: "https://news.example.co.uk/today", title: "Today in Paris" },
      ],
    },
  },
  { type: "content_block_stop", index: 1 },
  { type: "content_block_start", index: 2, content_block: { type: "text", text: "" } },
  { type: "content_block_delta", index: 2, delta: { type: "text_delta", text: "It's **sunny** in Paris today." } },
  {
    type: "content_block_delta",
    index: 2,
    delta: { type: "citations_delta", citation: { type: "web_search_result_location", url: "https://www.weather.example/paris", title: "Paris weather", cited_text: "Sunny" } },
  },
  { type: "content_block_stop", index: 2 },
  { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 20, server_tool_use: { web_search_requests: 1 } } },
  { type: "message_stop" },
]);

async function openApp(page: Page, opts: { key: string | null; apple?: boolean }): Promise<{ bodies: Array<Record<string, unknown>> }> {
  const bodies: Array<Record<string, unknown>> = [];
  await page.addInitScript(
    ({ key, apple }) => {
      let saved: string | null = key;
      const w = window as unknown as { webkit: unknown; __setupOpened?: boolean };
      w.webkit = {
        messageHandlers: {
          scout: {
            postMessage: async (m: { type?: string; account?: string; value?: string }) => {
              if (m.type === "keychain.get") return saved ? { ok: true, value: saved } : { ok: true };
              if (m.type === "keychain.set") return (saved = m.value ?? null), { ok: true };
              if (m.type === "keychain.delete") return (saved = null), { ok: true };
              if (m.type === "ai.apple.status") return apple ? { ok: true, available: true } : { ok: true, available: false, reason: "device_not_eligible" };
              if (m.type === "ai.apple.generate") return { ok: true, text: "Apple says hi." };
              if (m.type === "app.setup") return (w.__setupOpened = true), { ok: true };
              return { ok: false, error: "unsupported" };
            },
          },
        },
      };
    },
    { key: opts.key, apple: !!opts.apple },
  );
  await page.route("https://api.anthropic.com/**", async (route) => {
    const req = route.request();
    if (req.url().includes("/v1/models")) {
      const ok = req.headers()["x-api-key"] === KEY;
      return route.fulfill({ status: ok ? 200 : 401, headers: { "access-control-allow-origin": "*" }, contentType: "application/json", body: ok ? '{"data":[]}' : '{"error":{"message":"invalid x-api-key"}}' });
    }
    bodies.push(JSON.parse(req.postData() ?? "{}") as Record<string, unknown>);
    return route.fulfill({ status: 200, headers: { "access-control-allow-origin": "*" }, contentType: "text/event-stream", body: ANSWER });
  });
  await page.goto(PAGE);
  return { bodies };
}

test.describe("Scout app chat", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: false });

  test("asks Claude after consent, shows the answer with a source chip and sources list, and saves the chat", async ({ page }) => {
    const { bodies } = await openApp(page, { key: KEY });
    await expect(page.getByRole("heading", { name: "Ask Scout anything" })).toBeVisible();
    await page.getByLabel("Message").fill("What's the weather in Paris?");
    await page.getByRole("button", { name: "Send" }).click();

    // Nothing is sent before consent.
    await expect(page.getByRole("dialog", { name: "Share with Anthropic?" })).toBeVisible();
    expect(bodies).toHaveLength(0);
    await page.getByRole("button", { name: "Agree and send" }).click();

    const answer = page.locator(".msg.assistant").last();
    await expect(answer).toContainText("It's sunny in Paris today.");
    await expect(answer.locator("a.cite")).toHaveText("weather");
    await expect(answer.locator("a.cite")).toHaveAttribute("href", "https://www.weather.example/paris");
    await answer.getByRole("button", { name: /2 sources/ }).click();
    await expect(answer.locator(".source-list a")).toHaveCount(2);
    await expect(answer).toContainText("Claude Haiku 5.5");

    expect(bodies).toHaveLength(1);
    const body = bodies[0]!;
    expect(body.model).toBe("claude-haiku-5-5");
    expect(JSON.stringify(body.tools)).toContain("web_search");
    expect(String(body.system)).toContain("Scout app");
    expect(body.messages).toEqual([{ role: "user", content: "What's the weather in Paris?" }]);

    // A follow-up sends the conversation so far, without citation markers.
    await page.getByLabel("Message").fill("And tomorrow?");
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.locator(".msg.assistant")).toHaveCount(2);
    expect(bodies[1]!.messages).toEqual([
      { role: "user", content: "What's the weather in Paris?" },
      { role: "assistant", content: "It's **sunny** in Paris today." },
      { role: "user", content: "And tomorrow?" },
    ]);

    // New chat clears the screen; the old one is under Chats and opens again.
    await page.getByRole("button", { name: "New chat" }).first().click();
    await expect(page.getByRole("heading", { name: "Ask Scout anything" })).toBeVisible();
    await page.getByRole("button", { name: "Chats" }).click();
    const list = page.getByRole("dialog", { name: "Chats" });
    await expect(list.getByRole("button", { name: /^What.s the weather in Paris\?/ })).toBeVisible();
    await list.getByRole("button", { name: /^What.s the weather in Paris\?/ }).click();
    await expect(page.locator(".msg.user")).toHaveCount(2);

    // The chat is still there after the app restarts, and consent is not asked again.
    await page.reload();
    await page.getByRole("button", { name: "Chats" }).click();
    await expect(page.getByRole("dialog", { name: "Chats" }).locator(".open")).toHaveCount(1);
    await page.getByRole("dialog", { name: "Chats" }).getByRole("button", { name: "Close" }).click();
    await page.getByLabel("Message").fill("Hi again");
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.locator(".msg.assistant")).toHaveCount(1);
    await expect(page.getByRole("dialog", { name: "Share with Anthropic?" })).toBeHidden();
  });

  test("without a key, asks for one, checks it, and saves it to the Keychain", async ({ page }) => {
    await openApp(page, { key: null });
    await expect(page.getByRole("heading", { name: "Add your Anthropic API key" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Send" })).toBeDisabled();
    await page.getByLabel("API key").first().fill("sk-ant-wrong-key-but-long-enough-xx");
    await page.getByRole("button", { name: "Save key" }).first().click();
    await expect(page.locator("#key-note")).toHaveText(/rejected/);
    await page.getByLabel("API key").first().fill(KEY);
    await page.getByRole("button", { name: "Save key" }).first().click();
    await expect(page.locator("#key-note")).toHaveText("Key saved in your Keychain.");
    await expect(page.getByRole("heading", { name: "Add your Anthropic API key" })).toBeHidden();
    await page.getByLabel("Message").fill("hello");
    await expect(page.getByRole("button", { name: "Send" })).toBeEnabled();
  });

  test("without a key but with Apple's model, Apple answers and nothing goes to Anthropic", async ({ page }) => {
    const { bodies } = await openApp(page, { key: null, apple: true });
    await expect(page.getByRole("heading", { name: "Add your Anthropic API key" })).toBeHidden();
    await page.getByLabel("Message").fill("Say hi");
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.locator(".msg.assistant")).toContainText("Apple says hi.");
    await expect(page.locator(".msg.assistant")).toContainText("Apple · on device");
    expect(bodies).toHaveLength(0);
  });

  test("Settings: model choice is used, and Safari setup opens natively", async ({ page }) => {
    const { bodies } = await openApp(page, { key: KEY });
    await page.getByRole("button", { name: "Settings" }).click();
    const settings = page.getByRole("dialog", { name: "Settings" });
    await expect(settings).toContainText("Your key is saved in your Keychain");
    await settings.getByLabel("Model", { exact: true }).selectOption("claude-sonnet-5-5");
    await settings.getByRole("button", { name: "Safari setup" }).click();
    expect(await page.evaluate(() => (window as unknown as { __setupOpened?: boolean }).__setupOpened)).toBe(true);
    await settings.getByRole("button", { name: "Close" }).click();
    await page.getByLabel("Message").fill("hi");
    await page.getByRole("button", { name: "Send" }).click();
    await page.getByRole("button", { name: "Agree and send" }).click();
    await expect(page.locator(".msg.assistant")).toContainText("Claude Sonnet 5.5");
    expect(bodies[0]!.model).toBe("claude-sonnet-5-5");
    expect(bodies[0]!.output_config).toBeUndefined();
  });
});
