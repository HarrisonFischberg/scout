// Plain-English steps while Scout works (owner, 2026-11-08): wording, the
// step events from provider to panel, and the step line's timing.
import { describe, expect, it } from "vitest";
import { readingStep, stepText, waitingStep } from "../../src/chat/steps";
import { ConversationStore } from "../../src/chat/store";
import { createProvider, type StreamEvent } from "../../src/providers";
import type { ProviderClient } from "../../src/providers/types";
import { ScoutServer, type StartRequest } from "../../src/server/engine";
import { fromWire, toWire, type NumberedEvent } from "../../src/server/protocol";
import { checkSchema, WORKER_EVENTS } from "../../src/bridge/messages";
import { createStepLine, MIN_STEP_MS } from "../../src/panel/step-line";

describe("step wording", () => {
  const ctx = { summary: false };
  it("says each big step in plain English", () => {
    expect(stepText({ step: "search", detail: "best pizza in Brooklyn" }, ctx)).toBe("Searching for “best pizza in Brooklyn”");
    expect(stepText({ step: "search" }, ctx)).toBe("Searching the web");
    expect(stepText({ step: "results", count: 8 }, ctx)).toBe("Reading 8 results");
    expect(stepText({ step: "results", count: 1 }, ctx)).toBe("Reading the results");
    expect(stepText({ step: "fetch", detail: "nytimes.com" }, ctx)).toBe("Opening nytimes.com");
    expect(stepText({ step: "thinking" }, ctx)).toBe("Thinking it through");
    expect(stepText({ step: "writing" }, ctx)).toBe("Writing your answer");
    expect(stepText({ step: "writing" }, { summary: true })).toBe("Writing your summary");
    expect(stepText({ step: "handoff" }, ctx)).toBe("Looking deeper");
    expect(stepText({ step: "tool", name: "screenshot_visible" }, ctx)).toBe("Looking at the screen");
    expect(stepText({ step: "tool", name: "something_new" }, ctx)).toBe("Working on it");
  });

  it("keeps a long search on one line", () => {
    const t = stepText({ step: "search", detail: "a very long search query that goes on and on about many different things" }, ctx);
    expect(t.length).toBeLessThan(80);
    expect(t).toMatch(/…”$/);
  });

  it("names what the panel reads first", () => {
    expect(readingStep({ page: true, video: true, instagram: false, tabs: 0 })).toBe("Getting the video’s captions");
    expect(readingStep({ page: true, video: false, instagram: true, tabs: 0 })).toBe("Looking at the post");
    expect(readingStep({ page: true, video: false, instagram: false, tabs: 2 })).toBe("Reading the page and 2 tabs");
    expect(readingStep({ page: false, video: false, instagram: false, tabs: 1 })).toBe("Reading 1 tab");
    // A general question doesn't read the page: no reading step.
    expect(readingStep({ page: false, video: true, instagram: false, tabs: 0 })).toBeNull();
  });

  it("says what happens while the model works", () => {
    expect(waitingStep({ summary: true, video: true, continued: false })).toBe("Picking out the key moments");
    expect(waitingStep({ summary: true, video: false, continued: false })).toBe("Picking out the key points");
    expect(waitingStep({ summary: false, video: false, continued: false })).toBe("Thinking it through");
  });
});

describe("step events", () => {
  it("survive the port, the bridge schema and the store", () => {
    const steps = [
      { step: "search", detail: "weather in Paris" },
      { step: "results", count: 5 },
      { step: "fetch", detail: "example.com" },
      { step: "thinking" },
      { step: "writing" },
    ] as const;
    const st = new ConversationStore();
    st.create("m");
    steps.forEach((step, i) => {
      const wire = toWire("m", { seq: i + 1, event: { kind: "step", step } });
      expect(checkSchema(WORKER_EVENTS["chat.event"], wire)).toBeNull();
      const back = fromWire(wire);
      expect(back?.event).toEqual({ kind: "step", step });
      st.apply("m", i + 1, back!.event);
      expect(st.get("m")?.step).toEqual(step);
    });
    // A browser tool the model asks for is a step too.
    st.apply("m", 6, { kind: "tool_request", request_id: "r", name: "read_page", input: {} });
    expect(st.get("m")?.step).toEqual({ step: "tool", name: "read_page" });
  });

  it("drops an unknown step", () => {
    expect(fromWire({ message_id: "m", seq: 1, kind: "step", step: "hack" })).toBeNull();
  });

  it("come from Anthropic's search, fetch and thinking blocks", async () => {
    const events = [
      { type: "message_start", message: { usage: { input_tokens: 1, output_tokens: 1 } } },
      { type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "" } },
      { type: "content_block_stop", index: 0 },
      { type: "content_block_start", index: 1, content_block: { type: "server_tool_use", id: "s1", name: "web_search", input: {} } },
      { type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: '{"query":"widget price"}' } },
      { type: "content_block_stop", index: 1 },
      { type: "content_block_start", index: 2, content_block: { type: "web_search_tool_result", tool_use_id: "s1", content: [{ type: "web_search_result", url: "https://a.test/", title: "A" }, { type: "web_search_result", url: "https://b.test/", title: "B" }] } },
      { type: "content_block_stop", index: 2 },
      { type: "content_block_start", index: 3, content_block: { type: "server_tool_use", id: "f1", name: "web_fetch", input: {} } },
      { type: "content_block_delta", index: 3, delta: { type: "input_json_delta", partial_json: '{"url":"https://www.shop.test/item"}' } },
      { type: "content_block_stop", index: 3 },
      { type: "content_block_start", index: 4, content_block: { type: "text", text: "" } },
      { type: "content_block_delta", index: 4, delta: { type: "text_delta", text: "Done." } },
      { type: "content_block_stop", index: 4 },
      { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 3 } },
      { type: "message_stop" },
    ];
    const body = events.map((e) => "event: " + e.type + "\ndata: " + JSON.stringify(e) + "\n\n").join("");
    const p = createProvider("anthropic", { apiKey: "sk-test-synthetic", fetch: async () => new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } }) });
    const got: StreamEvent[] = [];
    for await (const ev of p.stream({ model: "m", messages: [{ role: "user", content: "x" }], maxTokens: 10, webSearch: true })) got.push(ev);
    const steps = got.flatMap((e) => (e.type === "progress" ? [e.step] : []));
    expect(steps).toEqual([
      { step: "thinking" },
      { step: "writing" },
      { step: "search", detail: "widget price" },
      { step: "results", count: 2 },
      { step: "fetch", detail: "shop.test" },
    ]);
  });

  it("are passed on by the answer engine before the words", async () => {
    const provider: ProviderClient = {
      id: "anthropic",
      async *stream() {
        yield { type: "progress", step: { step: "search", detail: "q" } };
        yield { type: "text", delta: "Hi" };
        yield { type: "done" };
      },
    };
    const s = new ScoutServer({ provider: async () => provider, tools: async () => [], save: async () => undefined, now: () => 1 });
    const req: StartRequest = { message_id: "m1", conv: "c", provider: "anthropic", model: "x", question: "q", history: [], pages: [], shared: [] };
    s.start(req);
    const got = await new Promise<NumberedEvent[]>((resolve) => {
      const out: NumberedEvent[] = [];
      s.subscribe("m1", 0, (n) => {
        out.push(n);
        if (n.event.kind === "done") resolve(out);
      });
    });
    expect(got.map((n) => n.event.kind)).toEqual(["start", "step", "text", "done"]);
  });
});

/** Just enough DOM for the step line. */
function fakeDoc() {
  class El {
    className = "";
    textContent = "";
    innerHTML = "";
    attrs: Record<string, string> = {};
    children: El[] = [];
    parent: El | null = null;
    setAttribute(k: string, v: string) {
      this.attrs[k] = v;
    }
    appendChild(c: El) {
      c.parent = this;
      this.children.push(c);
      return c;
    }
    remove() {
      if (this.parent) this.parent.children = this.parent.children.filter((c) => c !== this);
    }
  }
  return { createElement: () => new El() } as unknown as Document;
}

describe("step line", () => {
  function setup() {
    let t = 0;
    const timers: Array<{ at: number; fn: () => void }> = [];
    const clock = { now: () => t, later: (fn: () => void, ms: number) => timers.push({ at: t + ms, fn }) };
    const advance = (ms: number) => {
      t += ms;
      for (const x of timers.splice(0).sort((a, b) => a.at - b.at)) {
        if (x.at <= t) x.fn();
        else timers.push(x);
      }
    };
    const line = createStepLine(fakeDoc(), "", "Reading the page", clock);
    const stack = (line.el as unknown as { children: Array<{ children: Array<{ className: string; textContent: string }> }> }).children[0]!;
    return { line, advance, stack };
  }

  it("keeps each step on screen long enough to read, then shows only the newest waiting one", () => {
    const { line, advance, stack } = setup();
    line.set("Thinking it through");
    line.set("Searching the web");
    expect(line.label).toBe("Reading the page");
    advance(MIN_STEP_MS);
    expect(line.label).toBe("Searching the web");
    // The old step leaves, then is removed.
    expect(stack.children.map((c) => c.className)).toEqual(["step leaving", "step now entering"]);
    advance(400);
    expect(stack.children.map((c) => c.textContent)).toEqual(["Searching the web…"]);
  });

  it("changes at once after the minimum time, and ignores the same step", () => {
    const { line, advance } = setup();
    advance(MIN_STEP_MS + 10);
    line.set("Reading the page");
    expect(line.label).toBe("Reading the page");
    line.set("Thinking it through");
    expect(line.label).toBe("Thinking it through");
  });

  it("is announced politely to VoiceOver", () => {
    const { line } = setup();
    const attrs = (line.el as unknown as { attrs: Record<string, string> }).attrs;
    expect(attrs).toEqual({ role: "status", "aria-live": "polite" });
  });
});
