// Scout task events (Part 3). The task runner in the background worker
// numbers every event per task; the panel applies them in order and ignores
// repeats, so a reopened panel resubscribes with the last number it has
// (as chat answers do in src/server/protocol.ts).
import type { Usage } from "../providers/types";
import type { SensitiveKind } from "./sensitive";

export type TaskState = "running" | "paused" | "waiting" | "done";

export type TaskStatus = "done" | "cannot" | "stopped" | "blocked" | "captcha" | "step_budget" | "token_budget" | "error";

export type StepStatus = "running" | "ok" | "failed" | "rejected" | "denied" | "skipped";

export type Decision = "once" | "always" | "deny";

export type TaskEvent =
  | { kind: "start"; goal: string; site: string }
  | { kind: "state"; state: TaskState }
  /** The model's note before a batch, when it wrote one. */
  | { kind: "plan"; text: string }
  /** One action, in plain language. Sent when it starts and again when it ends. */
  | { kind: "step"; index: number; text: string; status: StepStatus; detail?: string }
  /** A sensitive action waits for the user (spec 8.4). */
  | { kind: "confirm"; request_id: string; description: string; site: string; sensitive_kind: SensitiveKind }
  | { kind: "confirm_done"; request_id: string; decision: Decision }
  | { kind: "usage"; usage: Usage }
  | { kind: "done"; status: TaskStatus; message: string };

export interface NumberedTaskEvent {
  seq: number;
  event: TaskEvent;
}

export const TASK_STATUSES: readonly TaskStatus[] = ["done", "cannot", "stopped", "blocked", "captcha", "step_budget", "token_budget", "error"];
const STEP_STATUSES: readonly StepStatus[] = ["running", "ok", "failed", "rejected", "denied", "skipped"];
const STATES: readonly TaskState[] = ["running", "paused", "waiting", "done"];
const DECISIONS: readonly Decision[] = ["once", "always", "deny"];

/** Flat port payload for "task.event" (the bridge schema checks the fields). */
export function taskToWire(task_id: string, n: NumberedTaskEvent): Record<string, unknown> {
  const e = n.event;
  const base = { task_id, seq: n.seq, kind: e.kind };
  switch (e.kind) {
    case "start":
      return { ...base, goal: e.goal, site: e.site };
    case "state":
      return { ...base, state: e.state };
    case "plan":
      return { ...base, text: e.text };
    case "step":
      return { ...base, index: e.index, text: e.text, status: e.status, ...(e.detail ? { detail: e.detail } : {}) };
    case "confirm":
      return { ...base, request_id: e.request_id, description: e.description, site: e.site, sensitive_kind: e.sensitive_kind };
    case "confirm_done":
      return { ...base, request_id: e.request_id, decision: e.decision };
    case "usage":
      return { ...base, input_tokens: e.usage.inputTokens, output_tokens: e.usage.outputTokens, ...(e.usage.webSearches ? { web_searches: e.usage.webSearches } : {}) };
    case "done":
      return { ...base, status: e.status, message: e.message };
  }
}

/** Reads a "task.event" payload back; null when a kind's fields are missing. */
export function taskFromWire(p: Record<string, unknown>): { task_id: string; seq: number; event: TaskEvent } | null {
  const task_id = p.task_id as string;
  const seq = p.seq as number;
  const s = (k: string): string | undefined => (typeof p[k] === "string" ? (p[k] as string) : undefined);
  const n = (k: string): number => (typeof p[k] === "number" ? (p[k] as number) : 0);
  let event: TaskEvent | null = null;
  switch (p.kind) {
    case "start":
      event = s("goal") !== undefined ? { kind: "start", goal: s("goal")!, site: s("site") ?? "" } : null;
      break;
    case "state":
      event = STATES.includes(s("state") as TaskState) ? { kind: "state", state: s("state") as TaskState } : null;
      break;
    case "plan":
      event = s("text") !== undefined ? { kind: "plan", text: s("text")! } : null;
      break;
    case "step":
      event =
        s("text") !== undefined && STEP_STATUSES.includes(s("status") as StepStatus)
          ? { kind: "step", index: n("index"), text: s("text")!, status: s("status") as StepStatus, ...(s("detail") ? { detail: s("detail")! } : {}) }
          : null;
      break;
    case "confirm":
      event =
        s("request_id") && s("description") !== undefined
          ? { kind: "confirm", request_id: s("request_id")!, description: s("description")!, site: s("site") ?? "", sensitive_kind: (s("sensitive_kind") ?? "submit") as SensitiveKind }
          : null;
      break;
    case "confirm_done":
      event = s("request_id") && DECISIONS.includes(s("decision") as Decision) ? { kind: "confirm_done", request_id: s("request_id")!, decision: s("decision") as Decision } : null;
      break;
    case "usage":
      event = { kind: "usage", usage: { inputTokens: n("input_tokens"), outputTokens: n("output_tokens"), ...(n("web_searches") ? { webSearches: n("web_searches") } : {}) } };
      break;
    case "done":
      event = TASK_STATUSES.includes(s("status") as TaskStatus) ? { kind: "done", status: s("status") as TaskStatus, message: s("message") ?? "" } : null;
      break;
  }
  return event && Number.isInteger(seq) && seq > 0 && typeof task_id === "string" ? { task_id, seq, event } : null;
}

/** What the panel shows for a finished task. */
export function statusText(status: TaskStatus, message: string): string {
  switch (status) {
    case "done":
    case "cannot":
    case "error":
      return message;
    case "stopped":
      return "Stopped. Nothing more was done on the page.";
    case "blocked":
      return "Stopped: " + message;
    case "captcha":
      return "Stopped: the page asks for a CAPTCHA. Complete it yourself, then start the task again.";
    case "step_budget":
      return "Stopped after the step limit. Start a new task to continue.";
    case "token_budget":
      return "Stopped: the token budget for one task is used up.";
  }
}
