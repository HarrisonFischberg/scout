// Owner, 2026-10-27: chat asks Apple's on-device model first and uses the
// key's model only when Apple can't answer. Scripted providers; no network.
import { describe, expect, it } from "vitest";
import { APPLE_MODEL, AppleModelError, appleCouldNotAnswer, applePrompt, appleRepeats, createApple } from "../../src/providers/apple";
import { APPLE_NEEDS_WEB } from "../../src/chat/prompt";
import type { ChatMessage, ChatRequest, ProviderClient, StreamEvent } from "../../src/providers/types";
import { ScoutServer, type StartRequest } from "../../src/server/engine";
import { fromWire, toWire, type NumberedEvent } from "../../src/server/protocol";
import { ConversationStore } from "../../src/chat/store";
import { ProviderError } from "../../src/providers/errors";

const REQ: StartRequest = {
  message_id: "m1",
  conv: "c1",
  provider: "anthropic",
  model: APPLE_MODEL,
  fallback: { provider: "anthropic", model: "claude-haiku-5-5", effort: "low" },
  question: "How much is the widget?",
  history: [],
  pages: [{ url: "https://shop.test/a", title: "Test shop", text: "Widget costs $10." }],
};

function client(id: "apple" | "anthropic", reply: () => StreamEvent[]): ProviderClient & { calls: number } {
  const c = {
    id,
    calls: 0,
    async *stream() {
      c.calls++;
      for (const ev of reply()) yield ev;
    },
  };
  return c;
}

function run(apple: ProviderClient, keyed: ProviderClient, req: StartRequest = REQ) {
  const asked: string[] = [];
  const s = new ScoutServer({
    provider: async (_p, model) => {
      asked.push(model);
      return model === APPLE_MODEL ? apple : keyed;
    },
    tools: async () => [],
    save: async () => undefined,
    now: () => 1,
  });
  s.start(req);
  return new Promise<{ events: NumberedEvent[]; asked: string[] }>((resolve) => {
    const events: NumberedEvent[] = [];
    s.subscribe(req.message_id, 0, (n) => {
      events.push(n);
      if (n.event.kind === "done" || n.event.kind === "error") resolve({ events, asked });
    });
  });
}

const answer = (t: string): StreamEvent[] => [{ type: "text", delta: t }, { type: "done" }];
const KEYED = (): StreamEvent[] => [{ type: "text", delta: "Claude: $10." }, { type: "usage", usage: { inputTokens: 10, outputTokens: 3 } }, { type: "done" }];

describe("Apple first, key as fallback", () => {
  it("keeps Apple's answer and never calls the key's model", async () => {
    const keyed = client("anthropic", KEYED);
    const { events, asked } = await run(client("apple", () => answer("It costs $10.")), keyed);
    expect(events[events.length - 1]?.event).toEqual({ kind: "done", text: "It costs $10." });
    expect(events.some((e) => e.event.kind === "usage")).toBe(false);
    expect(asked).toEqual([APPLE_MODEL]);
    expect(keyed.calls).toBe(0);
    expect(events.some((e) => e.event.kind === "handoff")).toBe(false);
  });

  it("falls back when Apple says it can't answer", async () => {
    const { events, asked } = await run(client("apple", () => answer("I'm sorry, but I don't have access to real-time information.")), client("anthropic", KEYED));
    expect(events[events.length - 1]?.event).toEqual({ kind: "done", text: "Claude: $10." });
    expect(events.some((e) => e.event.kind === "usage")).toBe(true);
    expect(asked).toEqual([APPLE_MODEL, "claude-haiku-5-5"]);
    // The panel swaps "Thinking…" for "Looking deeper…" before the key's model writes.
    expect(events.map((e) => e.event.kind)).toEqual(["start", "handoff", "text", "usage", "done"]);
  });

  it("the handoff survives the port and the store", () => {
    expect(fromWire(toWire("m1", { seq: 2, event: { kind: "handoff" } }))?.event).toEqual({ kind: "handoff" });
    const st = new ConversationStore();
    st.create("m");
    st.apply("m", 1, { kind: "start" });
    st.apply("m", 2, { kind: "handoff" });
    expect(st.get("m")?.handoff).toBe(true);
  });

  it("falls back when Apple fails (too long, unavailable, declined)", async () => {
    for (const code of ["too_long", "unavailable", "refused", "generation_failed"]) {
      const apple = client("apple", () => {
        throw new AppleModelError(code);
      });
      const { events } = await run(apple, client("anthropic", KEYED));
      expect(events[events.length - 1]?.event).toEqual({ kind: "done", text: "Claude: $10." });
    }
  });

  it("falls back on an empty reply", async () => {
    const { events } = await run(client("apple", () => answer("  ")), client("anthropic", KEYED));
    expect(events[events.length - 1]?.event).toEqual({ kind: "done", text: "Claude: $10." });
  });

  it("without a fallback, Apple's model is the only model (no key saved)", async () => {
    const { fallback: _, ...noKey } = REQ;
    const { events, asked } = await run(client("apple", () => answer("I'm sorry, I can't.")), client("anthropic", KEYED), noKey);
    expect(events[events.length - 1]?.event).toEqual({ kind: "done", text: "I'm sorry, I can't." });
    expect(asked).toEqual([APPLE_MODEL]);
  });
});

describe("appleCouldNotAnswer", () => {
  it("spots short refusals and 'no current information' replies", () => {
    for (const t of [
      "",
      "I'm sorry, but I can't help with that.",
      "I’m unable to browse the internet.",
      "I don't have access to real-time data, so I can't tell you today's price.",
      "As an AI, I cannot provide that.",
      "I don't know.",
    ]) expect(appleCouldNotAnswer(t), t).toBe(true);
  });

  it("keeps real answers, including long ones that start with an apology", () => {
    expect(appleCouldNotAnswer("The widget costs $10 with free shipping.")).toBe(false);
    expect(appleCouldNotAnswer("- Point one\n- Point two")).toBe(false);
    expect(appleCouldNotAnswer("I'm sorry to hear that. " + "Here is a detailed answer. ".repeat(40))).toBe(false);
  });

  it("keeps short answers that only mention access, real-time or failing to find something", () => {
    for (const t of [
      "Real-time bidding (RTB) is how ad slots are sold in an auction that runs while the page loads.",
      "This page explains that guests without access to the portal must call the front desk.",
      "The article says the app is unable to find your location when GPS is off.",
      "The store has no up-to-date information on restocks yet.",
    ]) expect(appleCouldNotAnswer(t), t).toBe(false);
  });

  it("still spots the model naming its own knowledge cutoff", () => {
    expect(appleCouldNotAnswer("My knowledge cutoff is before that event.")).toBe(true);
  });
});

// Owner report 2026-10-28: "best wall dimmer that dims to 5%" got six vague
// replies from Apple, each asking "traditional or smart?" again, with [1]
// markers and no sources, and never a product. Expected: Apple hands a
// question that needs the web to the key's model, which researches it.
describe("Apple hands research questions to the key's model", () => {
  const ASK = "Would you like to explore specific traditional wall-mounted models, or should we look into alternatives?";
  const CHAT: StartRequest = {
    ...REQ,
    question: "traditional wall mounted",
    pages: [],
    scope: "page",
    history: [
      { role: "user", content: "i want to find the best dimmer switch for my lamp, that dims as low as possible" },
      { role: "assistant", content: "Options are limited [1]. " + ASK },
    ],
  };

  function capture(reply: string) {
    const c = client("apple", () => answer(reply)) as ReturnType<typeof client> & { reqs: ChatRequest[] };
    c.reqs = [];
    const inner = c.stream.bind(c);
    c.stream = (r: ChatRequest) => {
      c.reqs.push(r);
      return inner(r);
    };
    return c;
  }

  it("falls back when Apple says the answer needs the web, and the word never shows", async () => {
    const apple = capture(APPLE_NEEDS_WEB);
    const { events, asked } = await run(apple, client("anthropic", KEYED), CHAT);
    expect(asked).toEqual([APPLE_MODEL, "claude-haiku-5-5"]);
    expect(events.map((e) => e.event.kind)).toEqual(["start", "handoff", "text", "usage", "done"]);
    expect(JSON.stringify(events)).not.toContain(APPLE_NEEDS_WEB);
    // Apple is told how to ask for the web, and gets the no-page rules (no [1], no repeated questions).
    expect(apple.reqs[0]?.system).toContain(APPLE_NEEDS_WEB);
    expect(apple.reqs[0]?.system).toContain("never write markers like [1]");
    expect(apple.reqs[0]?.system).not.toContain("end it with that page's number");
  });

  it("falls back when Apple asks the same question as its last reply", async () => {
    const { events } = await run(capture("Traditional switches rarely go that low. " + ASK), client("anthropic", KEYED), CHAT);
    expect(events[events.length - 1]?.event).toEqual({ kind: "done", text: "Claude: $10." });
  });

  it("removes [n] markers from Apple's answer when there were no sources", async () => {
    const { events } = await run(capture("Lutron's Diva goes to about 1% [1]. The Leviton SureSlide works too [1, 2]."), client("anthropic", KEYED), CHAT);
    expect(events[events.length - 1]?.event).toEqual({ kind: "done", text: "Lutron's Diva goes to about 1%. The Leviton SureSlide works too." });
  });

  it("keeps the chat's first message in Apple's prompt after it scrolls out", () => {
    const msgs: ChatMessage[] = [
      { role: "user", content: "best dimmer switch for my lamp" },
      { role: "assistant", content: "Smart or traditional?" },
      { role: "user", content: "wall mounted" },
      { role: "assistant", content: "Smart or traditional?" },
      { role: "user", content: "traditional" },
      { role: "assistant", content: "Smart or traditional?" },
      { role: "user", content: "traditional wall mounted" },
    ];
    expect(applePrompt(msgs)).toContain("User: best dimmer switch for my lamp");
  });

  it("does not count a different follow-up question as a repeat", () => {
    expect(appleRepeats("Here are three. Do you want ones under $30?", [{ role: "assistant", content: "Smart or traditional?" }])).toBe(false);
    expect(appleRepeats("Here are three.", [{ role: "assistant", content: "Smart or traditional?" }])).toBe(false);
  });
});

describe("Ask Claude under Apple's answer", () => {
  it("goes straight to the key's model and saves in place of Apple's answer", async () => {
    const saved: Array<{ answer: string; replaces?: string }> = [];
    const keyed = client("anthropic", KEYED);
    const apple = client("apple", () => answer("Apple."));
    const req: StartRequest = { ...REQ, model: "claude-haiku-5-5", fallback: undefined, replaces: "Apple's vague answer" };
    delete req.fallback;
    const s = new ScoutServer({
      provider: async (_p, model) => (model === APPLE_MODEL ? apple : keyed),
      tools: async () => [],
      save: async (e) => void saved.push(e),
      now: () => 1,
    });
    s.start(req);
    await new Promise<void>((resolve) => s.subscribe(req.message_id, 0, (n) => n.event.kind === "done" && resolve()));
    await new Promise((r) => setTimeout(r, 0));
    expect(apple.calls).toBe(0);
    expect(saved[0]).toMatchObject({ answer: "Claude: $10.", replaces: "Apple's vague answer" });
  });
});

describe("a stuck Apple model (QA 2026-10-29)", () => {
  // Native messaging to Apple's model that never answers.
  const stuckSend = () => new Promise<unknown>(() => undefined);

  it("hands off to the key's model after the time limit instead of hanging", async () => {
    const keyed = client("anthropic", KEYED);
    const { events, asked } = await run(createApple(stuckSend, { timeoutMs: 20 }), keyed);
    expect(events[events.length - 1]?.event).toEqual({ kind: "done", text: "Claude: $10." });
    expect(asked).toEqual([APPLE_MODEL, "claude-haiku-5-5"]);
    expect(keyed.calls).toBe(1);
  });

  it("stops at once when the user presses Stop, without calling the key's model or saving", async () => {
    const keyed = client("anthropic", KEYED);
    const saved: unknown[] = [];
    const s = new ScoutServer({
      provider: async (_p, model) => (model === APPLE_MODEL ? createApple(stuckSend) : keyed),
      tools: async () => [],
      save: async (e) => void saved.push(e),
      now: () => 1,
    });
    s.start(REQ);
    const events: NumberedEvent[] = [];
    const ended = new Promise<void>((resolve) =>
      s.subscribe(REQ.message_id, 0, (n) => {
        events.push(n);
        if (n.event.kind === "done" || n.event.kind === "error") resolve();
      }),
    );
    await new Promise((r) => setTimeout(r, 5));
    expect(s.stop(REQ.message_id)).toBe(true);
    await Promise.race([ended, new Promise((_, rej) => setTimeout(() => rej(new Error("Stop did not end the answer")), 500))]);
    expect(events[events.length - 1]?.event).toEqual({ kind: "done", text: "", stopped: true });
    expect(events.some((e) => e.event.kind === "handoff")).toBe(false);
    expect(keyed.calls).toBe(0);
    expect(saved).toEqual([]);
  });

  it("without a key, a stuck model ends in a plain error, not a spinner", async () => {
    const { fallback: _, ...noKey } = REQ;
    const { events } = await run(createApple(stuckSend, { timeoutMs: 20 }), client("anthropic", KEYED), noKey);
    expect(events[events.length - 1]?.event.kind).toBe("error");
  });
});

describe("after the handoff (QA 2026-10-29)", () => {
  const cantAnswer = () => client("apple", () => answer("I'm sorry, I can't help with current prices."));

  for (const code of ["auth_invalid", "rate_limited", "provider_unavailable", "network", "no_credit"] as const) {
    it("a " + code + " failure of the key's model is one plain error: no retry loop, no second Apple call", async () => {
      const apple = cantAnswer();
      const keyed = client("anthropic", () => {
        throw new ProviderError("anthropic", code, code === "auth_invalid" ? 401 : code === "rate_limited" ? 429 : 500);
      });
      const { events, asked } = await run(apple, keyed);
      const last = events[events.length - 1]?.event;
      expect(last?.kind).toBe("error");
      expect(JSON.stringify(last)).not.toMatch(/sk-ant/);
      expect(apple.calls).toBe(1);
      expect(keyed.calls).toBe(1);
      expect(asked).toEqual([APPLE_MODEL, "claude-haiku-5-5"]);
      expect(events.filter((e) => e.event.kind === "handoff")).toHaveLength(1);
    });
  }

  it("Stop while the key's model is being set up never starts it", async () => {
    const keyed = client("anthropic", KEYED);
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const s = new ScoutServer({
      provider: async (_p, model) => {
        if (model === APPLE_MODEL) return cantAnswer();
        await gate;
        return keyed;
      },
      tools: async () => [],
      save: async () => undefined,
      now: () => 1,
    });
    s.start(REQ);
    const events: NumberedEvent[] = [];
    const ended = new Promise<void>((resolve) =>
      s.subscribe(REQ.message_id, 0, (n) => {
        events.push(n);
        if (n.event.kind === "done" || n.event.kind === "error") resolve();
      }),
    );
    await new Promise((r) => setTimeout(r, 5));
    s.stop(REQ.message_id);
    release();
    await ended;
    expect(keyed.calls).toBe(0);
    expect(events[events.length - 1]?.event).toEqual({ kind: "done", text: "", stopped: true });
  });
});
