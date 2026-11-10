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

async function openPopup(page: Page, opts: { key: string | null; apple?: boolean; appleText?: string }): Promise<{ bodies: string[] }> {
  const bodies: string[] = [];
  await page.addInitScript(
    ({ key, pageData, apple, appleText }) => {
      const stub = {
        runtime: {
          sendMessage: async () => ({ ok: true }),
          sendNativeMessage: async (_app: string, m: { type?: string; prompt?: string }) => {
            // Apple's on-device model (src/providers/apple.ts), answered by the "native app".
            if (m?.type === "ai.apple.status") return apple ? { ok: true, available: true } : { ok: true, available: false, reason: "device_not_eligible" };
            if (m?.type === "ai.apple.generate") {
              const g = globalThis as unknown as { __applePrompts?: string[] };
              (g.__applePrompts ??= []).push(m.prompt ?? "");
              return { ok: true, text: appleText };
            }
            return key ? { ok: true, value: key } : { ok: true };
          },
          onMessage: { addListener() {} },
        },
        // Sharing with the provider already allowed (consent.spec.ts covers asking).
        storage: { local: { get: async (k: string | string[]) => (([] as string[]).concat(k).includes("aiConsent") ? { aiConsent: { anthropic: { at: 1, version: 3 }, openai: { at: 1, version: 3 } } } : {}), set: async () => undefined, clear: async () => undefined } },
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
    { key: opts.key, pageData: PAGE, apple: opts.apple === true, appleText: opts.appleText ?? "On device: the widget costs $10." },
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

// Owner's choice 2026-10-25: no key needed where Apple Intelligence is available.
test("no key with Apple Intelligence: chat answers on the device and nothing goes to a provider", async ({ page }) => {
  const { bodies } = await openPopup(page, { key: null, apple: true });
  await expect(page.getByRole("heading", { name: "Add your API key to start" })).toBeHidden();
  await expect(page.getByRole("button", { name: /Apple · on device/ })).toBeVisible();
  await page.getByLabel("Ask about this page").fill("How much is the widget?");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByRole("log", { name: "Conversation" }).getByText("On device: the widget costs $10.")).toBeVisible();
  expect(bodies).toHaveLength(0);
  const prompts = await page.evaluate(() => (globalThis as unknown as { __applePrompts: string[] }).__applePrompts);
  expect(prompts[0]).toContain("Widget costs $10.");
  expect(prompts[0]).toContain("How much is the widget?");
});

// Owner, 2026-10-27: with a key saved, Apple's model still answers first and the key is the fallback.
test("key and Apple Intelligence: Apple answers first and nothing goes to the provider", async ({ page }) => {
  const { bodies } = await openPopup(page, { key: "sk-test-synthetic", apple: true });
  await expect(page.getByRole("button", { name: /^Apple \+ / })).toBeVisible();
  await page.getByLabel("Ask about this page").fill("How much is the widget?");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByRole("log", { name: "Conversation" }).getByText("On device: the widget costs $10.")).toBeVisible();
  expect(bodies).toHaveLength(0);
});

test("key and Apple Intelligence: when Apple can't answer, the key's model does", async ({ page }) => {
  const { bodies } = await openPopup(page, { key: "sk-test-synthetic", apple: true, appleText: "I'm sorry, but I can't help with that." });
  await page.getByLabel("Ask about this page").fill("How much is the widget?");
  await page.getByRole("button", { name: "Send" }).click();
  const log = page.getByRole("log", { name: "Conversation" });
  await expect(log.getByText("with free shipping.")).toBeVisible();
  await expect(log.getByText("I'm sorry, but I can't help with that.")).toBeHidden();
  expect(bodies).toHaveLength(1);
});

// Owner, 2026-10-28: a button under Apple's answer asks the key's model instead, in its place.
test("key and Apple Intelligence: Ask Claude under Apple's answer replaces it with the key's answer", async ({ page }) => {
  const { bodies } = await openPopup(page, { key: "sk-test-synthetic", apple: true });
  await page.getByLabel("Ask about this page").fill("How much is the widget?");
  await page.getByRole("button", { name: "Send" }).click();
  const log = page.getByRole("log", { name: "Conversation" });
  await expect(log.getByText("On device: the widget costs $10.")).toBeVisible();
  const askKey = log.getByRole("button", { name: "Ask Claude" });
  await expect(askKey).toBeVisible();
  await askKey.click();
  await expect(log.getByText("with free shipping.")).toBeVisible();
  await expect(log.getByText("On device: the widget costs $10.")).toBeHidden();
  await expect(log.getByRole("button", { name: "Ask Claude" })).toBeHidden();
  // Asked once, with Apple's answer left out of the history it sends.
  expect(bodies).toHaveLength(1);
  expect(bodies[0]).not.toContain("On device");
  await expect(log.getByText("How much is the widget?")).toHaveCount(1);
});

test("no key with Apple Intelligence: Find coupons explains it needs a key", async ({ page }) => {
  await openPopup(page, { key: null, apple: true });
  await page.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("button", { name: "Find coupons" }).click();
  const log = page.getByRole("log", { name: "Conversation" });
  await expect(log.getByText("Find coupons needs an API key.")).toBeVisible();
  await expect(log.getByRole("button", { name: "Add API key" })).toBeVisible();
});

test("no key and no Apple Intelligence: says why and asks for a key", async ({ page }) => {
  await openPopup(page, { key: null });
  await expect(page.getByRole("heading", { name: "Add your API key to start" })).toBeVisible();
  await expect(page.getByText("This device doesn't support Apple Intelligence.")).toBeVisible();
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
  // Plain-English steps (owner, 2026-11-08): reading the page, then the model's turn.
  const step = log.locator(".msg.assistant .thinking .step.now");
  await expect(step).toHaveText("Reading the page…");
  await expect(step).toHaveText("Thinking it through…");
  await expect(log.locator(".msg.assistant .thinking")).toHaveAttribute("aria-live", "polite");
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
  // A small scroll up near the bottom (scrollbar drag, end of a touch drag) is not snapped back.
  await thread.evaluate((t) => (t.scrollTop -= 10));
  const nudged = await thread.evaluate((t) => t.scrollTop);
  await page.waitForTimeout(300);
  expect(await thread.evaluate((t) => t.scrollTop)).toBe(nudged);
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

// UX plan (2026-10-25, peak-end): an error offers the way forward first.
test("a failed answer offers Try again, which asks again once", async ({ page }) => {
  await openPopup(page, { key: "sk-test-synthetic" });
  await page.unroute("https://api.anthropic.com/**");
  let calls = 0;
  await page.route("https://api.anthropic.com/**", async (r) => {
    calls += 1;
    if (calls === 1) await r.fulfill({ status: 529, body: "{}" });
    else await r.fulfill({ status: 200, contentType: "text/event-stream", body: ANSWER });
  });
  await page.getByLabel("Ask about this page").fill("How much is the widget?");
  await page.getByRole("button", { name: "Send" }).click();
  const log = page.getByRole("log", { name: "Conversation" });
  await expect(log.getByRole("button", { name: "Copy diagnostics" })).toBeVisible();
  await log.getByRole("button", { name: "Try again" }).click();
  await expect(log.getByText("with free shipping.")).toBeVisible();
  await expect(log.locator(".msg.error")).toHaveCount(0);
  await expect(log.locator(".msg.user")).toHaveCount(1);
});

test("a rejected key offers Open Settings instead of Try again", async ({ page }) => {
  await openPopup(page, { key: "sk-test-synthetic" });
  await page.unroute("https://api.anthropic.com/**");
  await page.route("https://api.anthropic.com/**", (r) => r.fulfill({ status: 401, body: "{}" }));
  await page.getByLabel("Ask about this page").fill("Hi");
  await page.getByRole("button", { name: "Send" }).click();
  const log = page.getByRole("log", { name: "Conversation" });
  await expect(log.getByRole("button", { name: "Try again" })).toHaveCount(0);
  await log.getByRole("button", { name: "Open Settings" }).click();
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
});

test("no key: says it is the last step", async ({ page }) => {
  await openPopup(page, { key: null });
  await expect(page.getByText("Last step · 2 of 3 done")).toBeVisible();
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
          get: async () => ({ settings: { provider: "openai", model: "gpt-5", retention: "7" }, aiConsent: { anthropic: { at: 1, version: 3 } } }),
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

// Owner request 2026-11-02: paste images into Scout and have Claude read them.
async function pasteImage(page: Page, width: number, height: number): Promise<void> {
  await page.getByLabel("Ask about this page").evaluate(async (el, size) => {
    const c = document.createElement("canvas");
    c.width = size.width;
    c.height = size.height;
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "#3a7";
    ctx.fillRect(0, 0, size.width, size.height);
    const blob = await new Promise<Blob>((r) => c.toBlob((b) => r(b!), "image/png"));
    const dt = new DataTransfer();
    dt.items.add(new File([blob], "shot.png", { type: "image/png" }));
    el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
  }, { width, height });
}

function pngWidth(base64: string): number {
  const b = atob(base64);
  return ((b.charCodeAt(16) << 24) | (b.charCodeAt(17) << 16) | (b.charCodeAt(18) << 8) | b.charCodeAt(19)) >>> 0;
}

test("a pasted image shows as a thumbnail, can be removed, and goes to the provider scaled down", async ({ page }) => {
  const { bodies } = await openPopup(page, { key: "sk-test-synthetic" });
  await pasteImage(page, 3000, 2000);
  const tray = page.getByRole("group", { name: "Attached images" });
  await expect(tray.locator("img")).toHaveCount(1);
  await pasteImage(page, 400, 300);
  await expect(tray.locator("img")).toHaveCount(2);
  await tray.getByRole("button", { name: "Remove image 2" }).click();
  await expect(tray.locator("img")).toHaveCount(1);

  // Images alone send a default question.
  await page.getByRole("button", { name: "Send" }).click();
  const log = page.getByRole("log", { name: "Conversation" });
  await expect(log.getByText("with free shipping.")).toBeVisible();
  await expect(log.locator(".msg.user .msg-images img")).toHaveCount(1);
  await expect(tray).toBeHidden();
  expect(bodies).toHaveLength(1);
  const body = JSON.parse(bodies[0]!) as { messages: Array<{ role: string; content: unknown }> };
  const last = body.messages[body.messages.length - 1]!.content as Array<Record<string, any>>;
  expect(last[0]).toMatchObject({ type: "text" });
  expect(String(last[0]!.text)).toContain("What's in this image?");
  // An image question is not a page question: the page text stays out.
  expect(String(last[0]!.text)).not.toContain("Widget costs $10.");
  expect(last[1]).toMatchObject({ type: "image", source: { type: "base64", media_type: "image/png" } });
  expect(pngWidth(last[1]!.source.data)).toBe(1568);

  // A follow-up carries a note, not the image again.
  await page.getByLabel("Ask about this page").fill("What color is it?");
  await page.getByRole("button", { name: "Send" }).click();
  await expect.poll(() => bodies.length).toBe(2);
  const second = JSON.parse(bodies[1]!) as { messages: Array<{ role: string; content: unknown }> };
  expect(second.messages[0]!.content).toBe("What's in this image?\n\n[1 image was attached to this message.]");
  expect(bodies[1]).not.toContain('"type":"image"');
});

test("Add image in the + menu picks a file", async ({ page }) => {
  await openPopup(page, { key: "sk-test-synthetic" });
  await page.getByRole("button", { name: "More actions" }).click();
  await expect(page.getByRole("button", { name: "Add image" })).toBeVisible();
  await page.locator("#img-pick").setInputFiles("src/icons/toolbar-128.png");
  await expect(page.getByRole("group", { name: "Attached images" }).locator("img")).toHaveCount(1);
});

test("no key with Apple Intelligence: an image question says it needs a key and sends nothing", async ({ page }) => {
  const { bodies } = await openPopup(page, { key: null, apple: true });
  await pasteImage(page, 200, 200);
  await page.getByLabel("Ask about this page").fill("What is this?");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText("Reading images needs an API key.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Add API key" })).toBeVisible();
  expect(bodies).toHaveLength(0);
  // The image stays, ready once a key is added.
  await expect(page.getByRole("group", { name: "Attached images" }).locator("img")).toHaveCount(1);
});

test("key and Apple Intelligence: an image question skips Apple and goes to the key's model", async ({ page }) => {
  const { bodies } = await openPopup(page, { key: "sk-test-synthetic", apple: true });
  await pasteImage(page, 200, 200);
  await page.getByLabel("Ask about this page").fill("What is this?");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText("with free shipping.")).toBeVisible();
  expect(bodies).toHaveLength(1);
  expect(await page.evaluate(() => (globalThis as unknown as { __applePrompts?: string[] }).__applePrompts ?? [])).toEqual([]);
});
