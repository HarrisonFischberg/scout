import { expect, test, type Page } from "@playwright/test";
import { withWorker } from "./worker";

// Loads the built popup (run `npm run build` first) with a stubbed `browser`
// namespace. Storage, Keychain, and permissions are in-memory fakes exposed on
// `window.__fake` so the test can assert what was deleted. No live API call.
async function openPopup(page: Page, os?: string): Promise<void> {
  await page.addInitScript((os) => {
    const data: Record<string, unknown> = {
      settings: { provider: "anthropic", model: "claude-sonnet-5-5", retention: "7" },
      // A choice made after the one-time switch to Haiku 5.5 High, so it is kept.
      modelMigration: "haiku-5-5-high",
      history: [{ at: Date.now(), question: "hi", answer: "hello" }],
      // Sharing with the providers already allowed (consent.spec.ts covers asking).
      aiConsent: { anthropic: { at: 1, version: 2 }, openai: { at: 1, version: 2 } },
    };
    const keys: Record<string, string> = { anthropic: "sk-test-synthetic" };
    let origins = ["https://shop.test/*", "https://api.anthropic.com/*"];
    const fake = { data, keys, get origins() { return origins; } };
    const stub = {
      runtime: {
        sendMessage: async () => ({ ok: true }),
        sendNativeMessage: async (_app: string, m: { type: string; account: string }) => {
          if (m.type === "keychain.get") return keys[m.account] ? { ok: true, value: keys[m.account] } : { ok: true };
          if (m.type === "keychain.delete") {
            delete keys[m.account];
            return { ok: true };
          }
          return { ok: true };
        },
        onMessage: { addListener() {} },
        ...(os ? { getPlatformInfo: async () => ({ os }) } : {}),
      },
      tabs: { query: async () => [] },
      permissions: {
        request: async () => true,
        getAll: async () => ({ origins }),
        remove: async (p: { origins: string[] }) => {
          origins = origins.filter((o) => !p.origins.includes(o));
          return true;
        },
      },
      scripting: { executeScript: async () => [] },
      storage: {
        local: {
          get: async (k: string | string[]) => {
            const list = Array.isArray(k) ? k : [k];
            return Object.fromEntries(list.filter((x) => x in data).map((x) => [x, data[x]]));
          },
          set: async (items: Record<string, unknown>) => void Object.assign(data, items),
          clear: async () => {
            for (const k of Object.keys(data)) delete data[k];
          },
        },
      },
    };
    (globalThis as unknown as { browser: unknown; __fake: unknown }).browser = stub;
    (globalThis as unknown as { __fake: unknown }).__fake = fake;
  }, os);
  await page.route("**/popup.html", (r) => r.fulfill({ path: "apple/Extension/Resources/popup.html", contentType: "text/html" }));
  await page.route("**/popup.js", (r) => r.fulfill({ path: "apple/Extension/Resources/popup.js", contentType: "text/javascript" }));
  // No live provider calls. A test can register its own model list after this.
  await page.route("https://api.anthropic.com/**", (r) => r.fulfill({ status: 401, body: "{}" }));
  await page.route("https://api.openai.com/**", (r) => r.fulfill({ status: 401, body: "{}" }));
  await withWorker(page);
  await page.goto("/popup.html");
}

const savedSettings = (page: Page) =>
  page.evaluate(() => (globalThis as unknown as { __fake: { data: { settings: unknown } } }).__fake.data.settings);

test("settings save as you change them and persist provider, model, and retention", async ({ page }) => {
  await openPopup(page);
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("radio", { name: "OpenAI" }).check();
  // No OpenAI key saved: the built-in list, plus "Other model ID…".
  await expect(page.getByLabel("Model", { exact: true })).toHaveValue("gpt-5");
  await expect(page.locator("#model-help")).toContainText("Save your OpenAI key");
  await page.getByLabel("Model", { exact: true }).selectOption({ label: "Other model ID…" });
  await page.getByLabel("Model ID").fill("gpt-test-model");
  await page.getByLabel("Model ID").press("Tab");
  await expect(page.getByLabel("Model", { exact: true })).toHaveValue("gpt-test-model");
  await expect(page.getByLabel("Effort", { exact: true })).toBeDisabled();
  await page.getByLabel("Keep chat history").selectOption("30");
  await expect(page.locator("#settings-saved")).toHaveText("Saved.");
  await expect.poll(() => savedSettings(page)).toEqual({ provider: "openai", model: "gpt-test-model", effort: "default", retention: "30" });
});

test("model and effort dropdowns list the key's models and save the effort", async ({ page }) => {
  await openPopup(page);
  // Synthetic model list in the shape of Anthropic's GET /v1/models.
  await page.route("https://api.anthropic.com/v1/models**", (r) =>
    r.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: [
          {
            id: "claude-opus-5-5",
            display_name: "Claude Opus 5.5",
            capabilities: { effort: { supported: true, low: { supported: true }, medium: { supported: true }, high: { supported: true }, xhigh: { supported: true }, max: { supported: true } } },
          },
          { id: "claude-sonnet-5-5", display_name: "Claude Sonnet 5.5", capabilities: { effort: { supported: true, low: { supported: true }, medium: { supported: true }, high: { supported: true } } } },
          { id: "claude-old-4", display_name: "Claude Old 4", capabilities: { effort: { supported: false } } },
        ],
        has_more: false,
      }),
    }),
  );
  await page.getByRole("button", { name: "Settings" }).click();
  await expect(page.locator("#model-help")).toHaveText("Models your Anthropic key can use.");
  const model = page.getByLabel("Model", { exact: true });
  const effort = page.getByLabel("Effort", { exact: true });
  await expect(model.locator("option")).toHaveText(["Claude Opus 5.5", "Claude Sonnet 5.5", "Claude Old 4", "Other model ID…"]);
  await expect(effort.locator("option")).toHaveText(["Default (model decides)", "Low", "Medium", "High"]);
  await model.selectOption("claude-opus-5-5");
  await effort.selectOption("max");
  await expect.poll(() => savedSettings(page)).toEqual({ provider: "anthropic", model: "claude-opus-5-5", effort: "max", retention: "7" });
  await page.getByRole("button", { name: "Back to chat" }).click();
  await expect(page.locator("#model-pill")).toHaveText("Opus 5.5");
  await expect(page.locator("#model-pill")).toHaveAttribute("aria-label", "Opus 5.5, Max effort, change model or effort");
  // A model without effort control resets the effort to Default.
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByLabel("Model", { exact: true }).selectOption("claude-old-4");
  await expect(effort).toBeDisabled();
  await expect(page.locator("#effort-help")).toHaveText("This model has no effort setting.");
  await expect.poll(() => savedSettings(page)).toEqual({ provider: "anthropic", model: "claude-old-4", effort: "default", retention: "7" });
});

test("site access lists granted origins and can remove one", async ({ page }) => {
  await openPopup(page);
  await page.getByRole("button", { name: "Settings" }).click();
  await expect(page.getByText("https://shop.test/*")).toBeVisible();
  await expect(page.getByText("api.anthropic.com")).toHaveCount(0);
  await page.getByRole("button", { name: "Remove access to https://shop.test/*" }).click();
  await expect(page.getByText("No sites granted.")).toBeVisible();
});

test("Delete all data needs a confirm, then clears storage, Keychain, and site access", async ({ page }) => {
  await openPopup(page);
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("button", { name: "Delete all data" }).click();
  await page.getByRole("button", { name: "Cancel" }).click();
  const untouched = await page.evaluate(() => Object.keys((globalThis as unknown as { __fake: { data: object } }).__fake.data));
  expect(untouched).toContain("settings");
  expect(untouched).toContain("aiConsent");
  await page.getByRole("button", { name: "Delete all data" }).click();
  await page.getByRole("button", { name: "Yes, delete all data" }).click();
  await expect(page.locator("#delete-result")).toHaveText("Deleted your API keys, settings, and history from this device.");
  const after = await page.evaluate(() => {
    const f = (globalThis as unknown as { __fake: { data: object; keys: object; origins: string[] } }).__fake;
    return { data: Object.keys(f.data), keys: Object.keys(f.keys), origins: f.origins };
  });
  expect(after.data).toEqual([]);
  expect(after.keys).toEqual([]);
  // Permission to share with AI providers goes too, so the next request asks again.
  await expect(page.locator("#consent-list")).toContainText("Anthropic: not allowed");
  await expect(page.locator("#consent-list")).toContainText("OpenAI: not allowed");
  expect(after.origins).toEqual(["https://api.anthropic.com/*"]);
});

test("legal drafts open from settings by keyboard and are marked DRAFT", async ({ page, context }) => {
  await openPopup(page);
  // The links open new tabs, so route on the context, not the popup page.
  await context.route("**/privacy.html", (r) => r.fulfill({ path: "apple/Extension/Resources/privacy.html", contentType: "text/html" }));
  await context.route("**/terms.html", (r) => r.fulfill({ path: "apple/Extension/Resources/terms.html", contentType: "text/html" }));
  await page.getByRole("button", { name: "Settings" }).click();
  for (const [name, heading] of [
    ["Privacy policy (draft)", /Privacy/i],
    ["Terms of service (draft)", /Terms/i],
  ] as const) {
    const link = page.getByRole("link", { name });
    await link.focus();
    await expect(link).toBeFocused();
    const popup = context.waitForEvent("page");
    await page.keyboard.press("Enter");
    const legal = await popup;
    await expect(legal.getByText("DRAFT. Not approved by legal review.")).toBeVisible();
    await expect(legal.getByRole("heading", { level: 1 })).toHaveText(heading);
    await legal.close();
  }
});

// iOS opens a <select>'s picker as soon as it gets focus (seen in T018), so
// opening Settings must focus the heading, not the provider select.
test("opening Settings focuses its heading, not a provider control", async ({ page }) => {
  await openPopup(page);
  await page.getByRole("button", { name: "Settings" }).click();
  await expect(page.getByRole("heading", { name: "Settings", level: 2 })).toBeFocused();
  for (const name of ["Anthropic", "OpenAI"]) await expect(page.getByRole("radio", { name })).not.toBeFocused();
});

test("Settings ends at Delete all data: neither the panel nor the page scrolls on into empty space", async ({ page }) => {
  await page.setViewportSize({ width: 400, height: 600 });
  await openPopup(page);
  await page.getByRole("button", { name: "Settings" }).click();
  const sizes = await page.evaluate(() => {
    const body = document.querySelector("#settings-view .body") as HTMLElement;
    const last = body.lastElementChild as HTMLElement;
    const style = getComputedStyle(body);
    return {
      page: document.documentElement.scrollHeight,
      viewport: innerHeight,
      scroll: body.scrollHeight,
      end: last.offsetTop + last.offsetHeight + parseFloat(style.paddingBottom),
    };
  });
  expect(sizes.page).toBeLessThanOrEqual(sizes.viewport);
  expect(sizes.scroll).toBeLessThanOrEqual(Math.ceil(sizes.end) + 1);
});

test("Button on webpages is offered on iPhone and iPad, and not on Mac", async ({ page }) => {
  await openPopup(page, "mac");
  await page.getByRole("button", { name: "Settings" }).click();
  await expect(page.getByRole("heading", { name: "Toolbar button" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Button on webpages" })).toBeHidden();
  await expect(page.getByText("turn on Button on webpages")).toBeHidden();
  await expect(page.getByText("Control-Shift-S on Mac opens and closes Scout for Safari")).toBeVisible();
});

test("Button on webpages shows on iPhone and iPad", async ({ page }) => {
  await openPopup(page, "ios");
  await page.getByRole("button", { name: "Settings" }).click();
  await expect(page.getByRole("heading", { name: "Button on webpages" })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: "Show a Scout button on the edge of webpages" })).toBeVisible();
});

test("Settings has no Activity section", async ({ page }) => {
  await openPopup(page);
  await page.getByRole("button", { name: "Settings" }).click();
  await expect(page.getByRole("heading", { name: "Permissions" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Activity" })).toHaveCount(0);
});
