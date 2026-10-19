import { expect, test, type Page } from "@playwright/test";

// Loads the built content script (run `npm run build` first) into a fixture
// page, then drives it through the same handler the popup calls via
// scripting.executeScript.
type Req = { type: "scout:snapshot" } | { type: "scout:act"; action: Record<string, unknown>; show?: boolean };
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

test("coupon runs show a pointer that presses Apply and types the code one character at a time", async ({ page }) => {
  await load(page, "/shop.html");
  await page.evaluate(() => {
    const w = window as unknown as { __values: string[] };
    w.__values = [];
    document.getElementById("coupon")?.addEventListener("input", (e) => w.__values.push((e.target as HTMLInputElement).value));
  });
  const snap = await send<Snap>(page, { type: "scout:snapshot" });
  const typed = await send<Result>(page, { type: "scout:act", action: { type: "type", ref: refFor(snap, "Coupon code"), text: "SAVE20" }, show: true });
  expect(typed.ok).toBe(true);
  await expect(page.getByLabel("Coupon code")).toHaveValue("SAVE20");
  // Cleared first, then one change per character, as a person typing makes.
  const values = await page.evaluate(() => (window as unknown as { __values: string[] }).__values);
  expect(values).toEqual(["", "S", "SA", "SAV", "SAVE", "SAVE2", "SAVE20"]);
  // The pointer is on the page, hidden from assistive tech and from Scout's own snapshots.
  const host = page.locator("#scout-pointer");
  await expect(host).toHaveAttribute("aria-hidden", "true");
  const again = await send<Snap>(page, { type: "scout:snapshot" });
  expect(again.elements.length).toBe(snap.elements.length);
  // It lets clicks through: a real click on Apply under it still lands.
  const clicked = await send<Result>(page, { type: "scout:act", action: { type: "click", ref: refFor(snap, "Apply") }, show: true });
  expect(clicked.ok).toBe(true);
  await expect(page.locator("#total")).toHaveText("$80.00");
  await page.getByRole("button", { name: "Place order" }).click();
  await expect(page.locator("#order-status")).toHaveText("Order placed.");
});

test("on iPhone the pointer works above the panel's sheet: the coupon box is scrolled into the top part of the page", async ({ page }) => {
  await load(page, "/shop.html");
  // A long page, with the coupon box far down.
  await page.evaluate(() => {
    document.body.style.paddingTop = "1500px";
    document.body.style.paddingBottom = "1500px";
  });
  const snap = await send<Snap>(page, { type: "scout:snapshot" });
  const typed = await send<Result>(page, { type: "scout:act", action: { type: "type", ref: refFor(snap, "Coupon code"), text: "SAVE20" }, show: true, aboveSheet: true });
  expect(typed.ok).toBe(true);
  const box = await page.evaluate(() => {
    const r = document.getElementById("coupon")!.getBoundingClientRect();
    return { top: r.top, bottom: r.bottom, height: window.innerHeight };
  });
  // Above the half-height sheet (src/actions/pointer.ts ABOVE_SHEET), not behind it.
  expect(box.top).toBeGreaterThan(0);
  expect(box.bottom).toBeLessThanOrEqual(box.height * 0.42);
});

test("without show, actions stay instant and draw nothing", async ({ page }) => {
  await load(page, "/shop.html");
  const snap = await send<Snap>(page, { type: "scout:snapshot" });
  await act(page, { type: "type", ref: refFor(snap, "Coupon code"), text: "SAVE10" });
  await expect(page.getByLabel("Coupon code")).toHaveValue("SAVE10");
  await expect(page.locator("#scout-pointer")).toHaveCount(0);
});
