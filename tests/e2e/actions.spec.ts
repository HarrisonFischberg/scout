import { expect, test, type Page } from "@playwright/test";

// Loads the built content script (run `npm run build` first) into a fixture
// page, then drives it through the same handler the popup calls via
// scripting.executeScript.
type Req = { type: "scout:snapshot" } | { type: "scout:act"; action: Record<string, unknown> };
interface Snap {
  elements: Array<{ ref: string; name: string; role: string; value?: string }>;
}
interface Result {
  ok: boolean;
  error?: string;
  message: string;
}
type Handler = (m: unknown) => unknown;

async function load(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await page.addScriptTag({ path: "apple/Extension/Resources/content.js" });
}

const send = <T>(page: Page, req: Req): Promise<T> =>
  page.evaluate((r) => (window as unknown as { __safariScoutHandle: Handler }).__safariScoutHandle(r), req) as Promise<T>;

const act = (page: Page, action: Record<string, unknown>): Promise<Result> =>
  send<Result>(page, { type: "scout:act", action });

const refFor = (snap: Snap, name: string): string => {
  const el = snap.elements.find((e) => e.name === name);
  if (!el) throw new Error("no element named " + name);
  return el.ref;
};

test("type and select by ref on the forms fixture", async ({ page }) => {
  await load(page, "/forms.html");
  const snap = await send<Snap>(page, { type: "scout:snapshot" });
  const typed = await act(page, { type: "type", ref: refFor(snap, "Name"), text: "Test User" });
  expect(typed.ok).toBe(true);
  await expect(page.getByLabel("Name")).toHaveValue("Test User");
  const picked = await act(page, { type: "select", ref: refFor(snap, "Topic"), value: "Support" });
  expect(picked.ok).toBe(true);
  await expect(page.getByLabel("Topic")).toHaveValue("Support");
});

test("type and click by ref on the shop fixture", async ({ page }) => {
  await load(page, "/shop.html");
  const snap = await send<Snap>(page, { type: "scout:snapshot" });
  await act(page, { type: "type", ref: refFor(snap, "Coupon code"), text: "save20" });
  const clicked = await act(page, { type: "click", ref: refFor(snap, "Apply") });
  expect(clicked.ok).toBe(true);
  await expect(page.locator("#total")).toHaveText("$80.00");
});

test("scroll and wait succeed", async ({ page }) => {
  await load(page, "/shop.html");
  await page.evaluate(() => {
    document.body.style.minHeight = "5000px";
  });
  await send(page, { type: "scout:snapshot" });
  expect((await act(page, { type: "scroll", direction: "bottom" })).ok).toBe(true);
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  expect((await act(page, { type: "wait", ms: 20 })).ok).toBe(true);
});

test("navigate follows http paths and blocks other schemes", async ({ page }) => {
  await load(page, "/index.html");
  const bad = await act(page, { type: "navigate", url: "javascript:alert(1)" });
  expect(bad).toMatchObject({ ok: false, error: "blocked_url" });
  const res = await act(page, { type: "navigate", url: "/shop.html" });
  expect(res.ok).toBe(true);
  await page.waitForURL("**/shop.html");
});

test("missing ref fails cleanly and the page is unchanged", async ({ page }) => {
  await load(page, "/shop.html");
  await send(page, { type: "scout:snapshot" });
  const res = await act(page, { type: "click", ref: "e999" });
  expect(res).toMatchObject({ ok: false, error: "no_ref" });
  await expect(page.locator("#total")).toHaveText("$100.00");
});

test("stale ref after the element is removed fails cleanly", async ({ page }) => {
  await load(page, "/shop.html");
  const snap = await send<Snap>(page, { type: "scout:snapshot" });
  const ref = refFor(snap, "Apply");
  await page.evaluate(() => document.getElementById("apply")?.remove());
  expect(await act(page, { type: "click", ref })).toMatchObject({ ok: false, error: "stale_ref" });
});
