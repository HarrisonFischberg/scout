import { ProviderError, errorFromStatus } from "./errors";
import { readSse } from "./sse";
import type { ChatRequest, ProviderClient, ProviderConfig, StreamEvent } from "./types";

const DEFAULT_URL = "https://api.openai.com/v1/responses";

interface Call {
  callId: string;
  name: string;
  args: string;
}

export function createOpenAI(cfg: ProviderConfig): ProviderClient {
  return {
    id: "openai",
    async *stream(req: ChatRequest): AsyncGenerator<StreamEvent, void, void> {
      const tools: Array<Record<string, unknown>> = (req.tools ?? []).map((t) => ({
        type: "function",
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      }));
      if (req.webSearch) tools.push({ type: "web_search" });
      const body = {
        model: req.model,
        stream: true,
        instructions: req.system,
        max_output_tokens: req.maxTokens,
        input: req.messages,
        tools: tools.length ? tools : undefined,
      };
      let res: Response;
      try {
        res = await cfg.fetch(cfg.baseUrl ?? DEFAULT_URL, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${cfg.apiKey}`,
          },
          body: JSON.stringify(body),
          signal: req.signal,
        });
      } catch {
        throw new ProviderError("openai", "network");
      }
      if (!res.ok) throw errorFromStatus("openai", res);
      if (!res.body) throw new ProviderError("openai", "stream_error");

      const calls = new Map<string, Call>();
      let usage = { inputTokens: 0, outputTokens: 0 };
      for await (const raw of readSse(res.body)) {
        const ev = raw as Record<string, any>;
        switch (ev.type) {
          case "response.output_text.delta":
            yield { type: "text", delta: ev.delta };
            break;
          case "response.output_text.annotation.added":
            if (ev.annotation?.type === "url_citation" && typeof ev.annotation.url === "string") {
              yield {
                type: "source",
                url: ev.annotation.url,
                ...(typeof ev.annotation.title === "string" ? { title: ev.annotation.title } : {}),
              };
            }
            break;
          case "response.output_item.added":
            if (ev.item?.type === "function_call") {
              calls.set(ev.item.id, {
                callId: ev.item.call_id,
                name: ev.item.name,
                args: "",
              });
            }
            break;
          case "response.function_call_arguments.delta": {
            const c = calls.get(ev.item_id);
            if (c) c.args += ev.delta ?? "";
            break;
          }
          case "response.function_call_arguments.done": {
            const c = calls.get(ev.item_id);
            if (!c) break;
            const args: string = ev.arguments ?? c.args;
            let input: unknown;
            try {
              input = args ? JSON.parse(args) : {};
            } catch {
              throw new ProviderError("openai", "stream_error");
            }
            calls.delete(ev.item_id);
            yield { type: "tool_call", id: c.callId, name: c.name, input };
            break;
          }
          case "response.completed":
            usage = {
              inputTokens: ev.response?.usage?.input_tokens ?? 0,
              outputTokens: ev.response?.usage?.output_tokens ?? 0,
            };
            break;
          case "response.failed":
          case "error":
            throw new ProviderError("openai", "stream_error");
        }
      }
      yield { type: "usage", usage };
      yield { type: "done" };
    },
  };
}
