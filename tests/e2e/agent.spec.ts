import { expect, test, type Page } from "@playwright/test";

// Drives the built popup (run `npm run build` first) with a scripted mock
// model at the network layer and a fake tab that answers the content-script
// messages. No live provider call. Not run in the sandbox (launch-blockers 12).
function sse(events: Array<Record<string, unknown>>): string {
  return events.map((e) => "event: " + String(e.type) + "\ndata: " + JSON.stringify(e) + "\n\n").join("");
}

function turn(name: string, input: Record<string, unknown>, text = ""): string {
  const events: Array<Record<string, unknown>> = [
    { type: "message_start", message: { usage: { input_tokens: 20, output_tokens: 1 } } },
  ];
  let index = 0;
  if (text) {
    events.push(
      { type: "content_block_start", index, content_block: { type: "text", text: "" } },
      { type: "content_block_delta", index, delta: { type: "text_delta", text } },
      { type: "content_block_stop", index },
    );
    index++;
  }
  events.push(
    { type: "content_block_start", index, content_block: { type: "tool_use", id: "t" + name, name } },
    { type: "content_block_delta", index, delta: { type: "input_json_delta", partial_json: JSON.stringify(input) } },
    { type: "content_block_stop", index },
    { type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 8 } },
    { type: "message_stop" },
  );
  return sse(events);
}

const SCRIPT = [
  turn("type", { ref: "e1", text: "Ada" }, "1. Fill name 2. email 3. topic 4. submit"),
  turn("type", { ref: "e2", text: "ada@example.test" }),
  turn("select", { ref: "e3", value: "Support" }),
  turn("scroll", { direction: "down" }),
  turn("click", { ref: "e5" }),
  turn("finish", { summary: "Form sent." }),
];

// modelDelayMs holds every model reply after the first, so a test can act
// (e.g. press Stop) while the run is genuinely mid-flight.
async function openPopup(page: Page, modelDelayMs = 0): Promise<{ acts: string[]; calls: () => number }> {
  const acts: string[] = [];
  let calls = 0;
  await page.exposeFunction("__recordAct", (a: string) => acts.push(a));
  await page.addInitScript(() => {
    const snap = {
      url: "https://shop.test/forms",
      title: "Forms",
      text: "Contact form",
      elements: [{ ref: "e1", tag: "input", role: "textbox", name: "Name" }],
      truncated: false,
    };
    const w = window as unknown as { __recordAct: (a: string) => void };
    (globalThis as unknown as { browser: unknown }).browser = {
      runtime: {
        sendMessage: async () => ({ ok: true }),
        sendNativeMessage: async () => ({ ok: true, value: "sk-test-synthetic" }),
        onMessage: { addListener() {} },
      },
      // Sharing with the provider already allowed (consent.spec.ts covers asking).
      storage: { local: { get: async (k: string | string[]) => (([] as string[]).concat(k).includes("aiConsent") ? { aiConsent: { anthropic: { at: 1, version: 1 }, openai: { at: 1, version: 1 } } } : {}), set: async () => undefined, clear: async () => undefined } },
      tabs: {
        query: async () => [{ id: 1 }],
        sendMessage: async (_id: number, m: { type: string; action?: { type: string } }) => {
          if (m.type === "scout:snapshot") return snap;
          w.__recordAct(m.action?.type ?? "?");
          return { ok: true, action: m.action?.type, message: "ok" };
        },
      },
      scripting: {
        // The popup calls the content handler through executeScript(func, args);
        // the fake page behind it is tabs.sendMessage above.
        // Runs the popup's real injected func against a fake page handler.
        executeScript: async (inj: { func?: (...a: unknown[]) => unknown; args?: unknown[] }) => {
          if (!inj.func || !inj.args) return [{ result: null }];
          const g = globalThis as unknown as Record<string, unknown> & {
            browser: { tabs: { sendMessage: (id: number, m: unknown) => Promise<unknown> } };
          };
          g.__safariScoutHandle = (r: unknown) => g.browser.tabs.sendMessage(1, r);
          return [{ result: await inj.func(...inj.args) }];
        },
      },
    };
  });
  await page.route("**/popup.html", (r) => r.fulfill({ path: "apple/Extension/Resources/popup.html", contentType: "text/html" }));
  await page.route("**/popup.js", (r) => r.fulfill({ path: "apple/Extension/Resources/popup.js", contentType: "text/javascript" }));
  await page.route("https://api.anthropic.com/**", async (r) => {
    const n = calls++;
    const body = SCRIPT[Math.min(n, SCRIPT.length - 1)] ?? "";
    if (n > 0 && modelDelayMs > 0) await new Promise((res) => setTimeout(res, modelDelayMs));
    await r.fulfill({ status: 200, contentType: "text/event-stream", body });
  });
  await page.goto("/popup.html");
  return { acts, calls: () => calls };
}

test("agent completes a 5-step form task and lists every step", async ({ page }) => {
  const { acts } = await openPopup(page);
  await page.getByLabel("Ask about this page").fill("Send a support message as Ada");
  await page.getByRole("radio", { name: "Control Browser" }).check();
  await page.getByRole("button", { name: "Start task" }).click();
  const log = page.getByRole("log", { name: "Conversation" });
  await expect(log.getByText("Form sent.")).toBeVisible();
  await expect(page.getByRole("list").locator("li")).toHaveCount(6);
  expect(acts).toEqual(["type", "type", "select", "scroll", "click"]);
});

test("Stop halts the run within one step", async ({ page }) => {
  const { acts, calls } = await openPopup(page, 1500);
  await page.getByLabel("Ask about this page").fill("Send a support message as Ada");
  await page.getByRole("radio", { name: "Control Browser" }).check();
  await page.getByRole("button", { name: "Start task" }).click();
  await page.getByRole("button", { name: "Stop" }).first().click();
  await expect(page.getByText("Stopped.", { exact: true })).toBeVisible();
  expect(acts.length).toBeLessThanOrEqual(1);
  expect(calls()).toBeLessThanOrEqual(2);
});
