import { expect, test, type Page } from "@playwright/test";

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
  permissionRequests: string[][];
  injected: string[][];
}

async function stub(page: Page, pageButton: unknown): Promise<void> {
  await page.addInitScript(
    ({ key, pageData, pageButton }) => {
      const g = globalThis as unknown as Record<string, unknown>;
      const top = (window.top ?? window) as unknown as Record<string, unknown>;
      if (!top.__fake) {
        top.__fake = { data: { aiConsent: { anthropic: { at: 1, version: 1 } }, pageButton }, panelOpens: 0, permissionRequests: [], injected: [] };
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
async function openPage(page: Page, pageButton: unknown = { on: true }): Promise<void> {
  await stub(page, pageButton);
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

test("the tab is big enough to see and hit, and stays a usable target when tucked", async ({ page }) => {
  await openPage(page);
  const vp = page.viewportSize() ?? { width: 1280, height: 720 };
  const y = Math.round(vp.height * 0.45);
  // Awake: 60 px wide, 64 px tall around its center.
  await expect.poll(() => tabThere(page, { x: vp.width - 56, y })).toBe(true);
  expect(await tabThere(page, { x: vp.width - 8, y: y - 30 })).toBe(true);
  expect(await tabThere(page, { x: vp.width - 8, y: y + 30 })).toBe(true);
  // Tucked after a few idle seconds: still a 32 px wide target on the edge.
  await page.mouse.move(10, 10);
  await expect.poll(() => tabThere(page, { x: vp.width - 56, y }), { timeout: 6000 }).toBe(false);
  expect(await tabThere(page, { x: vp.width - 28, y })).toBe(true);
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

test("Settings turns the button on: asks Safari for site access and shows it on this page", async ({ page }) => {
  await stub(page, undefined);
  await page.goto("/popup.html");
  await page.getByRole("button", { name: "Settings" }).click();
  const box = page.getByRole("checkbox", { name: "Show a Scout button on the edge of webpages" });
  await expect(box).not.toBeChecked();
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
