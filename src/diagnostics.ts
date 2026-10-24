// Debug-build diagnostics. Records what each run did (stages, user-visible
// errors, outcome, tokens) so a failure can be pasted into a bug report as
// "Actual behavior". Local only: kept in extension storage, never sent
// anywhere, cleared by Delete all data. Release builds never create a
// recorder (see __SCOUT_DEBUG__ in scripts/build.mjs).
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
  /** Debug builds: the local mock server answered instead of the provider. */
  mock?: boolean;
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
// Enough to cover a whole session of use, so a bug noticed a few runs later
// is still in the log (owner request 2026-10-24: "much more robust").
export const MAX_RUNS = 15;
// A coupon run with two searches and 80 tested codes writes about 250 stages.
export const MAX_EVENTS = 400;
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

  start(kind: RunKind, meta: { provider?: string; model?: string; question?: string; mock?: boolean } = {}): RunHandle {
    const startedAt = this.now();
    const run: DiagRun = { id: this.data.nextId++, kind, startedAt, events: [], errors: [] };
    if (meta.provider) run.provider = meta.provider;
    if (meta.model) run.model = meta.model;
    if (meta.mock) run.mock = true;
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

// ---------- Page button failures ----------
// The page button (src/edge.ts) asks the worker to open the panel. When Safari
// refuses, no panel opens, so no run is recorded; the worker keeps the reason
// here instead (debug builds only) and the next report lists it.

export const BUTTON_KEY = "diagnosticsButton";
export const MAX_BUTTON_FAILURES = 5;

export interface ButtonFailure {
  at: number;
  /** Safari's error text, scrubbed. */
  reason: string;
  tries: number;
}

export function parseButtonFailures(raw: unknown): ButtonFailure[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((f): f is ButtonFailure => !!f && typeof f === "object" && typeof f.at === "number" && typeof f.reason === "string" && typeof f.tries === "number")
    .slice(-MAX_BUTTON_FAILURES);
}

export async function loadButtonFailures(store: StorageArea | undefined): Promise<ButtonFailure[]> {
  if (!store) return [];
  try {
    return parseButtonFailures((await store.get(BUTTON_KEY))[BUTTON_KEY]);
  } catch {
    return [];
  }
}

export async function recordButtonFailure(store: StorageArea | undefined, failure: ButtonFailure): Promise<void> {
  if (!store) return;
  try {
    const list = await loadButtonFailures(store);
    list.push({ at: failure.at, reason: scrub(failure.reason), tries: failure.tries });
    await store.set({ [BUTTON_KEY]: list.slice(-MAX_BUTTON_FAILURES) });
  } catch {
    // Best effort.
  }
}

// ---------- Unexpected errors ----------
// Uncaught exceptions and unhandled promise rejections in the panel and the
// worker (debug builds only). Nothing else would show them: they never reach
// the chat as an error message.

export const CRASH_KEY = "diagnosticsCrashes";
export const MAX_CRASHES = 20;

export interface Crash {
  at: number;
  where: "panel" | "worker";
  /** Error name, message and the first bundle frames, scrubbed. */
  message: string;
  /** The same error again right after: counted, not stored twice. */
  count: number;
}

export function parseCrashes(raw: unknown): Crash[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((c): c is Crash => !!c && typeof c === "object" && typeof c.at === "number" && typeof c.message === "string" && (c.where === "panel" || c.where === "worker"))
    .map((c) => ({ at: c.at, where: c.where, message: c.message, count: typeof c.count === "number" ? c.count : 1 }))
    .slice(-MAX_CRASHES);
}

export async function loadCrashes(store: StorageArea | undefined): Promise<Crash[]> {
  if (!store) return [];
  try {
    return parseCrashes((await store.get(CRASH_KEY))[CRASH_KEY]);
  } catch {
    return [];
  }
}

/** "TypeError: x is undefined at popup.js:12:5": file names only, never a full path or page address. */
export function describeCrash(error: unknown, file?: string, line?: number): string {
  let text: string;
  let stack = "";
  if (error instanceof Error) {
    text = error.name + ": " + error.message;
    stack = error.stack ?? "";
  } else text = typeof error === "string" ? error : (() => {
    try {
      return JSON.stringify(error) ?? String(error);
    } catch {
      return String(error);
    }
  })();
  const frames = [...stack.matchAll(/([\w.-]+\.js):(\d+)(?::\d+)?/g)].slice(0, 3).map((m) => m[1] + ":" + m[2]);
  if (!frames.length && file) frames.push((file.split("/").pop() ?? file) + (line ? ":" + line : ""));
  return scrub(text + (frames.length ? " at " + frames.join(" < ") : ""));
}

export async function recordCrash(store: StorageArea | undefined, crash: Omit<Crash, "count">): Promise<void> {
  if (!store) return;
  try {
    const list = await loadCrashes(store);
    const last = list[list.length - 1];
    const message = scrub(crash.message);
    if (last && last.where === crash.where && last.message === message) {
      last.count++;
      last.at = crash.at;
    } else list.push({ at: crash.at, where: crash.where, message, count: 1 });
    await store.set({ [CRASH_KEY]: list.slice(-MAX_CRASHES) });
  } catch {
    // Best effort; never throw from an error handler.
  }
}

interface ErrorTarget {
  addEventListener(type: "error" | "unhandledrejection", listener: (e: Event) => void): void;
}

/** Records uncaught errors from `target` (a window or the worker's global). */
export function watchCrashes(target: ErrorTarget, store: StorageArea | undefined, where: Crash["where"], now: () => number = () => Date.now()): void {
  target.addEventListener("error", (e) => {
    const ev = e as ErrorEvent;
    void recordCrash(store, { at: now(), where, message: describeCrash(ev.error ?? ev.message, ev.filename, ev.lineno) });
  });
  target.addEventListener("unhandledrejection", (e) => {
    void recordCrash(store, { at: now(), where, message: "Unhandled rejection: " + describeCrash((e as PromiseRejectionEvent).reason) });
  });
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
  const os = /iPhone|iPad|iPod/.test(ua)
    ? "iOS"
    : /Mac OS X|Macintosh/.test(ua)
      ? "macOS"
      : /Windows/.test(ua)
        ? "Windows"
        : /Linux|X11/.test(ua)
          ? "Linux"
          : "unknown OS";
  // Chrome and Firefox also say "Safari" in their user agent, so check them first.
  const firefox = /Firefox\/(\d+(?:\.\d+)?)/.exec(ua)?.[1];
  if (firefox) return "Firefox " + firefox + " on " + os;
  const chrome = /Chrome\/(\d+)/.exec(ua)?.[1];
  if (chrome) return "Chrome " + chrome + " on " + os;
  const v = /Version\/(\d+(?:\.\d+)?)/.exec(ua)?.[1];
  return (v ? "Safari " + v : "Safari (version unknown)") + " on " + os;
}

/** A panel opening that went fine: nothing to report on its own. */
const quietStartup = (r: DiagRun): boolean => r.kind === "startup" && r.outcome?.status === "ready" && r.errors.length === 0;

/**
 * The run a report shows in full: the most recent one that is not a quiet
 * panel opening. Opening the panel to copy the report starts a run of its
 * own, which used to push the coupon run out of view (owner report
 * 2026-10-19, run #227). Falls back to the most recent run.
 */
export function reportedRun(runs: readonly DiagRun[]): DiagRun | undefined {
  for (let i = runs.length - 1; i >= 0; i--) if (!quietStartup(runs[i]!)) return runs[i];
  return runs[runs.length - 1];
}

/** Markdown the user pastes as "Actual behavior". The reported run (see `reportedRun`) in full, the others summarised. */
export interface ReportExtras {
  /** "Name: value" lines describing the setup (surface, input, provider, keys saved yes/no). Never secrets. */
  setup?: readonly string[];
  crashes?: readonly Crash[];
}

const timeline = (lines: string[], events: readonly DiagEvent[]): void => {
  lines.push("```");
  if (events.length === 0) lines.push("(no stages recorded)");
  for (const e of events) lines.push(`+${(e.t / 1000).toFixed(2)}s  ${e.stage}`);
  lines.push("```");
};

/**
 * Markdown the user pastes as "Actual behavior": the reported run (see
 * `reportedRun`) in full, then every other run with its own timeline,
 * unexpected errors, page button failures, and the setup.
 */
export function buildReport(runs: readonly DiagRun[], env: ReportEnv, buttonFailures: readonly ButtonFailure[] = [], extras: ReportExtras = {}): string {
  const lines: string[] = ["## Scout AI Assistant diagnostics — Actual behavior", ""];
  const last = reportedRun(runs);
  const tail = (): void => {
    if (extras.crashes?.length) {
      lines.push("", "### Unexpected errors");
      for (const c of [...extras.crashes].reverse()) {
        lines.push(`- ${clock(c.at)} ${c.where}${c.count > 1 ? ` (×${c.count})` : ""}: ${c.message}`);
      }
    }
    if (buttonFailures.length) {
      lines.push("", "### Page button could not open Scout");
      for (const f of [...buttonFailures].reverse()) {
        lines.push(`- ${clock(f.at)} after ${f.tries} ${f.tries === 1 ? "try" : "tries"}: "${f.reason}"`);
      }
    }
    lines.push("", "### Setup", `- Build: Scout AI Assistant ${env.version} (${env.build}) · ${env.browser}${env.tz ? " · " + env.tz : ""}`);
    for (const l of extras.setup ?? []) lines.push(`- ${scrub(l)}`);
  };
  if (!last) {
    lines.push("No runs recorded yet. Use Scout, then copy diagnostics again.");
    tail();
    return lines.join("\n");
  }
  lines.push(
    `- Run: ${last.kind} (#${last.id}) at ${clock(last.startedAt)}${env.tz ? " " + env.tz : ""}`,
    `- Build: Scout AI Assistant ${env.version} (${env.build}) · ${env.browser}`,
    `- Provider: ${last.provider ?? "none"}${last.model ? " / " + last.model : ""}${last.mock ? " · local mock server" : ""}`,
    `- Page: ${last.pageHost ?? "not read"}`,
    `- Outcome: ${last.outcome ? `${last.outcome.status} — "${last.outcome.message}"` : "did not finish (popup closed or still running)"}`,
  );
  if (last.errors.length) lines.push(`- Errors shown: ${last.errors.map((e) => `"${e}"`).join("; ")}`);
  if (last.usage) lines.push(`- Tokens: ${last.usage.inputTokens} in, ${last.usage.outputTokens} out`);
  lines.push(
    `- Question: ${last.question !== undefined ? `"${last.question}"` : "not recorded (opt in under Diagnostics)"}`,
    "",
    "### Timeline",
  );
  timeline(lines, last.events);
  const earlier = runs.filter((r) => r !== last).reverse();
  if (earlier.length) {
    lines.push("", "### Other runs");
    for (const r of earlier) {
      const where = r.pageHost ? ` on ${r.pageHost}` : "";
      const errors = r.errors.length ? ` (${r.errors.length} error${r.errors.length === 1 ? "" : "s"}: "${r.errors[r.errors.length - 1]}")` : "";
      lines.push(`- #${r.id} ${r.kind}${where} at ${clock(r.startedAt)} → ${r.outcome ? r.outcome.status : "unfinished"}${errors}`);
      // Quiet panel openings stay one line; every other run keeps its steps.
      if (!quietStartup(r)) {
        if (r.provider) lines.push(`  ${r.provider}${r.model ? " / " + r.model : ""}${r.mock ? " · local mock server" : ""}`);
        if (r.outcome) lines.push(`  outcome: "${r.outcome.message}"`);
        timeline(lines, r.events);
      }
    }
  }
  tail();
  lines.push("", "_Recorded locally by a debug build. No page text, keys, or form values are included._");
  return lines.join("\n");
}
