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

/** One listening session; with `continuous` it keeps going until stopped. */
export class Listener {
  private rec: RecognitionLike | null = null;
  private error: string | undefined;

  constructor(private readonly ctor: RecognitionCtor | null, private readonly lang: string) {}

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
    rec.onerror = (event) => {
      if (this.rec === rec && event.error !== "aborted") this.error = event.error;
    };
    rec.onend = () => {
      if (this.rec !== rec) return;
      this.rec = null;
      handlers.onEnd(this.error);
    };
    this.rec = rec;
    try {
      rec.start();
    } catch {
      this.rec = null;
      handlers.onEnd("not-allowed");
    }
  }

  /** Stops listening and keeps what was heard; onEnd still fires. */
  stop(): void {
    try {
      this.rec?.stop();
    } catch {
      // Already ended.
    }
  }

  /** Stops listening without a final onEnd. */
  cancel(): void {
    const rec = this.rec;
    this.rec = null;
    try {
      rec?.abort();
    } catch {
      // Already ended.
    }
  }
}
