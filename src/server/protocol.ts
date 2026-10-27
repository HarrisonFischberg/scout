// Scout server protocol (Part 2, spec 5). The server is the answer engine in
// the background worker (src/server/engine.ts); it calls the user's provider
// with the user's own key. There is no hosted Scout server.
//
// Every event carries a sequence number per message. The panel applies events
// in order and ignores any it has already seen, so after a dropped port it
// resubscribes with the last number it has and gets only what it missed.
import type { Usage } from "../providers/types";
import type { ToolStatus } from "../tools/registry";

export type ServerEvent =
  /** pending -> streaming */
  | { kind: "start" }
  | { kind: "text"; delta: string }
  | { kind: "citation"; url: string; title?: string }
  /** Apple's model couldn't answer and the key's model is taking over (no model named: the switch is seamless). */
  | { kind: "handoff" }
  /** The panel runs it through the tool host and posts the result with the same request_id. */
  | { kind: "tool_request"; request_id: string; name: string; input: unknown }
  /** The server has the result; a reopened panel does not run the request again. */
  | { kind: "tool_done"; request_id: string; status: ToolStatus }
  | { kind: "usage"; usage: Usage }
  /** streaming -> complete. `text` is the whole answer. */
  | { kind: "done"; text: string; stopped?: boolean }
  /** streaming -> error. "interrupted": the provider connection dropped mid-answer. */
  | { kind: "error"; code: "provider" | "interrupted" | "failed"; message: string };

export interface NumberedEvent {
  seq: number;
  event: ServerEvent;
}

/** Port payload for "chat.event" (flat, so the bridge schema can check it). */
export function toWire(message_id: string, n: NumberedEvent): Record<string, unknown> {
  const e = n.event;
  const base = { message_id, seq: n.seq, kind: e.kind };
  switch (e.kind) {
    case "start":
    case "handoff":
      return base;
    case "text":
      return { ...base, delta: e.delta };
    case "citation":
      return { ...base, url: e.url, ...(e.title ? { title: e.title } : {}) };
    case "tool_request":
      return { ...base, request_id: e.request_id, name: e.name, input: e.input ?? {} };
    case "tool_done":
      return { ...base, request_id: e.request_id, status: e.status };
    case "usage":
      return {
        ...base,
        input_tokens: e.usage.inputTokens,
        output_tokens: e.usage.outputTokens,
        ...(e.usage.webSearches ? { web_searches: e.usage.webSearches } : {}),
      };
    case "done":
      return { ...base, text: e.text, ...(e.stopped ? { stopped: true } : {}) };
    case "error":
      return { ...base, code: e.code, message: e.message };
  }
}

const TOOL_STATUSES: readonly string[] = ["ok", "error", "schema-error", "blocked-by-user", "unsupported", "declined", "timeout"];

/** Reads a "chat.event" payload (already schema-checked) back into an event; null when a kind's fields are missing. */
export function fromWire(p: Record<string, unknown>): { message_id: string; seq: number; event: ServerEvent } | null {
  const message_id = p.message_id as string;
  const seq = p.seq as number;
  const s = (k: string): string | undefined => (typeof p[k] === "string" ? (p[k] as string) : undefined);
  const n = (k: string): number => (typeof p[k] === "number" ? (p[k] as number) : 0);
  let event: ServerEvent | null = null;
  switch (p.kind) {
    case "start":
    case "handoff":
      event = { kind: p.kind };
      break;
    case "text":
      event = s("delta") !== undefined ? { kind: "text", delta: s("delta")! } : null;
      break;
    case "citation":
      event = s("url") ? { kind: "citation", url: s("url")!, ...(s("title") ? { title: s("title")! } : {}) } : null;
      break;
    case "tool_request":
      event = s("request_id") && s("name") !== undefined ? { kind: "tool_request", request_id: s("request_id")!, name: s("name")!, input: p.input } : null;
      break;
    case "tool_done":
      event = s("request_id") && TOOL_STATUSES.includes(s("status") ?? "") ? { kind: "tool_done", request_id: s("request_id")!, status: s("status") as ToolStatus } : null;
      break;
    case "usage":
      event = {
        kind: "usage",
        usage: { inputTokens: n("input_tokens"), outputTokens: n("output_tokens"), ...(n("web_searches") ? { webSearches: n("web_searches") } : {}) },
      };
      break;
    case "done":
      event = s("text") !== undefined ? { kind: "done", text: s("text")!, ...(p.stopped === true ? { stopped: true } : {}) } : null;
      break;
    case "error": {
      const code = s("code");
      event = code === "provider" || code === "interrupted" || code === "failed" ? { kind: "error", code, message: s("message") ?? "" } : null;
      break;
    }
  }
  return event && Number.isInteger(seq) && seq > 0 ? { message_id, seq, event } : null;
}
