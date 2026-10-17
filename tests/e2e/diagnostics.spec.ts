import { expect, test, type Page } from "@playwright/test";
import { withWorker } from "./worker";

// Debug-build diagnostics: an error offers "Copy diagnostics"; the copied
// report is the "Actual behavior" block and never contains the key, page
// text, or (unless opted in) the question. Stubbed browser APIs, mocked
// provider, synthetic data only.
const KEY = "sk-test-synthetic-DIAG-123456";
const PAGE = { url: "https://shop.test/cart?session=abc", title: "Test shop", text: "SECRET-PAGE-TEXT Widget costs $10." };

async function openPopup(page: Page): Promise<void> {
  await page.addInitScript(
    ({ key, pageData }) => {
      // Sharing with the provider already allowed (consent.spec.ts covers asking).
      const data: Record<string, unknown> = { aiConsent: { anthropic: { at: 1, version: 2 }, openai: { at: 1, version: 2 } } };
      (globalThis as unknown as { browser: unknown }).browser = {
        runtime: {
          sendMessage: async () => ({ ok: true }),
          sendNativeMessage: async (_app: string, m: { type: string }) =>
            m.type === "keychain.get" ? { ok: true, value: key } : { ok: true },
          onMessage: { addListener() {} },
        },
        tabs: { query: async () => [{ id: 1, url: pageData.url, title: pageData.title, active: true }] },
        permissions: { request: async () => true, getAll: async () => ({ origins: [] }), remove: async () => true },
        scripting: { executeScript: async () => [{ result: pageData }] },
        storage: {
          local: {
            get: async (k: string | string[]) => {
              const list = Array.isArray(k) ? k : [k];
              return JSON.parse(JSON.stringify(Object.fromEntries(list.filter((x) => x in data).map((x) => [x, data[x]]))));
            },
            set: async (items: Record<string, unknown>) => void Object.assign(data, JSON.parse(JSON.stringify(items))),
            clear: async () => {
              for (const k of Object.keys(data)) delete data[k];
            },
          },
        },
      };
      // Capture clipboard writes instead of touching the real clipboard.
      const w = window as unknown as { __copied?: string };
      Object.defineProperty(navigator, "clipboard", {
        value: { writeText: async (t: string) => void (w.__copied = t) },
        configurable: true,
      });
    },
    { key: KEY, pageData: PAGE },
  );
  await page.route("**/popup.html", (r) => r.fulfill({ path: "apple/Extension/Resources/popup.html", contentType: "text/html" }));
  await page.route("**/popup.js", (r) => r.fulfill({ path: "apple/Extension/Resources/popup.js", contentType: "text/javascript" }));
  await page.route("https://api.anthropic.com/**", (r) => r.fulfill({ status: 401, body: "{}" }));
  await withWorker(page);
  await page.goto("/popup.html");
  await expect(page.getByLabel("Ask about this page")).toBeVisible();
}

const copied = (page: Page): Promise<string> =>
  page.evaluate(() => (window as unknown as { __copied?: string }).__copied ?? "");

test("an error offers Copy diagnostics and the report is the Actual behavior", async ({ page }) => {
  await openPopup(page);
  await page.getByLabel("Ask about this page").fill("What does the widget cost?");
  await page.getByRole("button", { name: "Send" }).click();
  const err = page.getByRole("log").locator(".msg.error", { hasText: "The API key was rejected." });
  await expect(err).toBeVisible();
  await err.getByRole("button", { name: "Copy diagnostics" }).click();
  await expect(page.locator("#status")).toHaveText(/Diagnostics copied/);

  const report = await copied(page);
  expect(report).toContain("## Scout for Safari diagnostics — Actual behavior");
  expect(report).toMatch(/- Run: ask \(#\d+\)/);
  expect(report).toContain("- Provider: anthropic / claude-sonnet-5-5");
  expect(report).toContain("- Page: shop.test");
  expect(report).toContain('- Outcome: error — "The API key was rejected.');
  expect(report).toContain("page:read ok");
  expect(report).toContain("model:start");
  expect(report).toContain("not recorded (opt in under Diagnostics)");
  // Never in a report:
  expect(report).not.toContain(KEY);
  expect(report).not.toContain("SECRET-PAGE-TEXT");
  expect(report).not.toContain("session=abc");
  expect(report).not.toContain("What does the widget cost?");
});

test("the question is included only after opting in", async ({ page }) => {
  await openPopup(page);
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByLabel("Also record the question I type").check();
  await page.getByRole("button", { name: "Back to chat" }).click();
  await page.getByLabel("Ask about this page").fill("What does the widget cost?");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText("The API key was rejected.")).toBeVisible();
  await page.getByRole("button", { name: "Settings" }).click();
  await page.locator("#diag-copy").click();
  await expect(page.locator("#diag-status")).toHaveText(/Diagnostics copied/);
  expect(await copied(page)).toContain('- Question: "What does the widget cost?"');
});

test("diagnostics controls are reachable and labeled", async ({ page }) => {
  await openPopup(page);
  await page.getByRole("button", { name: "Settings" }).click();
  await expect(page.getByRole("heading", { name: "Diagnostics (debug build)" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Copy diagnostics" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Clear diagnostics" })).toBeVisible();
  await page.getByRole("button", { name: "Clear diagnostics" }).click();
  await expect(page.locator("#diag-status")).toHaveText("Diagnostics cleared.");
});
