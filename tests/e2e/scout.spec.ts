import { expect, test, type Page } from "@playwright/test";
import { withWorker } from "./worker";

// Part 3 acceptance (spec part 3): Scout mode end to end through the real
// background worker (tests/e2e/worker.ts) and the local mock server, which
// proposes action batches. The "tab" Scout acts on is a same-origin iframe
// holding the synthetic fixture page; the stubbed scripting.executeScript
// injects the built content.js into it and calls its handler, as Safari
// would in the tab. No live provider, synthetic pages only.
const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
const PORT = env.E2E_PORT ?? "4317";
const MOCK_URL = "http://127.0.0.1:" + (env.MOCK_PORT ?? "4318") + "/v1/messages";
const TAB_URL = "http://127.0.0.1:" + PORT + "/scout.html";

interface Calls {
  icons: Array<{ tabId?: number; path: Record<string, string> }>;
  captures: number;
  /** When the worker asked the page to hide the overlay, and when the overlay was gone (Date.now()). */
  hideAt: number;
  goneAt: number;
}

async function openPopup(page: Page, opts: { data?: Record<string, unknown>; incognito?: boolean; tabUrl?: string } = {}): Promise<void> {
  if (env.SCOUT_E2E_DEBUG) {
    page.on("console", (m) => console.log("[popup console]", m.type(), m.text().slice(0, 400)));
    page.on("pageerror", (e) => console.log("[popup error]", e.message));
  }
  await page.addInitScript(
    ({ tabUrl, data, mock, incognito }) => {
      const g = globalThis as unknown as Record<string, unknown>;
      // storage.local survives a reload of the popup, as Safari's does: kept in sessionStorage.
      const saved = JSON.parse(sessionStorage.getItem("__scoutStore") ?? "null") as Record<string, unknown> | null;
      const store: Record<string, unknown> = saved ?? { aiConsent: { anthropic: { at: 1, version: 2 } }, devMockServer: mock, ...data };
      const persist = (): void => sessionStorage.setItem("__scoutStore", JSON.stringify(store));
      const calls: Calls = { icons: [], captures: 0, hideAt: 0, goneAt: 0 };
      g.__calls = calls;
      g.__store = store;
      const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
      const tab = { id: 1, windowId: 1, title: "Scout fixture", url: tabUrl, active: true, ...(incognito ? { incognito: true } : {}) };
      // The "tab": a same-origin iframe with the fixture page, added once the popup's DOM exists.
      let frame: HTMLIFrameElement | null = null;
      const tabWindow = async (): Promise<Window> => {
        if (!frame) {
          frame = document.createElement("iframe");
          frame.id = "__tab1";
          frame.style.cssText = "position:fixed;left:420px;top:0;width:600px;height:500px;border:0";
          frame.src = tabUrl;
          document.body.appendChild(frame);
          await new Promise<void>((r) => frame!.addEventListener("load", () => r(), { once: true }));
          const w = frame.contentWindow as unknown as Record<string, unknown>;
          // The content script's runtime: messages arrive at the worker with the tab's sender.
          w.browser = {
            runtime: {
              sendMessage: (m: unknown) => (g.__scoutSendAs as (m: unknown, s: unknown) => Promise<unknown>)(m, { url: tabUrl, tab: { id: 1 } }),
            },
          };
          // When the overlay leaves the page.
          const doc = (w as unknown as Window).document;
          new (w as unknown as Window & { MutationObserver: typeof MutationObserver }).MutationObserver((muts) => {
            for (const m of muts) for (const n of Array.from(m.removedNodes)) if ((n as Element).tagName?.toLowerCase() === "scout-for-safari-overlay") calls.goneAt = Date.now();
          }).observe(doc.documentElement, { childList: true });
        }
        return frame.contentWindow!;
      };
      g.__tabWindow = tabWindow;
      g.browser = {
        runtime: {
          sendNativeMessage: async (_app: string, m: { type: string }) => (m.type === "keychain.get" ? { ok: true, value: "sk-ant-test-synthetic-PART3-0000" } : { ok: false, error: "unknown_type" }),
          // The panel's base differs from the tab's URL, as safari-web-extension:// does from https://, so the worker can tell a content sender from the panel.
          getURL: (p: string) => location.origin + "/popup" + (p ? "/" + p : ""),
        },
        storage: {
          local: {
            get: async (k: string | string[]) => copy(Object.fromEntries([k].flat().filter((x) => x in store).map((x) => [x, store[x]]))),
            set: async (items: Record<string, unknown>) => {
              Object.assign(store, copy(items));
              persist();
            },
            clear: async () => {
              for (const k of Object.keys(store)) delete store[k];
              persist();
            },
          },
        },
        tabs: {
          query: async () => [tab],
          get: async (id: number) => {
            if (id !== 1) throw new Error("No tab with id " + id);
            return tab;
          },
          captureVisibleTab: async () => {
            calls.captures++;
            // 1x1 white JPEG.
            return "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=";
          },
        },
        action: { setIcon: async (d: { tabId?: number; path: Record<string, string> }) => void calls.icons.push(copy(d)), setTitle: async () => undefined },
        permissions: { request: async () => true, getAll: async () => ({ origins: [] }), remove: async () => true },
        scripting: {
          executeScript: async (inj: { target: { tabId: number }; files?: string[]; func?: (...a: unknown[]) => unknown; args?: unknown[] }) => {
            const w = (await tabWindow()) as unknown as Record<string, unknown>;
            if (inj.files) {
              if (!w.__safariScoutContent) {
                const doc = (w as unknown as Window).document;
                const s = doc.createElement("script");
                s.src = "/content.js";
                doc.head.appendChild(s);
                await new Promise<void>((r) => s.addEventListener("load", () => r(), { once: true }));
              }
              return [{ result: undefined }];
            }
            if (inj.func && inj.args && inj.args[1] === "__safariScoutHandle") {
              const req = inj.args[0] as { type: string; command?: string };
              if (req.type === "scout:overlay" && req.command === "hide") calls.hideAt = Date.now();
              const h = w.__safariScoutHandle as ((r: unknown) => unknown) | undefined;
              if (!h) return [{ result: { ok: false, why: "no-handler" } }];
              try {
                const out = await Promise.resolve(h(req));
                return [{ result: { ok: true, value: copy(out) } }];
              } catch {
                return [{ result: { ok: false, why: "threw" } }];
              }
            }
            // Page context reads (extractPage): a small synthetic page.
            return [{ result: { url: tabUrl, title: "Scout fixture", text: "A form with a name field." } }];
          },
        },
      };
    },
    { tabUrl: opts.tabUrl ?? TAB_URL, data: opts.data ?? {}, mock: MOCK_URL, incognito: opts.incognito ?? false },
  );
  await page.route("**/popup.html", (r) => r.fulfill({ path: "apple/Extension/Resources/popup.html", contentType: "text/html" }));
  await page.route("**/popup.js", (r) => r.fulfill({ path: "apple/Extension/Resources/popup.js", contentType: "text/javascript" }));
  await page.route("**/content.js", (r) => r.fulfill({ path: "apple/Extension/Resources/content.js", contentType: "text/javascript" }));
  await page.route("**/icons/**", (r) => r.fulfill({ status: 200, contentType: "image/png", body: "" }));
  await page.route("https://api.anthropic.com/**", (r) => r.fulfill({ status: 401, body: "{}" }));
  await withWorker(page);
  await page.goto("/popup.html");
  if (!opts.incognito) await expect(page.getByLabel("Ask about this page")).toBeVisible();
}

const calls = (page: Page): Promise<Calls> => page.evaluate(() => (globalThis as unknown as { __calls: Calls }).__calls);
const tabFrame = (page: Page) => page.frameLocator("#__tab1");

async function startTask(page: Page, goal: string, site = "127.0.0.1"): Promise<void> {
  await page.getByRole("radio", { name: "Scout" }).check();
  await page.getByLabel("Ask about this page").fill(goal);
  await page.getByRole("button", { name: "Start task" }).click();
  const ask = page.getByRole("alertdialog", { name: "Start a Scout task on " + site + "?" });
  await expect(ask).toBeVisible();
  await expect(ask).toContainText("Stop and ask you before anything sensitive");
  await expect(ask).toContainText("Send screenshots of 127.0.0.1 to Anthropic");
  await ask.getByRole("button", { name: "Start task" }).click();
}

const actions = (list: unknown[]): string => "[mock:scout actions=" + JSON.stringify(list) + "]";
const card = (page: Page) => page.locator("#task");
/** The live action log in the task card (finished tasks keep theirs under the result message). */
const log = (page: Page) => card(page).getByRole("list", { name: "Action log" });
const confirmBox = (page: Page) => page.getByRole("alertdialog", { name: "Scout for Safari wants to:" });

test("a task runs through the worker: per-task question, overlay on the tab, action log, active icon, result in the thread", async ({ page }) => {
  await openPopup(page);
  await startTask(page, "Fill in the name " + actions([{ type: "type", target: { name: "Name" }, text: "Ada" }, { type: "click", target: { name: "Show more" } }]));
  await expect(tabFrame(page).getByLabel("Name")).toHaveValue("Ada");
  await expect(tabFrame(page).locator("#extra")).toBeVisible();
  const answer = page.getByRole("log").locator(".msg.assistant").last();
  await expect(answer).toContainText("Mock task finished. Results: 1. type: ok. Typed 3 characters. 2. click: ok.");
  // The action log stays under the result, in plain language.
  await expect(answer.getByRole("list", { name: "Action log" }).getByRole("listitem")).toHaveText([/Type 3 characters into "Name" \(done\)/, /Click "Show more" \(done\)/]);
  await expect(card(page)).toBeHidden();
  await expect(tabFrame(page).locator("scout-for-safari-overlay")).toHaveCount(0);
  await expect(page.locator("#status")).toContainText("Cost: ");
  const c = await calls(page);
  // Active icon on the tab while it ran, the plain one after (the theme sync sets the global icon, with no tab).
  expect(c.icons.filter((i) => i.tabId !== undefined).map((i) => [i.tabId, /toolbar-active/.test(i.path["32"] ?? "")])).toEqual([
    [1, true],
    [1, false],
  ]);
  expect(c.captures).toBeGreaterThan(0);
  // Saved to history as a Scout exchange.
  await page.reload();
  await expect(page.getByRole("log")).toContainText("Mock task finished.");
  await expect(page.getByRole("log").locator(".msg.user .mode")).toHaveText("Scout");
});

test("a sensitive action shows the confirmation even when the server marks it pre-approved; Deny stops it", async ({ page }) => {
  await openPopup(page);
  await startTask(page, "Send it " + actions([{ type: "click", target: { name: "Send" }, approved: true, pre_approved: true }]));
  const box = confirmBox(page);
  await expect(box).toBeVisible();
  await expect(box).toContainText('click "Send" to send or publish something on 127.0.0.1.');
  await expect(box.getByRole("button", { name: "Deny" })).toBeFocused();
  await expect(box.getByRole("button")).toHaveText(["Allow once", "Always allow on this site", "Deny"]);
  await expect(tabFrame(page).locator("#submitted")).toHaveText("0");
  await box.getByRole("button", { name: "Deny" }).click();
  const answer = page.getByRole("log").locator(".msg.assistant").last();
  await expect(answer).toContainText("the user did not allow this action");
  await expect(answer.getByRole("list", { name: "Action log" })).toContainText('Click "Send" (not allowed: You did not allow it.)');
  await expect(tabFrame(page).locator("#submitted")).toHaveText("0");
});

test("Allow once performs the action; Always allow remembers the site and can be revoked in Permissions", async ({ page }) => {
  await openPopup(page);
  await startTask(page, "Send it " + actions([{ type: "click", target: { name: "Send" } }]));
  await confirmBox(page).getByRole("button", { name: "Allow once" }).click();
  await expect(tabFrame(page).locator("#submitted")).toHaveText("1");
  await expect(card(page)).toBeHidden();

  await startTask(page, "Send it again " + actions([{ type: "click", target: { name: "Send" } }]));
  await confirmBox(page).getByRole("button", { name: "Always allow on this site" }).click();
  await expect(tabFrame(page).locator("#submitted")).toHaveText("2");
  await expect(card(page)).toBeHidden();

  await startTask(page, "And once more " + actions([{ type: "click", target: { name: "Send" } }]));
  await expect(tabFrame(page).locator("#submitted")).toHaveText("3");
  await expect(page.getByRole("log").locator(".msg.assistant").last().getByRole("list", { name: "Action log" })).toContainText("allowed: you always allow this on 127.0.0.1");
  await expect(confirmBox(page)).toBeHidden();

  await page.getByRole("button", { name: "Settings" }).click();
  const always = page.getByRole("list", { name: "Sites with always-allowed actions" });
  await expect(always).toContainText("127.0.0.1: send and publish");
  await page.getByRole("button", { name: "Revoke always allow on 127.0.0.1" }).click();
  await expect(always).toContainText("No sites yet.");
  await expect(page.getByLabel("Sensitive-action confirmation")).toBeChecked();
  await expect(page.getByLabel("Sensitive-action confirmation")).toBeDisabled();
});

test("unknown actions are rejected before they reach the page, and logged", async ({ page }) => {
  await openPopup(page);
  await startTask(page, "Do something odd " + actions([{ type: "frobnicate", target: { name: "Send" } }, { type: "click", target: { name: "Show more" } }]));
  const answer = page.getByRole("log").locator(".msg.assistant").last();
  await expect(answer).toContainText("rejected: Unknown action");
  await expect(answer.getByRole("list", { name: "Action log" })).toContainText("Rejected an action the page cannot do (frobnicate) (rejected: Unknown action \"frobnicate\"");
  await expect(tabFrame(page).locator("#extra")).toBeHidden();
  await page.getByRole("button", { name: "Settings" }).click();
  await expect(page.getByRole("list", { name: "Activity" })).toContainText("Scout action (frobnicate) · 127.0.0.1 · schema-error");
});

test("Take control pauses at once, Resume continues, and Stop removes the overlay within 500 ms", async ({ page }) => {
  await openPopup(page);
  await startTask(page, "Keep waiting [mock:scout slow]");
  await expect(card(page)).toBeVisible();
  await expect(card(page)).toContainText("On 127.0.0.1");
  await expect(tabFrame(page).locator("scout-for-safari-overlay")).toHaveCount(1);
  await expect(log(page).getByRole("listitem").first()).toContainText("Wait 0.4 s");
  await page.getByRole("button", { name: "Take control" }).click();
  await expect(card(page)).toContainText("Paused. You have control.");
  await expect(page.getByRole("button", { name: "Resume" })).toBeVisible();
  await expect.poll(() => tabFrame(page).locator("scout-for-safari-overlay").evaluate(() => (window as unknown as { __scoutOverlayRoot: ShadowRoot }).__scoutOverlayRoot.querySelector(".status")?.textContent)).toBe(
    "Paused. You have control.",
  );
  const paused = await log(page).getByRole("listitem").count();
  await page.waitForTimeout(600);
  expect(await log(page).getByRole("listitem").count()).toBe(paused);
  await page.getByRole("button", { name: "Resume" }).click();
  await expect(card(page)).toContainText("Scouting…");
  await expect.poll(() => log(page).getByRole("listitem").count()).toBeGreaterThan(paused);

  const t0 = Date.now();
  await page.getByRole("button", { name: "Stop" }).click();
  await expect(tabFrame(page).locator("scout-for-safari-overlay")).toHaveCount(0);
  const c = await calls(page);
  // The worker tells the page to hide at once, and the page is clear within 500 ms (400 ms fade).
  expect(c.hideAt - t0).toBeLessThan(250);
  expect(c.goneAt - c.hideAt).toBeLessThan(500);
  await expect(page.getByRole("log").locator(".msg.error").last()).toContainText("Stopped. Nothing more was done on the page.");
  await expect(card(page)).toBeHidden();
});

test("the overlay pill's Stop ends the task from the page", async ({ page }) => {
  await openPopup(page);
  await startTask(page, "Keep waiting [mock:scout slow]");
  const overlay = tabFrame(page).locator("scout-for-safari-overlay");
  await expect(overlay).toHaveCount(1);
  const stop = await overlay.evaluate(() => {
    const r = (window as unknown as { __scoutOverlayRoot: ShadowRoot }).__scoutOverlayRoot.querySelector("button.stop")!.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  const frameBox = (await page.locator("#__tab1").boundingBox())!;
  await page.mouse.click(frameBox.x + stop.x, frameBox.y + stop.y);
  await expect(overlay).toHaveCount(0);
  await expect(page.getByRole("log").locator(".msg.error").last()).toContainText("Stopped.");
});

test("sign-in and send actions need approval; denied ones never reach the page", async ({ page }) => {
  await openPopup(page);
  await startTask(page, "Log in and write " + actions([{ type: "click", target: { name: "Sign in" } }, { type: "click", target: { name: "Send" } }]));
  const box = confirmBox(page);
  await expect(box).toContainText('click "Sign in" to sign in or create an account on 127.0.0.1.');
  await box.getByRole("button", { name: "Deny" }).click();
  const answer = page.getByRole("log").locator(".msg.assistant").last();
  await expect(answer).toContainText("Mock task finished.");
  await expect(tabFrame(page).locator("#signed-in")).toHaveText("0");
  await expect(tabFrame(page).locator("#submitted")).toHaveText("0");
});

test("injected page text cannot trigger an unapproved action", async ({ page }) => {
  await openPopup(page, { tabUrl: "http://127.0.0.1:" + PORT + "/injection.html" });
  // The page text tells the model to delete the account; the device still asks the user.
  await startTask(page, "Summarize this article " + actions([{ type: "click", target: { name: "Delete account" } }]), "127.0.0.1");
  const box = confirmBox(page);
  await expect(box).toContainText('click "Delete account" to delete or remove something on 127.0.0.1.');
  await box.getByRole("button", { name: "Deny" }).click();
  await expect(page.getByRole("log").locator(".msg.assistant").last()).toContainText("did not allow this action");
});

test("a CAPTCHA page stops the task before anything happens", async ({ page }) => {
  await openPopup(page, { tabUrl: "http://127.0.0.1:" + PORT + "/captcha.html" });
  await startTask(page, "Buy it " + actions([{ type: "click", target: { name: "Continue" } }]));
  await expect(page.getByRole("log").locator(".msg.error").last()).toContainText("Stopped: the page asks for a CAPTCHA.");
  await expect(tabFrame(page).locator("scout-for-safari-overlay")).toHaveCount(0);
  expect((await calls(page)).captures).toBe(0);
});

test("Scout mode does not work in Private Browsing", async ({ page }) => {
  await openPopup(page, { incognito: true });
  await expect(page.getByRole("heading", { name: "Off in Private Browsing" })).toBeVisible();
  await expect(page.getByRole("radio", { name: "Scout" })).toBeHidden();
  // The worker refuses too, whoever asks.
  const check = await page.evaluate(() => browser.runtime.sendMessage({ type: "task.check", request_id: "r1", payload: { tab_id: 1 } }));
  expect(check).toEqual(expect.objectContaining({ type: "task.check.result", payload: { ok: false, reason: "Scout mode is off in Private Browsing." } }));
  const start = await page.evaluate(() =>
    browser.runtime.sendMessage({ type: "task.start", request_id: "r2", payload: { task_id: "t1", conv: "c", tab_id: 1, provider: "anthropic", model: "m", goal: "x", screenshots: true } }),
  );
  expect(start).toEqual(expect.objectContaining({ type: "error", payload: { error: "blocked-by-user", message: "Scout mode is off in Private Browsing." } }));
  // No per-tab (active) icon was ever set; the theme sync sets the global icon only.
  expect((await calls(page)).icons.filter((i) => i.tabId !== undefined)).toEqual([]);
});

test("the Permissions screen lists every control, and Scout mode off refuses tasks", async ({ page }) => {
  await openPopup(page);
  await page.getByRole("button", { name: "Settings" }).click();
  for (const label of ["Read the current page", "Search history and tabs", "Sensitive-action confirmation"]) await expect(page.getByLabel(label)).toBeVisible();
  await expect(page.getByLabel("Read the current page")).toBeChecked();
  await expect(page.getByLabel("Search history and tabs")).not.toBeChecked();
  for (const h of ["Screenshots", "Scout mode", '"Always allow" sites', "Blocked sites", "Private browsing"]) await expect(page.getByRole("heading", { name: h, exact: true })).toBeVisible();
  const mode = page.getByLabel("When Scout mode is asked to act on a page");
  await expect(mode).toHaveValue("ask");
  await mode.selectOption("off");
  await page.getByRole("button", { name: "Back to chat" }).click();
  await page.getByRole("radio", { name: "Scout" }).check();
  await page.getByLabel("Ask about this page").fill("Do it " + actions([{ type: "click", target: { name: "Show more" } }]));
  await page.getByRole("button", { name: "Start task" }).click();
  await expect(page.getByRole("log").locator(".msg.error").last()).toContainText("Scout mode is turned off in Settings > Permissions.");
  await expect(page.getByRole("alertdialog", { name: "Start a Scout task on 127.0.0.1?" })).toBeHidden();
});

test("run_task from the chat asks per task and starts the task", async ({ page }) => {
  await openPopup(page);
  const goal = "Show more " + actions([{ type: "click", target: { name: "Show more" } }]);
  await page.getByLabel("Ask about this page").fill('Please do it [mock:tool=run_task {"goal":' + JSON.stringify(goal) + "}]");
  await page.getByRole("button", { name: "Send" }).click();
  const ask = page.getByRole("alertdialog", { name: "Start a Scout task on 127.0.0.1?" });
  await expect(ask).toBeVisible();
  await ask.getByRole("button", { name: "Start task" }).click();
  await expect(card(page)).toBeVisible();
  await expect(tabFrame(page).locator("#extra")).toBeVisible();
  await expect(page.getByRole("log").locator(".msg.assistant").first()).toContainText("The run_task tool answered with status ok.");
  await expect(page.getByRole("log").locator(".msg.assistant").last()).toContainText("Mock task finished.");
});

test("what a conversation shared can be seen and cleared in Settings", async ({ page }) => {
  await openPopup(page);
  await page.getByLabel("Ask about this page").fill("What is here? [mock:tool=read_page]");
  await page.getByRole("button", { name: "Send" }).click();
  const answer = page.getByRole("log").locator(".msg.assistant").last();
  await expect(answer).toContainText("That finishes the mock answer.");
  await expect(answer.getByRole("list", { name: "Shared with this answer" })).toContainText("Scout fixture (127.0.0.1)");
  await page.getByRole("button", { name: "Settings" }).click();
  const shared = page.getByRole("list", { name: "Shared in conversations" });
  await expect(shared).toContainText("This tab's conversation");
  await expect(shared).toContainText("Scout fixture (127.0.0.1)");
  await page.getByRole("button", { name: "Clear what this conversation shared" }).click();
  await expect(shared).toContainText("Nothing shared yet.");
  await page.getByRole("button", { name: "Back to chat" }).click();
  await expect(page.getByRole("log").locator(".msg.assistant").last()).toContainText("That finishes the mock answer.");
  await expect(page.getByRole("log").getByRole("list", { name: "Shared with this answer" })).toHaveCount(0);
});
