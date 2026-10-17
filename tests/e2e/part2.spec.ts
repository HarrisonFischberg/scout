import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { withWorker } from "./worker";

// Part 2 acceptance (spec part 2): conversation through the Scout server in
// the worker, page context rules, the tool allow-list and permission gate.
// The worker runs for real (tests/e2e/worker.ts); answers come from the local
// mock server (scripts/mock-scout-server.mjs), started by playwright.config.ts.
// Stubbed browser APIs and synthetic pages only.
const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
const MOCK_URL = "http://127.0.0.1:" + (env.MOCK_PORT ?? "4318") + "/v1/messages";

const TABS = [
  { id: 1, windowId: 1, title: "Test shop", url: "https://shop.test/a", active: true },
  { id: 2, windowId: 1, title: "Reviews of Widget", url: "https://reviews.test/widget", active: false },
];
const PAGES: Record<number, { url: string; title: string; text: string }> = {
  1: { url: TABS[0]!.url, title: "Test shop", text: "Widget costs $10." },
  2: { url: TABS[1]!.url, title: "Reviews of Widget", text: "Customers rate the Widget 4.5 stars." },
};

interface Calls {
  scripts: number[];
  captures: number;
  removed: number[][];
  queriesAll: number;
}

async function openPopup(page: Page, opts: { data?: Record<string, unknown>; policy?: string[] } = {}): Promise<void> {
  await page.addInitScript(
    ({ tabs, pages, data, mock, policy }) => {
      const g = globalThis as unknown as Record<string, unknown>;
      const store: Record<string, unknown> = {
        aiConsent: { anthropic: { at: 1, version: 2 } },
        devMockServer: mock,
        ...data,
      };
      const calls = { scripts: [] as number[], captures: 0, removed: [] as number[][], queriesAll: 0 };
      g.__calls = calls;
      g.__store = store;
      const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
      g.browser = {
        runtime: {
          sendNativeMessage: async (_app: string, m: { type: string }) =>
            m.type === "keychain.get"
              ? { ok: true, value: "sk-ant-test-synthetic-PART2-0000" }
              : m.type === "policy.get"
                ? policy
                  ? { ok: true, blocked: policy }
                  : { ok: false, error: "unknown_type" }
                : { ok: true },
        },
        storage: {
          local: {
            get: async (k: string | string[]) => copy(Object.fromEntries([k].flat().filter((x) => x in store).map((x) => [x, store[x]]))),
            set: async (items: Record<string, unknown>) => void Object.assign(store, copy(items)),
            clear: async () => {
              for (const k of Object.keys(store)) delete store[k];
            },
          },
        },
        tabs: {
          query: async (info: { active?: boolean; currentWindow?: boolean }) => {
            if (info.active) return tabs.filter((t) => t.active);
            // The panel's own attach picker lists the current window locally; only
            // the tool host's search asks for every window.
            if (!info.currentWindow) calls.queriesAll++;
            return tabs;
          },
          get: async (id: number) => {
            const t = tabs.find((x) => x.id === id);
            if (!t) throw new Error("No tab with id " + id);
            return t;
          },
          create: async (p: { url: string }) => ({ id: 9, windowId: 1, url: p.url, title: "" }),
          remove: async (ids: number | number[]) => void calls.removed.push([ids].flat()),
          captureVisibleTab: async () => {
            calls.captures++;
            // 1x1 white JPEG.
            return "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=";
          },
        },
        permissions: { request: async () => true, getAll: async () => ({ origins: [] }), remove: async () => true },
        scripting: {
          executeScript: async (inj: { target: { tabId: number } }) => {
            calls.scripts.push(inj.target.tabId);
            return [{ result: pages[inj.target.tabId] }];
          },
        },
      };
    },
    { tabs: TABS, pages: PAGES, data: opts.data ?? {}, mock: MOCK_URL, policy: opts.policy ?? null },
  );
  await page.route("**/popup.html", (r) => r.fulfill({ path: "apple/Extension/Resources/popup.html", contentType: "text/html" }));
  await page.route("**/popup.js", (r) => r.fulfill({ path: "apple/Extension/Resources/popup.js", contentType: "text/javascript" }));
  await page.route("**/icons/**", (r) => r.fulfill({ status: 200, contentType: "image/png", body: "" }));
  // Model list lookups go to the real API host: answer without a network call.
  await page.route("https://api.anthropic.com/**", (r) => r.fulfill({ status: 401, body: "{}" }));
  await withWorker(page);
  await page.goto("/popup.html");
  await expect(page.getByLabel("Ask about this page")).toBeVisible();
}

const calls = (page: Page): Promise<Calls> => page.evaluate(() => (globalThis as unknown as { __calls: Calls }).__calls);

async function ask(page: Page, text: string): Promise<void> {
  await page.getByLabel("Ask about this page").fill(text);
  await page.getByRole("button", { name: "Send" }).click();
}

const lastAnswer = (page: Page) => page.getByRole("log").locator(".msg.assistant").last();

test("a tool request mid-stream runs and the same answer continues", async ({ page }) => {
  await openPopup(page);
  await ask(page, "What is on this page? [mock:tool=read_page]");
  await expect(lastAnswer(page)).toContainText("The read_page tool answered with status ok.");
  await expect(lastAnswer(page)).toContainText("Let me use a tool.");
  // One answer bubble, not two.
  await expect(page.getByRole("log").locator(".msg.assistant")).toHaveCount(1);
  await expect(page.locator("#status")).toContainText("Cost: ");
});

test("an unknown tool is rejected with schema-error and logged", async ({ page }) => {
  await openPopup(page);
  await ask(page, "Clean up [mock:tool=delete_history]");
  await expect(lastAnswer(page)).toContainText("The delete_history tool answered with status schema-error.");
  await page.getByRole("button", { name: "Settings" }).click();
  await expect(page.getByRole("list", { name: "Activity" })).toContainText("Unknown tool (delete_history) · no site · schema-error");
});

test("a question about the current page uses only that tab; read_page of another tab is refused", async ({ page }) => {
  await openPopup(page);
  await ask(page, 'Compare [mock:tool=read_page {"tab_id":2}]');
  await expect(lastAnswer(page)).toContainText("The read_page tool answered with status blocked-by-user.");
  expect((await calls(page)).scripts).toEqual([1]);
  await expect(lastAnswer(page).getByRole("list", { name: "Shared with this answer" }).getByRole("listitem")).toHaveText(["Test shop (shop.test)"]);
});

test("a blocked site is never read or screenshotted", async ({ page }) => {
  await openPopup(page, { data: { pageAccess: { blocked: ["shop.test"] } } });
  await ask(page, "Show me [mock:tool=screenshot_visible]");
  await expect(lastAnswer(page)).toContainText("The screenshot_visible tool answered with status blocked-by-user.");
  const c = await calls(page);
  expect(c.scripts).toEqual([]);
  expect(c.captures).toBe(0);
  await expect(lastAnswer(page).getByRole("list", { name: "Shared with this answer" })).toContainText("Test shop (shop.test), blocked");
  // No permission question was shown for a blocked site.
  await expect(page.getByRole("alertdialog", { name: "Allow a screenshot?" })).toBeHidden();
});

test("blocking the current site in Settings stops reading it", async ({ page }) => {
  await openPopup(page);
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("button", { name: "Block shop.test" }).click();
  await expect(page.getByRole("list", { name: "Blocked sites" })).toContainText("shop.test");
  await page.getByRole("button", { name: "Back to chat" }).click();
  await ask(page, "What does it cost?");
  await expect(lastAnswer(page)).toContainText("sample answer");
  expect((await calls(page)).scripts).toEqual([]);
});

test("the organization blocklist is shown and enforced", async ({ page }) => {
  await openPopup(page, { policy: ["shop.test"] });
  await page.getByRole("button", { name: "Settings" }).click();
  await expect(page.getByRole("list", { name: "Blocked by your organization" })).toContainText("shop.test");
  await page.getByRole("button", { name: "Back to chat" }).click();
  await ask(page, "What does it cost?");
  await expect(lastAnswer(page)).toContainText("sample answer");
  expect((await calls(page)).scripts).toEqual([]);
});

test("a screenshot needs the user's permission on a site set to ask", async ({ page }) => {
  await openPopup(page);
  await ask(page, "Look at the chart [mock:tool=screenshot_visible]");
  const dialog = page.getByRole("alertdialog", { name: "Allow a screenshot?" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Don't allow" })).toBeFocused();
  await dialog.getByRole("button", { name: "Allow once" }).click();
  await expect(lastAnswer(page)).toContainText("The screenshot_visible tool answered with status ok.");
  expect((await calls(page)).captures).toBe(1);
  await expect(lastAnswer(page).getByRole("list", { name: "Shared with this answer" })).toContainText("Screenshot (shop.test)");
});

test("history search does nothing until it is turned on", async ({ page }) => {
  await openPopup(page);
  await ask(page, "Find my tabs [mock:tool=search_tabs]");
  await expect(lastAnswer(page)).toContainText("The search_tabs tool answered with status blocked-by-user.");
  expect((await calls(page)).queriesAll).toBe(0);

  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByLabel("Let Scout for Safari search your open tabs and history").check();
  await expect(page.locator("#access-search-help")).toContainText("Safari does not let extensions search history");
  await page.getByRole("button", { name: "Back to chat" }).click();
  await ask(page, "Find my tabs again [mock:tool=search_tabs]");
  await expect(lastAnswer(page)).toContainText("The search_tabs tool answered with status ok.");
  expect((await calls(page)).queriesAll).toBeGreaterThan(0);
});

test("close_tabs asks first and closes nothing when cancelled", async ({ page }) => {
  await openPopup(page);
  await ask(page, "Tidy up [mock:tool=close_tabs]");
  const dialog = page.getByRole("alertdialog", { name: "Close this tab?" });
  await expect(dialog).toContainText("Reviews of Widget (reviews.test)");
  await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(lastAnswer(page)).toContainText("The close_tabs tool answered with status declined.");
  expect((await calls(page)).removed).toEqual([]);

  await ask(page, "Tidy up now [mock:tool=close_tabs]");
  await page.getByRole("alertdialog", { name: "Close this tab?" }).getByRole("button", { name: "Close tab" }).click();
  await expect(lastAnswer(page)).toContainText("The close_tabs tool answered with status ok.");
  expect((await calls(page)).removed).toEqual([[2]]);
});

test("a dropped port resumes the stream without duplicating text", async ({ page }) => {
  await openPopup(page);
  await ask(page, "Count slowly [mock:slow]");
  await expect(lastAnswer(page)).toContainText("One two three");
  await page.evaluate(() => (globalThis as unknown as { __scoutDropPorts: () => void }).__scoutDropPorts());
  await expect(lastAnswer(page)).toContainText("sixteen.", { timeout: 15_000 });
  const text = (await lastAnswer(page).locator("p").first().textContent()) ?? "";
  expect(text).toBe("One two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen.");
  expect(await page.evaluate(() => (globalThis as unknown as { __scoutPortCount: () => number }).__scoutPortCount())).toBeGreaterThan(1);
});

test("a provider stream that drops keeps the text and Continue finishes it", async ({ page }) => {
  await openPopup(page);
  await ask(page, "Count [mock:drop]");
  await expect(page.getByRole("log").getByText("The connection dropped before the answer finished.")).toBeVisible();
  await expect(lastAnswer(page)).toContainText("One two three four five six");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(lastAnswer(page)).toContainText("and the rest of the answer.");
  const text = (await lastAnswer(page).locator("p").first().textContent()) ?? "";
  expect(text.match(/One two/g)).toHaveLength(1);
});

test("Stop ends a streaming answer and keeps what arrived", async ({ page }) => {
  await openPopup(page);
  await ask(page, "Count slowly [mock:slow]");
  await expect(lastAnswer(page)).toContainText("One two");
  await expect(page.getByRole("button", { name: "Send" })).toBeHidden();
  await page.locator(".composer-foot").getByRole("button", { name: "Stop" }).click();
  await expect(page.getByRole("log").getByText("Stopped.", { exact: true })).toBeVisible();
  await expect(lastAnswer(page)).not.toContainText("sixteen");
  await expect(page.getByRole("button", { name: "Send" })).toBeVisible();
});

test("answers render tables, code with a Copy button, math, and numbered sources", async ({ page }) => {
  await openPopup(page);
  await ask(page, "Show me everything");
  const answer = lastAnswer(page);
  await expect(answer.locator("table")).toContainText("Widget");
  await expect(answer.getByRole("button", { name: "Copy code (js)" })).toBeVisible();
  await expect(answer.locator("math")).toHaveCount(1);
  await expect(answer.locator("math")).toHaveAttribute("alttext", "E = mc^2");
  await expect(answer.locator("sup a")).toHaveAttribute("href", "https://shop.test/a");
});

// Safeguards 13-15 for the new UI: WCAG 2.2 A/AA with the tool question,
// attached chips, the Shared line, and Settings > Page access showing.
const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
for (const scheme of ["light", "dark"] as const) {
  test.describe(scheme, () => {
    test.use({ colorScheme: scheme });

    test("Part 2 UI passes axe", async ({ page }) => {
      await openPopup(page);
      await page.getByLabel("Ask about this page").fill("Compare with @rev");
      await page.getByLabel("Ask about this page").press("Enter");
      await ask(page, "Look [mock:tool=screenshot_visible]");
      await expect(page.getByRole("alertdialog", { name: "Allow a screenshot?" })).toBeVisible();
      let r = await new AxeBuilder({ page }).withTags(WCAG).analyze();
      expect(r.violations.map((v) => v.id + ": " + v.nodes.map((n) => n.target.join(" ")).join(", "))).toEqual([]);
      await page.getByRole("button", { name: "Don't allow" }).click();
      await expect(lastAnswer(page).getByRole("list", { name: "Shared with this answer" })).toBeVisible();
      await page.getByRole("button", { name: "Settings" }).click();
      await page.getByRole("button", { name: "Block shop.test" }).click();
      await expect(page.getByRole("list", { name: "Blocked sites" })).toContainText("shop.test");
      r = await new AxeBuilder({ page }).withTags(WCAG).analyze();
      expect(r.violations.map((v) => v.id + ": " + v.nodes.map((n) => n.target.join(" ")).join(", "))).toEqual([]);
    });
  });
}
