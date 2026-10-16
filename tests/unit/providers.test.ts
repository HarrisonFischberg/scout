import { describe, expect, it } from "vitest";
import { createProvider, ProviderError } from "../../src/providers";
import type { FetchLike, StreamEvent } from "../../src/providers";

// Synthetic recorded streams: written by hand, not captured from a live API.
const enc = new TextEncoder();
function sse(events: Array<Record<string, unknown>>, chunk = 17): Response {
  const text = events.map((e) => `event: ${String(e.type)}\ndata: ${JSON.stringify(e)}\n\n`).join("");
  const bytes = enc.encode(text);
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      // Split mid-event to exercise buffering.
      for (let i = 0; i < bytes.length; i += chunk) c.enqueue(bytes.slice(i, i + chunk));
      c.close();
    },
  });
  return new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } });
}

async function collect(gen: AsyncGenerator<StreamEvent>): Promise<StreamEvent[]> {
  const out: StreamEvent[] = [];
  for await (const e of gen) out.push(e);
  return out;
}

const req = {
  model: "test-model",
  messages: [{ role: "user" as const, content: "hi" }],
  tools: [{ name: "click", description: "click ref", parameters: { type: "object" } }],
  maxTokens: 64,
};

const anthropicStream = [
  { type: "message_start", message: { usage: { input_tokens: 12, output_tokens: 1 } } },
  { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
  { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hel" } },
  { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "lo" } },
  { type: "content_block_stop", index: 0 },
  { type: "content_block_start", index: 1, content_block: { type: "tool_use", id: "tu_1", name: "click" } },
  { type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: '{"ref":' } },
  { type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: '"e3"}' } },
  { type: "content_block_stop", index: 1 },
  { type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 20 } },
  { type: "message_stop" },
];

const openaiStream = [
  { type: "response.output_text.delta", delta: "Hel" },
  { type: "response.output_text.delta", delta: "lo" },
  { type: "response.output_item.added", item: { type: "function_call", id: "fc_1", call_id: "call_1", name: "click" } },
  { type: "response.function_call_arguments.delta", item_id: "fc_1", delta: '{"ref":' },
  { type: "response.function_call_arguments.delta", item_id: "fc_1", delta: '"e3"}' },
  { type: "response.function_call_arguments.done", item_id: "fc_1", arguments: '{"ref":"e3"}' },
  { type: "response.completed", response: { usage: { input_tokens: 12, output_tokens: 20 } } },
];

function expectedEvents(toolId: string): StreamEvent[] {
  return [
    { type: "text", delta: "Hel" },
    { type: "text", delta: "lo" },
    { type: "tool_call", id: toolId, name: "click", input: { ref: "e3" } },
    { type: "usage", usage: { inputTokens: 12, outputTokens: 20 } },
    { type: "done" },
  ];
}

describe("anthropic adapter", () => {
  it("streams text, tool calls, and usage; sends key header only", async () => {
    let seen: RequestInit | undefined;
    const f: FetchLike = async (_u, init) => {
      seen = init;
      return sse(anthropicStream);
    };
    const events = await collect(createProvider("anthropic", { apiKey: "sk-test-synthetic", fetch: f }).stream(req));
    expect(events).toEqual(expectedEvents("tu_1"));
    expect((seen?.headers as Record<string, string>)["x-api-key"]).toBe("sk-test-synthetic");
    // Without this the API answers 401 to browser-origin calls (seen live, T018).
    expect((seen?.headers as Record<string, string>)["anthropic-dangerous-direct-browser-access"]).toBe("true");
    expect(String(seen?.body)).not.toContain("sk-test-synthetic");
    expect(JSON.parse(String(seen?.body)).tools[0].input_schema).toEqual({ type: "object" });
  });
});

describe("openai adapter", () => {
  it("streams text, tool calls, and usage; sends bearer header only", async () => {
    let seen: RequestInit | undefined;
    const f: FetchLike = async (_u, init) => {
      seen = init;
      return sse(openaiStream);
    };
    const events = await collect(createProvider("openai", { apiKey: "sk-test-synthetic", fetch: f }).stream(req));
    expect(events).toEqual(expectedEvents("call_1"));
    expect((seen?.headers as Record<string, string>).authorization).toBe("Bearer sk-test-synthetic");
    expect(String(seen?.body)).not.toContain("sk-test-synthetic");
    expect(JSON.parse(String(seen?.body)).tools[0]).toMatchObject({ type: "function", name: "click" });
  });
});

describe.each(["anthropic", "openai"] as const)("%s error mapping", (id) => {
  const run = (f: FetchLike) => collect(createProvider(id, { apiKey: "k", fetch: f }).stream(req));

  it.each([
    [401, "auth_invalid"],
    [403, "auth_invalid"],
    [429, "rate_limited"],
    [500, "provider_unavailable"],
    [529, "provider_unavailable"],
    [400, "bad_request"],
  ])("status %i -> %s", async (status, code) => {
    const f: FetchLike = async () => new Response("secret provider body", { status, headers: { "retry-after": "7" } });
    const err = await run(f).catch((e) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.code).toBe(code);
    expect(err.userMessage).not.toContain("secret provider body");
    if (code === "rate_limited") expect(err.retryAfterSeconds).toBe(7);
  });

  it("maps fetch rejection to network", async () => {
    const err = await run(async () => {
      throw new TypeError("Failed to fetch");
    }).catch((e) => e);
    expect(err.code).toBe("network");
  });

  it("maps in-stream error event to stream_error", async () => {
    const ev = id === "anthropic" ? { type: "error", error: { type: "overloaded_error" } } : { type: "error", message: "x" };
    const err = await run(async () => sse([ev])).catch((e) => e);
    expect(err.code).toBe("stream_error");
  });
});

describe("web search (T019)", () => {
  const search = { model: "m", messages: [{ role: "user" as const, content: "q" }], maxTokens: 64, webSearch: true };

  it("anthropic: sends the server search tool and emits result URLs as sources", async () => {
    let body = "";
    const f: FetchLike = async (_u, init) => {
      body = String(init.body);
      return sse([
        { type: "message_start", message: { usage: { input_tokens: 5, output_tokens: 1 } } },
        {
          type: "content_block_start",
          index: 0,
          content_block: {
            type: "web_search_tool_result",
            content: [{ type: "web_search_result", url: "https://deals.test/a", title: "Deals" }],
          },
        },
        { type: "content_block_stop", index: 0 },
        { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 3 } },
      ]);
    };
    const ev = await collect(createProvider("anthropic", { apiKey: "k", fetch: f }).stream(search));
    expect(JSON.parse(body).tools).toEqual([{ type: "web_search_20260209", name: "web_search", max_uses: 3 }]);
    expect(ev).toContainEqual({ type: "source", url: "https://deals.test/a", title: "Deals" });
  });

  it("openai: sends web_search and emits url citations as sources", async () => {
    let body = "";
    const f: FetchLike = async (_u, init) => {
      body = String(init.body);
      return sse([
        {
          type: "response.output_text.annotation.added",
          annotation: { type: "url_citation", url: "https://deals.test/b", title: "More" },
        },
        { type: "response.completed", response: { usage: { input_tokens: 5, output_tokens: 3 } } },
      ]);
    };
    const ev = await collect(createProvider("openai", { apiKey: "k", fetch: f }).stream(search));
    expect(JSON.parse(body).tools).toEqual([{ type: "web_search" }]);
    expect(ev).toContainEqual({ type: "source", url: "https://deals.test/b", title: "More" });
  });

  it("omits tools when search is off and no tools given", async () => {
    let body = "";
    const f: FetchLike = async (_u, init) => {
      body = String(init.body);
      return sse([{ type: "message_stop" }]);
    };
    await collect(createProvider("anthropic", { apiKey: "k", fetch: f }).stream({ ...search, webSearch: false }));
    expect(JSON.parse(body).tools).toBeUndefined();
  });
});
