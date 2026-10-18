import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { withWorker } from "./worker";

// T017 evidence for safeguards 13, 14, 15: axe-core WCAG 2.2 A/AA rules in
// WebKit (Safari's engine), light and dark, plus a keyboard walk. Stubbed
// `browser` namespace, synthetic data, no network.
async function openPopup(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const data: Record<string, unknown> = {
      settings: { provider: "anthropic", model: "claude-sonnet-5-5", retention: "7" },
      modelMigration: "haiku-5-5-high",
      // OpenAI allowed, Anthropic not: Settings shows a Withdraw button and the first chat request asks.
      aiConsent: { openai: { at: 1, version: 2 } },
    };
    (globalThis as unknown as { browser: unknown }).browser = {
      runtime: {
        sendMessage: async () => ({ ok: true }),
        sendNativeMessage: async () => ({ ok: true, value: "sk-test-synthetic" }),
        onMessage: { addListener() {} },
      },
      tabs: { query: async () => [{ id: 1, title: "Fixture shop", url: "https://shop.test/" }] },
      permissions: { request: async () => true, getAll: async () => ({ origins: ["https://shop.test/*"] }), remove: async () => true },
      scripting: { executeScript: async () => [] },
      storage: {
        local: {
          get: async (k: string | string[]) => {
            const list = Array.isArray(k) ? k : [k];
            return Object.fromEntries(list.filter((x) => x in data).map((x) => [x, data[x]]));
          },
          set: async (items: Record<string, unknown>) => void Object.assign(data, items),
          clear: async () => undefined,
        },
      },
    };
  });
  for (const f of ["popup.html", "popup.js", "privacy.html", "terms.html"]) {
    await page.context().route(`**/${f}`, (r) =>
      r.fulfill({ path: `apple/Extension/Resources/${f}`, contentType: f.endsWith(".js") ? "text/javascript" : "text/html" }),
    );
  }
  // No live provider calls (Settings loads the model list).
  await page.route("https://api.anthropic.com/**", (r) => r.fulfill({ status: 401, body: "{}" }));
  await withWorker(page);
  await page.goto("/popup.html");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
}

const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

async function axe(page: Page): Promise<string[]> {
  const r = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  return r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`);
}

for (const scheme of ["light", "dark"] as const) {
  test.describe(`${scheme} scheme`, () => {
    test.use({ colorScheme: scheme });

    test("popup chat view has no WCAG 2.2 AA violations", async ({ page }) => {
      await openPopup(page);
      expect(await axe(page)).toEqual([]);
    });

    test("popup model menu has no WCAG 2.2 AA violations", async ({ page }) => {
      await openPopup(page);
      await page.locator("#model-pill").click();
      await expect(page.getByRole("dialog", { name: "Models" })).toBeVisible();
      expect(await axe(page)).toEqual([]);
    });

    // Asked before the first request to a provider (tests/e2e/consent.spec.ts).
    test("popup consent dialog has no WCAG 2.2 AA violations", async ({ page }) => {
      await openPopup(page);
      await page.getByLabel("Ask about this page").fill("Hi");
      await page.getByLabel("Ask about this page").press("Enter");
      await expect(page.getByRole("dialog", { name: "Share with Anthropic?" })).toBeVisible();
      expect(await axe(page)).toEqual([]);
    });

    test("popup settings view has no WCAG 2.2 AA violations", async ({ page }) => {
      await openPopup(page);
      await page.getByRole("button", { name: "Settings" }).click();
      expect(await axe(page)).toEqual([]);
    });

    for (const doc of ["privacy.html", "terms.html"]) {
      test(`${doc} has no WCAG 2.2 AA violations`, async ({ page }) => {
        await openPopup(page);
        await page.goto(`/${doc}`);
        expect(await axe(page)).toEqual([]);
      });
    }
  });
}

// Safari on macOS moves focus to links and buttons with Option+Tab by default
// (plain Tab reaches text fields only), and Playwright WebKit mirrors that.
test("every visible control in the popup is reachable by Option+Tab and shows a focus ring", async ({ page }) => {
  await openPopup(page);
  const expected = await page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>("a[href], button, input, select, textarea, [tabindex]"))
      .filter((el) => el.tabIndex >= 0 && !(el as HTMLButtonElement).disabled && el.offsetParent !== null)
      .map((el) => el.id || el.getAttribute("aria-label") || el.textContent?.trim() || el.tagName),
  );
  expect(expected.length).toBeGreaterThan(0);
  const seen: string[] = [];
  for (let i = 0; i < expected.length + 2; i++) {
    await page.keyboard.press("Alt+Tab");
    const info = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body) return null;
      const hasRing = (n: Element): boolean => {
        const cs = getComputedStyle(n);
        return (cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) > 0) || cs.boxShadow.includes("0px 0px 0px");
      };
      // The message box draws focus on its container (.composer-box) instead of the textarea.
      const box = el.closest(".composer-box");
      const ring = hasRing(el) || (el.id === "question" && box !== null && hasRing(box));
      return { name: el.id || el.getAttribute("aria-label") || el.textContent?.trim() || el.tagName, ring };
    });
    if (!info) continue;
    expect(info.ring, `focus ring on ${info.name}`).toBe(true);
    if (!seen.includes(info.name)) seen.push(info.name);
  }
  for (const name of expected) expect(seen, `Option+Tab reaches ${name}`).toContain(name);
});
