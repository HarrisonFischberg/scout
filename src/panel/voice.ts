// Mic button (owner design 2026-10-17): speech to text into the question box,
// nothing more. The user sends it with Send as usual. Uses WebKit's own speech
// recognition (webkitSpeechRecognition); nothing here talks to the AI provider
// or stores audio. Safari decides whether an extension page may use the
// microphone, so every failure maps to a plain message and the keyboard's own
// dictation stays the fallback.

/** The part of the Web Speech API recognition object Scout uses. */
import { browserName } from "../platform";

export interface RecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: RecognitionEventLike) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  /** Fires once the recognizer really has the microphone. */
  onstart?: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

export interface RecognitionEventLike {
  results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
}

export type RecognitionCtor = new () => RecognitionLike;

/** WebKit's recognizer, or null when this Safari has none. */
export function recognitionCtor(w: object): RecognitionCtor | null {
  const g = w as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return g.SpeechRecognition ?? g.webkitSpeechRecognition ?? null;
}

/** What to tell the user when listening fails. `phone`: a touch screen with an on-screen keyboard. */
export function micErrorText(code: string, phone: boolean): string {
  const keyboard = phone ? "Tap the mic on your keyboard to dictate instead." : "Press the Dictation key (or Fn twice) to dictate instead.";
  switch (code) {
    case "not-allowed":
    case "service-not-allowed":
      return browserName() + " didn't allow the microphone here. " + keyboard;
    case "unsupported":
      return "This version of " + browserName() + " can't listen from Scout. " + keyboard;
    case "no-start":
      return browserName() + " didn't let Scout use the microphone. " + keyboard;
    case "page-unavailable":
      return "Scout can't listen on this page. " + keyboard;
    case "no-speech":
      return "Didn't hear anything. Tap the mic and try again.";
    case "audio-capture":
      return "No microphone was found. " + keyboard;
    case "network":
      return "Speech recognition needs an internet connection. Try again.";
    default:
      return "Listening stopped. Try again.";
  }
}

/** Joins dictated text onto what was already typed, with one space between. */
export function joinDictation(typed: string, heard: string): string {
  const h = heard.trim();
  if (!h) return typed;
  if (!typed.trim()) return h;
  return /\s$/.test(typed) ? typed + h : typed + " " + h;
}

export interface ListenHandlers {
  /** Everything heard so far in this session; `final` once the recognizer has settled it. */
  onText(text: string, final: boolean): void;
  /** Listening ended; `error` is the recognizer's code when it failed. */
  onEnd(error?: string): void;
}

function quietAbort(rec: RecognitionLike): void {
  try {
    rec.abort();
  } catch {
    // Already ended.
  }
}

/** Codes that mean this browser won't let Scout listen at all (not a one-off miss). */
export function micBlocked(code: string | undefined): boolean {
  return code === "not-allowed" || code === "service-not-allowed" || code === "unsupported" || code === "no-start" || code === "audio-capture";
}

const MIC_BLOCKED_KEY = "scout.micBlocked";

/**
 * Whether this browser already refused to listen. Keyed by user agent, so a
 * Safari update tries the recognizer again. `store` is the page cache (look.ts).
 */
export function micBlockedHere(store: Pick<Storage, "getItem"> | undefined, agent: string): boolean {
  try {
    return store?.getItem(MIC_BLOCKED_KEY) === agent;
  } catch {
    return false;
  }
}

export function rememberMic(store: Pick<Storage, "setItem" | "removeItem"> | undefined, agent: string, blocked: boolean): void {
  try {
    if (blocked) store?.setItem(MIC_BLOCKED_KEY, agent);
    else store?.removeItem(MIC_BLOCKED_KEY);
  } catch {
    // Storage unavailable; the recognizer is simply tried again next time.
  }
}

/** How long the recognizer gets to start before Scout gives up (iPhone Safari can hang silently). */
export const START_TIMEOUT_MS = 4000;
/** How long after an error Scout waits for the recognizer's own end. */
export const END_GRACE_MS = 800;

/**
 * One listening session; with `continuous` it keeps going until stopped.
 * onEnd always fires exactly once per start (unless cancelled): Safari on
 * iPhone can leave a recognizer that never starts, or errors without ending,
 * so timers end it here instead of leaving the mic button stuck on.
 */
export class Listener {
  private rec: RecognitionLike | null = null;
  private error: string | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private finish: ((error?: string, abort?: boolean) => void) | null = null;

  constructor(
    private readonly ctor: RecognitionCtor | null,
    private readonly lang: string,
    private readonly startTimeoutMs = START_TIMEOUT_MS,
  ) {}

  get active(): boolean {
    return this.rec !== null;
  }

  start(handlers: ListenHandlers, opts: { continuous: boolean }): void {
    this.cancel();
    if (!this.ctor) {
      handlers.onEnd("unsupported");
      return;
    }
    let rec: RecognitionLike;
    try {
      rec = new this.ctor();
    } catch {
      handlers.onEnd("unsupported");
      return;
    }
    this.error = undefined;
    rec.lang = this.lang;
    rec.continuous = opts.continuous;
    rec.interimResults = true;
    rec.onresult = (event) => {
      if (this.rec !== rec) return;
      // Hearing anything proves it started, even if onstart never came.
      if (this.error === undefined) this.clearTimer();
      let text = "";
      let final = true;
      for (let i = 0; i < event.results.length; i++) {
        const r = event.results[i];
        if (!r) continue;
        text += r[0].transcript;
        if (!r.isFinal) final = false;
      }
      handlers.onText(text.replace(/\s+/g, " ").trim(), final);
    };
    // `abort`: also abort the recognizer, before onEnd so a new session started there is untouched.
    const end = (error?: string, abort = false): void => {
      if (this.rec !== rec) return;
      this.clearTimer();
      this.rec = null;
      this.finish = null;
      if (abort) quietAbort(rec);
      handlers.onEnd(error);
    };
    rec.onstart = () => {
      if (this.rec === rec) this.clearTimer();
    };
    rec.onerror = (event) => {
      if (this.rec !== rec || event.error === "aborted") return;
      this.error = event.error;
      // Some Safari builds report the error and never end; end it ourselves.
      this.clearTimer();
      this.timer = setTimeout(() => end(this.error, true), END_GRACE_MS);
    };
    rec.onend = () => end(this.error);
    this.rec = rec;
    this.finish = end;
    this.timer = setTimeout(() => end("no-start", true), this.startTimeoutMs);
    try {
      rec.start();
    } catch {
      end("not-allowed");
    }
  }

  private clearTimer(): void {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
  }

  /** Stops listening and keeps what was heard; onEnd still fires. */
  stop(): void {
    const rec = this.rec;
    const finish = this.finish;
    if (!rec) return;
    try {
      rec.stop();
    } catch {
      // Already ended.
    }
    // A recognizer that never started may never end either: settle it now.
    if (this.rec === rec && finish) {
      this.clearTimer();
      this.timer = setTimeout(() => finish(this.error, true), END_GRACE_MS);
    }
  }

  /** Stops listening without a final onEnd. */
  cancel(): void {
    const rec = this.rec;
    this.clearTimer();
    this.rec = null;
    this.finish = null;
    try {
      rec?.abort();
    } catch {
      // Already ended.
    }
  }
}
