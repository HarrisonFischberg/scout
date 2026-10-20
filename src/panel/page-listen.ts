// Mic fallback (owner bug report 2026-10-20): Safari on iPhone won't let the
// panel's own recognizer hear anything, so Scout listens from the web page
// instead. The recognizer runs in an injected function in the active tab
// (Safari asks once per site, "Allow <site> to use the microphone?"), and the
// panel polls it for text. Only the transcript leaves the page; no audio is
// kept, and nothing is sent to the AI provider until the user taps Send.
import { END_GRACE_MS, type ListenHandlers } from "./voice";

/** Runs a self-contained function in the tab and returns its result. */
export type RunInTab = <A extends unknown[], R>(func: (...args: A) => R, args: A) => Promise<R | undefined>;

export interface PageListenState {
  text: string;
  final: boolean;
  started: boolean;
  ended: boolean;
  error?: string;
}

/** How long Safari gets to show its microphone question and start. */
export const PAGE_START_TIMEOUT_MS = 15000;
export const POLL_MS = 250;

// The three functions below are injected into the page, so they use nothing
// from module scope.

/** Page side: starts a recognizer. Returns "ok" or an error code. */
export function pageListenStart(lang: string): string {
  const g = globalThis as unknown as Record<string, unknown>;
  type Rec = {
    lang: string;
    continuous: boolean;
    interimResults: boolean;
    onstart: (() => void) | null;
    onaudiostart: (() => void) | null;
    onresult: ((e: { results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
    onerror: ((e: { error: string }) => void) | null;
    onend: (() => void) | null;
    start(): void;
    stop(): void;
    abort(): void;
  };
  const old = g.__scoutListen as { rec?: Rec } | undefined;
  try {
    old?.rec?.abort();
  } catch {
    // Already ended.
  }
  const C = (g.SpeechRecognition ?? g.webkitSpeechRecognition) as (new () => Rec) | undefined;
  if (!C) return "unsupported";
  const s: { text: string; final: boolean; started: boolean; ended: boolean; error?: string; rec?: Rec } = {
    text: "",
    final: false,
    started: false,
    ended: false,
  };
  let rec: Rec;
  try {
    rec = new C();
  } catch {
    return "unsupported";
  }
  rec.lang = lang;
  rec.continuous = true;
  rec.interimResults = true;
  rec.onstart = rec.onaudiostart = () => {
    s.started = true;
  };
  rec.onresult = (e) => {
    s.started = true;
    let text = "";
    let final = true;
    for (let i = 0; i < e.results.length; i++) {
      const r = e.results[i];
      if (!r) continue;
      text += r[0].transcript;
      if (!r.isFinal) final = false;
    }
    s.text = text.replace(/\s+/g, " ").trim();
    s.final = final;
  };
  rec.onerror = (e) => {
    if (e.error !== "aborted") s.error = e.error;
  };
  rec.onend = () => {
    s.ended = true;
  };
  s.rec = rec;
  g.__scoutListen = s;
  try {
    rec.start();
  } catch {
    return "not-allowed";
  }
  return "ok";
}

/** Page side: what has been heard so far, or null when no listening is set up (the page reloaded). */
export function pageListenPoll(): PageListenState | null {
  const s = (globalThis as unknown as Record<string, unknown>).__scoutListen as PageListenState | undefined;
  if (!s) return null;
  // No object spread: a lowered build would call a helper the page doesn't have.
  const out: PageListenState = { text: s.text, final: s.final, started: s.started, ended: s.ended };
  if (s.error) out.error = s.error;
  return out;
}

/** Page side: stops (keeps the text) or aborts, and forgets the recognizer once ended. */
export function pageListenStop(abort: boolean): void {
  const g = globalThis as unknown as Record<string, unknown>;
  const s = g.__scoutListen as { rec?: { stop(): void; abort(): void } } | undefined;
  try {
    if (abort) s?.rec?.abort();
    else s?.rec?.stop();
  } catch {
    // Already ended.
  }
  if (abort) delete g.__scoutListen;
}

/** Listens through the web page; same shape as Listener in voice.ts. */
export class PageListener {
  private session = 0;
  private handlers: ListenHandlers | null = null;
  private poller: ReturnType<typeof setInterval> | undefined;
  private deadline: ReturnType<typeof setTimeout> | undefined;
  private lastText = "";
  private stopping = false;

  constructor(private readonly run: RunInTab, private readonly lang: string, private readonly startTimeoutMs = PAGE_START_TIMEOUT_MS) {}

  get active(): boolean {
    return this.handlers !== null;
  }

  start(handlers: ListenHandlers): void {
    this.cancel();
    const session = ++this.session;
    this.handlers = handlers;
    this.lastText = "";
    this.deadline = setTimeout(() => this.end(session, "no-start", true), this.startTimeoutMs);
    void this.run(pageListenStart, [this.lang]).then(
      (code) => {
        if (session !== this.session) return;
        if (code !== "ok") return this.end(session, typeof code === "string" ? code : "page-unavailable", false);
        this.poller = setInterval(() => void this.poll(session), POLL_MS);
      },
      () => this.end(session, "page-unavailable", false),
    );
  }

  private async poll(session: number): Promise<void> {
    let s: PageListenState | null | undefined;
    try {
      s = await this.run(pageListenPoll, []);
    } catch {
      s = undefined;
    }
    if (session !== this.session || !this.handlers) return;
    if (!s || typeof s !== "object") return this.end(session, "page-unavailable", false);
    if (s.started && this.deadline !== undefined && !this.stopping) {
      clearTimeout(this.deadline);
      this.deadline = undefined;
    }
    const seen = s.text + (s.final ? "\u0000" : "");
    if (seen !== this.lastText) {
      this.lastText = seen;
      this.handlers.onText(s.text, s.final);
    }
    if (s.ended) this.end(session, s.error ?? (s.started || this.stopping ? undefined : "no-start"), false);
  }

  private end(session: number, error: string | undefined, abort: boolean): void {
    if (session !== this.session || !this.handlers) return;
    const handlers = this.handlers;
    this.clear();
    if (abort) void this.run(pageListenStop, [true]).catch(() => undefined);
    handlers.onEnd(error);
  }

  private clear(): void {
    if (this.poller !== undefined) clearInterval(this.poller);
    if (this.deadline !== undefined) clearTimeout(this.deadline);
    this.poller = this.deadline = undefined;
    this.handlers = null;
    this.stopping = false;
  }

  /** Stops listening and keeps what was heard; onEnd still fires. */
  stop(): void {
    if (!this.handlers) return;
    const session = this.session;
    this.stopping = true;
    void this.run(pageListenStop, [false]).catch(() => undefined);
    if (this.deadline !== undefined) clearTimeout(this.deadline);
    // The next poll normally sees the end; if the page never answers, end anyway.
    this.deadline = setTimeout(() => this.end(session, undefined, true), END_GRACE_MS + POLL_MS);
  }

  /** Stops listening without a final onEnd. */
  cancel(): void {
    if (!this.handlers) return;
    this.session++;
    this.clear();
    void this.run(pageListenStop, [true]).catch(() => undefined);
  }
}
