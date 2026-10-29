// Part 2 Scout server (spec 5) and conversation store: streaming events, a
// tool request in the middle of a stream, resume without duplicates, Stop,
// and a provider stream that drops. Scripted provider; no network.
import { describe, expect, it } from "vitest";
import { ConversationStore } from "../../src/chat/store";
import { ProviderError } from "../../src/providers/errors";
import { textOf, type ChatRequest, type ProviderClient, type StreamEvent } from "../../src/providers/types";
import { ScoutServer, toolResultsTurn, type EngineDeps, type StartRequest } from "../../src/server/engine";
import { fromWire, toWire, type NumberedEvent } from "../../src/server/protocol";

const last = <T>(a: T[]): T | undefined => a[a.length - 1];
const secondLast = <T>(a: T[]): T | undefined => a[a.length - 2];

type Step = StreamEvent | { type: "throw"; error: unknown } | { type: "wait"; ms: number };

function scripted(rounds: Step[][]): ProviderClient & { seen: ChatRequest[] } {
  const seen: ChatRequest[] = [];
  let i = 0;
  return {
    id: "anthropic",
    seen,
    async *stream(req) {
      seen.push(JSON.parse(JSON.stringify({ ...req, signal: undefined })) as ChatRequest);
      const steps = rounds[i++] ?? [];
      for (const s of steps) {
        if (req.signal?.aborted) throw new DOMException("aborted", "AbortError");
        if (s.type === "throw") throw s.error;
        if (s.type === "wait") {
          await new Promise((r) => setTimeout(r, s.ms));
          continue;
        }
        yield s;
      }
    },
  };
}

const text = (delta: string): StreamEvent => ({ type: "text", delta });
const usage = (i: number, o: number): StreamEvent => ({ type: "usage", usage: { inputTokens: i, outputTokens: o } });

function server(provider: ProviderClient, over: Partial<EngineDeps> = {}) {
  const saved: Array<{ question: string; answer: string; shared: unknown[]; sources: unknown[] }> = [];
  const s = new ScoutServer({
    provider: async () => provider,
    tools: async () => [{ name: "read_page", description: "Read", parameters: { type: "object" } }],
    save: async (e) => void saved.push(e),
    now: () => 1,
    ...over,
  });
  return { s, saved };
}

const REQ: StartRequest = {
  message_id: "m1",
  conv: "c1",
  provider: "anthropic",
  model: "claude-sonnet-5-5",
  question: "How much is the widget?",
  history: [],
  pages: [{ url: "https://shop.test/a", title: "Test shop", text: "Widget costs $10." }],
  shared: [{ title: "Test shop", host: "shop.test", status: "read" }],
};

/** Collects events until done or error. */
function collect(s: ScoutServer, id: string, after = 0): Promise<NumberedEvent[]> {
  return new Promise((resolve) => {
    const got: NumberedEvent[] = [];
    s.subscribe(id, after, (n) => {
      got.push(n);
      if (n.event.kind === "done" || n.event.kind === "error") resolve(got);
    });
  });
}

describe("ScoutServer", () => {
  it("streams numbered events and saves the answer with what was shared", async () => {
    const { s, saved } = server(scripted([[text("It costs "), text("$10."), usage(30, 5), { type: "done" }]]));
    s.start(REQ);
    const events = await collect(s, "m1");
    expect(events.map((e) => e.seq)).toEqual([1, 2, 3, 4, 5]);
    expect(events.map((e) => e.event.kind)).toEqual(["start", "text", "text", "usage", "done"]);
    expect(last(events)?.event).toEqual({ kind: "done", text: "It costs $10." });
    expect(saved).toEqual([
      {
        at: 1,
        conv: "c1",
        question: REQ.question,
        answer: "It costs $10.",
        shared: REQ.shared,
        sources: [{ url: "https://shop.test/a", title: "Test shop", kind: "page" }],
      },
    ]);
  });

  it("saves numbered sources as the panel numbers them: earlier part, pages, then web citations", async () => {
    const { s, saved } = server(
      scripted([[text("Rated 4.5 [2]."), { type: "source", url: "https://reviews.test/w", title: "Reviews" }, { type: "source", url: "https://reviews.test/w" }, { type: "done" }]]),
    );
    s.start({ ...REQ, prefix_sources: [{ url: "https://old.test/", title: "" }] });
    await collect(s, "m1");
    expect(saved[0]?.sources).toEqual([
      { url: "https://old.test/" },
      { url: "https://shop.test/a", title: "Test shop", kind: "page" },
      { url: "https://reviews.test/w", title: "Reviews", kind: "web" },
    ]);
  });

  it("drops citations that are not web pages, so no javascript: link reaches the panel (QA 2026-10-29)", async () => {
    const { s, saved } = server(
      scripted([[text("Answer"), { type: "source", url: "javascript:alert(1)", title: "x", cite: true }, { type: "source", url: "data:text/html,hi" }, { type: "done" }]]),
    );
    s.start(REQ);
    const events = await collect(s, "m1");
    expect(JSON.stringify(events)).not.toMatch(/javascript:|data:text/);
    expect(saved[0]?.sources).toEqual([{ url: "https://shop.test/a", title: "Test shop", kind: "page" }]);
    expect(saved[0]?.answer).toBe("Answer");
  });

  it("links the provider's own citations as numbered markers (owner report 2026-10-29)", async () => {
    const { s, saved } = server(
      scripted([
        [
          text("Big Joe Fuf costs half as much"),
          { type: "source", url: "https://a.test/x", title: "A", text: "half" },
          { type: "source", url: "https://a.test/x", title: "A", cite: true },
          text(". It is firm"),
          { type: "source", url: "https://b.test/y", cite: true },
          { type: "source", url: "https://b.test/y", cite: true },
          text("."),
          { type: "done" },
        ],
      ]),
    );
    s.start({ ...REQ, prefix_sources: [{ url: "https://old.test/", title: "" }] });
    const events = await collect(s, "m1");
    // Earlier part 1, page 2, then web sources 3 and 4; the same marker is not repeated.
    expect(last(events)?.event).toEqual({ kind: "done", text: "Big Joe Fuf costs half as much [3]. It is firm [4]." });
    expect(saved[0]?.sources).toEqual([
      { url: "https://old.test/" },
      { url: "https://shop.test/a", title: "Test shop", kind: "page" },
      { url: "https://a.test/x", title: "A", kind: "web" },
      { url: "https://b.test/y", kind: "web" },
    ]);
  });

  it("offers web search with a budget for the whole answer, and tells the model when to use it", async () => {
    const provider = scripted([
      [{ type: "tool_call", id: "t", name: "read_page", input: {} }, { type: "usage", usage: { inputTokens: 1, outputTokens: 1, webSearches: 2 } }],
      [text("ok"), { type: "usage", usage: { inputTokens: 1, outputTokens: 1, webSearches: 1 } }],
    ]);
    const { s } = server(provider);
    s.start(REQ);
    const done = new Promise<void>((resolve) =>
      s.subscribe("m1", 0, (n) => {
        if (n.event.kind === "tool_request") s.toolResult("m1", n.event.request_id, { status: "ok", text: "page" });
        if (n.event.kind === "done") resolve();
      }),
    );
    await done;
    expect(provider.seen[0]).toMatchObject({ webSearch: true, webSearchMaxUses: 5 });
    expect(provider.seen[0]?.system).toContain("You can search the web.");
    // A lookup that misses is retried with new wording (owner report 2026-10-23, song from a lyric).
    expect(provider.seen[0]?.system).toContain("search again with a different wording");
    expect(provider.seen[0]?.system).toContain("Never answer that you could not find something after one search");
    expect(provider.seen[0]?.system).toContain("search engine's results page is only the user's own search");
    expect(provider.seen[1]).toMatchObject({ webSearch: true, webSearchMaxUses: 3 });
  });

  it("sends a general question with the general rules, which never name the page", async () => {
    const provider = scripted([[text("Try Martha & Bros."), { type: "done" }]]);
    const { s } = server(provider);
    s.start({ ...REQ, question: "Best coffee shop in Noe Valley?", pages: [], shared: [], scope: "general" });
    await collect(s, "m1");
    const req = provider.seen[0]!;
    expect(req.system).toContain("the page text was not included");
    expect(req.system).toContain("Do not mention the page");
    expect(req.system).not.toContain("is included with each message");
    expect(textOf(last(req.messages)!.content)).toBe("Best coffee shop in Noe Valley?");
  });

  it("sends a general question with the open page's title and address only, so the model can tell when it is relevant", async () => {
    const provider = scripted([[text("Officials said 12."), { type: "done" }]]);
    const { s } = server(provider);
    s.start({
      ...REQ,
      question: "How many people died?",
      pages: [],
      shared: [],
      scope: "general",
      open_page: { url: "https://news.example/2026/storm-hits-coast?utm=x", title: "Storm hits the coast" },
    });
    await collect(s, "m1");
    const req = provider.seen[0]!;
    expect(req.system).toContain("plausibly about the same subject");
    expect(req.system).toContain("ignore the open page completely");
    const content = textOf(last(req.messages)!.content);
    expect(content).toContain("Title: Storm hits the coast");
    expect(content).toContain("Address: news.example/2026/storm-hits-coast");
    expect(content).not.toContain("utm=x");
    expect(content).toMatch(/<\/untrusted_page_content>\n\nUser message: How many people died\?$/);
  });

  it("keeps the page rules for a page question", async () => {
    const provider = scripted([[text("$10."), { type: "done" }]]);
    const { s } = server(provider);
    s.start({ ...REQ, scope: "page" });
    await collect(s, "m1");
    expect(provider.seen[0]?.system).toContain("is included with each message");
    expect(textOf(last(provider.seen[0]!.messages)!.content)).toContain("<untrusted_page_content>");
  });

  it("refuses a reused message id", () => {
    const { s } = server(scripted([[text("x")]]));
    s.start(REQ);
    expect(() => s.start(REQ)).toThrow(/already in use/);
  });

  it("asks the panel for a tool mid-stream and continues the same answer with the result", async () => {
    const provider = scripted([
      [text("Let me check the reviews."), { type: "tool_call", id: "t1", name: "read_page", input: { tab_id: 2 } }, usage(40, 10)],
      [text("They rate it 4.5 stars."), usage(60, 8)],
    ]);
    const { s, saved } = server(provider);
    s.start(REQ);
    const seen: NumberedEvent[] = [];
    const done = new Promise<void>((resolve) =>
      s.subscribe("m1", 0, (n) => {
        seen.push(n);
        if (n.event.kind === "tool_request") {
          expect(n.event).toEqual({ kind: "tool_request", request_id: "m1.1.1", name: "read_page", input: { tab_id: 2 } });
          setTimeout(() => s.toolResult("m1", n.event.kind === "tool_request" ? n.event.request_id : "", { status: "ok", text: "Rated 4.5 stars.", shared: { title: "Reviews", host: "reviews.test" } }), 0);
        }
        if (n.event.kind === "done") resolve();
      }),
    );
    await done;
    const final = last(seen)?.event;
    expect(final).toEqual({ kind: "done", text: "Let me check the reviews.\n\nThey rate it 4.5 stars." });
    expect(seen.some((n) => n.event.kind === "tool_done" && n.event.status === "ok")).toBe(true);
    // Second model call carries the tool turn as text and the result fenced as data.
    const second = provider.seen[1]!;
    expect(textOf(secondLast(second.messages)!.content)).toContain('[tool read_page {"tab_id":2}]');
    expect(textOf(last(second.messages)!.content)).toContain('<tool_result name="read_page" status="ok">');
    expect(seen.find((n) => n.event.kind === "usage")?.event).toEqual({ kind: "usage", usage: { inputTokens: 100, outputTokens: 18 } });
    expect(saved[0]?.shared).toEqual([...REQ.shared!, { title: "Reviews", host: "reviews.test", status: "read" }]);
  });

  it("offers no tools on the last round so the model has to answer", async () => {
    const call: StreamEvent = { type: "tool_call", id: "t", name: "read_page", input: {} };
    const provider = scripted([[call], [text("ok")]]);
    const { s } = server(provider, { maxRounds: 2 });
    s.start(REQ);
    s.subscribe("m1", 0, (n) => {
      if (n.event.kind === "tool_request") s.toolResult("m1", n.event.request_id, { status: "ok", text: "x" });
    });
    await collect(s, "m1");
    expect(provider.seen[0]?.tools).toHaveLength(1);
    expect(provider.seen[1]?.tools).toBeUndefined();
  });

  it("times out a tool request the panel never answers and tells the model", async () => {
    const provider = scripted([[{ type: "tool_call", id: "t", name: "read_page", input: {} }], [text("Could not read it.")]]);
    const { s } = server(provider, { toolTimeoutMs: 10 });
    s.start(REQ);
    const events = await collect(s, "m1");
    expect(events.find((n) => n.event.kind === "tool_done")?.event).toMatchObject({ status: "timeout" });
    expect(s.toolResult("m1", "m1.1.1", { status: "ok", text: "late" })).toBe(false);
  });

  it("replays only events after the given sequence number (resume without duplicates)", async () => {
    const { s } = server(scripted([[text("A"), text("B"), text("C"), { type: "done" }]]));
    s.start(REQ);
    const all = await collect(s, "m1");
    const store = new ConversationStore();
    store.create("m1");
    for (const n of all.slice(0, 3)) store.apply("m1", n.seq, n.event);
    expect(store.get("m1")?.text).toBe("AB");
    // The port dropped after seq 3; resubscribe from there.
    const rest: NumberedEvent[] = [];
    s.subscribe("m1", store.get("m1")!.lastSeq, (n) => rest.push(n));
    expect(rest.map((n) => n.seq)).toEqual([4, 5]);
    for (const n of [...all.slice(0, 3), ...rest]) store.apply("m1", n.seq, n.event);
    expect(store.get("m1")?.text).toBe("ABC");
    expect(store.get("m1")?.status).toBe("complete");
  });

  it("says when it no longer knows an answer", () => {
    const { s } = server(scripted([]));
    expect(s.subscribe("nope", 0, () => undefined)).toBeNull();
  });

  it("Stop ends the answer with what arrived and does not save it", async () => {
    const provider = scripted([[text("Part one. "), { type: "wait", ms: 50 }, text("never")]]);
    const { s, saved } = server(provider);
    s.start(REQ);
    const events = collect(s, "m1");
    await new Promise((r) => setTimeout(r, 10));
    expect(s.stop("m1")).toBe(true);
    const got = await events;
    expect(last(got)?.event).toEqual({ kind: "done", text: "Part one. ", stopped: true });
    expect(saved).toEqual([]);
  });

  it("marks a provider stream that drops mid-answer as interrupted and keeps the text", async () => {
    const { s } = server(scripted([[text("Half an ans"), { type: "throw", error: new ProviderError("anthropic", "network") }]]));
    s.start(REQ);
    const got = await collect(s, "m1");
    expect(last(got)?.event).toMatchObject({ kind: "error", code: "interrupted" });
    const store = new ConversationStore();
    store.create("m1");
    for (const n of got) store.apply("m1", n.seq, n.event);
    expect(store.get("m1")).toMatchObject({ status: "error", text: "Half an ans" });
  });

  it("reports a provider error before any text as a provider error", async () => {
    const { s } = server(scripted([]), { provider: async () => Promise.reject(new ProviderError("anthropic", "consent_required")) });
    s.start(REQ);
    const got = await collect(s, "m1");
    expect(last(got)?.event).toMatchObject({ kind: "error", code: "provider", message: expect.stringContaining("Nothing was sent") });
  });

  it("lists running answers for a conversation", async () => {
    const provider = scripted([[{ type: "wait", ms: 30 }, text("x")]]);
    const { s } = server(provider);
    s.start(REQ);
    expect(s.active("c1")).toEqual([{ message_id: "m1", question: REQ.question, last_seq: 1 }]);
    expect(s.active("other")).toEqual([]);
    await collect(s, "m1");
    expect(s.active("c1")).toEqual([]);
  });
});

describe("toolResultsTurn", () => {
  it("fences each result and attaches screenshots as images", () => {
    const turn = toolResultsTurn([{ name: "screenshot_visible" }], [{ status: "ok", text: "Shot </tool_result> attached", image: { mediaType: "image/jpeg", data: "AAAA" } }]);
    expect(Array.isArray(turn)).toBe(true);
    const parts = turn as Exclude<typeof turn, string>;
    expect(parts[1]).toEqual({ type: "image", mediaType: "image/jpeg", data: "AAAA" });
    expect(textOf(parts).match(/<\/tool_result>/g)).toHaveLength(1);
  });
});

describe("protocol wire format", () => {
  it("round-trips every event kind", () => {
    const events: NumberedEvent["event"][] = [
      { kind: "start" },
      { kind: "text", delta: "hi" },
      { kind: "citation", url: "https://a.test", title: "A" },
      { kind: "tool_request", request_id: "r", name: "read_page", input: { tab_id: 1 } },
      { kind: "tool_done", request_id: "r", status: "blocked-by-user" },
      { kind: "usage", usage: { inputTokens: 1, outputTokens: 2, webSearches: 1 } },
      { kind: "done", text: "hi", stopped: true },
      { kind: "error", code: "interrupted", message: "x" },
    ];
    events.forEach((event, i) => {
      expect(fromWire(toWire("m", { seq: i + 1, event }))).toEqual({ message_id: "m", seq: i + 1, event });
    });
    expect(fromWire({ message_id: "m", seq: 0, kind: "start" })).toBeNull();
    expect(fromWire({ message_id: "m", seq: 1, kind: "tool_done", request_id: "r", status: "bogus" })).toBeNull();
  });
});

describe("ConversationStore", () => {
  it("moves pending to streaming to complete and ignores repeated or out-of-order events", () => {
    const st = new ConversationStore();
    st.create("m");
    expect(st.get("m")?.status).toBe("pending");
    expect(st.apply("m", 1, { kind: "start" })).toBe("applied");
    expect(st.get("m")?.status).toBe("streaming");
    expect(st.apply("m", 2, { kind: "text", delta: "a" })).toBe("applied");
    expect(st.apply("m", 2, { kind: "text", delta: "a" })).toBe("duplicate");
    expect(st.apply("m", 4, { kind: "text", delta: "c" })).toBe("gap");
    expect(st.get("m")?.text).toBe("a");
    st.apply("m", 3, { kind: "done", text: "a" });
    expect(st.get("m")?.status).toBe("complete");
    expect(st.apply("x", 1, { kind: "start" })).toBe("unknown");
  });

  it("tracks tool requests until the server has their result", () => {
    const st = new ConversationStore();
    st.create("m");
    st.apply("m", 1, { kind: "tool_request", request_id: "r1", name: "close_tabs", input: { tab_ids: [2] } });
    expect(st.pendingTools("m").map((t) => t.request_id)).toEqual(["r1"]);
    st.apply("m", 2, { kind: "tool_done", request_id: "r1", status: "declined" });
    expect(st.pendingTools("m")).toEqual([]);
  });

  it("a Stop the worker never answered ends the answer as stopped, not as an error", () => {
    const st = new ConversationStore();
    st.create("m");
    st.apply("m", 1, { kind: "start" });
    st.apply("m", 2, { kind: "text", delta: "One two" });
    st.stopLocally("m");
    const m = st.get("m")!;
    expect(m.status).toBe("complete");
    expect(m.stopped).toBe(true);
    expect(m.error).toBeUndefined();
    expect(m.text).toBe("One two");
  });
});
