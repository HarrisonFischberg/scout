import { describe, expect, it } from "vitest";
import { joinDictation, Listener, micErrorText, recognitionCtor, type RecognitionEventLike, type RecognitionLike } from "../../src/panel/voice";

/** A recognizer the test drives by hand. */
class FakeRecognition implements RecognitionLike {
  static last: FakeRecognition | null = null;
  lang = "";
  continuous = false;
  interimResults = false;
  onresult: ((event: RecognitionEventLike) => void) | null = null;
  onerror: ((event: { error: string }) => void) | null = null;
  onend: (() => void) | null = null;
  started = false;
  constructor() {
    FakeRecognition.last = this;
  }
  start(): void {
    this.started = true;
  }
  stop(): void {
    this.onend?.();
  }
  abort(): void {
    this.onerror?.({ error: "aborted" });
    this.onend?.();
  }
  say(parts: Array<[string, boolean]>): void {
    this.onresult?.({ results: parts.map(([t, f]) => ({ isFinal: f, 0: { transcript: t } })) });
  }
  fail(error: string): void {
    this.onerror?.({ error });
    this.onend?.();
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
