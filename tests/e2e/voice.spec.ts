import { expect, test, type Page } from "@playwright/test";
import { withWorker } from "./worker";

// Mic and voice buttons (owner design 2026-10-17). The browser's recognizer and
// speech synthesis are replaced by stubs the test drives through window hooks,
// so the same steps run in any engine. Synthetic data only.
const PAGE = { url: "https://shop.test/a", title: "Test shop", text: "Widget costs $10." };
const GOOD_KEY = "sk-ant-test-synthetic-GOODKEY-0000";

/** Stub recognizer: __hear(text, final) feeds text, __endListening(error?) ends it. */
async function stubSpeech(page: Page, opts: { refuse?: boolean; none?: boolean } = {}): Promise<void> {
  await page.addInitScript(({ refuse, none }) => {
    const g = globalThis as unknown as Record<string, unknown>;
    const spoken: string[] = [];
    g.__spoken = spoken;
    g.__listening = false;
    let current: Record<string, unknown> | null = null;
    class Rec {
      lang = "";
      continuous = false;
      interimResults = false;
      onresult: ((e: unknown) => void) | null = null;
      onerror: ((e: unknown) => void) | null = null;
      onend: (() => void) | null = null;
      start(): void {
        current = this as unknown as Record<string, unknown>;
        g.__listening = true;
        g.__continuous = this.continuous;
        if (refuse) setTimeout(() => (g.__endListening as (e?: string) => void)("not-allowed"), 10);
      }
      stop(): void {
        (g.__endListening as () => void)();
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
    class Utterance {
      lang = "";
      onend: (() => void) | null = null;
      onerror: (() => void) | null = null;
      constructor(public text: string) {}
    }
    let speaking: Utterance | null = null;
    g.SpeechSynthesisUtterance = Utterance;
    Object.defineProperty(g, "speechSynthesis", {
      configurable: true,
      value: {
        speak: (u: Utterance) => {
          speaking = u;
          spoken.push(u.text);
        },
        cancel: () => {
          speaking = null;
        },
      },
    });
    g.__finishSpeaking = () => {
      const u = speaking;
      speaking = null;
      u?.onend?.();
    };
  }, { refuse: opts.refuse === true, none: opts.none === true });
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
        scripting: { executeScript: async () => [{ result: pageData }] },
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

test("an empty box shows the mic and the voice button; typing turns the voice button into Send", async ({ page }) => {
  await stubSpeech(page);
  await openPopup(page, { keys: { anthropic: GOOD_KEY } });
  await expect(foot(page).getByRole("button", { name: "Dictate" })).toBeVisible();
  await expect(foot(page).getByRole("button", { name: "Start voice chat" })).toBeVisible();
  await expect(foot(page).getByRole("button", { name: "Send" })).toBeHidden();
  await page.getByLabel("Ask about this page").fill("hello");
  await expect(foot(page).getByRole("button", { name: "Send" })).toBeVisible();
  await expect(foot(page).getByRole("button", { name: "Start voice chat" })).toBeHidden();
  await page.getByLabel("Ask about this page").fill("");
  await expect(foot(page).getByRole("button", { name: "Start voice chat" })).toBeVisible();
  expect(await foot(page).evaluate((n) => n.scrollWidth - n.clientWidth)).toBe(0);
});

test("the mic dictates into the box after what was typed, and stops on a second tap", async ({ page }) => {
  await stubSpeech(page);
  await openPopup(page, { keys: { anthropic: GOOD_KEY } });
  const box = page.getByLabel("Ask about this page");
  await box.fill("Find");
  await foot(page).getByRole("button", { name: "Dictate" }).click();
  await expect(foot(page).getByRole("button", { name: "Stop dictating" })).toHaveAttribute("aria-pressed", "true");
  expect(await page.evaluate(() => (window as unknown as { __continuous: boolean }).__continuous)).toBe(true);
  await page.evaluate(() => (window as unknown as { __hear: (t: string, f: boolean) => void }).__hear("cheaper shoes", false));
  await expect(box).toHaveValue("Find cheaper shoes");
  await foot(page).getByRole("button", { name: "Stop dictating" }).click();
  await expect(foot(page).getByRole("button", { name: "Dictate" })).toHaveAttribute("aria-pressed", "false");
  await expect(box).toHaveValue("Find cheaper shoes");
  await expect(foot(page).getByRole("button", { name: "Send" })).toBeVisible();
  // Nothing was sent: dictation only fills the box.
  await expect(page.locator(".msg.user")).toHaveCount(0);
});

test("a refused microphone says how to dictate with the keyboard and goes back to Send", async ({ page }) => {
  await stubSpeech(page, { refuse: true });
  await openPopup(page, { keys: { anthropic: GOOD_KEY } });
  await foot(page).getByRole("button", { name: "Dictate" }).click();
  await expect(page.locator("#status")).toContainText("Safari didn't allow the microphone here.");
  await expect(foot(page).getByRole("button", { name: "Start voice chat" })).toBeHidden();
  await expect(foot(page).getByRole("button", { name: "Send" })).toBeVisible();
});

test("without a recognizer the box keeps Send and the mic explains keyboard dictation", async ({ page }) => {
  await stubSpeech(page, { none: true });
  await openPopup(page, { keys: { anthropic: GOOD_KEY } });
  await expect(foot(page).getByRole("button", { name: "Start voice chat" })).toBeHidden();
  await expect(foot(page).getByRole("button", { name: "Send" })).toBeVisible();
  await foot(page).getByRole("button", { name: "Dictate" }).click();
  await expect(page.locator("#status")).toContainText("to dictate instead");
});

test("voice chat: what was said is sent, the answer is read aloud, then Scout listens again until ended", async ({ page }) => {
  await stubSpeech(page);
  await openPopup(page, { keys: { anthropic: GOOD_KEY } });
  await foot(page).getByRole("button", { name: "Start voice chat" }).click();
  await expect(foot(page).getByRole("button", { name: "End voice chat" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#status")).toHaveText("Listening…");
  expect(await page.evaluate(() => (window as unknown as { __continuous: boolean }).__continuous)).toBe(false);
  await page.evaluate(() => {
    const w = window as unknown as { __hear: (t: string, f: boolean) => void; __endListening: () => void };
    w.__hear("what does the widget cost", true);
    w.__endListening();
  });
  await expect(page.locator(".msg.user").last()).toHaveText("what does the widget cost");
  await expect.poll(() => page.evaluate(() => (window as unknown as { __spoken: string[] }).__spoken)).toEqual(["The widget costs $10."]);
  await expect(page.locator("#voice")).toHaveAttribute("data-state", "speaking");
  await page.evaluate(() => (window as unknown as { __finishSpeaking: () => void }).__finishSpeaking());
  await expect(page.locator("#voice")).toHaveAttribute("data-state", "listening");
  await foot(page).getByRole("button", { name: "End voice chat" }).click();
  await expect(page.locator("#voice")).toHaveAttribute("data-state", "off");
  expect(await page.evaluate(() => (window as unknown as { __listening: boolean }).__listening)).toBe(false);
  await expect(foot(page).getByRole("button", { name: "Start voice chat" })).toBeVisible();
});
