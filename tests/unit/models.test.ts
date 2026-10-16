import { describe, expect, it } from "vitest";
import { createProvider } from "../../src/providers";
import {
  BUILTIN_MODELS,
  effortFor,
  effortForId,
  loadModelList,
  parseAnthropicModels,
  parseOpenAIModels,
  withModel,
} from "../../src/providers/models";
import type { FetchLike } from "../../src/providers";

// Synthetic model lists, shaped like the providers' GET /v1/models responses.
const anthropicList = {
  data: [
    {
      type: "model",
      id: "claude-opus-5-5",
      display_name: "Claude Opus 5.5",
      capabilities: {
        effort: {
          supported: true,
          low: { supported: true },
          medium: { supported: true },
          high: { supported: true },
          xhigh: { supported: true },
          max: { supported: true },
        },
      },
    },
    {
      type: "model",
      id: "claude-old-4",
      display_name: "Claude Old 4",
      capabilities: { effort: { supported: false, low: { supported: false } } },
    },
    { type: "model", id: "claude-sonnet-5-5", display_name: "Claude Sonnet 5.5" },
  ],
  has_more: false,
};

const openaiList = {
  object: "list",
  data: [
    { id: "gpt-5", created: 300 },
    { id: "gpt-5-2025-08-07", created: 290 },
    { id: "gpt-5-chat-latest", created: 310 },
    { id: "gpt-4.1", created: 200 },
    { id: "o3", created: 250 },
    { id: "text-embedding-3-large", created: 100 },
    { id: "gpt-4o-realtime-preview", created: 260 },
    { id: "gpt-image-1", created: 270 },
    { id: "dall-e-3", created: 50 },
  ],
};

function storage(initial: Record<string, unknown> = {}) {
  const data = { ...initial };
  return {
    data,
    get: async (k: string | string[]) => {
      const list = Array.isArray(k) ? k : [k];
      return Object.fromEntries(list.filter((x) => x in data).map((x) => [x, data[x]]));
    },
    set: async (items: Record<string, unknown>) => void Object.assign(data, items),
  };
}

describe("model lists", () => {
  it("reads Anthropic effort support from capabilities, falling back to built-in knowledge", () => {
    const models = parseAnthropicModels(anthropicList);
    expect(models.map((m) => [m.id, m.name, m.efforts.join(",")])).toEqual([
      ["claude-opus-5-5", "Claude Opus 5.5", "low,medium,high,xhigh,max"],
      ["claude-old-4", "Claude Old 4", ""],
      ["claude-sonnet-5-5", "Claude Sonnet 5.5", "low,medium,high,xhigh,max"],
    ]);
  });

  it("keeps OpenAI chat models only, newest first, effort on reasoning models", () => {
    const models = parseOpenAIModels(openaiList);
    expect(models.map((m) => [m.id, m.efforts.join(",")])).toEqual([
      ["gpt-5-chat-latest", ""],
      ["gpt-5", "low,medium,high"],
      ["o3", "low,medium,high"],
      ["gpt-4.1", ""],
    ]);
    expect(models[1]?.name).toBe("GPT-5");
  });

  it("loads live with the key, caches for a day, and falls back to built-in", async () => {
    const calls: Array<{ url: string; headers: Record<string, string> }> = [];
    const ok: FetchLike = async (url, init) => {
      calls.push({ url, headers: init.headers as Record<string, string> });
      return new Response(JSON.stringify(anthropicList), { status: 200 });
    };
    const s = storage();
    const live = await loadModelList(s, "anthropic", "sk-ant-test-synthetic", ok, 1000);
    expect(live.source).toBe("live");
    expect(calls[0]?.url).toBe("https://api.anthropic.com/v1/models?limit=100");
    expect(calls[0]?.headers["x-api-key"]).toBe("sk-ant-test-synthetic");
    const cached = await loadModelList(s, "anthropic", "sk-ant-test-synthetic", ok, 2000);
    expect(cached.source).toBe("cached");
    expect(calls).toHaveLength(1);
    // The cache holds model ids and names only, never the key.
    expect(JSON.stringify(s.data)).not.toContain("sk-ant-");

    const down: FetchLike = async () => new Response("{}", { status: 500 });
    const fallback = await loadModelList(storage(), "openai", "sk-test-synthetic", down, 1000);
    expect(fallback).toMatchObject({ source: "builtin", error: "HTTP 500" });
    expect(fallback.models).toEqual(BUILTIN_MODELS.openai);
    const noKey = await loadModelList(undefined, "anthropic", null, down, 1000);
    expect(noKey.source).toBe("builtin");
  });

  it("keeps a saved model the list does not show", () => {
    const list = withModel(BUILTIN_MODELS.openai, "openai", "gpt-custom");
    expect(list[list.length - 1]).toEqual({ id: "gpt-custom", name: "gpt-custom", efforts: [] });
  });
});

describe("effort", () => {
  const opus = { id: "claude-opus-5-5", name: "Opus", efforts: ["low", "medium", "high", "xhigh", "max"] as const };
  it("is sent only when the model supports the chosen level", () => {
    expect(effortFor({ ...opus, efforts: [...opus.efforts] }, "max")).toBe("max");
    expect(effortFor({ ...opus, efforts: [...opus.efforts] }, "default")).toBeUndefined();
    expect(effortFor({ id: "gpt-5", name: "GPT-5", efforts: ["low", "medium", "high"] }, "xhigh")).toBeUndefined();
    expect(effortForId("openai", "gpt-4.1", "high")).toBeUndefined();
    expect(effortForId("anthropic", "claude-sonnet-5-5", "low")).toBe("low");
  });

  it("goes in output_config for Anthropic and reasoning for OpenAI, and is absent when unset", async () => {
    const bodies: Array<Record<string, unknown>> = [];
    const capture: FetchLike = async (_url, init) => {
      bodies.push(JSON.parse(String(init.body)));
      return new Response("", { status: 200, headers: { "content-type": "text/event-stream" } });
    };
    const req = { model: "m", messages: [{ role: "user" as const, content: "hi" }], maxTokens: 64 };
    for (const id of ["anthropic", "openai"] as const) {
      const p = createProvider(id, { apiKey: "k", fetch: capture });
      for await (const _ of p.stream({ ...req, effort: "high" })) void _;
      for await (const _ of p.stream(req)) void _;
    }
    expect(bodies[0]?.output_config).toEqual({ effort: "high" });
    expect(bodies[1]).not.toHaveProperty("output_config");
    expect(bodies[2]?.reasoning).toEqual({ effort: "high" });
    expect(bodies[3]).not.toHaveProperty("reasoning");
  });
});
