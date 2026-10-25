import { expect, test, type Page } from "@playwright/test";
import { withWorker } from "./worker";

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

async function openPopup(page: Page, opts: { keys?: Record<string, string>; data?: Record<string, unknown>; pageData?: typeof PAGE & { favIconUrl?: string }; path?: string } = {}): Promise<void> {
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
        tabs: {
          query: async () => [{ id: 1, url: pageData.url, title: pageData.title, active: true, favIconUrl: (pageData as { favIconUrl?: string }).favIconUrl }],
          create: async (p: { url: string }) => {
            g.__created = [...((g.__created as string[] | undefined) ?? []), p.url];
            return { id: 2, url: p.url };
          },
        },
        permissions: { request: async () => true, getAll: async () => ({ origins: [] }), remove: async () => true },
        scripting: { executeScript: async () => { g.__reads = ((g.__reads as number | undefined) ?? 0) + 1; return [{ result: pageData }]; } },
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
    // Sharing with the providers already allowed (consent.spec.ts covers asking).
    { keys: opts.keys ?? {}, data: { aiConsent: { anthropic: { at: 1, version: 2 }, openai: { at: 1, version: 2 } }, ...(opts.data ?? {}) }, pageData: opts.pageData ?? PAGE },
  );
  await page.route("**/popup.html*", (r) => r.fulfill({ path: "apple/Extension/Resources/popup.html", contentType: "text/html" }));
  await page.route("**/popup.js", (r) => r.fulfill({ path: "apple/Extension/Resources/popup.js", contentType: "text/javascript" }));
  await page.route("**/icons/**", (r) => r.fulfill({ status: 200, contentType: "image/png", body: "" }));
  await page.route("https://api.anthropic.com/v1/models**", (r) =>
    r.fulfill({ status: r.request().headers()["x-api-key"] === GOOD_KEY ? 200 : 401, body: "{}" }),
  );
  await page.route("https://api.anthropic.com/v1/messages", (r) =>
    r.fulfill({ status: 200, contentType: "text/event-stream", body: sse("The widget costs **$10**.") }),
  );
  await withWorker(page);
  await page.goto(opts.path ?? "/popup.html");
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

  // The first key is the end of setup: Scout goes back to the chat and says the key works (UX plan, 2026-10-25).
  await expect(page.getByLabel("Ask about this page")).toBeVisible();
  await expect(page.getByText("Your key works.")).toBeVisible();
  await expect(page.getByRole("list", { name: "Suggestions" })).toBeVisible();
  // No "Ready. Using …" line: the line under the conversation is only for cost.
  await expect(page.locator("#status")).toHaveText("");
  await page.getByRole("button", { name: "Summarize this page" }).click();
  await expect(page.getByText("Your key works.")).toBeHidden();
});

test("Scout mode shows a bold chip and switches the send action", async ({ page }) => {
  await openPopup(page, { keys: { anthropic: GOOD_KEY } });
  await expect(page.locator("#mode-chip")).toBeHidden();
  await page.getByRole("radio", { name: "Scout" }).check();
  await expect(page.locator("#mode-chip")).toBeVisible();
  await expect(page.locator("#mode-chip span")).toHaveText("Scout mode");
  expect(await page.locator("#mode-chip").evaluate((n) => getComputedStyle(n).fontWeight)).toBe("700");
  // No color, like the mode switch icons (owner item 11): the chip and its icon use the plain text color.
  const colors = await page.locator("#mode-chip").evaluate((n) => [getComputedStyle(n).color, getComputedStyle(document.body).color, getComputedStyle(n.querySelector("svg")!).stroke]);
  expect(colors[0]).toBe(colors[1]);
  expect(colors[2]).toBe(colors[0]);
  await expect(page.getByRole("button", { name: "Start task" })).toBeVisible();
  await expect(page.getByLabel("Ask about this page")).toHaveAttribute("placeholder", "Tell Scout what to do");
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
  // One cost line for the run: 20 tokens in, 5 out on Claude Sonnet 5.5.
  await expect(page.locator("#status")).toHaveText("Cost: <$0.0001");

  await page.reload();
  const log = page.getByRole("log");
  await expect(log.getByText("How much is the widget?")).toBeVisible();
  await expect(log.getByText("The widget costs")).toBeVisible();

  await page.getByRole("button", { name: "New chat" }).click();
  await expect(log.getByText("How much is the widget?")).toHaveCount(0);
  await expect(page.getByRole("list", { name: "Suggestions" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("log").getByText("How much is the widget?")).toHaveCount(0);
});

test("on a shopping site the composer lists store actions with the store's icon above the field, until the chat starts", async ({ page }) => {
  await openPopup(page, {
    keys: { anthropic: GOOD_KEY },
    pageData: { url: "https://www.amazon.com/dp/B000TEST", title: "Synthetic widget", text: "Widget costs $10. 4.5 stars from 12 reviews." },
  });
  const list = page.getByRole("list", { name: "Suggestions for Amazon" });
  await expect(list).toBeVisible();
  await expect(list.getByRole("button")).toHaveText(["Compare prices across sites", "Find similar products", "Summarize product reviews"]);
  // Inside the composer box, above the question field.
  await expect(page.locator(".composer-box > #site-suggestions")).toHaveCount(1);
  const listBox = await list.boundingBox();
  const fieldBox = await page.getByLabel("Ask about this page").boundingBox();
  expect(listBox!.y + listBox!.height).toBeLessThanOrEqual(fieldBox!.y);
  // The icon stub serves an empty image, so each row falls back to the letter tile.
  await expect(list.locator(".site-icon.tile")).toHaveCount(3);
  await expect(list.locator(".site-icon.tile").first()).toHaveAttribute("data-letter", "A");
  await expect(page.getByRole("button", { name: "Explain the key points" })).toBeHidden();

  await list.getByRole("button", { name: "Summarize product reviews" }).click();
  await expect(page.getByRole("log").getByText("Summarize the customer reviews for the product on this page")).toBeVisible();
  await expect(page.getByRole("log").getByText("The widget costs")).toBeVisible();
  await expect(list).toBeHidden();
});

test("the store's own icon shows when it loads", async ({ page }) => {
  // Safari's favicon for the tab (this sandbox's browser cannot reach real store hosts, even routed).
  await page.route("https://icons.test/target.png", (r) => r.fulfill({ status: 200, contentType: "image/png", path: "src/icons/icon-128.png" }));
  await openPopup(page, {
    keys: { anthropic: GOOD_KEY },
    pageData: { url: "https://www.target.com/p/widget", title: "Widget", text: "Widget $10.", favIconUrl: "https://icons.test/target.png" },
  });
  const list = page.getByRole("list", { name: "Suggestions for Target" });
  await expect(list.locator("img.site-icon")).toHaveCount(3);
  await expect(list.locator("img.site-icon").first()).toHaveAttribute("src", "https://icons.test/target.png");
  await expect(list.locator(".site-icon.tile")).toHaveCount(0);
});

test("a page that is not a known store keeps the starters", async ({ page }) => {
  await openPopup(page, { keys: { anthropic: GOOD_KEY } });
  await expect(page.getByRole("button", { name: "Explain the key points" })).toBeVisible();
  await expect(page.locator("#site-suggestions")).toBeHidden();
});

test("the + menu opens by keyboard, Escape closes it and returns focus", async ({ page }) => {
  await openPopup(page, { keys: { anthropic: GOOD_KEY } });
  const plus = page.getByRole("button", { name: "More actions" });
  await plus.focus();
  await page.keyboard.press("Enter");
  await expect(plus).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByRole("button", { name: "Find coupons" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Find coupons" })).toBeHidden();
  await expect(plus).toBeFocused();
  await expect(plus).toHaveAttribute("aria-expanded", "false");
});

const savedSettings = (page: Page) =>
  page.evaluate(() => (globalThis as unknown as { __fake: { data: { settings: unknown } } }).__fake.data.settings);

test("the model pill opens the Models sheet: picking a model or effort saves it and Settings stays closed", async ({ page }) => {
  await openPopup(page, { keys: { anthropic: GOOD_KEY } });
  const pill = page.locator("#model-pill");
  // Default for a new install: Haiku 5.5 at High.
  await expect(pill).toHaveText("Haiku 5.5");
  await expect(pill).toHaveAttribute("aria-label", "Haiku 5.5, High effort, change model or effort");
  await expect(pill).toHaveAttribute("aria-haspopup", "dialog");
  await pill.click();
  const sheet = page.getByRole("dialog", { name: "Models" });
  await expect(sheet).toBeVisible();
  await expect(pill).toHaveAttribute("aria-expanded", "true");
  const models = sheet.getByRole("radiogroup", { name: "Models" });
  const haiku = models.getByRole("radio", { name: "Claude Haiku 5.5" });
  await expect(haiku).toHaveAttribute("aria-checked", "true");
  await expect(haiku).toBeFocused();
  // Only the provider with a saved key is listed.
  await expect(models.getByRole("radio", { name: "GPT-5" })).toHaveCount(0);
  await expect(sheet.locator("#model-menu-note")).toHaveText("Showing models for your Anthropic API key. Add keys in Settings.");
  // The sheet covers the panel.
  const box = (await sheet.boundingBox())!;
  expect(box.y).toBe(0);
  expect(box.height).toBeGreaterThan(500);

  await models.getByRole("radio", { name: "Claude Opus 5.5" }).click();
  await expect(sheet).toBeHidden();
  await expect(page.locator("#settings-view")).toBeHidden();
  await expect(pill).toBeFocused();
  await expect(pill).toHaveText("Opus 5.5");
  await expect(pill).toHaveAttribute("aria-label", "Opus 5.5, High effort, change model or effort");
  await expect(page.locator("#status")).toHaveText("");
  await expect.poll(() => savedSettings(page)).toMatchObject({ provider: "anthropic", model: "claude-opus-5-5", effort: "high" });

  await pill.click();
  await sheet.getByRole("radiogroup", { name: "Effort levels" }).getByRole("radio", { name: "Low", exact: true }).click();
  await expect(pill).toHaveText("Opus 5.5");
  await expect(pill).toHaveAttribute("aria-label", "Opus 5.5, Low effort, change model or effort");
  await expect.poll(() => savedSettings(page)).toMatchObject({ model: "claude-opus-5-5", effort: "low" });

  // Close changes nothing.
  await pill.click();
  await sheet.getByRole("button", { name: "Close" }).click();
  await expect(sheet).toBeHidden();
  await expect(pill).toHaveAttribute("aria-expanded", "false");
  await expect.poll(() => savedSettings(page)).toMatchObject({ model: "claude-opus-5-5", effort: "low" });
});

test("the Models sheet lists every provider with a saved key, and picking another provider's model switches to it", async ({ page }) => {
  await openPopup(page, { keys: { anthropic: GOOD_KEY, openai: "sk-test-synthetic-openai" } });
  await page.locator("#model-pill").click();
  const models = page.getByRole("dialog", { name: "Models" }).getByRole("radiogroup", { name: "Models" });
  await expect(models.getByRole("radio", { name: "Claude Haiku 5.5" })).toBeVisible();
  await expect(page.locator("#model-menu-note")).toHaveText("Showing models for your Anthropic and OpenAI API keys. Add keys in Settings.");
  await models.getByRole("radio", { name: "GPT-5" }).click();
  await expect(page.locator("#model-pill")).toHaveText("GPT-5");
  await expect(page.locator("#model-pill")).toHaveAttribute("aria-label", "GPT-5, High effort, change model or effort");
  await expect.poll(() => savedSettings(page)).toMatchObject({ provider: "openai", model: "gpt-5", effort: "high" });
});

test("the Models sheet works by keyboard: arrows move, Enter picks, Escape closes and returns focus", async ({ page }) => {
  await openPopup(page, { keys: { anthropic: GOOD_KEY } });
  const pill = page.locator("#model-pill");
  const sheet = page.getByRole("dialog", { name: "Models" });
  await pill.focus();
  await page.keyboard.press("ArrowDown");
  await expect(sheet.getByRole("radio", { name: "Claude Haiku 5.5" })).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(sheet.getByRole("radio", { name: "Claude Fable 5.1" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
  await expect(pill).toBeFocused();
  await expect.poll(() => savedSettings(page)).toBeUndefined();

  await page.keyboard.press("Enter");
  await expect(sheet).toBeVisible();
  await page.keyboard.press("End");
  await expect(sheet.getByRole("radio", { name: "Max" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(sheet).toBeHidden();
  await expect(pill).toHaveText("Haiku 5.5");
  await expect(pill).toHaveAttribute("aria-label", "Haiku 5.5, Max effort, change model or effort");
  await expect.poll(() => savedSettings(page)).toMatchObject({ model: "claude-haiku-5-5", effort: "max" });
});

test("the mode switch stays on one line beside the model pill when the popup first opens", async ({ page }) => {
  await openPopup(page, {
    keys: { anthropic: GOOD_KEY },
    data: { settings: { provider: "anthropic", model: "claude-opus-5-5", effort: "medium", retention: "7" }, modelMigration: "haiku-5-5-high" },
  });
  await expect(page.locator("#model-pill")).toHaveText("Opus 5.5");
  await expect(page.locator("#model-pill")).toHaveAttribute("aria-label", "Opus 5.5, Medium effort, change model or effort");
  for (const label of await page.locator(".composer-foot fieldset.segmented label").all()) {
    expect((await label.boundingBox())!.height).toBeLessThanOrEqual(30);
  }
  expect(await page.locator(".composer-foot").evaluate((n) => n.scrollWidth - n.clientWidth)).toBe(0);
});

test("Settings and Back keep focus where the user expects", async ({ page }) => {
  await openPopup(page, { keys: { anthropic: GOOD_KEY } });
  await page.getByRole("button", { name: "Settings" }).click();
  await expect(page.getByRole("heading", { name: "Settings" })).toBeFocused();
  await expect(page.locator("#key-status")).toHaveText("Anthropic key saved in your Keychain.");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Settings" })).toBeFocused();
  await expect(page.getByRole("list", { name: "Suggestions" })).toBeVisible();
});

test("only the selected mode is highlighted", async ({ page }) => {
  await openPopup(page, { keys: { anthropic: GOOD_KEY } });
  const chatLabel = page.locator("fieldset.segmented label", { hasText: "Chat" }).first();
  const controlLabel = page.locator("fieldset.segmented label", { hasText: "Scout" });
  await expect(chatLabel).toHaveClass(/\bon\b/);
  await expect(controlLabel).not.toHaveClass(/\bon\b/);
  await page.getByRole("radio", { name: "Scout" }).check();
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
  await page.getByRole("radio", { name: "Scout" }).check();
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

test("Open in new tab: the header button opens Scout as its own page, which hides page-only actions and reads no page", async ({ page }) => {
  await openPopup(page, { keys: { anthropic: GOOD_KEY } });
  const header = page.locator("#chat-view > header");
  const open = header.getByRole("button", { name: "Open Scout in a new tab" });
  await expect(open).toBeVisible();
  await page.evaluate(() => ((globalThis as unknown as { close: () => void }).close = () => undefined));
  await open.click();
  await expect.poll(() => page.evaluate(() => (globalThis as unknown as { __created?: string[] }).__created)).toEqual([new URL("/popup.html?view=page", page.url()).href]);

  await openPopup(page, { keys: { anthropic: GOOD_KEY }, path: "/popup.html?view=page" });
  await expect(page.getByRole("heading", { name: "Scout AI Assistant" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Open Scout in a new tab" })).toBeHidden();
  await expect(page.getByRole("button", { name: "New chat" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Settings" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Summarize this page" })).toBeHidden();
  await expect(page.getByRole("button", { name: "More actions" })).toBeHidden();
  await expect(page.getByRole("radio", { name: "Scout" })).toBeHidden();

  await page.getByRole("textbox").fill("What is 2 + 2?");
  await page.keyboard.press("Enter");
  await expect(page.getByText("The widget costs")).toBeVisible();
  await expect(page.getByText("Could not read this page")).toHaveCount(0);
  expect(await page.evaluate(() => (globalThis as unknown as { __reads?: number }).__reads ?? 0)).toBe(0);
});

test.describe("touch device", () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 393, height: 760 } });
  test("Open in new tab is Mac only: no button on iPhone", async ({ page }) => {
    await openPopup(page, { keys: { anthropic: GOOD_KEY } });
    await expect(page.getByRole("button", { name: "New chat" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Open Scout in a new tab" })).toBeHidden();
  });

  test("Summarize, Explain and the question box stay pinned to the bottom as the sheet changes height (owner 2026-10-18)", async ({ page }) => {
    await openPopup(page, { keys: { anthropic: GOOD_KEY } });
    const starters = page.locator("#composer > #starters");
    await expect(starters).toBeVisible();
    await expect(page.locator("#composer")).toHaveCSS("position", "fixed");
    const fromBottom = async (): Promise<number> =>
      page.evaluate(() => innerHeight - document.querySelector("#starters")!.getBoundingClientRect().bottom);
    const before = await fromBottom();
    for (const height of [420, 700, 520]) {
      await page.setViewportSize({ width: 393, height });
      expect(await fromBottom()).toBe(before);
    }
    // Typing: back in the page flow, where the keyboard fit sizes the panel.
    await page.getByRole("textbox", { name: /Ask about this page/ }).focus();
    await expect(page.locator("#composer")).toHaveCSS("position", "relative");
    await page.getByRole("textbox", { name: /Ask about this page/ }).fill("What does it cost?");
    await page.keyboard.press("Enter");
    await expect(page.getByText("The widget costs")).toBeVisible();
    await expect(starters).toBeHidden();
  });
  test("Find coupons opens right above the + button, not above Summarize / Explain (owner 2026-10-18)", async ({ page }) => {
    await openPopup(page, { keys: { anthropic: GOOD_KEY } });
    await expect(page.locator("#composer > #starters")).toBeVisible();
    await page.getByRole("button", { name: "More actions" }).tap();
    const menu = page.locator("#plus-menu");
    await expect(menu).toBeVisible();
    const [m, box, plus, starters] = await Promise.all(
      ["#plus-menu", ".composer-box", "#plus", "#starters"].map((s) => page.locator(s).boundingBox()),
    );
    // Just above the question box, starting at its left edge by the + button.
    expect(box!.y - (m!.y + m!.height)).toBeGreaterThanOrEqual(0);
    expect(box!.y - (m!.y + m!.height)).toBeLessThanOrEqual(10);
    expect(Math.abs(m!.x - box!.x)).toBeLessThanOrEqual(2);
    expect(m!.x).toBeLessThanOrEqual(plus!.x);
    // It covers the starters rather than floating over the empty-chat logo above them.
    expect(m!.y + m!.height).toBeGreaterThan(starters!.y);
    await page.getByRole("button", { name: "Find coupons" }).tap();
    await expect(menu).toBeHidden();
    // Tapping it starts the coupon search (the run itself is covered in coupons.spec.ts).
    await expect(page.getByRole("log").getByText("Find the best coupon for this cart.")).toBeVisible();
  });
});
