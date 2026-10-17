import { expect, test, type Page } from "@playwright/test";

// Part 3 overlay and executor (spec 9, 8.2) at the content-script level: the
// built content.js (run `npm run build` first) on a synthetic fixture page,
// driven through the same handler the worker calls via scripting.executeScript.
// Debug builds expose the overlay's closed shadow root as __scoutOverlayRoot.
type Handler = (m: unknown) => unknown;
interface Result {
  ok: boolean;
  error?: string;
  message: string;
}
interface Snap {
  elements: Array<{ ref: string; name: string; role: string }>;
}

async function load(page: Page, path = "/scout.html"): Promise<void> {
  await page.goto(path);
  await page.addInitScript(() => undefined);
  // A stub `browser` so the pill can report its commands.
  await page.evaluate(() => {
    const g = globalThis as unknown as Record<string, unknown>;
    g.__sent = [];
    g.browser = { runtime: { sendMessage: async (m: unknown) => void (g.__sent as unknown[]).push(m) } };
  });
  await page.addScriptTag({ path: "apple/Extension/Resources/content.js" });
}

const send = <T>(page: Page, req: unknown): Promise<T> =>
  page.evaluate((r) => (window as unknown as { __safariScoutHandle: Handler }).__safariScoutHandle(r), req) as Promise<T>;
const act = (page: Page, action: Record<string, unknown>): Promise<Result> => send<Result>(page, { type: "scout:scout-act", action });
const refFor = async (page: Page, name: string): Promise<string> => {
  const snap = await send<Snap>(page, { type: "scout:snapshot" });
  const el = snap.elements.find((e) => e.name === name);
  if (!el) throw new Error("no element named " + name);
  return el.ref;
};
const host = (page: Page) => page.locator("scout-for-safari-overlay");
const inRoot = <T>(page: Page, fn: (root: ShadowRoot) => T): Promise<T> =>
  page.evaluate((src) => new Function("root", "return (" + src + ")(root)")((window as unknown as { __scoutOverlayRoot: ShadowRoot }).__scoutOverlayRoot) as T, fn.toString());

test("the overlay appears with the sweeping gradient border, and Stop removes it within 500 ms", async ({ page }) => {
  await load(page);
  await send(page, { type: "scout:overlay", command: "show", state: "running" });
  await expect(host(page)).toHaveCount(1);
  await expect.poll(() => inRoot(page, (root) => root.querySelector(".glow")?.classList.contains("on"))).toBe(true);
  const style = await inRoot(page, (root) => {
    const ring = root.querySelector(".ring.crisp") as HTMLElement;
    const cs = getComputedStyle(ring);
    return { animation: cs.animationName, background: cs.backgroundImage, pointer: cs.pointerEvents, hostPointer: getComputedStyle(root.host).pointerEvents, status: root.querySelector(".status")?.textContent };
  });
  expect(style.animation).toBe("scout-sweep");
  expect(style.background).toContain("conic-gradient");
  expect(style.pointer).toBe("none");
  expect(style.hostPointer).toBe("none");
  expect(style.status).toBe("Scouting…");
  const t0 = Date.now();
  await send(page, { type: "scout:overlay", command: "hide" });
  await expect(host(page)).toHaveCount(0);
  expect(Date.now() - t0).toBeLessThan(500);
});

test("reduced motion shows a static border and a hidden tab pauses the sweep", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await load(page);
  await send(page, { type: "scout:overlay", command: "show" });
  expect(await inRoot(page, (root) => getComputedStyle(root.querySelector(".ring.crisp")!).animationName)).toBe("none");
  expect(await inRoot(page, (root) => getComputedStyle(root.querySelector(".ring.crisp")!).backgroundImage)).toContain("conic-gradient");

  await page.emulateMedia({ reducedMotion: "no-preference" });
  expect(await inRoot(page, (root) => getComputedStyle(root.querySelector(".ring.crisp")!).animationName)).toBe("scout-sweep");
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  expect(await inRoot(page, (root) => getComputedStyle(root.querySelector(".ring.crisp")!).animationPlayState)).toBe("paused");
});

test("the overlay never blocks the user's clicks, except on the control pill", async ({ page }) => {
  await load(page);
  await send(page, { type: "scout:overlay", command: "show" });
  await expect(host(page)).toHaveCount(1);
  // A click on the page under the layer reaches the page.
  const more = page.getByRole("button", { name: "Show more" });
  const box = (await more.boundingBox())!;
  expect(await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.id, [box.x + box.width / 2, box.y + box.height / 2])).toBe("more");
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.locator("#extra")).toBeVisible();
  // The pill's Stop button takes the click and sends Stop to the worker.
  const stop = await inRoot(page, (root) => {
    const r = root.querySelector("button.stop")!.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  expect(await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.tagName.toLowerCase(), [stop.x, stop.y])).toBe("scout-for-safari-overlay");
  // A synthetic click from page script is ignored.
  await inRoot(page, (root) => (root.querySelector("button.stop") as HTMLButtonElement).click());
  expect(await page.evaluate(() => (globalThis as unknown as { __sent: unknown[] }).__sent)).toEqual([]);
  await page.mouse.click(stop.x, stop.y);
  const sent = await page.evaluate(() => (globalThis as unknown as { __sent: Array<{ type: string; payload: unknown }> }).__sent);
  expect(sent).toEqual([expect.objectContaining({ type: "task.control", payload: { command: "stop" } })]);
});

test("Take control on the pill halts an action in progress within 250 ms and switches to Resume", async ({ page }) => {
  await load(page);
  await send(page, { type: "scout:overlay", command: "show" });
  const pending = act(page, { type: "wait", ms: 5000 });
  await page.waitForTimeout(50);
  const control = await inRoot(page, (root) => {
    const r = root.querySelector("button.control")!.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  const t0 = Date.now();
  await page.mouse.click(control.x, control.y);
  const r = await pending;
  expect(Date.now() - t0).toBeLessThan(250);
  expect(r.ok).toBe(false);
  expect(r.error).toBe("paused");
  const sent = await page.evaluate(() => (globalThis as unknown as { __sent: Array<{ payload: unknown }> }).__sent);
  expect(sent).toEqual([expect.objectContaining({ payload: { command: "take_control" } })]);
  await send(page, { type: "scout:overlay", command: "state", state: "paused" });
  expect(await inRoot(page, (root) => [root.querySelector(".status")?.textContent, root.querySelector("button.control")?.textContent])).toEqual(["Paused. You have control.", "Resume"]);
  // Halting is per action: the next one runs.
  expect((await act(page, { type: "wait", ms: 10 })).ok).toBe(true);
});

test("the click marker ripples at the target about 150 ms before the click lands", async ({ page }) => {
  await load(page);
  await send(page, { type: "scout:overlay", command: "show" });
  await inRoot(page, (root) => {
    const w = window as unknown as { __markerAt?: number; __markerPos?: { x: string; y: string } };
    new MutationObserver((muts) => {
      for (const m of muts) {
        for (const n of Array.from(m.addedNodes)) {
          if ((n as HTMLElement).classList?.contains("marker") && w.__markerAt === undefined) {
            w.__markerAt = performance.now();
            w.__markerPos = { x: (n as HTMLElement).style.left, y: (n as HTMLElement).style.top };
          }
        }
      }
    }).observe(root, { childList: true });
  });
  const ref = await refFor(page, "Show more");
  const r = await act(page, { type: "click", target: { ref } });
  expect(r.ok).toBe(true);
  const timing = await page.evaluate(() => {
    const w = window as unknown as { __markerAt: number; __lastClickAt: number; __clicks: number; __markerPos: { x: string; y: string } };
    return { lead: w.__lastClickAt - w.__markerAt, clicks: w.__clicks, pos: w.__markerPos };
  });
  expect(timing.clicks).toBe(1);
  expect(timing.lead).toBeGreaterThanOrEqual(100);
  expect(timing.lead).toBeLessThan(400);
  const box = (await page.getByRole("button", { name: "Show more" }).boundingBox())!;
  expect(Math.abs(parseFloat(timing.pos.x) - (box.x + box.width / 2))).toBeLessThan(3);
  expect(Math.abs(parseFloat(timing.pos.y) - (box.y + box.height / 2))).toBeLessThan(3);
});

test("the executor performs the vocabulary with DOM events and refuses the rest", async ({ page }) => {
  await load(page);
  const name = await refFor(page, "Name");
  expect((await act(page, { type: "type", target: { ref: name }, text: "Ada" })).ok).toBe(true);
  await expect(page.getByLabel("Name")).toHaveValue("Ada");
  expect((await act(page, { type: "type", target: { ref: name }, text: " Lovelace", clear: false })).ok).toBe(true);
  await expect(page.getByLabel("Name")).toHaveValue("Ada Lovelace");
  const topic = await refFor(page, "Topic");
  expect((await act(page, { type: "fill_field", target: { ref: topic }, value: "Support" })).ok).toBe(true);
  await expect(page.getByLabel("Topic")).toHaveValue("Support");
  expect((await act(page, { type: "fill_field", target: { ref: topic }, value: "Nope" })).error).toBe("no_option");
  // Enter in a form field submits the form (the gate asks first in a real task).
  expect((await act(page, { type: "key", key: "Enter", target: { ref: name } })).ok).toBe(true);
  await expect(page.locator("#submitted")).toHaveText("1");
  expect((await act(page, { type: "scroll", direction: "down" })).ok).toBe(true);
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(100);
  expect((await act(page, { type: "scroll_to_element", target: { ref: name } })).ok).toBe(true);
  // A coordinate click lands on whatever is at that viewport point.
  const box = (await page.getByRole("button", { name: "Show more" }).boundingBox())!;
  expect((await act(page, { type: "click", target: { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) } })).ok).toBe(true);
  await expect(page.locator("#extra")).toBeVisible();
  expect((await act(page, { type: "click", target: { ref: "e999" } })).error).toBe("no_ref");
  expect((await act(page, { type: "wait", ms: 20 })).ok).toBe(true);
  expect((await act(page, { type: "screenshot" })).ok).toBe(true);
});
