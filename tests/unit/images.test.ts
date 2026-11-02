// Owner request 2026-11-02: paste images into Scout and have Claude read them.
// Scripted providers; no network.
import { describe, expect, it } from "vitest";
import { ask } from "../../src/app/ask";
import { historyFor, loadChats, saveChats, type TextStorage } from "../../src/app/chats";
import { checkSchema, REQUESTS } from "../../src/bridge/messages";
import { IMAGE_ONLY_QUESTION, IMAGES_NEED_KEY, IMAGES_ONLY_QUESTION, describeImages, fitSize, historyText, imageFiles, questionFor, withImages, type PastedImage } from "../../src/chat/images";
import { anthropicMessages } from "../../src/providers/anthropic";
import { APPLE_MODEL } from "../../src/providers/apple";
import type { ChatRequest, ProviderClient, StreamEvent } from "../../src/providers/types";
import { ScoutServer, type StartRequest } from "../../src/server/engine";
import type { NumberedEvent } from "../../src/server/protocol";

const IMG: PastedImage = { mediaType: "image/png", data: "iVBORw0KGgo=", width: 800, height: 600 };

function client(id: "apple" | "anthropic", seen: ChatRequest[], text = "A cat."): ProviderClient {
  return {
    id,
    async *stream(req: ChatRequest) {
      seen.push(req);
      const out: StreamEvent[] = [{ type: "text", delta: text }, { type: "usage", usage: { inputTokens: 5, outputTokens: 2 } }, { type: "done" }];
      for (const ev of out) yield ev;
    },
  } as ProviderClient;
}

function run(req: StartRequest, apple: ProviderClient, keyed: ProviderClient) {
  const asked: string[] = [];
  const saved: Array<{ question: string; answer: string }> = [];
  const s = new ScoutServer({
    provider: async (_p, model) => {
      asked.push(model);
      return model === APPLE_MODEL ? apple : keyed;
    },
    tools: async () => [],
    save: async (e) => void saved.push(e),
    now: () => 1,
  });
  s.start(req);
  return new Promise<{ events: NumberedEvent[]; asked: string[]; saved: typeof saved }>((resolve) => {
    const events: NumberedEvent[] = [];
    s.subscribe(req.message_id, 0, (n) => {
      events.push(n);
      if (n.event.kind === "done" || n.event.kind === "error") setTimeout(() => resolve({ events, asked, saved }), 0);
    });
  });
}

const BASE: StartRequest = { message_id: "m1", conv: "c1", provider: "anthropic", model: "claude-haiku-5-5", question: "What breed is this?", history: [], pages: [], scope: "general" };

describe("pasted images: helpers", () => {
  it("scales the long edge down to 1568 and never up", () => {
    expect(fitSize(4032, 3024)).toEqual({ width: 1568, height: 1176 });
    expect(fitSize(3024, 4032)).toEqual({ width: 1176, height: 1568 });
    expect(fitSize(640, 480)).toEqual({ width: 640, height: 480 });
  });

  it("picks image files out of pasted items and file lists", () => {
    const f = { type: "image/png" } as File;
    const items = [
      { kind: "string", type: "text/plain", getAsFile: () => null },
      { kind: "file", type: "image/png", getAsFile: () => f },
      { kind: "file", type: "application/pdf", getAsFile: () => ({}) as File },
    ];
    expect(imageFiles(items)).toEqual([f]);
    expect(imageFiles([f, { type: "text/plain" } as File])).toEqual([f]);
    expect(imageFiles(null)).toEqual([]);
  });

  it("sends a default question for images alone", () => {
    expect(questionFor("  ", 1)).toBe(IMAGE_ONLY_QUESTION);
    expect(questionFor("", 2)).toBe(IMAGES_ONLY_QUESTION);
    expect(questionFor(" what is it ", 1)).toBe("what is it");
    expect(questionFor("", 0)).toBe("");
  });

  it("builds the user turn as text then images, and Anthropic gets base64 image blocks", () => {
    expect(withImages("hi", [])).toBe("hi");
    const turn = withImages("What is this?", [IMG]);
    expect(anthropicMessages([{ role: "user", content: turn }])).toEqual([
      { role: "user", content: [{ type: "text", text: "What is this?" }, { type: "image", source: { type: "base64", media_type: "image/png", data: IMG.data } }] },
    ]);
  });

  it("history and the debug log never carry image data", () => {
    expect(historyText("What is this?", 1)).toBe("What is this?\n\n[1 image was attached to this message.]");
    expect(historyText("Q", 0)).toBe("Q");
    const d = describeImages([IMG]);
    expect(d).toBe("png 800x600 0KB");
    expect(d).not.toContain(IMG.data);
  });

  it("the bridge accepts images on chat.start and rejects other types", () => {
    const base = { message_id: "m", conv: "c", provider: "anthropic", model: "x", question: "q", history: [], pages: [] };
    expect(checkSchema(REQUESTS["chat.start"].payload, { ...base, images: [IMG] })).toBeNull();
    expect(checkSchema(REQUESTS["chat.start"].payload, { ...base, images: [{ ...IMG, mediaType: "image/svg+xml" }] })).not.toBeNull();
  });
});

describe("pasted images: the panel's answer engine", () => {
  it("sends the images to the key's model with the question", async () => {
    const seen: ChatRequest[] = [];
    const { events } = await run({ ...BASE, images: [IMG] }, client("apple", []), client("anthropic", seen));
    expect(events[events.length - 1]?.event).toEqual({ kind: "done", text: "A cat." });
    const last = seen[0]!.messages[seen[0]!.messages.length - 1]!;
    expect(last.content).toEqual([
      { type: "text", text: "What breed is this?" },
      { type: "image", mediaType: "image/png", data: IMG.data },
    ]);
  });

  it("skips Apple's model (it can't see images) and goes straight to the key", async () => {
    const appleSeen: ChatRequest[] = [];
    const { asked, events } = await run(
      { ...BASE, model: APPLE_MODEL, fallback: { provider: "anthropic", model: "claude-haiku-5-5" }, images: [IMG] },
      client("apple", appleSeen, "Apple"),
      client("anthropic", []),
    );
    expect(appleSeen).toHaveLength(0);
    expect(asked).toEqual(["claude-haiku-5-5"]);
    expect(events.some((e) => e.event.kind === "handoff")).toBe(false);
  });

  it("with only Apple's model, says images need a key", async () => {
    const { events } = await run({ ...BASE, model: APPLE_MODEL, images: [IMG] }, client("apple", []), client("anthropic", []));
    expect(events[events.length - 1]?.event).toMatchObject({ kind: "error", message: IMAGES_NEED_KEY });
  });

  it("saves the question text only", async () => {
    const { saved } = await run({ ...BASE, images: [IMG] }, client("apple", []), client("anthropic", []));
    expect(JSON.stringify(saved)).not.toContain(IMG.data);
    expect(saved[0]?.question).toBe("What breed is this?");
  });
});

describe("pasted images: the iPhone app's chat", () => {
  it("sends images to Claude, skipping Apple first", async () => {
    const claudeSeen: ChatRequest[] = [];
    const appleSeen: ChatRequest[] = [];
    const r = await ask({
      claude: { client: client("anthropic", claudeSeen), model: "claude-haiku-5-5" },
      apple: client("apple", appleSeen, "Apple"),
      appleFirst: true,
      history: [],
      question: "What is this?",
      images: [IMG],
      onText: () => undefined,
    });
    expect(r.text).toBe("A cat.");
    expect(appleSeen).toHaveLength(0);
    expect(claudeSeen[0]!.messages[0]!.content).toEqual([{ type: "text", text: "What is this?" }, { type: "image", mediaType: "image/png", data: IMG.data }]);
  });

  it("without a key, says images need one", async () => {
    const r = await ask({ apple: client("apple", [], "Apple"), history: [], question: "What is this?", images: [IMG], onText: () => undefined });
    expect(r.error).toBe(IMAGES_NEED_KEY);
  });

  it("saved chats keep the image count, not the images, and history notes them", () => {
    const data = new Map<string, string>();
    const storage: TextStorage = { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k) };
    saveChats(storage, [{ id: "a", title: "t", at: 1, turns: [{ role: "user", text: "What is this?", images: 2 }, { role: "assistant", text: "Two cats." }] }]);
    const [chat] = loadChats(storage);
    expect(chat?.turns[0]).toEqual({ role: "user", text: "What is this?", images: 2 });
    expect(historyFor(chat!.turns)[0]?.content).toBe("What is this?\n\n[2 images were attached to this message.]");
  });
});
