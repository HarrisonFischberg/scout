import { describe, expect, it } from "vitest";
import {
  forSpeech,
  joinDictation,
  Listener,
  micBlocked,
  micErrorText,
  recognitionCtor,
  VoiceChat,
  type RecognitionLike,
  type RecognitionEventLike,
  type VoiceState,
} from "../../src/panel/voice";

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

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe("mic and voice buttons (owner design 2026-10-17)", () => {
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
    expect(micBlocked("not-allowed")).toBe(true);
    expect(micBlocked("no-speech")).toBe(false);
    expect(micErrorText("not-allowed", true)).toMatch(/mic on your keyboard/);
    expect(micErrorText("service-not-allowed", false)).toMatch(/Fn twice/);
    expect(micErrorText("no-speech", true)).toMatch(/Didn't hear anything/);
  });

  it("answers are read aloud without Markdown, links, code or citation marks", () => {
    const md = "## Summary\n\n- **Free shipping** over $50 [1]\n- See [the policy](https://x.com/p)\n\n```js\nx()\n```\nUse `SAVE10` at https://shop.com/cart.";
    expect(forSpeech(md)).toBe("Summary\nFree shipping over $50\nSee the policy\nUse SAVE10 at");
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

  function voice(answer: string | null) {
    const states: VoiceState[] = [];
    const sent: string[] = [];
    const spoken: string[] = [];
    const errors: string[] = [];
    let finishSpeech = (): void => undefined;
    const chat = new VoiceChat({
      listener: new Listener(FakeRecognition, "en-US"),
      speak: (text, done) => {
        spoken.push(text);
        finishSpeech = done;
        return () => undefined;
      },
      send: async (text) => {
        sent.push(text);
        return answer;
      },
      onState: (s) => states.push(s),
      onHeard: () => undefined,
      onError: (e) => errors.push(e),
    });
    return { chat, states, sent, spoken, errors, endSpeech: () => finishSpeech() };
  }

  it("voice chat: listens, sends, reads the answer aloud, then listens again", async () => {
    const v = voice("**Yes**, it ships free.");
    v.chat.start();
    FakeRecognition.last!.say([["does it ship free", true]]);
    FakeRecognition.last!.stop();
    await tick();
    expect(v.sent).toEqual(["does it ship free"]);
    expect(v.spoken).toEqual(["Yes, it ships free."]);
    expect(v.chat.state).toBe("speaking");
    v.endSpeech();
    expect(v.chat.state).toBe("listening");
    expect(v.states).toEqual(["listening", "thinking", "speaking", "listening"]);
    // Silence after an answer ends the conversation quietly.
    FakeRecognition.last!.fail("no-speech");
    expect(v.chat.state).toBe("off");
    expect(v.errors).toEqual([]);
  });

  it("voice chat: silence at the start says nothing was heard; a refused mic says so", () => {
    const v = voice("hi");
    v.chat.start();
    FakeRecognition.last!.fail("no-speech");
    expect(v.errors).toEqual(["no-speech"]);
    v.chat.start();
    FakeRecognition.last!.fail("not-allowed");
    expect(v.errors).toEqual(["no-speech", "not-allowed"]);
    expect(v.sent).toEqual([]);
  });

  it("voice chat: no answer (stopped or failed) ends it without speaking", async () => {
    const v = voice(null);
    v.chat.start();
    FakeRecognition.last!.say([["hello", true]]);
    FakeRecognition.last!.stop();
    await tick();
    expect(v.spoken).toEqual([]);
    expect(v.chat.state).toBe("off");
  });

  it("voice chat: ending it while listening sends nothing", () => {
    const v = voice("hi");
    v.chat.start();
    FakeRecognition.last!.say([["half a sen", false]]);
    v.chat.stop();
    expect(v.chat.state).toBe("off");
    expect(v.sent).toEqual([]);
  });
});
