import { expect, test, type Page } from "@playwright/test";
import { withWorker } from "./worker";

// Page button (src/edge.ts): the Scout tab on the edge of a page. Tapping it
// asks the worker to open Scout's toolbar panel (Safari's own sheet on
// iPhone). Owner bug report 2026-10-16: the first version opened the panel in
// an iframe on the page, which Safari runs in the page's process and kills
// when it calls extension APIs. Also covers its size, dragging, keyboard,
// turning it on in Settings. Stubbed browser APIs, synthetic data.
const KEY = "sk-ant-test-synthetic-EDGE-00000";
const PAGE = { url: "http://127.0.0.1/index.html", title: "Fixture index", text: "Scout for Safari fixtures. Shop, Forms, Injection." };

interface Fake {
  data: Record<string, unknown>;
  panelOpens: number;
  /** panel.warm requests: the tab getting Scout ready (src/panel/warm.ts). */
  warms: number;
  /** panel.ask payloads: the quick ask on a phone (src/quick-ask.ts). */
  asks: unknown[];
  permissionRequests: string[][];
  injected: string[][];
}

async function stub(page: Page, pageButton: unknown): Promise<void> {
  await page.addInitScript(
    ({ key, pageData, pageButton }) => {
      const g = globalThis as unknown as Record<string, unknown>;
      const top = (window.top ?? window) as unknown as Record<string, unknown>;
      if (!top.__fake) {
        top.__fake = { data: { aiConsent: { anthropic: { at: 1, version: 2 } }, pageButton }, panelOpens: 0, warms: 0, asks: [], permissionRequests: [], injected: [] };
        top.__listeners = [];
      }
      const fake = top.__fake as Fake;
      const listeners = top.__listeners as Array<(c: Record<string, { oldValue?: unknown; newValue?: unknown }>, a: string) => void>;
      g.browser = {
        runtime: {
          id: "scout-test",
          getURL: (p: string) => location.origin + "/" + p,
          // The worker's panel.open handler (src/background.ts): Safari opens the toolbar panel.
          sendMessage: async (m: { type: string; request_id: string }) => {
            if (m.type === "panel.open") {
              fake.panelOpens += 1;
              return { type: m.type + ".result", request_id: m.request_id, payload: { opened: true } };
            }
            if (m.type === "panel.ask") {
              fake.asks.push((m as unknown as { payload: unknown }).payload);
              return { type: m.type + ".result", request_id: m.request_id, payload: { opened: true } };
            }
            if (m.type === "panel.warm") {
              fake.warms += 1;
              return { type: m.type + ".result", request_id: m.request_id, payload: {} };
            }
            return { ok: true };
          },
          sendNativeMessage: async (_app: string, m: { type: string }) => (m.type === "keychain.get" ? { ok: true, value: key } : { ok: true }),
          onMessage: { addListener() {} },
        },
        extension: { inIncognitoContext: false },
        tabs: { query: async () => [{ id: 5, windowId: 1, url: pageData.url, title: pageData.title, active: true, incognito: false }] },
        permissions: {
          request: async (p: { origins: string[] }) => {
            fake.permissionRequests.push(p.origins);
            return true;
          },
          getAll: async () => ({ origins: fake.permissionRequests.flat() }),
          remove: async () => true,
        },
        scripting: {
          executeScript: async (inj: { files?: string[] }) => {
            if (inj.files) fake.injected.push(inj.files);
            return [{ result: pageData }];
          },
        },
        storage: {
          local: {
            get: async (k: string | string[]) => {
              const list = Array.isArray(k) ? k : [k];
              return JSON.parse(JSON.stringify(Object.fromEntries(list.filter((x) => x in fake.data).map((x) => [x, fake.data[x]]))));
            },
            set: async (items: Record<string, unknown>) => {
              const changes: Record<string, { oldValue?: unknown; newValue?: unknown }> = {};
              for (const [k, v] of Object.entries(items)) changes[k] = { oldValue: fake.data[k], newValue: JSON.parse(JSON.stringify(v)) };
              Object.assign(fake.data, JSON.parse(JSON.stringify(items)));
              for (const f of listeners) f(changes, "local");
            },
            clear: async () => {
              fake.data = {};
            },
          },
          onChanged: { addListener: (f: (typeof listeners)[number]) => listeners.push(f) },
        },
      };
    },
    { key: KEY, pageData: PAGE, pageButton },
  );
  const built = (name: string, type: string) => (r: { fulfill: (o: object) => Promise<void> }) =>
    r.fulfill({ path: "apple/Extension/Resources/" + name, contentType: type });
  await page.route("**/popup.html", built("popup.html", "text/html"));
  await page.route("**/popup.js", built("popup.js", "text/javascript"));
  await page.route("**/icons/**", (r) => r.fulfill({ status: 200, contentType: "image/png", body: "" }));
  await page.route("https://api.anthropic.com/v1/models**", (r) => r.fulfill({ status: 401, body: "{}" }));
}

/** A page with the edge script loaded, as the worker's registration would load it. */
async function openPage(page: Page, pageButton: unknown = { on: true }, extra: Record<string, unknown> = {}): Promise<void> {
  await stub(page, pageButton);
  await page.addInitScript((d) => Object.assign(((window.top ?? window) as unknown as { __fake: Fake }).__fake.data, d), extra);
  await page.goto("/index.html");
  await page.addScriptTag({ path: "apple/Extension/Resources/edge.js" });
}

const fake = (page: Page) => page.evaluate(() => (globalThis as unknown as { __fake: Fake }).__fake);

/** Point on the tab: it hugs the right (or left) edge at fraction y of the viewport. */
async function tabPoint(page: Page, side: "left" | "right" = "right", y = 0.45): Promise<{ x: number; y: number }> {
  const vp = page.viewportSize() ?? { width: 1280, height: 720 };
  return { x: side === "right" ? vp.width - 8 : 8, y: Math.round(vp.height * y) };
}

/** Whether the closed-shadow tab is under that point (the page sees only the host). */
async function tabThere(page: Page, at: { x: number; y: number }): Promise<boolean> {
  return page.evaluate(({ x, y }) => (document.elementFromPoint(x, y) as HTMLElement | null)?.getAttribute("style")?.includes("2147483647") === true, at);
}

const panelOpens = async (page: Page) => (await fake(page)).panelOpens;
/** Whether the quick ask box is open (the host carries data-quick-ask while it is). */
const quickAskOpen = (page: Page) => page.evaluate(() => document.querySelector("[data-quick-ask=open]") !== null);
/** Frames the extension put in the page: there must be none. */
const extensionFrames = (page: Page) => page.frames().filter((f) => f !== page.mainFrame()).length;

test("tapping the tab opens Scout's own panel and puts no extension page in the website", async ({ page }) => {
  await openPage(page);
  const at = await tabPoint(page);
  await expect.poll(() => tabThere(page, at)).toBe(true);
  await page.mouse.click(at.x, at.y);
  await expect.poll(() => panelOpens(page)).toBe(1);
  await page.waitForTimeout(300);
  expect(extensionFrames(page)).toBe(0);
  // Still there for the next time.
  expect(await tabThere(page, at)).toBe(true);
  await page.mouse.click(at.x, at.y);
  await expect.poll(() => panelOpens(page)).toBe(2);
});

// Owner request 2026-10-18: smaller than the first 60 x 64 target, still a
// clear truck, and never tucked away.
test("the tab is small but easy to hit, and stays out when idle", async ({ page }) => {
  await openPage(page);
  const vp = page.viewportSize() ?? { width: 1280, height: 720 };
  const y = Math.round(vp.height * 0.45);
  // A 46 x 48 target around its center.
  await expect.poll(() => tabThere(page, { x: vp.width - 40, y })).toBe(true);
  expect(await tabThere(page, { x: vp.width - 8, y: y - 21 })).toBe(true);
  expect(await tabThere(page, { x: vp.width - 8, y: y + 21 })).toBe(true);
  expect(await tabThere(page, { x: vp.width - 56, y })).toBe(false);
  expect(await tabThere(page, { x: vp.width - 8, y: y - 30 })).toBe(false);
  // Idle for longer than the old tuck delay: still all there.
  await page.mouse.move(10, 10);
  await page.waitForTimeout(3500);
  expect(await tabThere(page, { x: vp.width - 40, y })).toBe(true);
});

test("dragging moves the tab to the other side and remembers where it was dropped", async ({ page }) => {
  await openPage(page);
  const vp = page.viewportSize() ?? { width: 1280, height: 720 };
  const from = await tabPoint(page);
  await expect.poll(() => tabThere(page, from)).toBe(true);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(vp.width / 2, vp.height * 0.6, { steps: 5 });
  await page.mouse.move(60, Math.round(vp.height * 0.7), { steps: 5 });
  await page.mouse.up();

  await expect.poll(async () => ((await fake(page)).data.pageButton as { side?: string }).side).toBe("left");
  const saved = (await fake(page)).data.pageButton as { on: boolean; y: number };
  expect(saved.on).toBe(true);
  expect(saved.y).toBeCloseTo(0.7, 1);
  // A drag is not a tap: Scout did not open.
  expect(await panelOpens(page)).toBe(0);

  const to = await tabPoint(page, "left", saved.y);
  await expect.poll(() => tabThere(page, to)).toBe(true);
  expect(await tabThere(page, from)).toBe(false);
  await page.mouse.click(to.x, to.y);
  await expect.poll(() => panelOpens(page)).toBe(1);
});

test("arrow keys move a focused tab without dragging", async ({ page }) => {
  await openPage(page, { on: true, side: "right", y: 0.45 });
  const at = await tabPoint(page);
  await expect.poll(() => tabThere(page, at)).toBe(true);
  // Option-Tab reaches buttons and links in Safari (Tab alone only reaches fields).
  // The tab is last in the document, after the fixture's three links.
  const onTab = () => page.evaluate(() => (document.activeElement as HTMLElement | null)?.getAttribute("style")?.includes("2147483647") === true);
  for (let i = 0; i < 5 && !(await onTab()); i++) await page.keyboard.press("Alt+Tab");
  expect(await onTab()).toBe(true);
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowDown");
  await expect.poll(async () => (await fake(page)).data.pageButton).toEqual({ on: true, side: "left", y: 0.5 });
  await page.keyboard.press("Enter");
  await expect.poll(() => panelOpens(page)).toBe(1);
});

test("the tab is absent while the setting is off and goes away when it is turned off", async ({ page }) => {
  await openPage(page, { on: false });
  const at = await tabPoint(page);
  await page.waitForTimeout(200);
  expect(await tabThere(page, at)).toBe(false);

  const setOn = (on: boolean) =>
    page.evaluate((v) => (globalThis as unknown as { browser: { storage: { local: { set(i: object): Promise<void> } } } }).browser.storage.local.set({ pageButton: { on: v } }), on);
  await setOn(true);
  await expect.poll(() => tabThere(page, at)).toBe(true);
  await setOn(false);
  await expect.poll(() => tabThere(page, at)).toBe(false);
});

test("a page cannot open Scout with a synthetic click", async ({ page }) => {
  await openPage(page);
  const at = await tabPoint(page);
  await expect.poll(() => tabThere(page, at)).toBe(true);
  // Synthetic clicks are not trusted, so they do nothing.
  await page.evaluate(({ x, y }) => {
    const host = document.elementFromPoint(x, y) as HTMLElement;
    host.click();
    host.dispatchEvent(new MouseEvent("click", { bubbles: true, composed: true, clientX: x, clientY: y }));
  }, at);
  await page.waitForTimeout(300);
  expect(await panelOpens(page)).toBe(0);
});

test("every page shows the whole tab, and one click opens Scout", async ({ page }) => {
  await openPage(page);
  const vp = page.viewportSize() ?? { width: 1280, height: 720 };
  const y = Math.round(vp.height * 0.45);
  await expect.poll(() => tabThere(page, { x: vp.width - 40, y })).toBe(true);
  const later = await page.context().newPage();
  await openPage(later, { on: true }, { pageButtonIntroduced: true });
  await expect.poll(() => tabThere(later, { x: vp.width - 40, y })).toBe(true);
  await later.mouse.click(vp.width - 8, y);
  await expect.poll(() => panelOpens(later)).toBe(1);
});

test.describe("touch", () => {
  test.use({ hasTouch: true });
  test("one tap on the tab opens Scout", async ({ page }) => {
    // A returning user (the old tab started tucked for them).
    await openPage(page, { on: true }, { pageButtonIntroduced: true });
    const vp = page.viewportSize() ?? { width: 1280, height: 720 };
    const y = Math.round(vp.height * 0.45);
    await expect.poll(() => tabThere(page, { x: vp.width - 40, y })).toBe(true);
    await page.touchscreen.tap(vp.width - 8, y);
    await expect.poll(() => panelOpens(page)).toBe(1);
  });
});

// Owner request 2026-10-18: Scout should open at once. The tab asks the worker
// to get ready as soon as it is on the page, and again when a finger lands on
// it, before the tap ends.
test("the tab gets Scout ready when the page loads and again on touch", async ({ page }) => {
  await openPage(page);
  const at = await tabPoint(page);
  await expect.poll(() => tabThere(page, at)).toBe(true);
  await expect.poll(async () => (await fake(page)).warms).toBe(1);
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await expect.poll(async () => (await fake(page)).warms).toBe(2);
  expect(await panelOpens(page)).toBe(0);
  await page.mouse.up();
  await expect.poll(() => panelOpens(page)).toBe(1);
});

test("Settings turns the button on: asks Safari for site access and shows it on this page", async ({ page }) => {
  await stub(page, undefined);
  await withWorker(page);
  await page.goto("/popup.html");
  await page.getByRole("button", { name: "Settings" }).click();
  const box = page.getByRole("checkbox", { name: "Show a Scout button on the edge of webpages" });
  // On from a fresh install (owner request 2026-10-17); it shows once a site is granted.
  await expect(box).toBeChecked();
  await expect(page.locator("#pagebutton-status")).toHaveText("On. It appears on a site after you let Scout for Safari access it.");
  await box.uncheck();
  await expect(page.locator("#pagebutton-status")).toHaveText("Off.");
  await box.check();
  await expect(page.locator("#pagebutton-status")).toHaveText("On for every website.");
  const f = await fake(page);
  expect(f.permissionRequests).toEqual([["http://*/*", "https://*/*"]]);
  expect(f.data.pageButton).toEqual({ on: true, side: "right", y: 0.45 });
  expect(f.injected).toEqual([["edge.js"]]);

  await page.getByRole("radio", { name: "Left" }).check();
  await expect.poll(async () => (await fake(page)).data.pageButton).toEqual({ on: true, side: "left", y: 0.45 });
  await box.uncheck();
  await expect.poll(async () => ((await fake(page)).data.pageButton as { on: boolean }).on).toBe(false);
  await expect(page.locator("#pagebutton-status")).toHaveText("Off.");
});

// Owner bug report 2026-10-18: on iPhone, the page stopped showing through
// Safari 26's bottom bar once Scout loaded. The tab was a popover, and every
// top-layer element gets a full-screen fixed ::backdrop that Safari takes as a
// dimming layer, painting the page background under the bar. A later attempt
// moved the tab into the page and made pages zoom out. Now: a plain fixed tab.
test.describe("iPhone", () => {
  test.use({ viewport: { width: 390, height: 664 }, screen: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 });

  /** Opens closed shadow roots for the test only, so it can look inside the tab. */
  async function openShadows(page: Page): Promise<void> {
    await page.addInitScript(() => {
      const attach = Element.prototype.attachShadow;
      Element.prototype.attachShadow = function (init: ShadowRootInit) {
        return attach.call(this, { ...init, mode: "open" });
      };
    });
  }

  /** Every shown element on the page, shadow content included, that is fixed or sticky to the screen, with its box. */
  const pinned = (page: Page) =>
    page.evaluate(() => {
      const out: Array<{ name: string; width: number; height: number; bottom: number }> = [];
      const walk = (root: Document | ShadowRoot): void => {
        for (const el of Array.from(root.querySelectorAll("*"))) {
          const cs = getComputedStyle(el);
          if ((cs.position === "fixed" || cs.position === "sticky") && cs.display !== "none") {
            const r = el.getBoundingClientRect();
            out.push({ name: el.tagName.toLowerCase() + "." + (el.getAttribute("class") ?? ""), width: r.width, height: r.height, bottom: r.bottom });
          }
          if (el.shadowRoot) walk(el.shadowRoot);
        }
      };
      walk(document);
      return out;
    });

  /** A phone-ready page (width=device-width), with the edge script loaded. */
  async function openPhonePage(page: Page): Promise<void> {
    await stub(page, { on: true });
    await page.route("**/phone.html", (r) =>
      r.fulfill({
        contentType: "text/html",
        body: '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><title>Phone</title></head><body><h1>Phone fixture</h1><p>Synthetic text.</p></body></html>',
      }),
    );
    await page.goto("/phone.html");
    await page.addScriptTag({ path: "apple/Extension/Resources/edge.js" });
  }

  const tallPage = (page: Page) =>
    page.evaluate(() => {
      const spacer = document.createElement("div");
      spacer.style.height = "4000px";
      document.body.appendChild(spacer);
    });

  test("the tab is not in the top layer and adds nothing fixed across the screen or along its bottom edge", async ({ page }) => {
    await openShadows(page);
    await openPhonePage(page);
    const vp = page.viewportSize() ?? { width: 390, height: 664 };
    const y = Math.round(vp.height * 0.45);
    await expect.poll(() => tabThere(page, { x: vp.width - 8, y })).toBe(true);
    // No top layer, so no ::backdrop over the whole screen.
    expect(await page.evaluate(() => document.querySelectorAll(":popover-open, :modal").length)).toBe(0);
    // Every fixed box Scout adds is small and away from the bottom edge.
    const boxes = await pinned(page);
    expect(boxes.length).toBeGreaterThan(0);
    for (const b of boxes) {
      expect(b.width < vp.width * 0.9 || b.height < vp.height * 0.9, b.name).toBe(true);
      expect(b.bottom, b.name).toBeLessThan(vp.height - 8);
    }
  });

  test("the tab stays on the screen edge while the page scrolls, without making the page longer", async ({ page }) => {
    await openPhonePage(page);
    await tallPage(page);
    const vp = page.viewportSize() ?? { width: 390, height: 664 };
    const y = Math.round(vp.height * 0.45);
    await expect.poll(() => tabThere(page, { x: vp.width - 8, y })).toBe(true);
    const length = await page.evaluate(() => document.scrollingElement?.scrollHeight ?? 0);

    await page.evaluate(() => window.scrollTo(0, 1500));
    await expect.poll(() => tabThere(page, { x: vp.width - 8, y })).toBe(true);
    // Scrolled to the very end: still on screen, and the page did not grow.
    await page.evaluate(() => window.scrollTo(0, document.scrollingElement?.scrollHeight ?? 0));
    await expect.poll(() => tabThere(page, { x: vp.width - 8, y })).toBe(true);
    expect(await page.evaluate(() => document.scrollingElement?.scrollHeight ?? 0)).toBe(length);
    // The rest of the screen still belongs to the page.
    expect(await tabThere(page, { x: Math.round(vp.width / 2), y })).toBe(false);

    // One tap opens the quick ask box (src/quick-ask.ts).
    await page.touchscreen.tap(vp.width - 8, y);
    await expect.poll(() => quickAskOpen(page)).toBe(true);
  });

  test("dragging after a scroll drops the tab where the finger lets go", async ({ page }) => {
    await openPhonePage(page);
    await tallPage(page);
    await page.evaluate(() => window.scrollTo(0, 1200));
    const vp = page.viewportSize() ?? { width: 390, height: 664 };
    const from = await tabPoint(page);
    await expect.poll(() => tabThere(page, from)).toBe(true);
    // A pointer drag (Playwright's touchscreen has no drag).
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(vp.width / 2, vp.height * 0.6, { steps: 5 });
    await page.mouse.move(30, Math.round(vp.height * 0.7), { steps: 5 });
    await page.mouse.up();
    await expect.poll(async () => ((await fake(page)).data.pageButton as { side?: string }).side).toBe("left");
    expect(((await fake(page)).data.pageButton as { y: number }).y).toBeCloseTo(0.7, 1);
    const to = await tabPoint(page, "left", ((await fake(page)).data.pageButton as { y: number }).y);
    await expect.poll(() => tabThere(page, to)).toBe(true);
  });
});

// Owner request 2026-10-18 (option A of the Comet comparison): on a phone the
// tab opens a small question box over a dimmed, blurred page, with the
// keyboard up; what is asked goes to Scout's panel. The box and the dim never
// reach the strip under Safari's bottom bar (the white bar, #27-#39).
test.describe("iPhone quick ask", () => {
  test.use({ viewport: { width: 390, height: 664 }, screen: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 });

  async function openPhone(page: Page): Promise<{ width: number; height: number }> {
    await page.addInitScript(() => {
      const attach = Element.prototype.attachShadow;
      Element.prototype.attachShadow = function (init: ShadowRootInit) {
        return attach.call(this, { ...init, mode: "open" });
      };
    });
    await stub(page, { on: true });
    await page.route("**/phone.html", (r) =>
      r.fulfill({
        contentType: "text/html",
        body: '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><title>Phone</title></head><body><h1>Phone fixture</h1><p>Synthetic text.</p></body></html>',
      }),
    );
    await page.goto("/phone.html");
    await page.addScriptTag({ path: "apple/Extension/Resources/edge.js" });
    const vp = page.viewportSize() ?? { width: 390, height: 664 };
    await expect.poll(() => tabThere(page, { x: vp.width - 8, y: Math.round(vp.height * 0.45) })).toBe(true);
    return vp;
  }

  const shadow = (page: Page) => page.locator("[data-quick-ask=open]");
  const box = (page: Page) => page.locator("div[style*='2147483647'] >> .qa");
  const field = (page: Page) => page.locator("div[style*='2147483647'] >> .qa textarea");

  test("tapping the tab opens the box with the cursor in it, not Safari's sheet", async ({ page }) => {
    const vp = await openPhone(page);
    await page.touchscreen.tap(vp.width - 8, Math.round(vp.height * 0.45));
    await expect(shadow(page)).toHaveCount(1);
    await expect(box(page)).toBeVisible();
    await expect(field(page)).toBeFocused();
    expect(await panelOpens(page)).toBe(0);
    // Plain elements only: no extension frame, nothing in the top layer.
    expect(extensionFrames(page)).toBe(0);
    expect(await page.evaluate(() => document.querySelectorAll(":popover-open, :modal").length)).toBe(0);
  });

  test("the box and the dim stay out of the strip under Safari's bottom bar", async ({ page }) => {
    const vp = await openPhone(page);
    await page.touchscreen.tap(vp.width - 8, Math.round(vp.height * 0.45));
    await expect(box(page)).toBeVisible();
    await page.waitForTimeout(400);
    const bottoms = await page.evaluate(() => {
      const host = document.querySelector("[data-quick-ask=open]");
      const root = host?.shadowRoot;
      return ["qa", "qa-dim"].map((c) => root?.querySelector("." + c)?.getBoundingClientRect().bottom ?? -1);
    });
    for (const b of bottoms) {
      expect(b).toBeGreaterThan(0);
      expect(b).toBeLessThanOrEqual(vp.height - 96);
    }
  });

  test("sending hands the question to Scout's panel and closes the box", async ({ page }) => {
    const vp = await openPhone(page);
    await page.touchscreen.tap(vp.width - 8, Math.round(vp.height * 0.45));
    await expect(field(page)).toBeFocused();
    await page.keyboard.type("Is this in stock?");
    await page.keyboard.press("Enter");
    await expect.poll(async () => (await fake(page)).asks).toEqual([{ kind: "ask", question: "Is this in stock?" }]);
    await expect(shadow(page)).toHaveCount(0);
  });

  test("Summarize this page asks without typing", async ({ page }) => {
    const vp = await openPhone(page);
    await page.touchscreen.tap(vp.width - 8, Math.round(vp.height * 0.45));
    await page.locator("div[style*='2147483647'] >> .qa-sum").tap();
    await expect.poll(async () => (await fake(page)).asks).toEqual([{ kind: "summarize", question: "" }]);
  });

  test("tapping the dimmed page closes the box and asks nothing", async ({ page }) => {
    const vp = await openPhone(page);
    await page.touchscreen.tap(vp.width - 8, Math.round(vp.height * 0.45));
    await expect(box(page)).toBeVisible();
    await page.touchscreen.tap(Math.round(vp.width / 2), 80);
    await expect(shadow(page)).toHaveCount(0);
    await expect(box(page)).toBeHidden();
    expect((await fake(page)).asks).toEqual([]);
    expect(await panelOpens(page)).toBe(0);
  });

  test("the page does not see what is typed in the box", async ({ page }) => {
    const vp = await openPhone(page);
    await page.evaluate(() => {
      const seen: string[] = [];
      (window as unknown as { __seen: string[] }).__seen = seen;
      document.addEventListener("keydown", (e) => seen.push(e.key));
      document.addEventListener("input", () => seen.push("input"));
    });
    await page.touchscreen.tap(vp.width - 8, Math.round(vp.height * 0.45));
    await expect(field(page)).toBeFocused();
    await page.keyboard.type("secret");
    expect(await page.evaluate(() => (window as unknown as { __seen: string[] }).__seen)).toEqual([]);
  });
});

// Owner request 2026-10-18: after opening Safari from cold on iPhone, Scout's
// tab took a few seconds to appear. The worker now starts the edge script at
// document_start, and the tab shows as soon as the page has a body, while the
// rest of the page is still loading.
test.describe("starts with the page", () => {
  const SLOW_MS = 1500;

  /**
   * A page whose body arrives at once but whose script at the end takes
   * SLOW_MS, like a news site on a cold phone. `after` runs once it is loaded.
   * Records when the tab appeared and when the page finished loading.
   */
  async function openSlowPage(page: Page, phone: boolean, after = "", settingsDelayMs = 0): Promise<void> {
    await stub(page, { on: true });
    if (settingsDelayMs) {
      await page.addInitScript((ms) => {
        const local = (globalThis as unknown as { browser: { storage: { local: { get(k: unknown): Promise<unknown> } } } }).browser.storage.local;
        const get = local.get.bind(local);
        local.get = (k) => new Promise((res) => setTimeout(() => res(get(k)), ms));
      }, settingsDelayMs);
    }
    await page.addInitScript(() => {
      const t = window as unknown as { __tabAt?: number; __loadedAt?: number };
      new MutationObserver(() => {
        if (t.__tabAt === undefined && document.querySelector('[style*="2147483647"]')) t.__tabAt = performance.now();
      }).observe(document, { childList: true, subtree: true });
      document.addEventListener("DOMContentLoaded", () => (t.__loadedAt = performance.now()));
    });
    await page.addInitScript({ path: "apple/Extension/Resources/edge.js" });
    await page.route("**/slow.js", async (r) => {
      await new Promise((res) => setTimeout(res, SLOW_MS));
      await r.fulfill({ contentType: "text/javascript", body: after });
    });
    await page.route("**/slow.html", (r) =>
      r.fulfill({
        contentType: "text/html",
        body:
          "<!doctype html><html><head>" + (phone ? '<meta name="viewport" content="width=device-width, initial-scale=1">' : "") +
          "<title>Slow</title></head><body><h1>Slow fixture</h1><p>Synthetic text.</p>" +
          '<script src="/slow.js"></script><div style="height: 3000px"></div></body></html>',
      }),
    );
    await page.goto("/slow.html", { waitUntil: "commit" });
  }

  const times = (page: Page) =>
    page.evaluate(() => {
      const t = window as unknown as { __tabAt?: number; __loadedAt?: number };
      return { __tabAt: t.__tabAt, __loadedAt: t.__loadedAt };
    });

  test("the tab shows while the page is still loading, not after", async ({ page }) => {
    await openSlowPage(page, false);
    const at = await tabPoint(page);
    await expect.poll(() => tabThere(page, at), { timeout: 1000 }).toBe(true);
    await expect.poll(async () => (await times(page)).__loadedAt, { timeout: 5000 }).toBeGreaterThan(0);
    const t = await times(page);
    expect(t.__tabAt).toBeDefined();
    expect((t.__loadedAt ?? 0) - (t.__tabAt ?? 0)).toBeGreaterThan(SLOW_MS - 300);
    // Still works once the page has loaded.
    await page.mouse.click(at.x, at.y);
    await expect.poll(() => panelOpens(page)).toBe(1);
  });

  // Owner request 2026-10-18: right after Safari starts, Scout's settings can
  // be slow to arrive; the tab no longer waits for them.
  test("the tab shows at once even when Scout's settings are slow to arrive", async ({ page }) => {
    await openSlowPage(page, false, "", 4000);
    const at = await tabPoint(page);
    await expect.poll(() => tabThere(page, at), { timeout: 1000 }).toBe(true);
    await page.mouse.click(at.x, at.y);
    await expect.poll(() => panelOpens(page)).toBe(1);
  });

  test("a tab the user moved to the left never shows on the right first", async ({ page }) => {
    await stub(page, { on: true, side: "left" });
    // Samples the right edge every frame from the very start of the page.
    await page.addInitScript(() => {
      const w = window as unknown as { __onRight?: boolean };
      const look = (): void => {
        const y = Math.round(innerHeight * 0.45);
        if ((document.elementFromPoint(innerWidth - 8, y) as HTMLElement | null)?.getAttribute("style")?.includes("2147483647")) w.__onRight = true;
        requestAnimationFrame(look);
      };
      requestAnimationFrame(look);
    });
    await page.addInitScript({ path: "apple/Extension/Resources/edge.js" });
    await page.goto("/index.html");
    await expect.poll(async () => tabThere(page, await tabPoint(page, "left"))).toBe(true);
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => (window as unknown as { __onRight?: boolean }).__onRight === true)).toBe(false);
  });

  test("a page that rebuilds itself while loading gets the tab back", async ({ page }) => {
    await openSlowPage(page, false, 'document.documentElement.innerHTML = "<head><title>Rebuilt</title></head><body><p>Rebuilt.</p></body>";');
    await expect.poll(async () => (await times(page)).__loadedAt, { timeout: 5000 }).toBeGreaterThan(0);
    await expect.poll(() => page.title()).toBe("Rebuilt");
    await expect.poll(async () => tabThere(page, await tabPoint(page))).toBe(true);
  });

  test.describe("iPhone", () => {
    test.use({ viewport: { width: 390, height: 664 }, screen: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 });

    test("the tab is on the screen edge before the page has loaded, and after a scroll", async ({ page }) => {
      await openSlowPage(page, true);
      const vp = page.viewportSize() ?? { width: 390, height: 664 };
      const at = { x: vp.width - 8, y: Math.round(vp.height * 0.45) };
      await expect.poll(() => tabThere(page, at), { timeout: 1000 }).toBe(true);
      await expect.poll(async () => (await times(page)).__loadedAt, { timeout: 5000 }).toBeGreaterThan(0);
      await page.evaluate(() => window.scrollTo(0, 1500));
      await expect.poll(() => tabThere(page, at)).toBe(true);
    });

    // Owner bug report 2026-10-18: citizenfreepress.com and espn.com zoomed out
    // when the tab arrived before the page had set its viewport.
    test("the tab never makes the page wider, so Safari has no reason to zoom out", async ({ page }) => {
      await openSlowPage(page, true);
      await expect.poll(async () => (await times(page)).__loadedAt, { timeout: 5000 }).toBeGreaterThan(0);
      await page.waitForTimeout(300);
      const m = await page.evaluate(() => ({ scrollWidth: document.scrollingElement?.scrollWidth ?? 0, scale: visualViewport?.scale ?? 1, width: visualViewport?.width ?? 0 }));
      expect(m).toEqual({ scrollWidth: 390, scale: 1, width: 390 });
    });

    test("on a page with no mobile viewport, the page is exactly as wide as without Scout", async ({ page }) => {
      await openSlowPage(page, false);
      await expect.poll(async () => (await times(page)).__loadedAt, { timeout: 5000 }).toBeGreaterThan(0);
      await page.waitForTimeout(300);
      const m = await page.evaluate(() => ({ scrollWidth: document.scrollingElement?.scrollWidth ?? 0, clientWidth: document.documentElement.clientWidth }));
      expect(m.scrollWidth).toBe(m.clientWidth);
    });
  });
});
