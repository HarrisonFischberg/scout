// Find coupons host, run by the background worker. One run per tab (src/coupons/job.ts).
// The run used to live in the panel, so swiping the iPhone panel away ended it
// mid-way and left the page glowing (owner report 2026-10-19). Here it keeps
// going with the panel closed: the overlay and pointer stay on the page, and
// a reopened panel gets every event so far (coupons.status) and the rest live
// on its port, including a question still waiting for an answer.
import { AgentControl } from "../agent/control";
import { BridgeError, envelope, type MessageSender } from "../bridge/messages";
import type { PortLike } from "../bridge/port";
import type { OverlayRequest } from "../content-api";
import type { BrowserTarget, PageBrowser } from "../coupons/browser-read";
import { runCouponJob, type CouponEvent } from "../coupons/job";
import type { CouponPage } from "../coupons/tab-page";
import type { Provider } from "../keychain";
import { ProviderError } from "../providers/errors";
import type { Effort, ProviderClient } from "../providers/types";

/** No answer to "search again?" within this time counts as Stop here. */
export const ASK_TIMEOUT_MS = 120_000;

export interface CouponHostDeps {
  provider(p: Provider, model: string): Promise<ProviderClient>;
  page(tabId: number, opts: { aboveSheet: boolean; trace: (stage: string) => void }): Promise<CouponPage>;
  /** Why the tab's site may not be used (blocked in Settings or by the organization), or null. */
  blocked?(tabId: number): Promise<string | null>;
  tabs(windowId: number | undefined): PageBrowser;
  allowBrowser(pages: BrowserTarget[], trace: (stage: string) => void): Promise<boolean>;
  storage?: { get(key: string): Promise<Record<string, unknown>>; set(items: Record<string, unknown>): Promise<void> };
  overlay(tabId: number, req: OverlayRequest): Promise<unknown>;
  save(entry: { at: number; conv: string; question: string; answer: string; site?: string }): Promise<void>;
  now(): number;
  /** How long a finished run stays available for coupons.status. Default 2 minutes. */
  keepMs?: number;
  askTimeoutMs?: number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (h: unknown) => void;
}

export const COUPON_QUESTION = "Find the best coupon for this cart.";

/** One event on the port: flat fields (see `flat`), numbered per run. */
export type CouponWire = Record<string, unknown> & { kind: CouponEvent["kind"]; seq: number };

export interface CouponRunView {
  tab_id: number;
  started_at: number;
  /** The chat the run belongs to, where its summary is saved. */
  conv: string;
  /** Host of the store (the chats menu). */
  site?: string;
  events: CouponWire[];
  /** The question still waiting for an answer, if any. */
  prompt_id?: string;
  done: boolean;
}

interface RunRecord extends CouponRunView {
  control: AgentControl;
  seq: number;
  pending?: { prompt_id: string; resolve: (more: boolean) => void };
  /** Settles once the run has ended and saved its summary. */
  finished?: Promise<void>;
}

let counter = 0;

export class CouponHost {
  private readonly runs = new Map<number, RunRecord>();
  private readonly watchers = new Map<number, Set<Pick<PortLike, "postMessage">>>();

  constructor(private readonly deps: CouponHostDeps) {}

  private timer(fn: () => void, ms: number): unknown {
    return (this.deps.setTimer ?? ((f, t) => setTimeout(f, t)))(fn, ms);
  }

  /** Ports that show a tab get its coupon events (after task.watch). */
  watch(port: Pick<PortLike, "postMessage">, tabId: number): () => void {
    let set = this.watchers.get(tabId);
    if (!set) this.watchers.set(tabId, (set = new Set()));
    set.add(port);
    return () => {
      set!.delete(port);
      if (set!.size === 0) this.watchers.delete(tabId);
    };
  }

  /** The run on a tab, running or recently finished, with every event so far. */
  status(tabId: number): { run?: CouponRunView } {
    const r = this.runs.get(tabId);
    if (!r) return {};
    return { run: { tab_id: r.tab_id, started_at: r.started_at, conv: r.conv, ...(r.site ? { site: r.site } : {}), events: [...r.events], done: r.done, ...(r.pending ? { prompt_id: r.pending.prompt_id } : {}) } };
  }

  /** Every run kept (running or recently finished), without events: the chats menu. */
  list(): { runs: Array<Omit<CouponRunView, "events">> } {
    return {
      runs: [...this.runs.values()].map((r) => ({
        tab_id: r.tab_id,
        started_at: r.started_at,
        conv: r.conv,
        ...(r.site ? { site: r.site } : {}),
        done: r.done,
        ...(r.pending ? { prompt_id: r.pending.prompt_id } : {}),
      })),
    };
  }

  running(tabId: number): boolean {
    const r = this.runs.get(tabId);
    return !!r && !r.done;
  }

  private emit(r: RunRecord, e: CouponEvent): void {
    const wire: CouponWire = { ...flat(e), kind: e.kind, seq: ++r.seq, ...(e.kind === "trace" ? { at_ms: this.deps.now() - r.started_at } : {}) };
    // A reopened panel replays diagnostics stages too, with their time in the
    // run, so a report sent after closing the panel still shows where each code
    // came from (owner report 2026-10-19 began at attempt 26). Page URLs are not kept.
    if (e.kind !== "page") r.events.push(wire);
    const payload = { tab_id: r.tab_id, ...wire };
    for (const port of [...(this.watchers.get(r.tab_id) ?? [])]) {
      try {
        port.postMessage(envelope("coupons.event", payload));
      } catch {
        this.watchers.get(r.tab_id)?.delete(port);
      }
    }
  }

  /** Starts a run on a tab. The panel has already checked consent and the key. */
  async start(p: { tab_id: number; window_id?: number; provider: Provider; model: string; effort?: Effort; conv?: string; phone?: boolean; site?: string }): Promise<{ started_at: number }> {
    if (this.running(p.tab_id)) throw new BridgeError("blocked-by-user", "Scout is already finding coupons on this tab.");
    // Blocked sites are never read or acted on, the same rule as Scout mode (src/permissions/gate.ts).
    const blocked = await this.deps.blocked?.(p.tab_id);
    if (blocked) throw new BridgeError("blocked-by-user", blocked);
    const control = new AgentControl();
    const r: RunRecord = { tab_id: p.tab_id, started_at: this.deps.now(), conv: p.conv ?? "", ...(p.site ? { site: p.site } : {}), events: [], done: false, control, seq: 0 };
    this.runs.set(p.tab_id, r);
    const trace = (stage: string): void => this.emit(r, { kind: "trace", stage });
    let client: ProviderClient;
    let page: CouponPage;
    try {
      client = await this.deps.provider(p.provider, p.model);
      page = await this.deps.page(p.tab_id, { aboveSheet: p.phone === true, trace });
    } catch (err) {
      // Diagnostics say why (owner report 2026-10-26: "Could not reach this page" with no stages).
      trace("coupons:start-failed " + failReason(err));
      this.runs.delete(p.tab_id);
      if (err instanceof BridgeError) throw err;
      // No permission, no key: say so, not "could not reach" (owner report 2026-10-27).
      if (err instanceof ProviderError) throw new BridgeError("unhandled", err.userMessage);
      throw new BridgeError("unhandled", "Could not reach this page. Reload it and try again.");
    }
    const overlay = (req: OverlayRequest): void => {
      void this.deps.overlay(p.tab_id, req).catch(() => trace("coupons:overlay-failed"));
    };
    overlay({ type: "overlay:show", taskId: "coupons:" + p.tab_id, state: "running" });
    r.finished = runCouponJob({
      page,
      provider: client,
      model: p.model,
      ...(p.effort ? { effort: p.effort } : {}),
      control,
      tabs: this.deps.tabs(p.window_id),
      allowBrowser: (pages) => this.deps.allowBrowser(pages, trace),
      ...(this.deps.storage ? { storage: this.deps.storage } : {}),
      askMore: (state, signal) => {
        overlay({ type: "overlay:state", state: "waiting" });
        return this.ask(r, state.tried, signal).then((more) => {
          overlay({ type: "overlay:state", state: "running" });
          return more;
        });
      },
      emit: (e) => this.emit(r, e),
    })
      .then(async (done) => {
        r.done = true;
        overlay({ type: "overlay:hide" });
        await this.deps.save({ at: this.deps.now(), conv: p.conv ?? "", question: COUPON_QUESTION, answer: done.summary, ...(p.site ? { site: p.site } : {}) }).catch(() => undefined);
      })
      .finally(() => {
        r.done = true;
        this.timer(() => {
          if (this.runs.get(p.tab_id) === r) this.runs.delete(p.tab_id);
        }, this.deps.keepMs ?? 120_000);
      });
    return { started_at: r.started_at };
  }

  private ask(r: RunRecord, tried: number, signal: AbortSignal): Promise<boolean> {
    const prompt_id = "more-" + (++counter).toString(36);
    return new Promise((resolve) => {
      let timeout: unknown;
      const done = (more: boolean): void => {
        if (r.pending?.prompt_id !== prompt_id) return;
        r.pending = undefined;
        signal.removeEventListener("abort", no);
        (this.deps.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>)))(timeout);
        this.emit(r, { kind: "trace", stage: "coupons:more " + (more ? "yes" : "no") });
        this.emit(r, { kind: "answered", prompt_id });
        resolve(more);
      };
      const no = (): void => done(false);
      r.pending = { prompt_id, resolve: done };
      this.emit(r, { kind: "trace", stage: "coupons:ask-more tried=" + tried });
      this.emit(r, { kind: "ask", prompt_id, tried });
      if (signal.aborted) return done(false);
      signal.addEventListener("abort", no, { once: true });
      timeout = this.timer(no, this.deps.askTimeoutMs ?? ASK_TIMEOUT_MS);
    });
  }

  /** The panel's answer to "search again?". */
  answer(p: { tab_id: number; prompt_id: string; more: boolean }): { accepted: boolean } {
    const r = this.runs.get(p.tab_id);
    if (!r?.pending || r.pending.prompt_id !== p.prompt_id) return { accepted: false };
    r.pending.resolve(p.more);
    return { accepted: true };
  }

  /**
   * Stop, from the panel or from the overlay toast in the run's own tab. The
   * overlay goes at once, before the run winds down.
   */
  stop(tabId: number, sender?: { kind: "panel" | "content"; raw: MessageSender }): { ok: boolean } {
    if (sender?.kind === "content" && sender.raw.tab?.id !== tabId) throw new BridgeError("schema-error", "not this tab's run");
    const r = this.runs.get(tabId);
    if (!r || r.done) return { ok: false };
    this.emit(r, { kind: "trace", stage: "ui:stop-click coupons" });
    r.control.stop();
    void this.deps.overlay(tabId, { type: "overlay:hide" }).catch(() => undefined);
    return { ok: true };
  }

  /** Delete all data: ends every run and waits until each has saved, so nothing is written after the wipe. */
  async stopAll(): Promise<void> {
    const runs = [...this.runs.values()];
    for (const r of runs) if (!r.done) this.stop(r.tab_id);
    // A run marked done may still be saving its summary, so every one is waited on.
    await Promise.all(runs.map((r) => r.finished));
  }

  /** A closed tab ends its run. */
  stopForTab(tabId: number): void {
    this.runs.get(tabId)?.control.stop();
  }
}

/** One event as flat port fields: the attempt row and usage are nested objects. */
function flat(w: CouponEvent): Record<string, unknown> {
  if (w.kind === "done") {
    const { usage, ...rest } = w;
    return { ...rest, input_tokens: usage.inputTokens, output_tokens: usage.outputTokens, ...(usage.webSearches ? { web_searches: usage.webSearches } : {}) };
  }
  return { ...w };
}

/** A short reason for diagnostics: the error's kind and words, with no page address. */
export function failReason(err: unknown): string {
  const kind = err instanceof BridgeError ? err.error : err instanceof Error ? err.name : typeof err;
  const words = err instanceof Error ? err.message : String(err ?? "");
  const clean = words.replace(/\b[a-z][a-z0-9+.-]*:\/\/\S*/gi, "<url>").replace(/\s+/g, " ").trim().slice(0, 100);
  return clean ? kind + ": " + clean : kind;
}
