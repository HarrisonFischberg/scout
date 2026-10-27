// Message bridge between the Scout panel (popup), content scripts, and the
// background worker. One shared module: Parts 2 and 3 add their message types
// to REQUESTS and EVENTS below. Every message is { type, request_id, payload }.
// All checks run on the device; nothing relies on a server to enforce them.
import { EFFORTS } from "../providers/types";

/** Name of the long-lived port the panel opens to the background worker. */
export const PANEL_PORT = "scout-panel";

// "unsupported" (Part 2): the browser has no API for it (Safari: tab groups,
// history, recently closed tabs).
export type BridgeErrorType = "timeout" | "blocked-by-user" | "schema-error" | "unhandled" | "unsupported";

export interface Envelope<P = unknown> {
  type: string;
  request_id: string;
  payload: P;
}

export interface ErrorPayload {
  error: BridgeErrorType;
  message: string;
}

export class BridgeError extends Error {
  constructor(
    readonly error: BridgeErrorType,
    message: string,
  ) {
    super(message);
    this.name = "BridgeError";
  }
}

// ---------- Schemas ----------
// A small schema language, enough for flat message payloads.
export type Schema =
  | "string"
  | "number"
  | "boolean"
  /** Any JSON value; the receiver validates it further (tool inputs). */
  | "unknown"
  | { enum: readonly string[] }
  | { array: Schema }
  | { object: Record<string, Schema>; optional?: readonly string[] };

/** Returns null when `value` matches, otherwise where and why it does not. */
export function checkSchema(schema: Schema, value: unknown, path = "payload"): string | null {
  if (schema === "unknown") return value === undefined ? path + " is required" : null;
  if (schema === "string" || schema === "boolean") {
    return typeof value === schema ? null : path + " must be a " + schema;
  }
  if (schema === "number") {
    return typeof value === "number" && Number.isFinite(value) ? null : path + " must be a number";
  }
  if ("enum" in schema) {
    return typeof value === "string" && schema.enum.includes(value) ? null : path + " must be one of " + schema.enum.join(", ");
  }
  if ("array" in schema) {
    if (!Array.isArray(value)) return path + " must be an array";
    for (let i = 0; i < value.length; i++) {
      const bad = checkSchema(schema.array, value[i], path + "[" + i + "]");
      if (bad) return bad;
    }
    return null;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return path + " must be an object";
  const obj = value as Record<string, unknown>;
  for (const key of Object.keys(obj)) {
    if (!(key in schema.object)) return path + "." + key + " is not allowed";
  }
  for (const [key, sub] of Object.entries(schema.object)) {
    if (!(key in obj) || obj[key] === undefined) {
      if (schema.optional?.includes(key)) continue;
      return path + "." + key + " is required";
    }
    const bad = checkSchema(sub, obj[key], path + "." + key);
    if (bad) return bad;
  }
  return null;
}

// ---------- Senders ----------
/** "panel": an extension page (the popup). "content": a Scout content script in a tab. */
export type SenderKind = "panel" | "content";

export interface MessageSender {
  id?: string;
  url?: string;
  origin?: string;
  tab?: { id?: number };
  frameId?: number;
}

export interface Self {
  /** browser.runtime.id */
  id: string;
  /** browser.runtime.getURL(""), e.g. "safari-web-extension://<uuid>/" */
  baseUrl: string;
}

/**
 * Only Scout's own panel and content scripts may talk to the worker. Anything
 * else, including a web page, another extension, or a sender with no id, is
 * rejected (null).
 */
export function classifySender(sender: MessageSender | undefined, self: Self): SenderKind | null {
  if (!sender || !self.id || sender.id !== self.id) return null;
  const url = sender.url ?? "";
  if (self.baseUrl && url.startsWith(self.baseUrl)) return "panel";
  // A content script's sender carries its tab and the page URL. Only Scout's
  // own scripts can send with Scout's id; web pages have no runtime access.
  if (sender.tab?.id !== undefined && /^https?:\/\//.test(url)) return "content";
  return null;
}

// ---------- Message registry ----------
export interface RequestSpec {
  senders: readonly SenderKind[];
  payload: Schema;
}

/** Request/response messages: one call, one answer. */
export const REQUESTS = {
  ping: { senders: ["panel", "content"], payload: { object: {} } },
  /** The panel's per-tab state: which conversation it shows and whether it was open. */
  "panel.state": { senders: ["panel"], payload: { object: { tabId: "number" } } },
  /** Page button (src/edge.ts): the user tapped it; open the toolbar panel. */
  "panel.open": { senders: ["content"], payload: { object: {} } },
  /** Page button: a page with the button loaded, or a finger on it. The worker gets the app's handler ready (src/panel/warm.ts). */
  "panel.warm": { senders: ["content"], payload: { object: {} } },
  // ---------- Part 2: conversation, context and tools ----------
  /** Reads the current tab (when allowed) and the attached tabs as cleaned Markdown (src/context). */
  "context.read": {
    senders: ["panel"],
    payload: { object: { current_tab: "number", attached: { array: "number" }, include_current: "boolean" }, optional: ["current_tab"] },
  },
  /** Starts an answer on the Scout server (src/server/engine.ts). Events follow on the port. */
  "chat.start": {
    senders: ["panel"],
    payload: {
      object: {
        message_id: "string",
        conv: "string",
        provider: { enum: ["anthropic", "openai"] },
        model: "string",
        effort: { enum: EFFORTS },
        question: "string",
        history: { array: { object: { role: { enum: ["user", "assistant"] }, content: "string" } } },
        /** Cleaned pages from context.read: the current tab first, then attached tabs. */
        pages: { array: { object: { url: "string", title: "string", text: "string" } } },
        /** Tabs shown under the message (title, host, read status), saved with the answer. */
        shared: { array: { object: { title: "string", host: "string", status: "string" } } },
        /** Continue after a drop: history shows this question and the answer starts with this text. */
        display_question: "string",
        answer_prefix: "string",
        /** Sources numbered in answer_prefix, so the saved answer keeps them. */
        prefix_sources: { array: { object: { url: "string", title: "string" } } },
        /** Host of the page the chat is on, saved to title it in the chats menu. */
        site: "string",
        /** "general": judged unrelated to the page, sent without it (src/chat/intent.ts). */
        scope: { enum: ["page", "general"] },
        /** General questions: the open page's address and title only, so the model can choose to read it. */
        open_page: { object: { url: "string", title: "string" } },
      },
      optional: ["effort", "shared", "display_question", "answer_prefix", "prefix_sources", "site", "scope", "open_page"],
    },
  },
  "chat.stop": { senders: ["panel"], payload: { object: { message_id: "string" } } },
  /** Delete all data: stop every answer, Scout mode task and coupon run, so none saves after the wipe. */
  "jobs.stop_all": { senders: ["panel"], payload: { object: {} } },
  /** The panel ran a tool request through the tool host; same request_id as the request. */
  "chat.tool_result": {
    senders: ["panel"],
    payload: {
      object: {
        message_id: "string",
        request_id: "string",
        status: { enum: ["ok", "error", "schema-error", "blocked-by-user", "unsupported", "declined", "timeout"] },
        text: "string",
        image_type: { enum: ["image/jpeg", "image/png"] },
        image_data: "string",
        /** What the tool shared (read_page, screenshot_visible), for the saved entry. Never page text. */
        shared_title: "string",
        shared_host: "string",
      },
      optional: ["image_type", "image_data", "shared_title", "shared_host"],
    },
  },
  /** Answers still running for a conversation, so a reopened panel can resume them. */
  "chat.active": { senders: ["panel"], payload: { object: { conv: "string" } } },
  /** Runs one tool through the tool host (src/tools/host.ts). `input` is checked there. */
  "tool.run": {
    senders: ["panel"],
    payload: {
      object: {
        request_id: "string",
        name: "string",
        input: "unknown",
        tabs: { array: "number" },
        current_tab: "number",
        /** The user's answer when the tool needed one (close_tabs, screenshots). */
        decision: { enum: ["confirmed", "declined", "once", "always", "never"] },
      },
      optional: ["current_tab", "decision"],
    },
  },
  /** Recent tool calls (the tool log; not shown in Settings since 2026-10-17). */
  "tools.log": { senders: ["panel"], payload: { object: {} } },
  // ---------- Part 3: Scout mode ----------
  /** Starts a task on a tab (src/agent/task.ts in the worker). Events follow on the port after task.watch. */
  "task.start": {
    senders: ["panel"],
    payload: {
      object: {
        tab_id: "number",
        goal: "string",
        /** Conversation the outcome is saved to. */
        conv: "string",
        /** "chat": requested by the Scout server mid-answer (run_task); "panel": the user's Scout mode. */
        source: { enum: ["panel", "chat"] },
      },
      optional: ["conv", "source"],
    },
  },
  /** Stop. From the panel, or from the overlay's pill in the task's own tab. */
  "task.control": { senders: ["panel", "content"], payload: { object: { task_id: "string", command: { enum: ["stop"] } } } },
  /** The user's answer to a sensitive-action confirmation. */
  "task.decide": { senders: ["panel"], payload: { object: { task_id: "string", prompt_id: "string", decision: { enum: ["once", "always", "deny"] } } } },
  /** The task on a tab, if any, with its log so far (a reopened panel catches up). */
  "task.status": { senders: ["panel"], payload: { object: { tab_id: "number" } } },
  // ---------- Find coupons (src/server/coupon-host.ts): runs in the worker, so it outlives the panel ----------
  /** Starts a coupon run on a tab. Events follow on the port after task.watch. */
  "coupons.start": {
    senders: ["panel"],
    payload: {
      object: {
        tab_id: "number",
        /** The window background tabs open in (the browser fallback). */
        window_id: "number",
        provider: { enum: ["anthropic", "openai"] },
        model: "string",
        effort: { enum: EFFORTS },
        /** Conversation the outcome is saved to. */
        conv: "string",
        /** iPhone: the panel's sheet covers the bottom half of the page. */
        phone: "boolean",
        /** Host of the store, saved to title the chat in the chats menu. */
        site: "string",
      },
      optional: ["window_id", "effort", "conv", "phone", "site"],
    },
  },
  "coupons.stop": { senders: ["panel"], payload: { object: { tab_id: "number" } } },
  /** The user allowed or withdrew sharing with a provider in the panel; counts even if Safari failed to save it. */
  "consent.set": { senders: ["panel"], payload: { object: { provider: { enum: ["anthropic", "openai"] }, allowed: "boolean" } } },
  /** The answer to "search the web again?". */
  "coupons.answer": { senders: ["panel"], payload: { object: { tab_id: "number", prompt_id: "string", more: "boolean" } } },
  /** The run on a tab, if any, with its events so far (a reopened panel catches up). */
  "coupons.status": { senders: ["panel"], payload: { object: { tab_id: "number" } } },
  /** The chats menu: switch to the tab a coupon run is on and open the panel there. */
  "tabs.show": { senders: ["panel"], payload: { object: { tab_id: "number" } } },
  /** Every tab's run, without events, for the chats menu. */
  "coupons.list": { senders: ["panel"], payload: { object: {} } },
} as const satisfies Record<string, RequestSpec>;

export type RequestType = keyof typeof REQUESTS;

/** Port events (panel to worker). Worker-to-panel events are listed in WORKER_EVENTS. */
export const PANEL_EVENTS = {
  /** First message on the port: which tab and window the panel is showing. */
  "panel.hello": { object: { tabId: "number", windowId: "number" }, optional: ["windowId"] },
  /** Part 2: stream this answer's events after `after_seq` (0 = from the start). Sent again after a reconnect. */
  "chat.subscribe": { object: { message_id: "string", after_seq: "number" } },
  /** Part 3: send this port the task events of a tab. Sent again after a reconnect. */
  "task.watch": { object: { tab_id: "number" } },
} as const satisfies Record<string, Schema>;

/** Port events (worker to panel), for streaming progress and task state. */
export const WORKER_EVENTS = {
  "panel.ack": { object: { tabId: "number" } },
  /** Part 2: one numbered Scout server event (src/server/protocol.ts checks the fields per kind). */
  "chat.event": {
    object: {
      message_id: "string",
      seq: "number",
      kind: { enum: ["start", "text", "citation", "tool_request", "tool_done", "usage", "done", "error"] },
      delta: "string",
      url: "string",
      title: "string",
      request_id: "string",
      name: "string",
      input: "unknown",
      status: "string",
      text: "string",
      message: "string",
      code: "string",
      stopped: "boolean",
      input_tokens: "number",
      output_tokens: "number",
      web_searches: "number",
    },
    optional: [
      "delta", "url", "title", "request_id", "name", "input", "status", "text", "message", "code", "stopped",
      "input_tokens", "output_tokens", "web_searches",
    ],
  },
  /** The worker no longer knows this answer (it restarted): nothing more will come. */
  "chat.lost": { object: { message_id: "string" } },
  /** Part 3: one Scout mode task event (flat, per kind: started, state, log, confirm, done). */
  /** One Find coupons event (src/coupons/job.ts; flat, per kind). */
  "coupons.event": {
    object: {
      tab_id: "number",
      seq: "number",
      kind: { enum: ["say", "step", "steps-end", "attempt", "ask", "answered", "trace", "page", "done"] },
      text: "string",
      step: "number",
      attempt: "unknown",
      currency: "string",
      prompt_id: "string",
      tried: "number",
      /** A checkpoint ask (src/coupons/finder.ts): seconds so far, and the best code so far. */
      seconds: "number",
      best: "string",
      stage: "string",
      /** A stage's time in the run (CouponHost.emit). Missing here, every stage was dropped (owner report 2026-10-19, run #203). */
      at_ms: "number",
      url: "string",
      status: "string",
      message: "string",
      outcome: { enum: ["done", "stopped", "error"] },
      summary: "string",
      tone: { enum: ["assistant", "error"] },
      status_text: "string",
      input_tokens: "number",
      output_tokens: "number",
      web_searches: "number",
    },
    optional: [
      "text", "step", "attempt", "currency", "prompt_id", "tried", "seconds", "best", "stage", "at_ms", "url", "status", "message", "outcome", "summary", "tone", "status_text",
      "input_tokens", "output_tokens", "web_searches",
    ],
  },
  "task.event": {
    object: {
      task_id: "string",
      tab_id: "number",
      seq: "number",
      kind: { enum: ["started", "state", "log", "confirm", "done"] },
      goal: "string",
      state: { enum: ["running", "waiting"] },
      text: "string",
      status: "string",
      prompt_id: "string",
      what: "string",
      site: "string",
      reason: "string",
      preapproved: "boolean",
      summary: "string",
      input_tokens: "number",
      output_tokens: "number",
    },
    optional: ["goal", "state", "text", "status", "prompt_id", "what", "site", "reason", "preapproved", "summary", "input_tokens", "output_tokens"],
  },
} as const satisfies Record<string, Schema>;

let counter = 0;
export function newRequestId(): string {
  counter = (counter + 1) % 1_000_000;
  const rand = Math.random().toString(36).slice(2, 8);
  return Date.now().toString(36) + "-" + counter.toString(36) + "-" + rand;
}

export function envelope<P>(type: string, payload: P, request_id = newRequestId()): Envelope<P> {
  return { type, request_id, payload };
}

export function errorEnvelope(request_id: string, error: BridgeErrorType, message: string): Envelope<ErrorPayload> {
  return { type: "error", request_id, payload: { error, message } };
}

/** Checks the outer shape. Returns the envelope, or the reason it is malformed. */
export function parseEnvelope(raw: unknown): { ok: true; env: Envelope } | { ok: false; why: string; request_id: string } {
  const r = (raw && typeof raw === "object" ? raw : null) as Record<string, unknown> | null;
  const request_id = r && typeof r.request_id === "string" ? r.request_id : "";
  if (!r) return { ok: false, why: "message must be an object", request_id };
  if (typeof r.type !== "string" || !r.type) return { ok: false, why: "type must be a non-empty string", request_id };
  if (!request_id) return { ok: false, why: "request_id must be a non-empty string", request_id };
  if (!("payload" in r)) return { ok: false, why: "payload is required", request_id };
  for (const k of Object.keys(r)) {
    if (k !== "type" && k !== "request_id" && k !== "payload") return { ok: false, why: k + " is not allowed", request_id };
  }
  return { ok: true, env: { type: r.type, request_id, payload: r.payload } };
}

// ---------- Worker side: request router ----------
export type Handler = (payload: never, sender: { kind: SenderKind; raw: MessageSender }) => Promise<unknown> | unknown;

/**
 * Builds the worker's runtime.onMessage handler. Returns null for a rejected
 * sender (no reply at all), an error envelope for anything malformed or
 * unknown, and `{ type: "<type>.result", request_id, payload }` on success.
 */
export function createRouter(handlers: Partial<Record<RequestType, Handler>>, self: () => Self) {
  return async (raw: unknown, sender: MessageSender | undefined): Promise<Envelope | null> => {
    const kind = classifySender(sender, self());
    if (!kind) return null;
    const parsed = parseEnvelope(raw);
    if (!parsed.ok) return errorEnvelope(parsed.request_id, "schema-error", parsed.why);
    const { env } = parsed;
    const spec = (REQUESTS as Record<string, RequestSpec>)[env.type];
    if (!spec) return errorEnvelope(env.request_id, "schema-error", "unknown message type " + env.type);
    if (!spec.senders.includes(kind)) return errorEnvelope(env.request_id, "schema-error", env.type + " is not accepted from a " + kind);
    const bad = checkSchema(spec.payload, env.payload);
    if (bad) return errorEnvelope(env.request_id, "schema-error", bad);
    const handler = handlers[env.type as RequestType];
    if (!handler) return errorEnvelope(env.request_id, "unhandled", "no handler for " + env.type);
    try {
      const out = await handler(env.payload as never, { kind, raw: sender ?? {} });
      return envelope(env.type + ".result", out ?? {}, env.request_id);
    } catch (err) {
      if (err instanceof BridgeError) return errorEnvelope(env.request_id, err.error, err.message);
      return errorEnvelope(env.request_id, "unhandled", err instanceof Error ? err.message : "handler failed");
    }
  };
}

// ---------- Panel side: one request, one answer ----------
export type SendFn = (message: unknown) => Promise<unknown>;

export async function request<R = unknown>(
  send: SendFn,
  type: RequestType,
  payload: unknown,
  opts: { timeoutMs?: number } = {},
): Promise<R> {
  const env = envelope(type, payload);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new BridgeError("timeout", type + " got no answer")), opts.timeoutMs ?? 5000);
  });
  try {
    const reply = await Promise.race([send(env), timeout]);
    const parsed = parseEnvelope(reply);
    if (!parsed.ok || parsed.env.request_id !== env.request_id) throw new BridgeError("unhandled", "bad reply to " + type);
    if (parsed.env.type === "error") {
      const p = parsed.env.payload as Partial<ErrorPayload>;
      const kind: BridgeErrorType =
        p.error === "timeout" || p.error === "blocked-by-user" || p.error === "schema-error" || p.error === "unsupported" ? p.error : "unhandled";
      throw new BridgeError(kind, typeof p.message === "string" ? p.message : type + " failed");
    }
    return parsed.env.payload as R;
  } finally {
    clearTimeout(timer);
  }
}
