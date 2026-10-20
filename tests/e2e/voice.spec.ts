import { expect, test, type Page } from "@playwright/test";
import { withWorker } from "./worker";

// Mic button (owner, 2026-10-17): speech to text into the box; Send sends as
// usual. The browser's recognizer is replaced by a stub the test drives
// through window hooks, so the same steps run in any engine. Synthetic data only.
const PAGE = { url: "https://shop.test/a", title: "Test shop", text: "Widget costs $10." };
const GOOD_KEY = "sk-ant-test-synthetic-GOODKEY-0000";

/** Stub recognizer: __hear(text, final) feeds text, __endListening(error?) ends it. */
async function stubSpeech(page: Page, opts: { refuse?: boolean; none?: boolean; silent?: boolean } = {}): Promise<void> {
  await page.addInitScript(({ refuse, none, silent }) => {
    const g = globalThis as unknown as Record<string, unknown>;
    g.__listening = false;
    let current: Record<string, unknown> | null = null;
    class Rec {
      lang = "";
      continuous = false;
      interimResults = false;
      onresult: ((e: unknown) => void) | null = null;
      onerror: ((e: unknown) => void) | null = null;
      onend: (() => void) | null = null;
      onstart: (() => void) | null = null;
      start(): void {
        current = this as unknown as Record<string, unknown>;
        g.__starts = ((g.__starts as number) ?? 0) + 1;
        if (silent) {
          g.__listening = true;
          return;
        }
        setTimeout(() => this.onstart?.(), 0);
        g.__listening = true;
        g.__continuous = this.continuous;
        // `refuse` refuses only the panel's own recognizer; the page's (g.__inPage) works.
        if (refuse && !g.__inPage) setTimeout(() => (g.__endListening as (e?: string) => void)("not-allowed"), 10);
        else if (g.__pageRefuses && g.__inPage) setTimeout(() => (g.__endListening as (e?: string) => void)("not-allowed"), 10);
      }
      stop(): void {
        if (!silent) (g.__endListening as () => void)();
      }
      abort(): void {
        (g.__endListening as (e?: string) => void)("aborted");
      }
    }
    g.__hear = (text: string, final: boolean) => {
      const r = current as unknown as Rec | null;
      r?.onresult?.({ results: [{ isFinal: final, 0: { transcript: text } }] });
    };
    g.__endListening = (error?: string) => {
      const r = current as unknown as Rec | null;
      if (!r) return;
      current = null;
      g.__listening = false;
      if (error) r.onerror?.({ error });
      r.onend?.();
    };
    if (none) {
      delete g.webkitSpeechRecognition;
      delete g.SpeechRecognition;
    } else {
      g.webkitSpeechRecognition = Rec;
      g.SpeechRecognition = undefined;
    }
  }, { refuse: opts.refuse === true, none: opts.none === true, silent: opts.silent === true });
}

function sse(text: string): string {
  const ev = [
    { type: "message_start", message: { usage: { input_tokens: 20, output_tokens: 1 } } },
    { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
    { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } },
    { type: "content_block_stop", index: 0 },
    { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 5 } },
    { type: "message_stop" },
  ];
  return ev.map((e) => "event: " + e.type + "\ndata: " + JSON.stringify(e) + "\n\n").join("");
}

async function openPopup(page: Page, opts: { keys?: Record<string, string>; data?: Record<string, unknown>; pageData?: typeof PAGE & { favIconUrl?: string } } = {}): Promise<void> {
  await page.addInitScript(
    ({ keys, data, pageData }) => {
      const g = globalThis as unknown as Record<string, unknown>;
      // Survive reloads inside one test (simulates reopening the popup).
      const store = (g.sessionStorage as Storage).getItem("__fake");
      const fake = store ? JSON.parse(store) : { keys, data };
      const save = () => (g.sessionStorage as Storage).setItem("__fake", JSON.stringify(fake));
      save();
      g.__fake = fake;
      g.browser = {
        runtime: {
          sendMessage: async () => ({ ok: true }),
          sendNativeMessage: async (_app: string, m: { type: string; account: string; value?: string }) => {
            if (m.type === "keychain.get") return fake.keys[m.account] ? { ok: true, value: fake.keys[m.account] } : { ok: true };
            if (m.type === "keychain.set") { fake.keys[m.account] = m.value; save(); return { ok: true }; }
            if (m.type === "keychain.delete") { delete fake.keys[m.account]; save(); return { ok: true }; }
            return { ok: true };
          },
          onMessage: { addListener() {} },
        },
        tabs: { query: async () => [{ id: 1, url: pageData.url, title: pageData.title, active: true, favIconUrl: (pageData as { favIconUrl?: string }).favIconUrl }] },
        permissions: { request: async () => true, getAll: async () => ({ origins: [] }), remove: async () => true },
        scripting: {
          // The mic's page fallback runs here as if in the page (src/panel/page-listen.ts).
          executeScript: async (inj: { func?: (...a: unknown[]) => unknown; args?: unknown[] }) => {
            if (!inj.func || !/^pageListen/.test(inj.func.name)) return [{ result: pageData }];
            g.__pageCalls = ((g.__pageCalls as number) ?? 0) + 1;
            g.__inPage = true;
            try {
              return [{ result: inj.func(...(inj.args ?? [])) }];
            } finally {
              g.__inPage = false;
            }
          },
        },
        storage: {
          local: {
            get: async (k: string | string[]) => {
              const list = Array.isArray(k) ? k : [k];
              return JSON.parse(JSON.stringify(Object.fromEntries(list.filter((x) => x in fake.data).map((x) => [x, fake.data[x]]))));
            },
            set: async (items: Record<string, unknown>) => { Object.assign(fake.data, JSON.parse(JSON.stringify(items))); save(); },
            clear: async () => { fake.data = {}; save(); },
          },
        },
      };
    },
    // Sharing with the providers already allowed (consent.spec.ts covers asking).
    { keys: opts.keys ?? {}, data: { aiConsent: { anthropic: { at: 1, version: 2 }, openai: { at: 1, version: 2 } }, ...(opts.data ?? {}) }, pageData: opts.pageData ?? PAGE },
  );
  await page.route("**/popup.html", (r) => r.fulfill({ path: "apple/Extension/Resources/popup.html", contentType: "text/html" }));
  await page.route("**/popup.js", (r) => r.fulfill({ path: "apple/Extension/Resources/popup.js", contentType: "text/javascript" }));
  await page.route("**/icons/**", (r) => r.fulfill({ status: 200, contentType: "image/png", body: "" }));
  await page.route("https://api.anthropic.com/v1/models**", (r) =>
    r.fulfill({ status: r.request().headers()["x-api-key"] === GOOD_KEY ? 200 : 401, body: "{}" }),
  );
  await page.route("https://api.anthropic.com/v1/messages", (r) =>
    r.fulfill({ status: 200, contentType: "text/event-stream", body: sse("The widget costs **$10**.") }),
  );
  await withWorker(page);
  await page.goto("/popup.html");
}

const foot = (page: Page) => page.locator(".composer-foot");

test("the mic and Send are both always in the row", async ({ page }) => {
  await stubSpeech(page);
  await openPopup(page, { keys: { anthropic: GOOD_KEY } });
  await expect(foot(page).getByRole("button", { name: "Dictate" })).toBeVisible();
  await expect(foot(page).getByRole("button", { name: "Send" })).toBeVisible();
  await page.getByLabel("Ask about this page").fill("hello");
  await expect(foot(page).getByRole("button", { name: "Dictate" })).toBeVisible();
  await expect(foot(page).getByRole("button", { name: "Send" })).toBeVisible();
  expect(await foot(page).evaluate((n) => n.scrollWidth - n.clientWidth)).toBe(0);
});

test("the mic types what was said after what was typed, sends nothing, and Send sends it as usual", async ({ page }) => {
  await stubSpeech(page);
  await openPopup(page, { keys: { anthropic: GOOD_KEY } });
  const box = page.getByLabel("Ask about this page");
  await box.fill("What does");
  await foot(page).getByRole("button", { name: "Dictate" }).click();
  await expect(foot(page).getByRole("button", { name: "Stop dictating" })).toHaveAttribute("aria-pressed", "true");
  expect(await page.evaluate(() => (window as unknown as { __continuous: boolean }).__continuous)).toBe(true);
  await page.evaluate(() => (window as unknown as { __hear: (t: string, f: boolean) => void }).__hear("the widget cost", false));
  await expect(box).toHaveValue("What does the widget cost");
  await foot(page).getByRole("button", { name: "Stop dictating" }).click();
  await expect(foot(page).getByRole("button", { name: "Dictate" })).toHaveAttribute("aria-pressed", "false");
  await expect(box).toHaveValue("What does the widget cost");
  await expect(page.locator(".msg.user")).toHaveCount(0);
  await foot(page).getByRole("button", { name: "Send" }).click();
  await expect(page.locator(".msg.user").last()).toHaveText("What does the widget cost");
  await expect(page.locator(".msg.assistant").last()).toContainText("The widget costs $10.");
});

test("without a recognizer the mic explains keyboard dictation", async ({ page }) => {
  await stubSpeech(page, { none: true });
  await openPopup(page, { keys: { anthropic: GOOD_KEY } });
  await foot(page).getByRole("button", { name: "Dictate" }).click();
  await expect(page.locator("#status")).toContainText("to dictate instead");
});

test("a mic that never starts (iPhone Safari) turns itself off with a message", async ({ page }) => {
  test.setTimeout(45000);
  await stubSpeech(page, { silent: true });
  await openPopup(page, { keys: { anthropic: GOOD_KEY } });
  await foot(page).getByRole("button", { name: "Dictate" }).click();
  await expect(foot(page).getByRole("button", { name: "Stop dictating" })).toHaveAttribute("aria-pressed", "true");
  // 4 s for the panel, then up to 15 s for the page's microphone question.
  await expect(foot(page).getByRole("button", { name: "Dictate" })).toHaveAttribute("aria-pressed", "false", { timeout: 25000 });
  await expect(page.locator("#status")).toContainText("didn't let Scout use the microphone");
  await expect(page.locator("#status")).toContainText("to dictate instead");
});

test("tapping a stuck mic again turns it off", async ({ page }) => {
  await stubSpeech(page, { silent: true });
  await openPopup(page, { keys: { anthropic: GOOD_KEY } });
  await foot(page).getByRole("button", { name: "Dictate" }).click();
  await foot(page).getByRole("button", { name: "Stop dictating" }).click();
  await expect(foot(page).getByRole("button", { name: "Dictate" })).toHaveAttribute("aria-pressed", "false", { timeout: 2000 });
});

test("when Safari refuses the panel's mic, Scout listens from the page and the mic stays on", async ({ page }) => {
  await stubSpeech(page, { refuse: true });
  await openPopup(page, { keys: { anthropic: GOOD_KEY } });
  const box = page.getByLabel("Ask about this page");
  await box.fill("Find");
  await foot(page).getByRole("button", { name: "Dictate" }).click();
  await expect(page.locator("#status")).toHaveText("Listening…");
  await expect.poll(() => page.evaluate(() => (window as unknown as { __pageCalls?: number }).__pageCalls ?? 0)).toBeGreaterThan(1);
  await expect(foot(page).getByRole("button", { name: "Stop dictating" })).toHaveAttribute("aria-pressed", "true");
  await page.evaluate(() => (window as unknown as { __hear: (t: string, f: boolean) => void }).__hear("cheap shoes", true));
  await expect(box).toHaveValue("Find cheap shoes");
  await foot(page).getByRole("button", { name: "Stop dictating" }).click();
  await expect(foot(page).getByRole("button", { name: "Dictate" })).toHaveAttribute("aria-pressed", "false");
  await expect(box).toHaveValue("Find cheap shoes");
  await expect(page.locator("#status")).toHaveText("");
});

test("after one refusal the mic still lights up and goes straight to the page", async ({ page }) => {
  await stubSpeech(page, { refuse: true });
  await openPopup(page, { keys: { anthropic: GOOD_KEY } });
  await foot(page).getByRole("button", { name: "Dictate" }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __pageCalls?: number }).__pageCalls ?? 0)).toBeGreaterThan(0);
  await foot(page).getByRole("button", { name: "Stop dictating" }).click();
  await expect(foot(page).getByRole("button", { name: "Dictate" })).toHaveAttribute("aria-pressed", "false");
  await page.reload();
  await foot(page).getByRole("button", { name: "Dictate" }).click();
  await expect(foot(page).getByRole("button", { name: "Stop dictating" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#status")).toHaveText("Listening…");
  await page.evaluate(() => (window as unknown as { __hear: (t: string, f: boolean) => void }).__hear("hello", true));
  await expect(page.getByLabel("Ask about this page")).toHaveValue("hello");
});

test("when the page refuses too, the mic turns off and says why", async ({ page }) => {
  await stubSpeech(page, { refuse: true });
  await page.addInitScript(() => ((globalThis as unknown as Record<string, unknown>).__pageRefuses = true));
  await openPopup(page, { keys: { anthropic: GOOD_KEY } });
  await foot(page).getByRole("button", { name: "Dictate" }).click();
  await expect(page.locator("#status")).toContainText("Safari didn't allow the microphone here.");
  await expect(foot(page).getByRole("button", { name: "Dictate" })).toHaveAttribute("aria-pressed", "false");
});

test.describe("on iPhone (owner choice 2026-10-20)", () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 393, height: 700 } });
  test("Scout's mic is hidden and Send still fits", async ({ page }) => {
    await stubSpeech(page);
    await openPopup(page, { keys: { anthropic: GOOD_KEY } });
    await expect(foot(page).getByRole("button", { name: "Send" })).toBeVisible();
    await expect(page.locator("#mic")).toBeHidden();
    expect(await foot(page).evaluate((n) => n.scrollWidth - n.clientWidth)).toBe(0);
  });
});
