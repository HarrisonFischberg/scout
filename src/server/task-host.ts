// Scout mode host (Part 3, spec 8 and 10), run by the background worker. One
// task per tab. It starts the runner (src/agent/task.ts) after the gate
// agrees (Scout mode not off, site not blocked), keeps
// its action log and any pending confirmation so a reopened panel catches up,
// relays Stop from the panel or the overlay's pill,
// and saves the outcome to the conversation. The runner's page calls go
// through the content scripts of that tab; nothing here touches page text.
import { runTask, type ConfirmDecision, type ConfirmRequest, type OverlayCommand, type OverlayState, type TaskEvent, type TaskLogStatus, type TaskStatus } from "../agent/task";
import { AgentControl } from "../agent/control";
import { BridgeError, envelope, type MessageSender } from "../bridge/messages";
import type { PortLike } from "../bridge/port";
import type { ContentRequest, OverlayRequest } from "../content-api";
import type { TabRef } from "../context/gather";
import type { Provider } from "../keychain";
import { ASK_EVERY_TIME, hostOf, savePageAccess, taskDecision, withAlwaysAllow, type PageAccess } from "../permissions/gate";
import type { Effort, ProviderClient, Usage } from "../providers/types";
import type { SensitiveKind } from "../safety/classifier";
import type { StorageArea } from "../settings/settings";
import type { SizedImage } from "../tools/image";
import type { ToolLog } from "../tools/log";

/** No answer to a confirmation within this time counts as Deny. */
export const CONFIRM_TIMEOUT_MS = 120_000;

export interface TaskHostDeps {
  storage: StorageArea | undefined;
  tab(id: number): Promise<TabRef | null>;
  /** Injects the content script if needed and calls its handler. */
  content(tabId: number, req: ContentRequest): Promise<unknown>;
  /** Injects the overlay script if needed and calls its handler. */
  overlay(tabId: number, req: OverlayRequest): Promise<unknown>;
  capture(tab: TabRef): Promise<SizedImage>;
  /** Sets the tab's address (tabs.update) and resolves once it has loaded or a time limit passed. */
  navigate(tabId: number, url: string): Promise<void>;
  access(): Promise<PageAccess>;
  admin(): Promise<readonly string[]>;
  provider(p: Provider, model: string): Promise<ProviderClient>;
  settings(): Promise<{ provider: Provider; model: string; effort?: Effort }>;
  log: Pick<ToolLog, "add">;
  /** Toolbar icon for one tab: the filled-lens variant while its task runs. */
  setIcon(tabId: number, active: boolean): Promise<void>;
  /** Brings the panel up when a confirmation waits and no panel is open (best effort). */
  openPanel(): Promise<void>;
  save(entry: { at: number; conv: string; question: string; answer: string }): Promise<void>;
  now(): number;
  /** How long a finished task stays available for task.status. Default 2 minutes. */
  keepMs?: number;
  /** How long a confirmation waits for an answer before it counts as Deny. Default 2 minutes. */
  confirmTimeoutMs?: number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (h: unknown) => void;
}

export interface PendingPrompt {
  prompt_id: string;
  what: string;
  site: string;
  reason: string;
  preapproved: boolean;
  /** "Always allow on this site" may be offered (never for payments). */
  always: boolean;
}

export interface TaskView {
  task_id: string;
  tab_id: number;
  goal: string;
  source: "panel" | "chat";
  state: OverlayState;
  log: Array<{ text: string; status: TaskLogStatus }>;
  prompt?: PendingPrompt;
  done?: { status: TaskStatus; summary: string; usage: Usage };
}

interface TaskRecord extends TaskView {
  control: AgentControl;
  seq: number;
  pending?: { prompt: PendingPrompt; resolve: (d: ConfirmDecision) => void };
  finished: Promise<{ status: TaskStatus; summary: string; usage: Usage }>;
}

export type TaskWire = Record<string, unknown>;

let counter = 0;

export class TaskHost {
  private readonly tasks = new Map<string, TaskRecord>();
  private readonly watchers = new Map<number, Set<Pick<PortLike, "postMessage">>>();

  constructor(private readonly deps: TaskHostDeps) {}

  private set(fn: () => void, ms: number): unknown {
    return (this.deps.setTimer ?? ((f, t) => setTimeout(f, t)))(fn, ms);
  }

  /** The running task on a tab, if any. */
  running(tabId: number): TaskRecord | undefined {
    for (const t of this.tasks.values()) if (t.tab_id === tabId && !t.done) return t;
    return undefined;
  }

  /** Whether this task is still going on this tab (src/bridge/run-port.ts). */
  alive(taskId: string, tabId: number): boolean {
    const t = this.tasks.get(taskId);
    return !!t && !t.done && t.tab_id === tabId;
  }

  /** A reopened panel: the task on this tab, running or recently finished. */
  status(tabId: number): { task?: TaskView } {
    let best: TaskRecord | undefined;
    for (const t of this.tasks.values()) if (t.tab_id === tabId && (!best || !t.done)) best = t;
    if (!best) return {};
    const { control: _c, seq: _s, pending: _p, finished: _f, ...view } = best;
    return { task: view };
  }

  /** Ports that show a tab get its task events (after task.watch). */
  watch(port: Pick<PortLike, "postMessage">, tabId: number): () => void {
    let set = this.watchers.get(tabId);
    if (!set) this.watchers.set(tabId, (set = new Set()));
    set.add(port);
    return () => {
      set!.delete(port);
      if (set!.size === 0) this.watchers.delete(tabId);
    };
  }

  private emit(task: TaskRecord, event: TaskWire): void {
    task.seq++;
    const payload = { task_id: task.task_id, tab_id: task.tab_id, seq: task.seq, ...event };
    for (const port of [...(this.watchers.get(task.tab_id) ?? [])]) {
      try {
        port.postMessage(envelope("task.event", payload));
      } catch {
        this.watchers.get(task.tab_id)?.delete(port);
      }
    }
  }

  /** Starts a task on a tab. Throws BridgeError when the gate refuses. */
  async start(p: { tab_id: number; goal: string; conv?: string; source?: "panel" | "chat" }): Promise<{ task_id: string }> {
    const goal = p.goal.trim();
    if (!goal) throw new BridgeError("schema-error", "goal is empty");
    if (this.running(p.tab_id)) throw new BridgeError("blocked-by-user", "A task is already running on this tab. Stop it first.");
    const tab = await this.deps.tab(p.tab_id);
    if (!tab || !tab.url) throw new BridgeError("unhandled", "That tab is not open.");
    if (!hostOf(tab.url)) throw new BridgeError("blocked-by-user", "Scout mode works on web pages only (http and https).");
    const access = await this.deps.access();
    const admin = await this.deps.admin();
    const decision = taskDecision(tab.url, access, admin);
    if (decision === "off") throw new BridgeError("blocked-by-user", "Scout mode is turned off in Settings > Permissions.");
    if (decision === "blocked-admin") throw new BridgeError("blocked-by-user", "Your organization blocks " + hostOf(tab.url) + ".");
    if (decision === "blocked-user") throw new BridgeError("blocked-by-user", hostOf(tab.url) + " is blocked in Settings, so Scout cannot act on it.");
    const settings = await this.deps.settings();
    // Fails here (no consent, no key) before anything is shown on the page.
    const provider = await this.deps.provider(settings.provider, settings.model);

    counter = (counter + 1) % 1_000_000;
    const task_id = "t" + this.deps.now().toString(36) + "-" + counter.toString(36);
    const control = new AgentControl();
    const tabId = p.tab_id;
    let resolveFinished: (o: { status: TaskStatus; summary: string; usage: Usage }) => void = () => undefined;
    const record: TaskRecord = {
      task_id,
      tab_id: tabId,
      goal,
      source: p.source ?? "panel",
      state: "running",
      log: [],
      control,
      seq: 0,
      finished: new Promise((r) => (resolveFinished = r)),
    };
    this.tasks.set(task_id, record);
    this.emit(record, { kind: "started", goal });

    const deps = this.deps;
    const overlayReq = (cmd: OverlayCommand): OverlayRequest => {
      switch (cmd.type) {
        case "show":
          return { type: "overlay:show", taskId: task_id, state: cmd.state };
        case "state":
          return { type: "overlay:state", state: cmd.state };
        case "marker":
          return { type: "overlay:marker", x: cmd.x, y: cmd.y };
        case "hide":
          return { type: "overlay:hide" };
      }
    };
    const onEvent = (e: TaskEvent): void => {
      if (e.kind === "state") {
        record.state = e.state;
        this.emit(record, { kind: "state", state: e.state });
      } else if (e.kind === "log") {
        record.log.push({ text: e.text, status: e.status });
        this.emit(record, { kind: "log", text: e.text, status: e.status });
      } else {
        record.done = { status: e.status, summary: e.summary, usage: e.usage };
        record.state = "running";
        this.emit(record, { kind: "done", status: e.status, summary: e.summary, input_tokens: e.usage.inputTokens, output_tokens: e.usage.outputTokens });
      }
    };
    const confirm = (req: ConfirmRequest): Promise<ConfirmDecision> =>
      new Promise((resolveDecision) => {
        const prompt: PendingPrompt = { prompt_id: task_id + "." + (record.log.length + 1), what: req.what, site: req.site, reason: req.reason, preapproved: req.preapproved, always: !ASK_EVERY_TIME.includes(req.kind) };
        // Unanswered for two minutes (panel closed, user away): denied, so the task cannot hang.
        const timer = this.set(() => {
          if (record.pending?.prompt === prompt) this.decide({ task_id, prompt_id: prompt.prompt_id, decision: "deny" });
        }, deps.confirmTimeoutMs ?? CONFIRM_TIMEOUT_MS);
        const resolve = (d: ConfirmDecision): void => {
          (deps.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>)))(timer);
          resolveDecision(d);
        };
        record.pending = { prompt, resolve };
        record.prompt = prompt;
        this.emit(record, { kind: "confirm", prompt_id: prompt.prompt_id, what: prompt.what, site: prompt.site, reason: prompt.reason, preapproved: prompt.preapproved, always: prompt.always });
        // Safari closes the popover when the user clicks the page; bring it back for the question.
        if (!this.watchers.get(tabId)?.size) void deps.openPanel().catch(() => undefined);
      });

    void runTask({
      provider,
      model: settings.model,
      ...(settings.effort ? { effort: settings.effort } : {}),
      goal,
      source: record.source,
      control,
      page: {
        snapshot: async () => (await deps.content(tabId, { type: "scout:snapshot" })) as never,
        probe: async (target) => (await deps.content(tabId, { type: "scout:task-probe", target })) as never,
        act: async (action) => (await deps.content(tabId, { type: "scout:task-act", action })) as never,
        overlay: async (cmd) => void (await deps.overlay(tabId, overlayReq(cmd))),
        screenshot: async () => {
          const now = await deps.tab(tabId);
          if (!now || now.active === false) return null;
          const img = await deps.capture(now);
          return img.width && img.height ? { image: { mediaType: img.mediaType, data: img.data }, width: img.width, height: img.height } : null;
        },
        url: async () => (await deps.tab(tabId))?.url ?? "",
        navigate: (url) => deps.navigate(tabId, url),
      },
      access: deps.access,
      admin: deps.admin,
      saveAlwaysAllow: async (host: string, kind: SensitiveKind) => {
        if (!deps.storage) return;
        await savePageAccess(deps.storage, withAlwaysAllow(await deps.access(), host, kind));
      },
      confirm,
      onEvent,
      log: (e) => deps.log.add({ at: deps.now(), ...e }),
      setIcon: (active) => deps.setIcon(tabId, active),
      now: deps.now,
      ...(deps.setTimer ? { setTimer: deps.setTimer } : {}),
      ...(deps.clearTimer ? { clearTimer: deps.clearTimer } : {}),
    })
      .catch((): { status: TaskStatus; summary: string; usage: Usage } => {
        const out = { status: "error" as const, summary: "The task stopped because of an unexpected error. Nothing more was done on the page.", usage: { inputTokens: 0, outputTokens: 0 } };
        onEvent({ kind: "done", ...out });
        void deps.overlay(tabId, { type: "overlay:hide" }).catch(() => undefined);
        void deps.setIcon(tabId, false).catch(() => undefined);
        return out;
      })
      .then(async (out) => {
        record.pending = undefined;
        record.prompt = undefined;
        this.set(() => this.tasks.delete(task_id), deps.keepMs ?? 120_000);
        if (p.conv && record.source === "panel") {
          await deps.save({ at: deps.now(), conv: p.conv, question: goal, answer: out.summary }).catch(() => undefined);
        }
        // After the save, so stopAll knows nothing more is written.
        resolveFinished(out);
      });
    return { task_id };
  }

  /** Resolves with the outcome (the chat's run_task tool waits on it). */
  outcome(task_id: string): Promise<{ status: TaskStatus; summary: string; usage: Usage }> | null {
    return this.tasks.get(task_id)?.finished ?? null;
  }

  /**
   * Stop. From the overlay (a content sender), only
   * the task's own tab may control it. Stop hides the overlay at once, before
   * the runner winds down, and answers any open confirmation with deny.
   */
  async control(p: { task_id: string; command: "stop" }, sender?: { kind: "panel" | "content"; raw: MessageSender }): Promise<{ ok: boolean }> {
    const task = this.tasks.get(p.task_id);
    if (!task || task.done) return { ok: false };
    if (sender?.kind === "content" && sender.raw.tab?.id !== task.tab_id) throw new BridgeError("schema-error", "not this tab's task");
    task.control.stop();
    task.pending?.resolve("deny");
    task.pending = undefined;
    task.prompt = undefined;
    void this.deps.overlay(task.tab_id, { type: "overlay:hide" }).catch(() => undefined);
    return { ok: true };
  }

  decide(p: { task_id: string; prompt_id: string; decision: ConfirmDecision }): { accepted: boolean } {
    const task = this.tasks.get(p.task_id);
    if (!task?.pending || task.pending.prompt.prompt_id !== p.prompt_id) return { accepted: false };
    const { resolve } = task.pending;
    task.pending = undefined;
    task.prompt = undefined;
    resolve(p.decision);
    return { accepted: true };
  }

  /** Delete all data: ends every task and waits until each has saved, so nothing is written after the wipe. */
  async stopAll(): Promise<void> {
    const all = [...this.tasks.values()];
    for (const t of all) if (!t.done) void this.control({ task_id: t.task_id, command: "stop" });
    // A task marked done may still be saving its summary, so every one is waited on.
    await Promise.all(all.map((t) => t.finished));
  }

  /** The tab closed: end its task. */
  stopForTab(tabId: number): void {
    for (const t of this.tasks.values()) if (t.tab_id === tabId && !t.done) void this.control({ task_id: t.task_id, command: "stop" });
  }
}
