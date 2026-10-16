// Debug-build diagnostics. Records what each run did (stages, user-visible
// errors, outcome, tokens) so a failure can be pasted into a bug report as
// "Actual behavior". Local only: kept in extension storage, never sent
// anywhere, cleared by Delete all data. Release builds never create a
// recorder (see __ASSISTANT_DEBUG__ in scripts/build.mjs).
//
// Never recorded: API keys, page text, form values, typed agent input. The
// user's question is recorded only when they opt in.

import type { StorageArea } from "./settings/settings";

export type RunKind = "startup" | "ask" | "summarize" | "agent" | "coupons" | "settings";

export interface DiagEvent {
  /** Milliseconds since the run started. */
  t: number;
  stage: string;
}

export interface DiagRun {
  id: number;
  kind: RunKind;
  startedAt: number;
  provider?: string;
  model?: string;
  /** Hostname only, never the full URL. */
  pageHost?: string;
  question?: string;
  events: DiagEvent[];
  errors: string[];
  outcome?: { status: string; message: string };
  usage?: { inputTokens: number; outputTokens: number };
}

interface Stored {
  includeQuestion: boolean;
  nextId: number;
  runs: DiagRun[];
}

export const DIAG_KEY = "diagnostics";
export const MAX_RUNS = 5;
export const MAX_EVENTS = 200;
const MAX_TEXT = 300;

/** Removes anything that looks like a secret or personal identifier, then caps length. */
export function scrub(text: string): string {
  return text
    .replace(/\bsk-[A-Za-z0-9_-]{6,}/g, "[key]")
    .replace(/\b(Bearer|x-api-key:?)\s+\S+/gi, "$1 [key]")
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[email]")
    .replace(/https?:\/\/([^/\s?#]+)[^\s]*/g, "$1")
    .slice(0, MAX_TEXT);
}

export function hostOf(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).hostname || undefined;
  } catch {
    return undefined;
  }
}

export interface RunHandle {
  stage(name: string): void;
  error(userVisibleText: string): void;
  page(url: string | undefined): void;
  finish(status: string, message: string, usage?: { inputTokens: number; outputTokens: number }): void;
}

const NOOP: RunHandle = { stage() {}, error() {}, page() {}, finish() {} };

export class Diagnostics {
  private data: Stored = { includeQuestion: false, nextId: 1, runs: [] };

  constructor(
    private readonly store: StorageArea | undefined,
    private readonly now: () => number = () => Date.now(),
  ) {}

  async load(): Promise<void> {
    if (!this.store) return;
    try {
      const got = (await this.store.get(DIAG_KEY))[DIAG_KEY] as Partial<Stored> | undefined;
      if (got && Array.isArray(got.runs)) {
        this.data = {
          includeQuestion: got.includeQuestion === true,
          nextId: typeof got.nextId === "number" ? got.nextId : got.runs.length + 1,
          runs: got.runs.slice(-MAX_RUNS),
        };
      }
    } catch {
      // Diagnostics must never break the popup.
    }
  }

  get includeQuestion(): boolean {
    return this.data.includeQuestion;
  }

  async setIncludeQuestion(on: boolean): Promise<void> {
    this.data.includeQuestion = on;
    if (!on) for (const r of this.data.runs) delete r.question;
    await this.persist();
  }

  async clear(): Promise<void> {
    this.data.runs = [];
    await this.persist();
  }

  /** Drops everything in memory without writing (storage was just cleared). */
  forget(): void {
    this.data = { includeQuestion: false, nextId: 1, runs: [] };
  }

  get runs(): readonly DiagRun[] {
    return this.data.runs;
  }

  start(kind: RunKind, meta: { provider?: string; model?: string; question?: string } = {}): RunHandle {
    const startedAt = this.now();
    const run: DiagRun = { id: this.data.nextId++, kind, startedAt, events: [], errors: [] };
    if (meta.provider) run.provider = meta.provider;
    if (meta.model) run.model = meta.model;
    if (meta.question && this.data.includeQuestion) run.question = scrub(meta.question);
    this.data.runs.push(run);
    if (this.data.runs.length > MAX_RUNS) this.data.runs.splice(0, this.data.runs.length - MAX_RUNS);
    void this.persist();
    const save = (): void => void this.persist();
    return {
      stage: (name) => {
        if (run.events.length >= MAX_EVENTS) return;
        run.events.push({ t: this.now() - startedAt, stage: scrub(name) });
        save();
      },
      error: (text) => {
        run.errors.push(scrub(text));
        save();
      },
      page: (url) => {
        const h = hostOf(url);
        if (h) run.pageHost = h;
      },
      finish: (status, message, usage) => {
        run.outcome = { status: scrub(status), message: scrub(message) };
        if (usage) run.usage = { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens };
        save();
      },
    };
  }

  private async persist(): Promise<void> {
    if (!this.store) return;
    try {
      await this.store.set({ [DIAG_KEY]: this.data });
    } catch {
      // Ignore: diagnostics are best effort.
    }
  }
}

/** A recorder that does nothing; used by release builds. */
export const disabledRun = NOOP;

export interface ReportEnv {
  version: string;
  build: "debug" | "release";
  browser: string;
  tz?: string;
}

function clock(ms: number): string {
  const d = new Date(ms);
  const p = (n: number): string => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** Short browser description from the user agent, e.g. "Safari 27 on macOS". */
export function describeBrowser(ua: string): string {
  const os = /iPhone|iPad|iPod/.test(ua) ? "iOS" : /Mac OS X|Macintosh/.test(ua) ? "macOS" : "unknown OS";
  const v = /Version\/(\d+(?:\.\d+)?)/.exec(ua)?.[1];
  return (v ? "Safari " + v : "Safari (version unknown)") + " on " + os;
}

/** Markdown the user pastes as "Actual behavior". Most recent run in full, earlier runs summarised. */
export function buildReport(runs: readonly DiagRun[], env: ReportEnv): string {
  const lines: string[] = ["## AssistAnt diagnostics — Actual behavior", ""];
  const last = runs[runs.length - 1];
  if (!last) {
    lines.push("No runs recorded yet. Use AssistAnt, then copy diagnostics again.");
    return lines.join("\n");
  }
  lines.push(
    `- Run: ${last.kind} (#${last.id}) at ${clock(last.startedAt)}${env.tz ? " " + env.tz : ""}`,
    `- Build: AssistAnt ${env.version} (${env.build}) · ${env.browser}`,
    `- Provider: ${last.provider ?? "none"}${last.model ? " / " + last.model : ""}`,
    `- Page: ${last.pageHost ?? "not read"}`,
    `- Outcome: ${last.outcome ? `${last.outcome.status} — "${last.outcome.message}"` : "did not finish (popup closed or still running)"}`,
  );
  if (last.errors.length) lines.push(`- Errors shown: ${last.errors.map((e) => `"${e}"`).join("; ")}`);
  if (last.usage) lines.push(`- Tokens: ${last.usage.inputTokens} in, ${last.usage.outputTokens} out`);
  lines.push(
    `- Question: ${last.question !== undefined ? `"${last.question}"` : "not recorded (opt in under Diagnostics)"}`,
    "",
    "### Timeline",
    "```",
  );
  if (last.events.length === 0) lines.push("(no stages recorded)");
  for (const e of last.events) lines.push(`+${(e.t / 1000).toFixed(2)}s  ${e.stage}`);
  lines.push("```");
  const earlier = runs.slice(0, -1).reverse();
  if (earlier.length) {
    lines.push("", "### Earlier runs");
    for (const r of earlier) {
      lines.push(`- #${r.id} ${r.kind} at ${clock(r.startedAt)} → ${r.outcome ? r.outcome.status : "unfinished"}${r.errors.length ? ` (${r.errors.length} error)` : ""}`);
    }
  }
  lines.push("", "_Recorded locally by a debug build. No page text, keys, or form values are included._");
  return lines.join("\n");
}
