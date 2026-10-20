import { afterEach, describe, expect, it, vi } from "vitest";
import { END_GRACE_MS, joinDictation, Listener, micBlocked, micErrorText, START_TIMEOUT_MS, micBlockedHere, rememberMic, recognitionCtor, type RecognitionEventLike, type RecognitionLike } from "../../src/panel/voice";

/** A recognizer the test drives by hand. */
class FakeRecognition implements RecognitionLike {
  static last: FakeRecognition | null = null;
  lang = "";
  continuous = false;
  interimResults = false;
  onresult: ((event: RecognitionEventLike) => void) | null = null;
  onerror: ((event: { error: string }) => void) | null = null;
  onend: (() => void) | null = null;
  onstart: (() => void) | null = null;
  started = false;
  aborted = false;
  /** iPhone Safari in the panel: start() returns but nothing ever happens. */
  static silent = false;
  /** Reports errors but never ends. */
  static noEnd = false;
  constructor() {
    FakeRecognition.last = this;
  }
  start(): void {
    this.started = true;
    if (!FakeRecognition.silent) this.onstart?.();
  }
  stop(): void {
    if (!FakeRecognition.silent) this.onend?.();
  }
  abort(): void {
    this.aborted = true;
    this.onerror?.({ error: "aborted" });
    this.onend?.();
  }
  say(parts: Array<[string, boolean]>): void {
    this.onresult?.({ results: parts.map(([t, f]) => ({ isFinal: f, 0: { transcript: t } })) });
  }
  fail(error: string): void {
    this.onerror?.({ error });
    if (!FakeRecognition.noEnd) this.onend?.();
  }
}

describe("mic button: speech to text (owner, 2026-10-17)", () => {
  it("finds WebKit's prefixed recognizer", () => {
    expect(recognitionCtor({ webkitSpeechRecognition: FakeRecognition })).toBe(FakeRecognition);
    expect(recognitionCtor({})).toBeNull();
  });

  it("dictation adds to what was typed", () => {
    expect(joinDictation("", " hello ")).toBe("hello");
    expect(joinDictation("Find", "shoes")).toBe("Find shoes");
    expect(joinDictation("Find ", "shoes")).toBe("Find shoes");
    expect(joinDictation("Find", "  ")).toBe("Find");
  });

  it("a refused microphone points to the keyboard's own dictation", () => {
    expect(micErrorText("not-allowed", true)).toMatch(/mic on your keyboard/);
    expect(micErrorText("service-not-allowed", false)).toMatch(/Fn twice/);
    expect(micErrorText("no-speech", true)).toMatch(/Didn't hear anything/);
  });


  it("the listener reports interim and final text, then ends", () => {
    const l = new Listener(FakeRecognition, "en-US");
    const seen: Array<[string, boolean]> = [];
    let ended: string | undefined | null = null;
    l.start({ onText: (t, f) => seen.push([t, f]), onEnd: (e) => (ended = e) }, { continuous: true });
    const r = FakeRecognition.last!;
    expect(r.lang).toBe("en-US");
    expect(r.continuous).toBe(true);
    expect(r.interimResults).toBe(true);
    r.say([["find ", false]]);
    r.say([["find coupons", true]]);
    l.stop();
    expect(seen).toEqual([["find", false], ["find coupons", true]]);
    expect(ended).toBeUndefined();
    expect(l.active).toBe(false);
  });

  it("the listener passes on errors, and says unsupported with no recognizer", () => {
    const l = new Listener(FakeRecognition, "en-US");
    let ended: string | undefined;
    l.start({ onText: () => undefined, onEnd: (e) => (ended = e) }, { continuous: false });
    FakeRecognition.last!.fail("not-allowed");
    expect(ended).toBe("not-allowed");
    new Listener(null, "en-US").start({ onText: () => undefined, onEnd: (e) => (ended = e) }, { continuous: false });
    expect(ended).toBe("unsupported");
  });

});

describe("mic button never stays stuck on (iPhone bug, 2026-10-20)", () => {
  afterEach(() => {
    FakeRecognition.silent = false;
    FakeRecognition.noEnd = false;
    vi.useRealTimers();
  });

  it("a recognizer that never starts ends with no-start and is aborted", () => {
    vi.useFakeTimers();
    FakeRecognition.silent = true;
    const l = new Listener(FakeRecognition, "en-US");
    const ends: Array<string | undefined> = [];
    l.start({ onText: () => undefined, onEnd: (e) => ends.push(e) }, { continuous: true });
    expect(l.active).toBe(true);
    vi.advanceTimersByTime(START_TIMEOUT_MS);
    expect(ends).toEqual(["no-start"]);
    expect(l.active).toBe(false);
    expect(FakeRecognition.last!.aborted).toBe(true);
    expect(micErrorText("no-start", true)).toMatch(/mic on your keyboard/);
  });

  it("an error with no end still ends, once", () => {
    vi.useFakeTimers();
    FakeRecognition.noEnd = true;
    const l = new Listener(FakeRecognition, "en-US");
    const ends: Array<string | undefined> = [];
    l.start({ onText: () => undefined, onEnd: (e) => ends.push(e) }, { continuous: true });
    FakeRecognition.last!.fail("not-allowed");
    expect(ends).toEqual([]);
    vi.advanceTimersByTime(END_GRACE_MS);
    expect(ends).toEqual(["not-allowed"]);
    vi.advanceTimersByTime(START_TIMEOUT_MS);
    expect(ends).toEqual(["not-allowed"]);
  });

  it("tapping stop on a recognizer that never started still turns the mic off", () => {
    vi.useFakeTimers();
    FakeRecognition.silent = true;
    const l = new Listener(FakeRecognition, "en-US");
    const ends: Array<string | undefined> = [];
    l.start({ onText: () => undefined, onEnd: (e) => ends.push(e) }, { continuous: true });
    l.stop();
    vi.advanceTimersByTime(END_GRACE_MS);
    expect(ends).toEqual([undefined]);
    expect(l.active).toBe(false);
  });

  it("a recognizer that started keeps listening past the start timeout", () => {
    vi.useFakeTimers();
    const l = new Listener(FakeRecognition, "en-US");
    const ends: Array<string | undefined> = [];
    l.start({ onText: () => undefined, onEnd: (e) => ends.push(e) }, { continuous: true });
    vi.advanceTimersByTime(START_TIMEOUT_MS * 3);
    expect(ends).toEqual([]);
    expect(l.active).toBe(true);
    l.stop();
    expect(ends).toEqual([undefined]);
  });

  it("only refusals count as blocked, not a quiet moment", () => {
    expect(micBlocked("not-allowed")).toBe(true);
    expect(micBlocked("no-start")).toBe(true);
    expect(micBlocked("unsupported")).toBe(true);
    expect(micBlocked("no-speech")).toBe(false);
    expect(micBlocked("network")).toBe(false);
    expect(micBlocked(undefined)).toBe(false);
  });

  it("remembers a refusal per browser version, and forgets it once dictation works", () => {
    const m = new Map<string, string>();
    const store = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
    expect(micBlockedHere(store, "iOS 26.0")).toBe(false);
    rememberMic(store, "iOS 26.0", true);
    expect(micBlockedHere(store, "iOS 26.0")).toBe(true);
    expect(micBlockedHere(store, "iOS 26.1")).toBe(false);
    rememberMic(store, "iOS 26.0", false);
    expect(micBlockedHere(store, "iOS 26.0")).toBe(false);
    expect(micBlockedHere(undefined, "x")).toBe(false);
  });
});
