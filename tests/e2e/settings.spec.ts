import { expect, test, type Page } from "@playwright/test";

// Loads the built popup (run `npm run build` first) with a stubbed `browser`
// namespace. Storage, Keychain, and permissions are in-memory fakes exposed on
// `window.__fake` so the test can assert what was deleted. No live API call.
async function openPopup(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const data: Record<string, unknown> = {
      settings: { provider: "anthropic", model: "claude-sonnet-5-5", retention: "7" },
      history: [{ at: Date.now(), question: "hi", answer: "hello" }],
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
  });
  await page.route("**/popup.html", (r) => r.fulfill({ path: "apple/Extension/Resources/popup.html", contentType: "text/html" }));
  await page.route("**/popup.js", (r) => r.fulfill({ path: "apple/Extension/Resources/popup.js", contentType: "text/javascript" }));
  await page.goto("/popup.html");
}

test("settings save as you change them and persist provider, model, and retention", async ({ page }) => {
  await openPopup(page);
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("radio", { name: "OpenAI" }).check();
  await expect(page.getByLabel("Model", { exact: true })).toHaveValue("gpt-5");
  await page.getByLabel("Model", { exact: true }).fill("gpt-test-model");
  await page.getByLabel("Model", { exact: true }).press("Tab");
  await page.getByLabel("Keep chat history").selectOption("30");
  await expect(page.locator("#settings-saved")).toHaveText("Saved.");
  const saved = await page.evaluate(() => (globalThis as unknown as { __fake: { data: { settings: unknown } } }).__fake.data.settings);
  expect(saved).toEqual({ provider: "openai", model: "gpt-test-model", retention: "30" });
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
  await page.getByRole("button", { name: "Delete all data" }).click();
  await page.getByRole("button", { name: "Yes, delete all data" }).click();
  await expect(page.locator("#delete-result")).toHaveText("Deleted your API keys, settings, and history from this device.");
  const after = await page.evaluate(() => {
    const f = (globalThis as unknown as { __fake: { data: object; keys: object; origins: string[] } }).__fake;
    return { data: Object.keys(f.data), keys: Object.keys(f.keys), origins: f.origins };
  });
  expect(after.data).toEqual([]);
  expect(after.keys).toEqual([]);
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
