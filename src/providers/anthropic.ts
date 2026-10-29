import { ProviderError, errorDetail, errorFromStatus } from "./errors";
import { readSse } from "./sse";
import type { ChatMessage, ChatRequest, ProviderClient, ProviderConfig, StreamEvent } from "./types";

const DEFAULT_URL = "https://api.anthropic.com/v1/messages";

/** Messages API shape: string content as is, parts as text and base64 image blocks. */
export function anthropicMessages(messages: ChatMessage[]): unknown[] {
  return messages.map((m) =>
    typeof m.content === "string"
      ? m
      : {
          role: m.role,
          content: m.content.map((p) =>
            p.type === "text" ? { type: "text", text: p.text } : { type: "image", source: { type: "base64", media_type: p.mediaType, data: p.data } },
          ),
        },
  );
}

interface Block {
  kind: "text" | "tool_use";
  id?: string;
  name?: string;
  json: string;
}

type RawBlock = Record<string, unknown>;

/**
 * The page a citation points to. Web search citations carry `url`; with
 * dynamic filtering (web_search_20260209) results reach the model as search
 * result blocks, whose citations carry the page in `source` instead (owner
 * report 2026-10-29: such answers showed "[12-1]" and no sources).
 */
export function citationPage(c: unknown): { url: string; title?: string } | null {
  const o = (c ?? {}) as Record<string, unknown>;
  const url = typeof o.url === "string" ? o.url : typeof o.source === "string" ? o.source : "";
  if (!/^https?:\/\//i.test(url)) return null;
  const title = typeof o.title === "string" && o.title ? o.title : typeof o.document_title === "string" && o.document_title ? o.document_title : undefined;
  return { url, ...(title ? { title } : {}) };
}

/**
 * Server tools (web search, web fetch) run in a loop on Anthropic's side that
 * ends the turn with stop_reason "pause_turn" after a set number of steps,
 * often before the model has written its answer. The turn goes on when it is
 * sent back unchanged as the last assistant message; at most this many times.
 */
export const MAX_RESUMES = 4;
/** Longest page the fetch tool hands the model (tokens). */
export const FETCH_MAX_CONTENT_TOKENS = 40_000;

/** The assistant turn as the API expects it back: no empty text blocks or null fields. */
function resumable(content: Array<RawBlock | undefined>): RawBlock[] {
  const out: RawBlock[] = [];
  for (const b of content) {
    if (!b) continue;
    if (b.type === "text") {
      if (typeof b.text !== "string" || b.text === "") continue;
      const citations = Array.isArray(b.citations) && b.citations.length ? b.citations : undefined;
      out.push({ type: "text", text: b.text, ...(citations ? { citations } : {}) });
    } else out.push(b);
  }
  return out;
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
      // Web fetch only opens URLs already in the conversation (search results,
      // or pages the request names; it works without the search tool).
      // Citations on, so quoted passages come back as page text; page size
      // bounded so one long page cannot eat the budget.
      if (req.webFetch) {
        tools.push({
          type: "web_fetch_20260209",
          name: "web_fetch",
          max_uses: req.webFetchMaxUses ?? req.webSearchMaxUses ?? 3,
          citations: { enabled: true },
          max_content_tokens: FETCH_MAX_CONTENT_TOKENS,
        });
      }
      let inputTokens = 0;
      let outputTokens = 0;
      let webSearches = 0;
      // Earlier parts of a paused turn, sent back so the server resumes it.
      let paused: RawBlock[] = [];
      let container: string | undefined;
      for (let round = 0; ; round++) {
        const messages = anthropicMessages(req.messages);
        if (paused.length) messages.push({ role: "assistant", content: paused });
        const body = {
          model: req.model,
          max_tokens: req.maxTokens,
          stream: true,
          system: req.system,
          messages,
          tools: tools.length ? tools : undefined,
          output_config: req.effort ? { effort: req.effort } : undefined,
          container: paused.length ? container : undefined,
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
        if (!res.ok) throw errorFromStatus("anthropic", res, await errorDetail(res));
        if (!res.body) throw new ProviderError("anthropic", "stream_error");

        const blocks = new Map<number, Block>();
        const content: Array<RawBlock | undefined> = [];
        // Pages the model asked the fetch tool for, by tool call id, so a failed
        // fetch (whose result names no page) can still be reported.
        const asked = new Map<string, string>();
        let respOut = 0;
        let respSearches = 0;
        let stop: string | undefined;
        for await (const raw of readSse(res.body)) {
          const ev = raw as Record<string, any>;
          switch (ev.type) {
            case "message_start":
              inputTokens += ev.message?.usage?.input_tokens ?? 0;
              respOut = ev.message?.usage?.output_tokens ?? 0;
              if (typeof ev.message?.container?.id === "string") container = ev.message.container.id;
              break;
            case "content_block_start": {
              const cb = ev.content_block ?? {};
              if (cb.type === "web_fetch_tool_result") {
                const url = typeof cb.content?.url === "string" ? cb.content.url : asked.get(String(cb.tool_use_id ?? ""));
                if (cb.content?.type === "web_fetch_tool_result_error") {
                  if (url) yield { type: "fetch", url, ok: false, error: typeof cb.content.error_code === "string" ? cb.content.error_code : "error" };
                } else if (url) {
                  // The fetched document's text travels with the result: page
                  // text the coupon finder checks codes against.
                  const doc = cb.content?.content ?? {};
                  const data = doc?.source?.data;
                  const page = typeof data === "string" && doc?.source?.type === "text" ? data : undefined;
                  yield { type: "fetch", url, ok: true, chars: page?.length ?? 0 };
                  yield { type: "source", url, ...(typeof doc?.title === "string" ? { title: doc.title } : {}), ...(page !== undefined ? { page } : {}) };
                }
              }
              // A failed search comes back as an error object, not a list (owner run
              // 2026-10-19 #237: four searches wrote no code, and nothing said why).
              if (cb.type === "web_search_tool_result" && !Array.isArray(cb.content)) {
                yield { type: "search", ok: false, error: typeof cb.content?.error_code === "string" ? cb.content.error_code : "error" };
              }
              if (cb.type === "web_search_tool_result" && Array.isArray(cb.content)) {
                yield { type: "search", ok: true, results: cb.content.filter((r: { type?: unknown }) => r?.type === "web_search_result").length };
                for (const r of cb.content) {
                  if (r?.type === "web_search_result" && typeof r.url === "string") {
                    yield {
                      type: "source",
                      url: r.url,
                      ...(typeof r.title === "string" ? { title: r.title } : {}),
                      ...(typeof r.page_age === "string" ? { age: r.page_age } : {}),
                    };
                  }
                }
              }
              content[ev.index] = { ...cb };
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
              const kept = content[ev.index];
              if (d.type === "text_delta") {
                yield { type: "text", delta: d.text };
                if (kept) kept.text = String(kept.text ?? "") + d.text;
              } else if (d.type === "citations_delta" && d.citation) {
                const cp = citationPage(d.citation);
                if (cp) yield { type: "source", ...cp, ...(typeof d.citation.cited_text === "string" ? { text: d.citation.cited_text } : {}) };
                if (kept) kept.citations = [...(Array.isArray(kept.citations) ? kept.citations : []), d.citation];
              } else if (d.type === "thinking_delta") {
                if (kept) kept.thinking = String(kept.thinking ?? "") + (d.thinking ?? "");
              } else if (d.type === "signature_delta") {
                if (kept) kept.signature = d.signature;
              } else if (d.type === "input_json_delta") {
                const b = blocks.get(ev.index);
                if (b) b.json += d.partial_json ?? "";
              }
              break;
            }
            case "content_block_stop": {
              const b = blocks.get(ev.index);
              const kept = content[ev.index];
              if (b?.json && kept && /tool_use$/.test(String(kept.type))) {
                try {
                  kept.input = JSON.parse(b.json);
                } catch {
                  throw new ProviderError("anthropic", "stream_error");
                }
              }
              // The cited text is complete: say which pages it cites, once each.
              if (kept?.type === "text" && Array.isArray(kept.citations)) {
                const seen = new Set<string>();
                for (const c of kept.citations) {
                  const cp = citationPage(c);
                  if (cp && !seen.has(cp.url)) {
                    seen.add(cp.url);
                    yield { type: "source", ...cp, cite: true };
                  }
                }
              }
              if (kept?.type === "server_tool_use" && kept.name === "web_fetch") {
                const url = (kept.input as { url?: unknown } | undefined)?.url;
                if (typeof url === "string" && url) asked.set(String(kept.id ?? ""), url);
              }
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
              respOut = ev.usage?.output_tokens ?? respOut;
              respSearches = ev.usage?.server_tool_use?.web_search_requests ?? respSearches;
              if (typeof ev.delta?.stop_reason === "string") stop = ev.delta.stop_reason;
              if (typeof ev.delta?.container?.id === "string") container = ev.delta.container.id;
              break;
            case "error":
              throw new ProviderError("anthropic", "stream_error");
          }
        }
        outputTokens += respOut;
        webSearches += respSearches;
        if (stop !== "pause_turn" || round >= MAX_RESUMES || req.signal?.aborted) {
          if (stop) yield { type: "stop", reason: stop };
          break;
        }
        paused = [...paused, ...resumable(content)];
      }
      yield { type: "usage", usage: { inputTokens, outputTokens, ...(webSearches ? { webSearches } : {}) } };
      yield { type: "done" };
    },
  };
}
