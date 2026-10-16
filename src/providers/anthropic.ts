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
      const body = {
        model: req.model,
        max_tokens: req.maxTokens,
        stream: true,
        system: req.system,
        messages: req.messages,
        tools: req.tools?.map((t) => ({
          name: t.name,
          description: t.description,
          input_schema: t.parameters,
        })),
      };
      let res: Response;
      try {
        res = await cfg.fetch(cfg.baseUrl ?? DEFAULT_URL, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-api-key": cfg.apiKey,
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify(body),
          signal: req.signal,
        });
      } catch {
        throw new ProviderError("anthropic", "network");
      }
      if (!res.ok) throw errorFromStatus("anthropic", res);
      if (!res.body) throw new ProviderError("anthropic", "stream_error");

      const blocks = new Map<number, Block>();
      let inputTokens = 0;
      let outputTokens = 0;
      for await (const raw of readSse(res.body)) {
        const ev = raw as Record<string, any>;
        switch (ev.type) {
          case "message_start":
            inputTokens = ev.message?.usage?.input_tokens ?? 0;
            outputTokens = ev.message?.usage?.output_tokens ?? 0;
            break;
          case "content_block_start": {
            const cb = ev.content_block ?? {};
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
            else if (d.type === "input_json_delta") {
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
            break;
          case "error":
            throw new ProviderError("anthropic", "stream_error");
        }
      }
      yield { type: "usage", usage: { inputTokens, outputTokens } };
      yield { type: "done" };
    },
  };
}
