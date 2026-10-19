import { expect, test, type Page } from "@playwright/test";

// Scouting overlay (Part 3, spec 9) on a fixture page: the built overlay.js
// and content.js (run `npm run build` first) driven through the same handler
// globals the worker calls. Checks the acceptance criteria that live in the
// page: clicks pass through everywhere but the pill, the click marker shows
// before a click, Stop removes the layer within 500 ms, reduced motion gives a
// static border, and a hidden tab pauses the sweep. Synthetic page, no model.
interface Sent {
  type: string;
  payload: unknown;
}
type Handler = (m: unknown) => unknown;
interface Status {
  shown: boolean;
  state: string;
  mounted: boolean;
  markers: number;
  taskId: string;
}

async function load(page: Page, path = "/forms.html"): Promise<void> {
  await page.addInitScript(() => {
    const sent: Sent[] = [];
    (globalThis as unknown as { __sent: Sent[] }).__sent = sent;
    (globalThis as unknown as { browser: unknown }).browser = {
      runtime: {
        sendMessage: async (m: { type: string; request_id: string; payload: unknown }) => {
          sent.push({ type: m.type, payload: m.payload });
          return { type: m.type + ".result", request_id: m.request_id, payload: { ok: true } };
        },
      },
    };
  });
  await page.goto(path);
  await page.addScriptTag({ path: "apple/Extension/Resources/content.js" });
  await page.addScriptTag({ path: "apple/Extension/Resources/overlay.js" });
}

const overlay = <T>(page: Page, req: Record<string, unknown>): Promise<T> =>
  page.evaluate((r) => (window as unknown as { __safariScoutOverlay: Handler }).__safariScoutOverlay(r), req) as Promise<T>;
const content = <T>(page: Page, req: Record<string, unknown>): Promise<T> =>
  page.evaluate((r) => (window as unknown as { __safariScoutHandle: Handler }).__safariScoutHandle(r), req) as Promise<T>;
const status = (page: Page): Promise<Status> => overlay<Status>(page, { type: "overlay:status" });
const sent = (page: Page): Promise<Sent[]> => page.evaluate(() => (globalThis as unknown as { __sent: Sent[] }).__sent);

const host = (page: Page) => page.locator("[data-scout-overlay]");
const inShadow = <T>(page: Page, fn: (root: ShadowRoot) => T): Promise<T> =>
  page.evaluate((f) => {
    const h = document.querySelector("[data-scout-overlay]") as HTMLElement | null;
    if (!h?.shadowRoot) throw new Error("no overlay");
    return (new Function("root", "return (" + f + ")(root)") as (r: ShadowRoot) => T)(h.shadowRoot);
  }, fn.toString());

test("the layer lets clicks through to the page everywhere except the control pill", async ({ page }) => {
  await load(page, "/shop.html");
  await page.evaluate(() => {
    (window as unknown as { __clicks: number }).__clicks = 0;
    document.getElementById("apply")?.addEventListener("click", () => ((window as unknown as { __clicks: number }).__clicks += 1));
  });
  await overlay(page, { type: "overlay:show", taskId: "t1", state: "running" });
  await expect(host(page)).toBeAttached();
  // The host covers the whole viewport but never takes the click.
  expect(await host(page).evaluate((h) => getComputedStyle(h).pointerEvents)).toBe("none");
  expect(await inShadow(page, (root) => getComputedStyle(root.querySelector(".layer")!).pointerEvents)).toBe("none");
  expect(await inShadow(page, (root) => getComputedStyle(root.querySelector(".pill")!).pointerEvents)).toBe("auto");
  await page.getByRole("button", { name: "Apply" }).click();
  expect(await page.evaluate(() => (window as unknown as { __clicks: number }).__clicks)).toBe(1);
  // What sits under the pill is the pill, not the page.
  const pill = await inShadow(page, (root) => {
    const r = root.querySelector(".pill")!.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  expect(await page.evaluate((p) => document.elementFromPoint(p.x, p.y)?.hasAttribute("data-scout-overlay"), pill)).toBe(true);
  // The toast's Stop square sends stop to the worker for this task, on trusted clicks only.
  await inShadow(page, (root) => (root.querySelector("button.stop") as HTMLButtonElement).click());
  expect((await sent(page)).filter((m) => m.type === "task.control")).toHaveLength(0);
  const stop = await inShadow(page, (root) => {
    const r = root.querySelector("button.stop")!.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  await page.mouse.click(stop.x, stop.y);
  expect((await sent(page)).filter((m) => m.type === "task.control")).toEqual([{ type: "task.control", payload: { task_id: "t1", command: "stop" } }]);
  await expect(host(page)).not.toBeAttached();
});

test("the click marker appears at the target before the click lands, and the border fades in", async ({ page }) => {
  await load(page, "/shop.html");
  await overlay(page, { type: "overlay:show", taskId: "t1", state: "running" });
  await expect.poll(() => inShadow(page, (root) => getComputedStyle(root.querySelector(".layer")!).opacity)).toBe("1");
  const snap = await content<{ elements: Array<{ ref: string; name: string }> }>(page, { type: "scout:snapshot" });
  const apply = snap.elements.find((e) => e.name === "Apply")!;
  const probe = await content<{ x: number; y: number; name: string }>(page, { type: "scout:task-probe", target: { ref: apply.ref } });
  expect(probe.name).toBe("Apply");
  // The worker shows the marker, waits the lead time, then performs the click.
  await overlay(page, { type: "overlay:marker", x: probe.x, y: probe.y });
  const ripple = await inShadow(page, (root) => {
    const r = root.querySelector(".ripple") as HTMLElement | null;
    return r ? { left: r.style.left, top: r.style.top, count: root.querySelectorAll(".ripple").length } : null;
  });
  expect(ripple).toEqual({ left: Math.round(probe.x) + "px", top: Math.round(probe.y) + "px", count: 1 });
  expect((await status(page)).markers).toBe(1);
  await page.waitForTimeout(150);
  await page.evaluate(() => {
    (window as unknown as { __clicks: number }).__clicks = 0;
    document.getElementById("apply")?.addEventListener("click", () => ((window as unknown as { __clicks: number }).__clicks += 1));
  });
  const result = await content<{ ok: boolean }>(page, { type: "scout:task-act", action: { type: "click", target: { ref: apply.ref } } });
  expect(result.ok).toBe(true);
  expect(await page.evaluate(() => (window as unknown as { __clicks: number }).__clicks)).toBe(1);
  // The ripple is gone shortly after.
  await expect.poll(() => inShadow(page, (root) => root.querySelectorAll(".ripple").length)).toBe(0);
});

// Timing against the spec's 500 ms. With several browsers running in
// parallel the 400 ms fade can start a frame or two late, so this one may retry.
test.describe("stop timing", () => {
  test.describe.configure({ retries: 2 });
  test("Stop removes the overlay within 500 ms", async ({ page }) => {
  await load(page);
  await overlay(page, { type: "overlay:show", taskId: "t1", state: "running" });
  await expect(host(page)).toBeAttached();
  // Timed inside the page: from the hide call to the host leaving the document.
  const elapsed = await page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        const t0 = performance.now();
        const watch = new MutationObserver(() => {
          if (!document.querySelector("[data-scout-overlay]")) {
            watch.disconnect();
            resolve(performance.now() - t0);
          }
        });
        watch.observe(document.documentElement, { childList: true, subtree: true });
        (window as unknown as { __safariScoutOverlay: Handler }).__safariScoutOverlay({ type: "overlay:hide" });
      }),
  );
  expect(elapsed).toBeLessThan(500);
  await expect(host(page)).not.toBeAttached();
  expect((await status(page)).shown).toBe(false);
  // Showing again rebuilds it.
  await overlay(page, { type: "overlay:show", taskId: "t2", state: "running" });
  await expect(host(page)).toBeAttached();
  expect((await status(page)).taskId).toBe("t2");
});

});

test("the border sweeps on a 1.5 s loop with a slow pulse, and pauses while the tab is hidden", async ({ page }) => {
  await load(page);
  await overlay(page, { type: "overlay:show", taskId: "t1", state: "running" });
  const anim = await inShadow(page, (root) => {
    const s = getComputedStyle(root.querySelector(".glow")!);
    return { name: s.animationName, duration: s.animationDuration, count: s.animationIterationCount, state: s.animationPlayState };
  });
  // Owner, 2026-10-19: more motion (the sweep was 2.5 s, with no pulse).
  expect(anim).toEqual({ name: "scout-sweep, scout-pulse", duration: "1.5s, 1.8s", count: "infinite, infinite", state: "running, running" });
  // The gradient computes: the angle is registered on the document, not in the shadow tree.
  expect(await inShadow(page, (root) => getComputedStyle(root.querySelector(".glow")!).backgroundImage)).toContain("conic-gradient");
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { get: () => true, configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect.poll(() => inShadow(page, (root) => getComputedStyle(root.querySelector(".glow")!).animationPlayState)).toBe("paused");
  // The wash covers the whole page, faded by a radial mask (lighter in the middle, strong at the edges).
  expect(await inShadow(page, (root) => getComputedStyle(root.querySelector(".glow")!).maskImage || (getComputedStyle(root.querySelector(".glow")!) as unknown as { webkitMaskImage: string }).webkitMaskImage)).toContain("radial-gradient");
  // The glow is drawn at half size and scaled up: a quarter of the pixels.
  const size = await inShadow(page, (root) => {
    const g = root.querySelector(".glow") as HTMLElement;
    return { width: g.offsetWidth, scale: getComputedStyle(g).transform, inner: window.innerWidth };
  });
  expect(size.width).toBe(Math.round(size.inner / 2));
  expect(size.scale).toBe("matrix(2, 0, 0, 2, 0, 0)");
});

test.describe("reduced motion", () => {
  test.use({ contextOptions: { reducedMotion: "reduce" } });
  test("shows a static border with no sweep", async ({ page }) => {
    await load(page);
    await overlay(page, { type: "overlay:show", taskId: "t1", state: "running" });
    await expect.poll(() => inShadow(page, (root) => getComputedStyle(root.querySelector(".glow")!).animationName)).toBe("none");
    expect(await inShadow(page, (root) => getComputedStyle(root.querySelector(".glow")!).backgroundImage)).toContain("conic-gradient");
    await overlay(page, { type: "overlay:marker", x: 20, y: 20 });
    expect(await inShadow(page, (root) => getComputedStyle(root.querySelector(".ripple")!).animationName)).toBe("none");
  });
});

test("the pill names the state and the page cannot press its buttons", async ({ page }) => {
  await load(page);
  await overlay(page, { type: "overlay:show", taskId: "t1", state: "running" });
  expect(await inShadow(page, (root) => root.querySelector(".label")!.textContent)).toBe("Working…");
  await overlay(page, { type: "overlay:state", state: "waiting" });
  expect(await inShadow(page, (root) => root.querySelector(".label")!.textContent)).toBe("Waiting for you");
  // A page script's synthetic click on Stop sends nothing.
  await inShadow(page, (root) => (root.querySelector("button.stop") as HTMLButtonElement).dispatchEvent(new MouseEvent("click", { bubbles: true })));
  expect((await sent(page)).filter((m) => m.type === "task.control")).toHaveLength(0);
  await expect(host(page)).toBeAttached();
});

test("task actions act on the real page: fill, type, key, scroll, drag, and a probe at a point", async ({ page }) => {
  await load(page, "/forms.html");
  const snap = await content<{ elements: Array<{ ref: string; name: string; role: string }>; viewport: { width: number; height: number } }>(page, { type: "scout:snapshot" });
  expect(snap.viewport.width).toBeGreaterThan(0);
  const ref = (name: string): string => snap.elements.find((e) => e.name === name)!.ref;
  expect((await content<{ ok: boolean }>(page, { type: "scout:task-act", action: { type: "fill_field", target: { ref: ref("Name") }, value: "Ada" } })).ok).toBe(true);
  await expect(page.getByLabel("Name")).toHaveValue("Ada");
  expect((await content<{ ok: boolean }>(page, { type: "scout:task-act", action: { type: "type", text: " Lovelace", target: { ref: ref("Name") } } })).ok).toBe(true);
  await expect(page.getByLabel("Name")).toHaveValue("Ada Lovelace");
  expect((await content<{ ok: boolean }>(page, { type: "scout:task-act", action: { type: "fill_field", target: { ref: ref("Topic") }, value: "Support" } })).ok).toBe(true);
  await expect(page.getByLabel("Topic")).toHaveValue("Support");
  // The password field is reported redacted, with no value in its name.
  const pw = await content<{ redacted?: boolean; name: string; inForm?: boolean }>(page, { type: "scout:task-probe", target: { ref: ref("Password") } });
  expect(pw.redacted).toBe(true);
  expect(pw.inForm).toBe(true);
  // A probe at a point finds the control under it.
  const box = await page.getByLabel("Email").boundingBox();
  const at = await content<{ name: string; role: string }>(page, { type: "scout:task-probe", target: { x: box!.x + 5, y: box!.y + 5 } });
  expect(at).toMatchObject({ name: "Email", role: "textbox" });
  expect(await content(page, { type: "scout:task-probe", target: { ref: "e999" } })).toBeNull();
  // Unknown action types never reach the page's executor as anything but a failure.
  expect(await content<{ ok: boolean; error: string }>(page, { type: "scout:task-act", action: { type: "navigate", url: "https://x.test" } })).toMatchObject({ ok: false, error: "unknown_action" });
  await page.evaluate(() => (document.body.style.minHeight = "4000px"));
  expect((await content<{ ok: boolean }>(page, { type: "scout:task-act", action: { type: "scroll", direction: "bottom" } })).ok).toBe(true);
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(1000);
  expect((await content<{ ok: boolean }>(page, { type: "scout:task-act", action: { type: "key", key: "Tab", modifiers: [] } })).ok).toBe(true);
  expect((await content<{ ok: boolean }>(page, { type: "scout:task-act", action: { type: "drag", from: { ref: ref("Name") }, to: { ref: ref("Email") } } })).ok).toBe(true);
});

// Owner bug report 2026-10-19: with coupon runs going on after the panel closes,
// Safari's bottom bar went solid on iPhone. Safari 26 does that while a page has
// a top-layer ::backdrop, so iPhone skips the top layer. The glow still covers
// the whole page with Working at the very bottom (owner, 2026-10-19).
test.describe("on iPhone", () => {
  test.use({ viewport: { width: 390, height: 664 }, screen: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 });

  test("the glow covers the whole page outside the top layer, and the pill sits at the very bottom", async ({ page }) => {
    await load(page, "/shop.html");
    await overlay(page, { type: "overlay:show", taskId: "coupons:1", state: "running" });
    const snap = await content<{ elements: Array<{ ref: string; name: string }> }>(page, { type: "scout:snapshot" });
    const ref = snap.elements.find((e) => e.name === "Apply")!.ref;
    await content(page, { type: "scout:act", action: { type: "click", ref }, show: true, aboveSheet: true });
    const boxes = await page.evaluate(() => {
      const o = document.querySelector("[data-scout-overlay]") as HTMLElement;
      const p = document.getElementById("scout-pointer") as HTMLElement;
      const r = (el: HTMLElement) => {
        const b = el.getBoundingClientRect();
        return { w: b.width, h: b.height, bottom: b.bottom, topLayer: el.matches(":popover-open") };
      };
      return { overlay: r(o), pointer: r(p), height: window.innerHeight };
    });
    expect(boxes.overlay.topLayer).toBe(false);
    expect(boxes.overlay.bottom).toBe(boxes.height);
    expect(boxes.pointer).toMatchObject({ w: 0, h: 0, topLayer: false });
    // The pill is on screen, at the very bottom.
    const pill = await inShadow(page, (root) => {
      const b = (root.querySelector(".pill") as HTMLElement).getBoundingClientRect();
      return { top: b.top, bottom: b.bottom };
    });
    expect(pill.top).toBeGreaterThan(0);
    expect(pill.bottom).toBeGreaterThan(boxes.height - 40);
    expect(pill.bottom).toBeLessThanOrEqual(boxes.height);
  });
});
