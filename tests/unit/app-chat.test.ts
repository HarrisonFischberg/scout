// The Scout app's own chat (owner request 2026-11-01): src/app/ask.ts and src/app/chats.ts.
import { describe, expect, it } from "vitest";
import { APP_WEB_SEARCHES, NO_MODEL, ask } from "../../src/app/ask";
import { CHATS_KEY, HISTORY_TURNS, MAX_CHATS, chatTitle, deleteChat, historyFor, loadChats, saveChats, upsertChat, type AppChat, type TextStorage } from "../../src/app/chats";
import { APP_INTRO, WEB_RULES } from "../../src/chat/prompt";
import { ProviderError } from "../../src/providers/errors";
import type { ChatRequest, ProviderClient, StreamEvent } from "../../src/providers/types";

function fakeClient(events: StreamEvent[] | ((req: ChatRequest) => StreamEvent[]), seen: ChatRequest[] = [], fail?: Error): ProviderClient {
  return {
    id: "anthropic",
    async *stream(req) {
      seen.push(req);
      for (const ev of typeof events === "function" ? events(req) : events) yield ev;
      if (fail) throw fail;
    },
  };
}

function appleClient(text: string, seen: ChatRequest[] = []): ProviderClient {
  return {
    id: "apple",
    async *stream(req) {
      seen.push(req);
      yield { type: "text", delta: text };
      yield { type: "done" };
    },
  };
}

function memoryStorage(): TextStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k) };
}

describe("ask (Scout app chat)", () => {
  it("asks Claude with web search and the app's prompt, without a page", async () => {
    const seen: ChatRequest[] = [];
    const texts: string[] = [];
    const r = await ask({
      claude: { client: fakeClient([{ type: "text", delta: "Hello" }, { type: "text", delta: " there" }, { type: "usage", usage: { inputTokens: 10, outputTokens: 5 } }], seen), model: "claude-haiku-5-5", effort: "high" },
      history: [{ role: "user", content: "hi" }, { role: "assistant", content: "Hi!" }],
      question: "What is 2+2?",
      onText: (t) => texts.push(t),
    });
    expect(r).toMatchObject({ text: "Hello there", model: "claude-haiku-5-5", sources: [], usage: { inputTokens: 10, outputTokens: 5 } });
    expect(texts[texts.length - 1]).toBe("Hello there");
    const req = seen[0]!;
    expect(req.webSearch).toBe(true);
    expect(req.webSearchMaxUses).toBe(APP_WEB_SEARCHES);
    expect(req.effort).toBe("high");
    expect(req.system).toContain(APP_INTRO);
    expect(req.system).toContain(WEB_RULES);
    expect(req.system).not.toContain("untrusted_page_content");
    expect(req.messages).toEqual([
      { role: "user", content: "hi" },
      { role: "assistant", content: "Hi!" },
      { role: "user", content: "What is 2+2?" },
    ]);
  });

  it("numbers web sources and marks cited text, as the panel does", async () => {
    const r = await ask({
      claude: {
        client: fakeClient([
          { type: "source", url: "https://a.example/x", title: "A" },
          { type: "source", url: "https://b.example/y", title: "B" },
          { type: "source", url: "javascript:alert(1)" },
          { type: "text", delta: "Fact one." },
          { type: "source", url: "https://b.example/y", cite: true },
          { type: "text", delta: " Fact two." },
          { type: "source", url: "https://c.example/z", cite: true },
        ]),
        model: "claude-haiku-5-5",
      },
      history: [],
      question: "q",
      onText: () => undefined,
    });
    expect(r.text).toBe("Fact one. [2] Fact two. [3]");
    expect(r.sources.map((s) => s.url)).toEqual(["https://a.example/x", "https://b.example/y", "https://c.example/z"]);
    expect(r.sources[0]).toEqual({ url: "https://a.example/x", title: "A", kind: "web" });
  });

  it("shows the provider's own message when Claude refuses the key", async () => {
    const r = await ask({
      claude: { client: fakeClient([], [], new ProviderError("anthropic", "auth_invalid", 401)), model: "claude-haiku-5-5" },
      history: [],
      question: "q",
      onText: () => undefined,
    });
    expect(r.error).toMatch(/API key was rejected/);
  });

  it("keeps a partial answer and says it stopped early on a dropped connection", async () => {
    const r = await ask({
      claude: { client: fakeClient([{ type: "text", delta: "Half" }], [], new ProviderError("anthropic", "network")), model: "claude-haiku-5-5" },
      history: [],
      question: "q",
      onText: () => undefined,
    });
    expect(r.text).toBe("Half");
    expect(r.error).toMatch(/stopped early/);
  });

  it("reports Stop as stopped, not as an error", async () => {
    const ctl = new AbortController();
    const client: ProviderClient = {
      id: "anthropic",
      async *stream() {
        yield { type: "text", delta: "Part" };
        ctl.abort();
        throw new ProviderError("anthropic", "network");
      },
    };
    const r = await ask({ claude: { client, model: "m" }, history: [], question: "q", signal: ctl.signal, onText: () => undefined });
    expect(r.stopped).toBe(true);
    expect(r.error).toBeUndefined();
    expect(r.text).toBe("Part");
  });

  it("asks for a key when there is no key and no Apple model", async () => {
    const r = await ask({ history: [], question: "q", onText: () => undefined });
    expect(r.error).toBe(NO_MODEL);
  });

  it("uses Apple's model alone when there is no key, and it must answer", async () => {
    const seen: ChatRequest[] = [];
    const r = await ask({ apple: appleClient("Paris is the capital [1].", seen), history: [], question: "Capital of France?", onText: () => undefined });
    expect(r).toMatchObject({ model: "apple", text: "Paris is the capital." });
    expect(seen[0]!.system).not.toContain("NEEDS_WEB");
  });

  it("does not ask Apple when there is a key and Apple first is off", async () => {
    const appleSeen: ChatRequest[] = [];
    const r = await ask({
      claude: { client: fakeClient([{ type: "text", delta: "Claude" }]), model: "m" },
      apple: appleClient("Apple", appleSeen),
      history: [],
      question: "Explain gravity",
      onText: () => undefined,
    });
    expect(r.text).toBe("Claude");
    expect(appleSeen).toHaveLength(0);
  });

  it("with Apple first, keeps Apple's answer, and hands off to Claude on NEEDS_WEB", async () => {
    const claude = { client: fakeClient([{ type: "text", delta: "Researched" }]), model: "m" };
    const kept = await ask({ claude, apple: appleClient("Gravity pulls."), appleFirst: true, history: [], question: "Explain gravity", onText: () => undefined });
    expect(kept).toMatchObject({ model: "apple", text: "Gravity pulls." });
    const handed = await ask({ claude, apple: appleClient("NEEDS_WEB"), appleFirst: true, history: [], question: "Explain gravity", onText: () => undefined });
    expect(handed).toMatchObject({ model: "m", text: "Researched" });
  });
});

describe("saved chats (Scout app)", () => {
  const chat = (id: string, at: number, turns: AppChat["turns"] = [{ role: "user", text: "q" }, { role: "assistant", text: "a" }]): AppChat => ({ id, title: "t" + id, at, turns });

  it("saves and loads chats newest first, skipping malformed ones", () => {
    const s = memoryStorage();
    saveChats(s, [chat("a", 1), chat("b", 3), chat("c", 2)]);
    expect(loadChats(s).map((c) => c.id)).toEqual(["b", "c", "a"]);
    s.setItem(CHATS_KEY, JSON.stringify([{ id: 1 }, null, chat("ok", 5), { id: "x", at: 1, turns: [{ role: "system", text: "no" }] }]));
    expect(loadChats(s).map((c) => c.id)).toEqual(["ok"]);
    s.setItem(CHATS_KEY, "not json");
    expect(loadChats(s)).toEqual([]);
  });

  it("only keeps http(s) sources from storage", () => {
    const s = memoryStorage();
    s.setItem(
      CHATS_KEY,
      JSON.stringify([chat("a", 1, [{ role: "user", text: "q" }, { role: "assistant", text: "a", sources: [{ url: "javascript:alert(1)" }, { url: "https://ok.example/", title: "Ok" }] } as never])]),
    );
    expect(loadChats(s)[0]!.turns[1]!.sources).toEqual([{ url: "https://ok.example/", title: "Ok", kind: "web" }]);
  });

  it("keeps at most MAX_CHATS, dropping the oldest", () => {
    const s = memoryStorage();
    saveChats(s, Array.from({ length: MAX_CHATS + 5 }, (_, i) => chat(String(i), i)));
    const kept = loadChats(s);
    expect(kept).toHaveLength(MAX_CHATS);
    expect(kept[kept.length - 1]!.id).toBe("5");
  });

  it("upserts and deletes", () => {
    const s = memoryStorage();
    upsertChat(s, chat("a", 1));
    upsertChat(s, chat("b", 2));
    expect(upsertChat(s, { ...chat("a", 3), title: "new" }).map((c) => c.title)).toEqual(["new", "tb"]);
    expect(deleteChat(s, "a").map((c) => c.id)).toEqual(["b"]);
  });

  it("titles a chat by its first question on one line", () => {
    expect(chatTitle("  What is\n the  weather? ")).toBe("What is the weather?");
    expect(chatTitle("x".repeat(100))).toHaveLength(58);
    expect(chatTitle("   ")).toBe("New chat");
  });

  it("sends answered turns back, without failed answers or citation markers", () => {
    const h = historyFor([
      { role: "user", text: "one" },
      { role: "assistant", text: "Answer one [1] and [2, 3].", sources: [{ url: "https://a.example" }] },
      { role: "user", text: "two" },
      { role: "assistant", text: "Couldn't reach the provider.", error: true },
      { role: "user", text: "three" },
      { role: "assistant", text: "Answer three" },
    ]);
    expect(h).toEqual([
      { role: "user", content: "one" },
      { role: "assistant", content: "Answer one and." },
      { role: "user", content: "three" },
      { role: "assistant", content: "Answer three" },
    ]);
  });

  it("sends at most HISTORY_TURNS turns, starting with a question", () => {
    const turns: AppChat["turns"] = [];
    for (let i = 0; i < 30; i++) turns.push({ role: "user", text: "q" + i }, { role: "assistant", text: "a" + i });
    const h = historyFor(turns);
    expect(h).toHaveLength(HISTORY_TURNS);
    expect(h[0]).toEqual({ role: "user", content: "q20" });
  });
});
