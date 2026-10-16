import { expect, test, type Page } from "@playwright/test";

// Drives the built popup (run `npm run build` first). The mock model suggests
// 5 synthetic codes; a fake tab simulates the fixture shop (SAVE10 = 10%,
// SAVE20 = 20%, the rest invalid). No live provider call, no merchant site.
// Not run in the sandbox (launch-blockers 12).
function sse(events: Array<Record<string, unknown>>): string {
  return events.map((e) => "event: " + String(e.type) + "\ndata: " + JSON.stringify(e) + "\n\n").join("");
}

const CODES_TURN = sse([
  { type: "message_start", message: { usage: { input_tokens: 15, output_tokens: 1 } } },
  { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
  {
    type: "content_block_delta",
    index: 0,
    delta: { type: "text_delta", text: "WELCOME5\nSAVE10\nFREESHIP\nSAVE20\nBOGUS99" },
  },
  { type: "content_block_stop", index: 0 },
  { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 12 } },
  { type: "message_stop" },
]);

async function openPopup(page: Page): Promise<{ clicks: string[] }> {
  const clicks: string[] = [];
  await page.exposeFunction("__recordClick", (ref: string) => clicks.push(ref));
  await page.addInitScript(() => {
    const w = window as unknown as { __recordClick: (r: string) => void };
    const pct: Record<string, number> = { SAVE10: 10, SAVE20: 20 };
    let typed = "";
    let total = 100;
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
      tabs: {
        query: async () => [{ id: 1 }],
        sendMessage: async (_id: number, m: { type: string; action?: { type: string; ref?: string; text?: string } }) => {
          if (m.type === "assistant:snapshot") {
            return {
              url: "https://shop.test/cart",
              title: "Cart",
              text: "Subtotal: $100.00\nTotal: $" + total.toFixed(2),
              elements,
              truncated: false,
            };
          }
          const a = m.action ?? { type: "?" };
          if (a.type === "type") typed = (a.text ?? "").toUpperCase();
          if (a.type === "click") {
            w.__recordClick(a.ref ?? "?");
            if (a.ref === "e2") total = 100 - (pct[typed] ?? 0);
          }
          return { ok: true, action: a.type, message: "ok" };
        },
      },
      scripting: { executeScript: async () => [{ result: null }] },
    };
  });
  await page.route("**/popup.html", (r) => r.fulfill({ path: "apple/Extension/Resources/popup.html", contentType: "text/html" }));
  await page.route("**/popup.js", (r) => r.fulfill({ path: "apple/Extension/Resources/popup.js", contentType: "text/javascript" }));
  await page.route("https://api.anthropic.com/**", (r) =>
    r.fulfill({ status: 200, contentType: "text/event-stream", body: CODES_TURN }),
  );
  await page.goto("/popup.html");
  return { clicks };
}

test("coupon run lists every attempt, keeps the best, never clicks order", async ({ page }) => {
  const { clicks } = await openPopup(page);
  await page.getByRole("button", { name: "Find coupons" }).click();
  const table = page.getByRole("table");
  await expect(page.getByText("Best code SAVE20 applied")).toBeVisible();
  const rows = table.locator("tbody tr");
  await expect(rows).toHaveCount(5);
  await expect(rows.nth(0)).toContainText("WELCOME5");
  await expect(rows.nth(0)).toContainText("$100.00");
  await expect(rows.nth(1)).toContainText("SAVE10");
  await expect(rows.nth(1)).toContainText("$90.00");
  await expect(rows.nth(3)).toContainText("SAVE20");
  await expect(rows.nth(3)).toContainText("$80.00");
  // e3 is "Place order": it must never be clicked.
  expect(clicks).not.toContain("e3");
  // 5 tries plus one re-apply of the winner, all on Apply (e2).
  expect(clicks).toEqual(["e2", "e2", "e2", "e2", "e2", "e2"]);
});
