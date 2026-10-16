import { expect, test, type Page } from "@playwright/test";

// Loads the built popup (run `npm run build` first) with a stubbed `browser`
// namespace holding two fixture tabs. The provider is mocked at the network
// layer: no live API call.
const TABS = [
  { id: 1, title: "Test shop", url: "https://shop.test/a", active: true },
  { id: 2, title: "Reviews of Widget", url: "https://reviews.test/widget", active: false },
];
const PAGES: Record<number, { url: string; title: string; text: string }> = {
  1: { url: TABS[0]!.url, title: TABS[0]!.title, text: "Widget costs $10. Free shipping." },
  2: { url: TABS[1]!.url, title: TABS[1]!.title, text: "Customers rate the Widget 4.5 stars." },
};

function sse(events: Array<Record<string, unknown>>): string {
  return events.map((e) => "event: " + String(e.type) + "\ndata: " + JSON.stringify(e) + "\n\n").join("");
}

const ANSWER = sse([
  { type: "message_start", message: { usage: { input_tokens: 60, output_tokens: 1 } } },
  { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
  {
    type: "content_block_delta",
    index: 0,
    delta: { type: "text_delta", text: "It costs $10 (Test shop) and is rated 4.5 stars (Reviews of Widget)." },
  },
  { type: "content_block_stop", index: 0 },
  { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 20 } },
  { type: "message_stop" },
]);

async function openPopup(page: Page, opts: { backgroundReadFails?: boolean } = {}): Promise<{ bodies: string[] }> {
  const bodies: string[] = [];
  await page.addInitScript(
    ({ tabs, pages, backgroundReadFails }) => {
      const stub = {
        runtime: {
          sendMessage: async () => ({ ok: true }),
          sendNativeMessage: async () => ({ ok: true, value: "sk-test-synthetic" }),
          onMessage: { addListener() {} },
        },
        tabs: {
          query: async (info: { active?: boolean }) => (info.active ? tabs.filter((t) => t.active) : tabs),
        },
        permissions: { request: async () => true },
        scripting: {
          executeScript: async (inj: { target: { tabId: number } }) => {
            // iOS Safari: scripting a background tab fails (T018).
            if (backgroundReadFails && !tabs.find((t) => t.id === inj.target.tabId)?.active) {
              throw new Error("No tab with id");
            }
            return [{ result: pages[inj.target.tabId] }];
          },
        },
      };
      (globalThis as unknown as { browser: unknown }).browser = stub;
    },
    { tabs: TABS, pages: PAGES, backgroundReadFails: opts.backgroundReadFails === true },
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

test("a ticked tab is read and cited alongside the active page", async ({ page }) => {
  const { bodies } = await openPopup(page);
  await page.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("button", { name: "Use other tabs" }).click();
  await page.getByRole("checkbox", { name: "Reviews of Widget" }).check();
  await page.getByLabel("Ask about this page").fill("Is the widget good value?");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByRole("log").getByText("rated 4.5 stars (Reviews of Widget)")).toBeVisible();
  expect(bodies).toHaveLength(1);
  expect(bodies[0]).toContain("Widget costs $10.");
  expect(bodies[0]).toContain("Customers rate the Widget 4.5 stars.");
});

test("@mention selects a tab without ticking it", async ({ page }) => {
  const { bodies } = await openPopup(page);
  await page.getByLabel("Ask about this page").fill("Compare with @reviews");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByRole("log").getByText("Reviews of Widget).")).toBeVisible();
  expect(bodies[0]).toContain("Customers rate the Widget 4.5 stars.");
});

test("an untouched tab is never read", async ({ page }) => {
  const { bodies } = await openPopup(page);
  await page.getByLabel("Ask about this page").fill("How much?");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByRole("log").getByText("Test shop")).toBeVisible();
  expect(bodies[0]).not.toContain("Customers rate the Widget");
});

test("a tab that cannot be read is named in the conversation, not just the status line", async ({ page }) => {
  const { bodies } = await openPopup(page, { backgroundReadFails: true });
  await page.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("button", { name: "Use other tabs" }).click();
  await page.getByRole("checkbox", { name: "Reviews of Widget" }).check();
  await page.getByLabel("Ask about this page").fill("Price and rating?");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByRole("log").getByText("Could not read: Reviews of Widget.")).toBeVisible();
  await expect(page.locator("#status")).toContainText("Cost: ");
  expect(bodies.join("")).not.toContain("4.5 stars");
});
