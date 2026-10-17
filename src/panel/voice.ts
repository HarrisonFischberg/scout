// Mic and voice buttons (owner design 2026-10-17): the mic dictates into the
// question box; the round voice button starts a hands-free conversation in
// which Scout listens, sends what it heard, reads the answer aloud and listens
// again until the user ends it. Both use WebKit's own speech recognition
// (webkitSpeechRecognition) and speech synthesis; nothing here talks to the AI
// provider or stores audio. Safari decides whether an extension page may use
// the microphone, so every failure maps to a plain message and the keyboard's
// own dictation stays the fallback.

/** The part of the Web Speech API recognition object Scout uses. */
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

/** Errors after which the microphone will not work in this panel at all. */
export function micBlocked(code: string): boolean {
  return code === "not-allowed" || code === "service-not-allowed" || code === "unsupported";
}

/** What to tell the user when listening fails. `phone`: a touch screen with an on-screen keyboard. */
export function micErrorText(code: string, phone: boolean): string {
  const keyboard = phone ? "Tap the mic on your keyboard to dictate instead." : "Press the Dictation key (or Fn twice) to dictate instead.";
  switch (code) {
    case "not-allowed":
    case "service-not-allowed":
      return "Safari didn't allow the microphone here. " + keyboard;
    case "unsupported":
      return "This version of Safari can't listen from Scout. " + keyboard;
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

/** An answer as words to read aloud: no code, links, citation marks or Markdown signs. */
export function forSpeech(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\[\d+\]/g, "")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+[.)])\s+/gm, "")
    .replace(/(\*\*|__|\*|_|~~)(?=\S)([\s\S]*?\S)\1/g, "$2")
    .replace(/^\s*\|?[-:| ]+\|?\s*$/gm, "")
    .replace(/\|/g, ", ")
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .trim();
}

export interface ListenHandlers {
  /** Everything heard so far in this session; `final` once the recognizer has settled it. */
  onText(text: string, final: boolean): void;
  /** Listening ended; `error` is the recognizer's code when it failed. */
  onEnd(error?: string): void;
}

/** One listening session: dictation keeps going until stopped, a voice turn ends at the first pause. */
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

export type VoiceState = "off" | "listening" | "thinking" | "speaking";

export interface VoiceDeps {
  listener: Listener;
  /** Reads text aloud and calls done when finished; returns a function that cuts it short. */
  speak(text: string, done: () => void): () => void;
  /** Sends what was heard; resolves with the answer to read aloud, or null when there is none. */
  send(text: string): Promise<string | null>;
  onState(state: VoiceState): void;
  onHeard(text: string): void;
  onError(code: string): void;
}

/** A hands-free conversation: listen, send, read the answer aloud, listen again. */
export class VoiceChat {
  private s: VoiceState = "off";
  private cutSpeech: (() => void) | null = null;
  private heard = "";
  private turns = 0;

  constructor(private readonly deps: VoiceDeps) {}

  get state(): VoiceState {
    return this.s;
  }

  start(): void {
    if (this.s !== "off") return;
    this.turns = 0;
    this.listen();
  }

  stop(): void {
    if (this.s === "off") return;
    this.deps.listener.cancel();
    this.cutSpeech?.();
    this.cutSpeech = null;
    this.set("off");
  }

  private set(next: VoiceState): void {
    this.s = next;
    this.deps.onState(next);
  }

  private listen(): void {
    this.heard = "";
    this.set("listening");
    this.deps.listener.start(
      {
        onText: (text) => {
          if (this.s !== "listening") return;
          this.heard = text;
          this.deps.onHeard(text);
        },
        onEnd: (error) => {
          if (this.s !== "listening") return;
          const said = this.heard.trim();
          if (said) {
            void this.ask(said);
            return;
          }
          this.set("off");
          // Silence after an answer just ends the conversation; the first silence says why.
          if (error && error !== "no-speech") this.deps.onError(error);
          else if (this.turns === 0) this.deps.onError("no-speech");
        },
      },
      { continuous: false },
    );
  }

  private async ask(text: string): Promise<void> {
    this.set("thinking");
    this.turns++;
    let answer: string | null = null;
    try {
      answer = await this.deps.send(text);
    } catch {
      answer = null;
    }
    if (this.s !== "thinking") return;
    const words = answer ? forSpeech(answer) : "";
    if (!words) {
      this.set("off");
      return;
    }
    this.set("speaking");
    this.cutSpeech = this.deps.speak(words, () => {
      this.cutSpeech = null;
      if (this.s === "speaking") this.listen();
    });
  }
}

/** speak() for VoiceChat on WebKit's speechSynthesis, or null when there is none. */
export function synthesisSpeaker(w: object, lang: string): VoiceDeps["speak"] | null {
  const g = w as { speechSynthesis?: SpeechSynthesis; SpeechSynthesisUtterance?: typeof SpeechSynthesisUtterance };
  const synth = g.speechSynthesis;
  const Utterance = g.SpeechSynthesisUtterance;
  if (!synth || !Utterance) return null;
  return (text, done) => {
    let over = false;
    const finish = (): void => {
      if (over) return;
      over = true;
      done();
    };
    synth.cancel();
    const u = new Utterance(text);
    u.lang = lang;
    u.onend = finish;
    u.onerror = finish;
    synth.speak(u);
    return () => {
      over = true;
      synth.cancel();
    };
  };
}
