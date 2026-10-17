import { expect, test, type Page } from "@playwright/test";

// Diagnostics run #20 (2026-10-16): Find coupons on a Shopify checkout page.
// Drives the built popup and the built content script (run `npm run build`
// first) against tests/fixtures/shopify-checkout.html in a second page, with a
// mock model. Synthetic store and codes only; no live provider or merchant.
// Not run in the sandbox (launch-blockers 12).
function sse(events: Array<Record<string, unknown>>): string {
  return events.map((e) => "event: " + String(e.type) + "\ndata: " + JSON.stringify(e) + "\n\n").join("");
}

function codesTurn(codes: string[]): string {
  return sse([
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
    { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: codes.map((c) => c + " | https://deals.test/codes").join("\n") } },
    { type: "content_block_stop", index: 1 },
    { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 12 } },
    { type: "message_stop" },
  ]);
}

type Handler = (m: unknown) => unknown;

/** Opens the checkout fixture, then the popup wired to it as the active tab. */
async function open(page: Page, opts: { shopify: boolean; codes: string[] }): Promise<Page> {
  const shop = await page.context().newPage();
  if (!opts.shopify) {
    await shop.route("**/cart.js", (r) => r.fulfill({ status: 404, contentType: "text/html", body: "not found" }));
  }
  await shop.goto("/shopify-checkout.html");
  await page.exposeFunction("__injectContent", async () => {
    await shop.addScriptTag({ path: "apple/Extension/Resources/content.js" });
  });
  await page.exposeFunction("__callContent", (req: unknown) =>
    shop.evaluate((r) => (window as unknown as { __safariScoutHandle: Handler }).__safariScoutHandle(r), req),
  );
  await page.addInitScript((url: string) => {
    const w = window as unknown as Record<string, unknown> & {
      __injectContent: () => Promise<void>;
      __callContent: (r: unknown) => Promise<unknown>;
    };
    (globalThis as unknown as { browser: unknown }).browser = {
      runtime: {
        sendMessage: async () => ({ ok: true }),
        sendNativeMessage: async () => ({ ok: true, value: "sk-test-synthetic" }),
        onMessage: { addListener() {} },
      },
      // Sharing with the provider already allowed (consent.spec.ts covers asking).
      storage: { local: { get: async (k: string | string[]) => (([] as string[]).concat(k).includes("aiConsent") ? { aiConsent: { anthropic: { at: 1, version: 2 }, openai: { at: 1, version: 2 } } } : {}), set: async () => undefined, clear: async () => undefined } },
      tabs: { query: async () => [{ id: 1, url }] },
      scripting: {
        // files: inject the real content script into the fixture page.
        // func: run the popup's real injected func, with the handler forwarding there.
        executeScript: async (inj: { files?: string[]; func?: (...a: unknown[]) => unknown; args?: unknown[] }) => {
          if (inj.files) {
            await w.__injectContent();
            return [{ result: true }];
          }
          if (!inj.func || !inj.args) return [{ result: null }];
          w.__safariScoutHandle = (r: unknown) => w.__callContent(r);
          return [{ result: await inj.func(...inj.args) }];
        },
      },
    };
  }, shop.url());
  await page.route("**/popup.html", (r) => r.fulfill({ path: "apple/Extension/Resources/popup.html", contentType: "text/html" }));
  await page.route("**/popup.js", (r) => r.fulfill({ path: "apple/Extension/Resources/popup.js", contentType: "text/javascript" }));
  await page.route("https://api.anthropic.com/**", (r) =>
    r.fulfill({ status: 200, contentType: "text/event-stream", body: codesTurn(opts.codes) }),
  );
  await page.goto("/popup.html");
  return shop;
}

const RUN_WAIT = { timeout: 60_000 };

test("checkout page without a cart API: types codes only into the discount box, reads the split total, applies the best", async ({ page }) => {
  test.setTimeout(120_000);
  const shop = await open(page, { shopify: false, codes: ["WELCOME5", "SAVE10", "SAVE20", "BOGUS99"] });
  await page.getByRole("button", { name: "Find coupons" }).click();
  const answer = page.getByRole("log").locator(".msg.assistant").last();
  await expect(answer).toContainText(
    "I tested 25 codes. SAVE20 is the best: your total drops from $170.00 to $136.00 (you save $34.00, 20% off).",
    RUN_WAIT,
  );
  await expect(answer).toContainText("It's applied to your cart, and I didn't go to checkout.");
  // A batch with a saving ends the search: no prompt for more.
  await expect(page.locator("#coupons-more")).toBeHidden();
  const rows = page.locator("#coupons-rows tr");
  await expect(rows).toHaveCount(25);
  await expect(rows.nth(1)).toContainText("$153.00");
  await expect(shop.locator("#message")).toHaveText("SAVE20 applied.");
  await expect(shop.locator("#zip")).toHaveValue("");
  await expect(shop.locator("#email")).toHaveValue("");
  await expect(shop.locator("#status")).toHaveText("");
});

test("checkout page on a Shopify store: tests codes through the cart API and applies the best", async ({ page }) => {
  test.setTimeout(120_000);
  // The fake store answers /cart.js as text/javascript, like real Shopify stores.
  const shop = await open(page, { shopify: true, codes: ["KETO10", "BEEFY15", "NOPE1"] });
  await page.getByRole("button", { name: "Find coupons" }).click();
  const answer = page.getByRole("log").locator(".msg.assistant").last();
  await expect(answer).toContainText(
    "I tested 25 codes. BEEFY15 is the best: your total drops from $151.79 to $135.81 (you save $15.98, 11% off).",
    RUN_WAIT,
  );
  await expect(answer).toContainText("It's applied to your cart");
  await expect(page.locator("#coupons-more")).toBeHidden();
  // The checkout page reloads to show the code; the cart holds only the winner.
  await shop.waitForLoadState("load");
  const cart = await shop.evaluate(() => fetch("/cart.js").then((r) => r.json()));
  expect(cart.discount_codes).toEqual([{ code: "BEEFY15", applicable: true }]);
  await expect(shop.locator("#zip")).toHaveValue("");
  await expect(shop.locator("#status")).toHaveText("");
});
