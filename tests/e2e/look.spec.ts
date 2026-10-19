import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { withWorker } from "./worker";

// Looks (owner choice 2026-10-19): the panel opens in Trailhead, Settings > Look
// switches between the six looks at once, the choice is kept, and each look
// passes the WCAG 2.2 AA rules in light and dark. Stubbed browser APIs,
// synthetic data, no network.
async function openPopup(page: Page, data: Record<string, unknown> = {}): Promise<void> {
  await page.addInitScript((seed) => {
    const g = globalThis as unknown as Record<string, unknown>;
    const kept = sessionStorage.getItem("__fake");
    const store: Record<string, unknown> = kept ? JSON.parse(kept) : {
      settings: { provider: "anthropic", model: "claude-haiku-5-5", retention: "7" },
      aiConsent: { anthropic: { at: 1, version: 2 } },
      ...seed,
    };
    const save = () => sessionStorage.setItem("__fake", JSON.stringify(store));
    save();
    g.__store = store;
    g.browser = {
      runtime: {
        sendMessage: async () => ({ ok: true }),
        sendNativeMessage: async (_a: string, m: { type: string }) => (m.type === "keychain.get" ? { ok: true, value: "sk-ant-test-synthetic-LOOK" } : { ok: true }),
        onMessage: { addListener() {} },
      },
      tabs: { query: async () => [{ id: 1, title: "Fixture page", url: "https://news.test/a" }] },
      permissions: { request: async () => true, getAll: async () => ({ origins: [] }), remove: async () => true },
      scripting: { executeScript: async () => [{ result: { url: "https://news.test/a", title: "Fixture page", text: "Synthetic text." } }] },
      storage: {
        local: {
          get: async (k: string | string[]) => {
            const list = Array.isArray(k) ? k : [k];
            return JSON.parse(JSON.stringify(Object.fromEntries(list.filter((x) => x in store).map((x) => [x, store[x]]))));
          },
          set: async (items: Record<string, unknown>) => {
            Object.assign(store, JSON.parse(JSON.stringify(items)));
            save();
          },
          clear: async () => {
            for (const k of Object.keys(store)) delete store[k];
            save();
          },
        },
      },
    };
  }, data);
  for (const f of ["popup.html", "popup.js"]) {
    await page.route(`**/${f}`, (r) => r.fulfill({ path: `apple/Extension/Resources/${f}`, contentType: f.endsWith(".js") ? "text/javascript" : "text/html" }));
  }
  await page.route("**/icons/**", (r) => r.fulfill({ status: 200, contentType: "image/png", body: "" }));
  await page.route("https://api.anthropic.com/**", (r) => r.fulfill({ status: 401, body: "{}" }));
  await withWorker(page);
  await page.goto("/popup.html");
  await expect(page.locator("#composer")).toBeVisible();
}

const look = (page: Page) => page.evaluate(() => document.documentElement.dataset.look);

test("opens in Trailhead, with its greeting and only the two starters", async ({ page }) => {
  await openPopup(page);
  expect(await look(page)).toBe("trailhead");
  await expect(page.locator("#greeting")).toHaveText(/Where to next\?/);
  await expect(page.locator("#starters button:visible")).toHaveText([/Summarize this page/, /Explain the key points/]);
});

test("Settings > Look switches at once, is saved, and is kept on the next open", async ({ page }) => {
  await openPopup(page);
  await page.getByRole("button", { name: "Settings" }).click();
  const group = page.getByRole("group", { name: "Look" });
  await expect(group.getByRole("radio")).toHaveCount(6);
  await expect(group.getByRole("radio", { name: /Trailhead/ })).toBeChecked();
  await group.getByRole("radio", { name: /Night Ops/ }).check();
  expect(await look(page)).toBe("nightops");
  await expect.poll(() => page.evaluate(() => (globalThis as unknown as { __store: Record<string, unknown> }).__store.look)).toBe("nightops");
  await page.reload();
  await expect(page.locator("#composer")).toBeVisible();
  expect(await look(page)).toBe("nightops");
  await expect(page.locator("#greeting")).toHaveText(/What should Scout do\?/);
});

test("a look saved on another device wins over a stale cache; Classic has no greeting", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("scout.look", "ink"));
  await openPopup(page, { look: "classic" });
  await expect.poll(() => look(page)).toBe("classic");
  await expect(page.locator("#greeting")).toBeHidden();
  await expect(page.locator("#starters button:visible")).toHaveCount(2);
});

test("Delete all data goes back to Trailhead, now and on the next open", async ({ page }) => {
  await openPopup(page, { look: "nightops" });
  await expect.poll(() => look(page)).toBe("nightops");
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("button", { name: "Delete all data" }).click();
  await page.getByRole("button", { name: "Yes, delete all data" }).click();
  await expect(page.locator("#delete-result")).toBeVisible();
  expect(await look(page)).toBe("trailhead");
  await expect(page.getByRole("group", { name: "Look" }).getByRole("radio", { name: /Trailhead/ })).toBeChecked();
  await page.reload();
  await expect(page.locator("#composer")).toBeVisible();
  await expect.poll(() => look(page)).toBe("trailhead");
});

test("every look shows only Summarize and Explain, each on one line, with nothing cut off on a short iPhone sheet", async ({ browser }) => {
  for (const id of ["trailhead", "apple", "nightops", "dealhunter", "ink", "classic"]) {
    const page = await browser.newPage({ viewport: { width: 393, height: 390 }, hasTouch: true, isMobile: true });
    await openPopup(page, { look: id });
    await expect.poll(() => look(page)).toBe(id);
    await expect(page.locator("#starters button:visible")).toHaveText([/Summarize this page/, /Explain the key points/]);
    const boxes = await page.locator("#starters button:visible").evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
    for (const h of boxes) expect(h, id).toBeLessThanOrEqual(44);
    // The little car stays on a short sheet, above the title and clear of the starters (owner 2026-10-19).
    const car = (await page.locator("#empty .scout-mark").boundingBox())!;
    expect(car.height, id).toBeLessThanOrEqual(40);
    const first = (await page.locator("#starters button:visible").first().boundingBox())!;
    expect(car.y + car.height, id).toBeLessThanOrEqual(first.y);
    await expect(page.locator("#greeting-sub")).toBeHidden();
    await page.close();
  }
});

test.describe("iPhone", () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 393, height: 740 } });

  test("opens in Pure Apple: the little car, \"Ask Scout\", and the new question-box hint", async ({ page }) => {
    await openPopup(page);
    expect(await look(page)).toBe("apple");
    await expect(page.locator("#greeting")).toHaveText("Ask Scout");
    await expect(page.locator("#greeting-sub")).toBeHidden();
    await expect(page.locator("#question")).toHaveAttribute("placeholder", "What can Scout help with today?");
    // The little car sits above the title; nothing else in the box but the hint.
    const car = page.locator("#empty .scout-mark");
    await expect(car).toBeVisible();
    expect((await car.boundingBox())!.y).toBeLessThan((await page.locator("#greeting").boundingBox())!.y);
  });

  test("Delete all data goes back to Pure Apple, and a chosen look is kept", async ({ page }) => {
    await openPopup(page, { look: "trailhead" });
    await expect.poll(() => look(page)).toBe("trailhead");
    await page.getByRole("button", { name: "Settings" }).click();
    await page.getByRole("button", { name: "Delete all data" }).click();
    await page.getByRole("button", { name: "Yes, delete all data" }).click();
    await expect(page.locator("#delete-result")).toBeVisible();
    expect(await look(page)).toBe("apple");
  });
});

test("Mac keeps Trailhead, with the same hint and the little car over the title", async ({ page }) => {
  await openPopup(page);
  expect(await look(page)).toBe("trailhead");
  await expect(page.locator("#question")).toHaveAttribute("placeholder", "What can Scout help with today?");
  await expect(page.locator("#empty .scout-mark")).toBeVisible();
  await expect(page.locator("#greeting")).toHaveText("Where to next?");
});

const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
for (const scheme of ["light", "dark"] as const) {
  test.describe(`${scheme} scheme`, () => {
    test.use({ colorScheme: scheme });
    for (const id of ["trailhead", "apple", "nightops", "dealhunter", "ink", "classic"]) {
      test(`${id}: new chat and Settings have no WCAG 2.2 AA violations`, async ({ page }) => {
        await openPopup(page, { look: id });
        await expect.poll(() => look(page)).toBe(id);
        await page.waitForTimeout(200); // let the 150 ms color transitions finish
        const chat = await new AxeBuilder({ page }).withTags(WCAG).analyze();
        expect(chat.violations.map((v) => v.id + ": " + v.nodes.map((n) => n.target.join(" ")).join(", "))).toEqual([]);
        await page.getByRole("button", { name: "Settings" }).click();
        await page.waitForTimeout(200);
        const settings = await new AxeBuilder({ page }).withTags(WCAG).analyze();
        expect(settings.violations.map((v) => v.id + ": " + v.nodes.map((n) => n.target.join(" ")).join(", "))).toEqual([]);
      });
    }
  });
}
