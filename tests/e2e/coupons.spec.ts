import { expect, test, type Page } from "@playwright/test";

// Drives the built popup (run `npm run build` first). The mock model suggests
// 5 synthetic codes; common-pattern guesses follow (T031). A fake tab simulates
// a non-Shopify shop (SAVE10 = 10%, SAVE20 = 20%, the rest refused with a
// message, as real stores do), so the page path (coupon box) is used. No live provider call, no merchant site.
// Not run in the sandbox (launch-blockers 12).
function sse(events: Array<Record<string, unknown>>): string {
  return events.map((e) => "event: " + String(e.type) + "\ndata: " + JSON.stringify(e) + "\n\n").join("");
}

const CODES_TURN = sse([
  { type: "message_start", message: { usage: { input_tokens: 15, output_tokens: 1 } } },
  {
    type: "content_block_start",
    index: 0,
    content_block: {
      type: "web_search_tool_result",
      content: [{ type: "web_search_result", url: "https://deals.test/codes", title: "Synthetic deals" }],
    },
  },
  { type: "content_block_stop", index: 0 },
  { type: "content_block_start", index: 1, content_block: { type: "text", text: "" } },
  {
    type: "content_block_delta",
    index: 1,
    delta: {
      type: "text_delta",
      text: ["WELCOME5", "SAVE10", "FREESHIP", "SAVE20", "BOGUS99"].map((c) => c + " | https://deals.test/codes").join("\n"),
    },
  },
  { type: "content_block_stop", index: 1 },
  { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 12 } },
  { type: "message_stop" },
]);

async function openPopup(
  page: Page,
  opts: { pct?: Record<string, number>; codesTurn?: string; status?: number } = {},
): Promise<{ clicks: string[]; asks: string[] }> {
  const clicks: string[] = [];
  const asks: string[] = [];
  await page.exposeFunction("__recordClick", (ref: string) => clicks.push(ref));
  await page.addInitScript((pctIn: Record<string, number>) => {
    const w = window as unknown as { __recordClick: (r: string) => void };
    const pct: Record<string, number> = pctIn;
    let typed = "";
    let total = 100;
    // Like real stores, a refused code gets a message.
    let message = "";
    const elements = [
      { ref: "e1", tag: "input", role: "textbox", name: "Coupon code", type: "text" },
      { ref: "e2", tag: "button", role: "button", name: "Apply" },
      { ref: "e3", tag: "button", role: "button", name: "Place order" },
    ];
    (globalThis as unknown as { browser: unknown }).browser = {
      runtime: {
        sendMessage: async () => ({ ok: true }),
        sendNativeMessage: async () => ({ ok: true, value: "sk-test-synthetic" }),
        onMessage: { addListener() {} },
      },
      // Sharing with the provider already allowed (consent.spec.ts covers asking).
      storage: { local: { get: async (k: string | string[]) => (([] as string[]).concat(k).includes("aiConsent") ? { aiConsent: { anthropic: { at: 1, version: 2 }, openai: { at: 1, version: 2 } } } : {}), set: async () => undefined, clear: async () => undefined } },
      tabs: {
        query: async () => [{ id: 1 }],
        sendMessage: async (_id: number, m: { type: string; action?: { type: string; ref?: string; text?: string } }) => {
          if (m.type === "scout:snapshot") {
            return {
              url: "https://shop.test/cart",
              title: "Cart",
              text: "Subtotal: $100.00\n" + (message ? message + "\n" : "") + "Total: $" + total.toFixed(2),
              elements,
              truncated: false,
            };
          }
          const a = m.action ?? { type: "?" };
          if (a.type === "type") {
            typed = (a.text ?? "").toUpperCase();
            message = "";
          }
          if (a.type === "click") {
            w.__recordClick(a.ref ?? "?");
            if (a.ref === "e2") {
              total = 100 - (pct[typed] ?? 0);
              message = pct[typed] ? "" : "Invalid coupon code.";
            }
          }
          return { ok: true, action: a.type, message: "ok" };
        },
      },
      scripting: {
        // The popup calls the content handler through executeScript(func, args);
        // the fake page behind it is tabs.sendMessage above.
        // Runs the popup's real injected func against a fake page handler.
        executeScript: async (inj: { func?: (...a: unknown[]) => unknown; args?: unknown[] }) => {
          if (!inj.func || !inj.args) return [{ result: null }];
          const g = globalThis as unknown as Record<string, unknown> & {
            browser: { tabs: { sendMessage: (id: number, m: unknown) => Promise<unknown> } };
          };
          g.__safariScoutHandle = (r: unknown) => g.browser.tabs.sendMessage(1, r);
          return [{ result: await inj.func(...inj.args) }];
        },
      },
    };
  }, opts.pct ?? { SAVE10: 10, SAVE20: 20 });
  await page.route("**/popup.html", (r) => r.fulfill({ path: "apple/Extension/Resources/popup.html", contentType: "text/html" }));
  await page.route("**/popup.js", (r) => r.fulfill({ path: "apple/Extension/Resources/popup.js", contentType: "text/javascript" }));
  await page.route("https://api.anthropic.com/**", (r) => {
    asks.push(r.request().postData() ?? "");
    if (opts.status) return r.fulfill({ status: opts.status, contentType: "application/json", body: "{}" });
    return r.fulfill({ status: 200, contentType: "text/event-stream", body: opts.codesTurn ?? CODES_TURN });
  });
  await page.goto("/popup.html");
  return { clicks, asks };
}

// The page path waits ~0.65 s per code (settle + polite pause), so 25 codes take ~16 s.
const BATCH_WAIT = { timeout: 45_000 };

// Owner, 2026-10-16: after 25 codes, a saving means the best code is applied
// with no prompt; no saving means "find 25 more?".
test("coupon run tests a batch of 25, applies the best without asking, never clicks order", async ({ page }) => {
  test.setTimeout(90_000);
  const { clicks } = await openPopup(page);
  await page.getByRole("button", { name: "Find coupons" }).click();
  const answer = page.getByRole("log").locator(".msg.assistant").last();
  await expect(answer).toContainText(
    "I tested 25 codes. SAVE20 is the best: your total drops from $100.00 to $80.00 (you save $20.00, 20% off).",
    BATCH_WAIT,
  );
  await expect(answer).toContainText("It's applied to your cart, and I didn't go to checkout.");
  await expect(page.locator("#coupons-more")).toBeHidden();
  const rows = page.locator("#coupons-rows tr");
  await expect(rows).toHaveCount(25);
  // Codes found online come first and link to their page; guesses are labeled.
  await expect(rows.nth(0)).toContainText("WELCOME5");
  await expect(rows.nth(0)).toContainText("$100.00");
  await expect(rows.nth(1)).toContainText("SAVE10");
  await expect(rows.nth(1)).toContainText("$90.00");
  await expect(rows.nth(3)).toContainText("SAVE20");
  await expect(rows.nth(3)).toContainText("$80.00");
  for (let i = 0; i < 5; i++) {
    await expect(rows.nth(i).getByRole("link", { name: "deals.test" })).toHaveAttribute("href", "https://deals.test/codes");
  }
  await expect(rows.nth(5)).toContainText("Guess (common pattern)");
  // e3 is "Place order": it must never be clicked.
  expect(clicks).not.toContain("e3");
  // 25 tries plus one re-apply of the winner, all on Apply (e2).
  expect(clicks).toHaveLength(26);
  expect(new Set(clicks)).toEqual(new Set(["e2"]));
});

test("no winning code: asks to find 25 more, searches again without repeating codes, stops on request", async ({ page }) => {
  test.setTimeout(150_000);
  const { asks } = await openPopup(page, { pct: {} });
  await page.getByRole("button", { name: "Find coupons" }).click();
  await expect(page.locator("#coupons-more-text")).toHaveText(
    "We've tried 25 codes and none lowered your total. Would you like Scout for Safari to find 25 more to test?",
    BATCH_WAIT,
  );
  await expect(page.getByRole("button", { name: "Find 25 more" })).toBeFocused();
  await page.getByRole("button", { name: "Find 25 more" }).click();
  await expect(page.locator("#coupons-more-text")).toHaveText(
    "We've tried 50 codes and none lowered your total. Would you like Scout for Safari to find 25 more to test?",
    BATCH_WAIT,
  );
  // The second web search names the codes already tried so it looks for others.
  expect(asks).toHaveLength(2);
  expect(asks[1]).toContain("Already tried, do not list these again");
  expect(asks[1]).toContain("WELCOME5, SAVE10, FREESHIP, SAVE20, BOGUS99");
  const rows = page.locator("#coupons-rows tr");
  await expect(rows).toHaveCount(50);
  const codes = await rows.locator("td:first-child").allTextContents();
  expect(new Set(codes).size).toBe(50);
  await page.getByRole("button", { name: "Stop here" }).click();
  const answer = page.getByRole("log").locator(".msg.assistant").last();
  await expect(answer).toContainText("I tested 50 codes and none lowered your total of $100.00.", BATCH_WAIT);
});

// Owner report 2026-10-16 (tackform.com): a failed web search ended the run
// before any code was tried. Now the guesses are still tested.
test("a failed web search still tests guesses and says why the search failed", async ({ page }) => {
  test.setTimeout(90_000);
  await openPopup(page, { status: 401 });
  await page.getByRole("button", { name: "Find coupons" }).click();
  const answer = page.getByRole("log").locator(".msg.assistant").last();
  await expect(answer).toContainText(
    "The web search failed. The API key was rejected. Check the key in Scout for Safari settings. I tested common guesses instead.",
    BATCH_WAIT,
  );
  await expect(answer).toContainText("SAVE20 is the best: your total drops from $100.00 to $80.00");
  await expect(page.locator("#coupons-rows tr").first()).toContainText("Guess (common pattern)");
});
