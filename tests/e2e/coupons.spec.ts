import { expect, test, type Page } from "@playwright/test";

// Drives the built popup (run `npm run build` first). The mock search returns
// one page (searched and fetched, with its text) and the model lists 5
// synthetic codes from it; nothing is guessed (owner rule 2026-10-17). A fake
// tab simulates a non-Shopify shop (SAVE10 = 10%, SAVE20 = 20%, the rest
// refused with a message, as real stores do), so the page path (coupon box)
// is used. No live provider call, no merchant site.
// Not run in the sandbox (launch-blockers 12).
function sse(events: Array<Record<string, unknown>>): string {
  return events.map((e) => "event: " + String(e.type) + "\ndata: " + JSON.stringify(e) + "\n\n").join("");
}

const CODES = ["WELCOME5", "SAVE10", "FREESHIP", "SAVE20", "BOGUS99"];
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
  // The page, fetched: its text names every code, so each counts as verified.
  {
    type: "content_block_start",
    index: 1,
    content_block: {
      type: "web_fetch_tool_result",
      content: {
        type: "web_fetch_result",
        url: "https://deals.test/codes",
        content: { type: "document", source: { type: "text", media_type: "text/plain", data: "Synthetic deals\n" + CODES.map((c) => "Use code " + c + " at checkout").join("\n") }, title: "Synthetic deals" },
      },
    },
  },
  { type: "content_block_stop", index: 1 },
  { type: "content_block_start", index: 2, content_block: { type: "text", text: "" } },
  {
    type: "content_block_delta",
    index: 2,
    delta: {
      type: "text_delta",
      text: CODES.map((c) => c + ' | https://deals.test/codes | "Use code ' + c + ' at checkout" | -').join("\n"),
    },
  },
  { type: "content_block_stop", index: 2 },
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

// The page path waits ~0.65 s per code (settle + polite pause).
const BATCH_WAIT = { timeout: 45_000 };

test("coupon run tests every code found online, applies the best, never clicks order, and names each code's page", async ({ page }) => {
  test.setTimeout(90_000);
  const { clicks } = await openPopup(page);
  await page.getByRole("button", { name: "Find coupons" }).click();
  // Owner, 2026-10-17: milestones post in the chat, outside the folded card,
  // the newest with a moving indicator; no "can take a couple of minutes" line.
  const steps = page.locator("#log > .coupon-step");
  await expect(steps.first()).toHaveText("Searching for coupons for shop…", BATCH_WAIT);
  await expect(page.locator("#log > .coupon-step.busy .pulse")).toHaveCount(1);
  await expect(page.locator("#status")).not.toContainText("couple of minutes");
  const answer = page.getByRole("log").locator(".msg.assistant").last();
  await expect(answer).toHaveText(
    "I tested 5 codes found online for shop. SAVE20 is the best: your total drops from $100.00 to $80.00 (you save $20.00, 20% off). It's applied to your cart, and I didn't go to checkout.",
    BATCH_WAIT,
  );
  await expect(answer).not.toContainText("guess");
  await expect(page.locator("#coupons-more")).toBeHidden();
  const said = await steps.allTextContents();
  expect(said).toContain("Found 5 coupons. Applying them to your cart while I keep searching.");
  expect(said).toContain("Found code SAVE10, saves $10.00 (10% off). Continuing to apply for better savings.");
  expect(said).toContain("Found code SAVE20, saves $20.00 (20% off). Continuing to apply for better savings.");
  expect(said.some((t) => t.startsWith("Found all relevant coupons, 5 in all."))).toBe(true);
  // When the run ends no indicator keeps moving.
  await expect(page.locator(".pulse")).toHaveCount(0);
  // The trace is folded by default: open it to read the code lines.
  await page.locator("#task .trace-head").click();
  await expect(page.locator("#task .say")).toContainText(["I searched the web for shop codes. Found 5 codes read on the pages that post them."]);
  // Tested as the search writes them, each arrival in rank order: the first
  // four finished lines arrive together and "welcome" reads as a first-order
  // restriction (candidates.ts RESTRICTED), so WELCOME5 goes last of them;
  // BOGUS99, the reply's last line, arrives when the reply ends.
  const rows = page.locator("#task .attempt");
  await expect(rows).toHaveCount(5);
  await expect(rows.nth(0)).toContainText("SAVE10");
  await expect(rows.nth(0)).toContainText("$90.00");
  await expect(rows.nth(1)).toContainText("FREESHIP");
  await expect(rows.nth(1)).toContainText("$100.00");
  await expect(rows.nth(2)).toContainText("SAVE20");
  await expect(rows.nth(2)).toContainText("$80.00");
  await expect(rows.nth(3)).toContainText("WELCOME5");
  await expect(rows.nth(3)).toContainText("$100.00");
  await expect(rows.nth(4)).toContainText("BOGUS99");
  for (let i = 0; i < 5; i++) {
    await expect(rows.nth(i).getByRole("link", { name: "seen on deals.test" })).toHaveAttribute("href", "https://deals.test/codes");
  }
  // e3 is "Place order": it must never be clicked.
  expect(clicks).not.toContain("e3");
  // 5 tries plus one re-apply of the winner, all on Apply (e2).
  expect(clicks).toHaveLength(6);
  expect(new Set(clicks)).toEqual(new Set(["e2"]));
});

test("no winning code: offers to search again, searches without repeating codes, says the cart is unchanged", async ({ page }) => {
  test.setTimeout(150_000);
  const { asks } = await openPopup(page, { pct: {} });
  await page.getByRole("button", { name: "Find coupons" }).click();
  await expect(page.locator("#coupons-more-text")).toHaveText(
    "We've tried 5 codes and none lowered your total. Would you like Scout for Safari to search the web again, in other places, for more codes to test?",
    BATCH_WAIT,
  );
  await expect(page.getByRole("button", { name: "Search again" })).toBeFocused();
  // Owner, 2026-10-17: Stop is the composer's button, never one in the chat.
  await expect(page.getByRole("log").getByRole("button", { name: "Stop", exact: true })).toHaveCount(0);
  await expect(page.locator(".composer-foot").getByRole("button", { name: "Stop", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Send" })).toBeHidden();
  await page.getByRole("button", { name: "Search again" }).click();
  const answer = page.getByRole("log").locator(".msg.assistant").last();
  await expect(answer).toContainText("I tested 5 codes found online for shop and none lowered your total of $100.00, so your cart is unchanged. I couldn't find any more codes to try.", BATCH_WAIT);
  // Three requests: the listed coupon pages read first, the search, then the
  // second search, which names the codes already tried and looks in other places.
  expect(asks).toHaveLength(3);
  expect(asks[0]).toContain("First job, no searching");
  expect(asks[2]).toContain("Already tried, do not list these again");
  // In the order they were tested (see the first test).
  expect(asks[2]).toContain("SAVE10, FREESHIP, SAVE20, WELCOME5, BOGUS99");
  expect(asks[2]).toContain("second search");
  // The trace is folded by default: open it to read the code lines.
  await page.locator("#task .trace-head").click();
  const rows = page.locator("#task .attempt");
  await expect(rows).toHaveCount(5);
  const codes = await rows.locator(".code").allTextContents();
  expect(new Set(codes).size).toBe(5);
});

// Owner, 2026-10-17: the send arrow turns into Stop while the run works, and Stop halts it.
test("Find coupons turns Send into Stop next to the model picker, and Stop ends the run", async ({ page }) => {
  test.setTimeout(90_000);
  await openPopup(page, { pct: {} });
  await page.getByRole("button", { name: "Find coupons" }).click();
  const composerStop = page.locator(".composer-foot").getByRole("button", { name: "Stop", exact: true });
  await expect(composerStop).toBeVisible();
  await expect(composerStop).toHaveClass(/\bsend\b/);
  await expect(page.getByRole("button", { name: "Send" })).toBeHidden();
  await expect(page.getByRole("log").getByRole("button", { name: "Stop", exact: true })).toHaveCount(0);
  // Stop also answers the inline "try more codes?" question when it is up.
  await expect(page.locator("#coupons-more-text")).toBeVisible(BATCH_WAIT);
  await composerStop.click();
  await expect(page.locator("#coupons-more")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Send" })).toBeVisible();
  await expect(composerStop).toBeHidden();
  await expect(page.locator("#task .trace-head")).toContainText(/Finished|Stopped/);
});

// Owner rule 2026-10-17: a failed web search means nothing is tested; no guesses stand in for it.
test("a failed web search tests nothing and says why", async ({ page }) => {
  test.setTimeout(90_000);
  const { clicks } = await openPopup(page, { status: 401 });
  await page.getByRole("button", { name: "Find coupons" }).click();
  const answer = page.getByRole("log").locator(".msg.error").last();
  await expect(answer).toContainText(
    "The web search ended early (The web search failed. The API key was rejected. Check the key in Scout for Safari settings). No code posted for shop could be found. Nothing was tested, and your cart is unchanged.",
    BATCH_WAIT,
  );
  await expect(page.locator("#task .attempt")).toHaveCount(0);
  expect(clicks).toEqual([]);
});
