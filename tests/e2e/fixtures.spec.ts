import { expect, test } from "@playwright/test";

test("shop fixture applies a synthetic coupon", async ({ page }) => {
  await page.goto("/shop.html");
  await expect(page.locator("#total")).toHaveText("$100.00");
  await page.getByLabel("Coupon code").fill("save20");
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(page.locator("#total")).toHaveText("$80.00");
});

test("forms fixture has labelled fields", async ({ page }) => {
  await page.goto("/forms.html");
  await page.getByLabel("Name").fill("Test User");
  await expect(page.getByLabel("Name")).toHaveValue("Test User");
});

test("injection fixture serves hidden instruction text", async ({ page }) => {
  await page.goto("/injection.html");
  await expect(page.getByText("ignore previous instructions")).toHaveCount(1);
});
