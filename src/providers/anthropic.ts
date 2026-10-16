import { ProviderError, errorFromStatus } from "./errors";
import { readSse } from "./sse";
import type { ChatRequest, ProviderClient, ProviderConfig, StreamEvent } from "./types";

const DEFAULT_URL = "https://api.anthropic.com/v1/messages";

interface Block {
  kind: "text" | "tool_use";
  id?: string;
  name?: string;
  json: string;
}

export function createAnthropic(cfg: ProviderConfig): ProviderClient {
  return {
    id: "anthropic",
    async *stream(req: ChatRequest): AsyncGenerator<StreamEvent, void, void> {
      const tools: Array<Record<string, unknown>> = (req.tools ?? []).map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.parameters,
      }));
      if (req.webSearch) tools.push({ type: "web_search_20260209", name: "web_search", max_uses: req.webSearchMaxUses ?? 3 });
      // Web fetch only opens URLs already in the conversation (e.g. search results).
      if (req.webSearch && req.webFetch) tools.push({ type: "web_fetch_20260209", name: "web_fetch", max_uses: req.webSearchMaxUses ?? 3 });
      const body = {
        model: req.model,
        max_tokens: req.maxTokens,
        stream: true,
        system: req.system,
        messages: req.messages,
        tools: tools.length ? tools : undefined,
        output_config: req.effort ? { effort: req.effort } : undefined,
      };
      let res: Response;
      try {
        res = await cfg.fetch(cfg.baseUrl ?? DEFAULT_URL, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-api-key": cfg.apiKey,
            "anthropic-version": "2023-06-01",
            // Calls come from the extension's browser origin with the user's own
            // key (BYOK); the API rejects browser-origin requests without this
            // opt-in (the official SDK sends it for dangerouslyAllowBrowser).
            "anthropic-dangerous-direct-browser-access": "true",
          },
          body: JSON.stringify(body),
          signal: req.signal,
        });
      } catch (err) {
        // A refused request (no consent, src/settings/consent.ts) keeps its reason.
        if (err instanceof ProviderError) throw err;
        throw new ProviderError("anthropic", "network");
      }
      if (!res.ok) throw errorFromStatus("anthropic", res);
      if (!res.body) throw new ProviderError("anthropic", "stream_error");

      const blocks = new Map<number, Block>();
      let inputTokens = 0;
      let outputTokens = 0;
      let webSearches = 0;
      for await (const raw of readSse(res.body)) {
        const ev = raw as Record<string, any>;
        switch (ev.type) {
          case "message_start":
            inputTokens = ev.message?.usage?.input_tokens ?? 0;
            outputTokens = ev.message?.usage?.output_tokens ?? 0;
            break;
          case "content_block_start": {
            const cb = ev.content_block ?? {};
            if (cb.type === "web_fetch_tool_result" && typeof cb.content?.url === "string") {
              yield { type: "source", url: cb.content.url };
            }
            if (cb.type === "web_search_tool_result" && Array.isArray(cb.content)) {
              for (const r of cb.content) {
                if (r?.type === "web_search_result" && typeof r.url === "string") {
                  yield { type: "source", url: r.url, ...(typeof r.title === "string" ? { title: r.title } : {}) };
                }
              }
            }
            blocks.set(ev.index, {
              kind: cb.type === "tool_use" ? "tool_use" : "text",
              id: cb.id,
              name: cb.name,
              json: "",
            });
            break;
          }
          case "content_block_delta": {
            const d = ev.delta ?? {};
            if (d.type === "text_delta") yield { type: "text", delta: d.text };
            else if (d.type === "citations_delta" && typeof d.citation?.url === "string") {
              yield { type: "source", url: d.citation.url };
            } else if (d.type === "input_json_delta") {
              const b = blocks.get(ev.index);
              if (b) b.json += d.partial_json ?? "";
            }
            break;
          }
          case "content_block_stop": {
            const b = blocks.get(ev.index);
            if (b?.kind === "tool_use") {
              let input: unknown;
              try {
                input = b.json ? JSON.parse(b.json) : {};
              } catch {
                throw new ProviderError("anthropic", "stream_error");
              }
              yield { type: "tool_call", id: b.id ?? "", name: b.name ?? "", input };
            }
            blocks.delete(ev.index);
            break;
          }
          case "message_delta":
            outputTokens = ev.usage?.output_tokens ?? outputTokens;
            webSearches = ev.usage?.server_tool_use?.web_search_requests ?? webSearches;
            break;
          case "error":
            throw new ProviderError("anthropic", "stream_error");
        }
      }
      yield { type: "usage", usage: { inputTokens, outputTokens, ...(webSearches ? { webSearches } : {}) } };
      yield { type: "done" };
    },
  };
}
