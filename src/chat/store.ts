// Conversation store (Part 2, spec 5): the panel's view of each answer, keyed
// by message id, with status pending -> streaming -> complete | error. Server
// events are applied in sequence order; an event the store has already seen is
// ignored, so a resumed stream never duplicates text.
import type { Usage } from "../providers/types";
import type { ServerEvent } from "../server/protocol";
import type { ToolStatus } from "../tools/registry";

export type MessageStatus = "pending" | "streaming" | "complete" | "error";

export interface ToolCall {
  request_id: string;
  name: string;
  input: unknown;
  /** Set once the server has the result. */
  status?: ToolStatus;
}

export interface StoredMessage {
  id: string;
  status: MessageStatus;
  text: string;
  /** Highest sequence number applied. */
  lastSeq: number;
  citations: Array<{ url: string; title?: string }>;
  tools: ToolCall[];
  usage?: Usage;
  stopped?: boolean;
  error?: { code: string; message: string };
}

export type ApplyResult = "applied" | "duplicate" | "gap" | "unknown";

export class ConversationStore {
  private readonly messages = new Map<string, StoredMessage>();

  create(id: string): StoredMessage {
    const m: StoredMessage = { id, status: "pending", text: "", lastSeq: 0, citations: [], tools: [] };
    this.messages.set(id, m);
    return m;
  }

  get(id: string): StoredMessage | undefined {
    return this.messages.get(id);
  }

  /** Messages still waiting for events, for resubscribing after a reconnect. */
  open(): StoredMessage[] {
    return [...this.messages.values()].filter((m) => m.status === "pending" || m.status === "streaming");
  }

  /** Tool requests the server is still waiting for. */
  pendingTools(id: string): ToolCall[] {
    return this.messages.get(id)?.tools.filter((t) => t.status === undefined) ?? [];
  }

  /**
   * Applies event `seq`. "duplicate": already applied (ignored). "gap": an
   * earlier event is missing, so nothing is applied and the caller
   * resubscribes from lastSeq.
   */
  apply(id: string, seq: number, event: ServerEvent): ApplyResult {
    const m = this.messages.get(id);
    if (!m) return "unknown";
    if (seq <= m.lastSeq) return "duplicate";
    if (seq !== m.lastSeq + 1) return "gap";
    m.lastSeq = seq;
    switch (event.kind) {
      case "start":
        if (m.status === "pending") m.status = "streaming";
        break;
      case "text":
        m.status = "streaming";
        m.text += event.delta;
        break;
      case "citation":
        if (!m.citations.some((c) => c.url === event.url)) m.citations.push({ url: event.url, ...(event.title ? { title: event.title } : {}) });
        break;
      case "tool_request":
        if (!m.tools.some((t) => t.request_id === event.request_id)) m.tools.push({ request_id: event.request_id, name: event.name, input: event.input });
        break;
      case "tool_done": {
        const t = m.tools.find((x) => x.request_id === event.request_id);
        if (t) t.status = event.status;
        break;
      }
      case "usage":
        m.usage = event.usage;
        break;
      case "done":
        m.status = "complete";
        // The server's full text wins: it is what was saved.
        m.text = event.text;
        if (event.stopped) m.stopped = true;
        break;
      case "error":
        m.status = "error";
        m.error = { code: event.code, message: event.message };
        break;
    }
    return "applied";
  }

  /** The worker lost this answer (it restarted): keep what arrived and mark it. */
  lose(id: string, message: string): void {
    const m = this.messages.get(id);
    if (!m || m.status === "complete" || m.status === "error") return;
    m.status = "error";
    m.error = { code: "lost", message };
  }

  /** The user stopped this answer and the worker is gone: end it as stopped, keeping what arrived. */
  stopLocally(id: string): void {
    const m = this.messages.get(id);
    if (!m || m.status === "complete" || m.status === "error") return;
    m.status = "complete";
    m.stopped = true;
  }

  clear(): void {
    this.messages.clear();
  }
}
