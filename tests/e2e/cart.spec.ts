import { expect, test, type Page } from "@playwright/test";

// T031: the content script's Shopify cart handlers against the local fake
// store (scripts/serve-fixtures.mjs). Synthetic codes only; no real store.
type Handler = (m: unknown) => unknown;

async function load(page: Page): Promise<void> {
  await page.goto("/shopify-cart.html");
  await expect(page.locator("#total")).toHaveText("Total: $151.79");
  await page.addScriptTag({ path: "apple/Extension/Resources/content.js" });
}

const call = <T>(page: Page, req: unknown): Promise<T> =>
  page.evaluate((r) => (window as unknown as { __safariScoutHandle: Handler }).__safariScoutHandle(r), req) as Promise<T>;

interface Cart {
  total: number;
  codes: Array<{ code: string; applicable: boolean }>;
}

test("reads the Shopify cart and tests codes through the store's own cart endpoint", async ({ page }) => {
  await load(page);
  const info = await call<Cart>(page, { type: "assistant:cart-info" });
  expect(info.total).toBe(151.79);
  const good = await call<Cart>(page, { type: "assistant:cart-update", discount: "BEEFY15" });
  expect(good.codes).toEqual([{ code: "BEEFY15", applicable: true }]);
  expect(good.total).toBe(135.81);
  const bad = await call<Cart>(page, { type: "assistant:cart-update", discount: "NOPE10" });
  expect(bad.codes).toEqual([{ code: "NOPE10", applicable: false }]);
  expect(bad.total).toBe(151.79);
  // Checkout is never touched by these calls.
  await expect(page.locator("#status")).toHaveText("");
});

test("returns null on a store that is not Shopify", async ({ page }) => {
  // The fake store serves /cart.js on every page of this origin; a non-Shopify
  // store has none.
  await page.route("**/cart.js", (r) => r.fulfill({ status: 404, contentType: "text/html", body: "not found" }));
  await page.goto("/shop.html");
  await page.addScriptTag({ path: "apple/Extension/Resources/content.js" });
  expect(await call(page, { type: "assistant:cart-info" })).toBeNull();
});
