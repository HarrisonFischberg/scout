// The mic button (owner, 2026-10-17; speech engines in voice.ts and
// page-listen.ts): speech to text into the ask box, nothing more; the user
// sends it with Send. Moved out of the panel's main() (audit 2026-11-10).
import { PageListener } from "./page-listen";
import { joinDictation, Listener, micBlocked, micBlockedHere, micErrorText, recognitionCtor, rememberMic } from "./voice";

export interface MicDeps {
  mic: HTMLButtonElement;
  question: HTMLTextAreaElement;
  status: HTMLElement;
  /** The web page's tab, when Scout may listen from it (not in the full-window chat, not on non-web pages). */
  pageTabId: number | undefined;
  /** Remembers that this browser refused the panel's own mic. */
  memory: (Pick<Storage, "getItem" | "setItem" | "removeItem">) | undefined;
  autosize: () => void;
  trace: (stage: string) => void;
}

/** Wires the mic button. Returns `stop`, which ends dictation when something else takes over the box. */
export function wireMic(d: MicDeps): { stop: () => void } {
  // Speech to text into the box, nothing more: the user sends it with Send.
  const { mic, question, status } = d;
  const phone = matchMedia("(pointer: coarse)").matches;
  const speechLang = navigator.language || "en-US";
  const panelVoice = new Listener(recognitionCtor(window), speechLang);
  // Safari on iPhone won't let the panel itself hear anything, so Scout falls
  // back to listening from the web page (src/panel/page-listen.ts). Once the
  // panel has refused, later taps go straight to the page (owner, 2026-10-20).
  const pageTabId = d.pageTabId;
  const pageVoice =
    pageTabId !== undefined
      ? new PageListener(async (func, args) => {
          const [res] = await browser.scripting.executeScript({ target: { tabId: pageTabId }, func: func as unknown as (...a: never[]) => unknown, args });
          return res?.result as Awaited<ReturnType<typeof func>> | undefined;
        }, speechLang)
      : null;
  let dictation: Listener | PageListener = panelVoice;
  let dictating = false;
  const micMemory = d.memory;
  function setDictating(on: boolean): void {
    dictating = on;
    mic.setAttribute("aria-pressed", String(on));
    mic.setAttribute("aria-label", on ? "Stop dictating" : "Dictate");
    mic.title = on ? "Stop dictating" : "Dictate";
  }
  function listen(via: Listener | PageListener, typed: string): void {
    dictation = via;
    d.trace(via === pageVoice ? "voice:page" : "voice:dictate");
    const handlers = {
      onText: (heard: string) => {
        question.value = joinDictation(typed, heard);
        d.autosize();
      },
      onEnd: (error?: string) => {
        if (via === panelVoice) {
          if (micBlocked(error)) rememberMic(micMemory, navigator.userAgent, true);
          else if (question.value !== typed) rememberMic(micMemory, navigator.userAgent, false);
          // The panel was refused before anything was heard: try the page, mic still on.
          if (micBlocked(error) && pageVoice && question.value === typed) {
            d.trace("voice:panel-refused " + error);
            listen(pageVoice, typed);
            return;
          }
        }
        setDictating(false);
        if (error && !(error === "no-speech" && question.value !== typed)) {
          status.textContent = micErrorText(error, phone);
          d.trace("voice:error " + error);
        } else if (status.textContent === "Listening…") status.textContent = "";
        question.focus();
      },
    };
    if (via instanceof Listener) via.start(handlers, { continuous: true });
    else via.start(handlers);
  }
  // iPhone and iPad (owner choice 2026-10-20): Safari gives extensions no
  // microphone there and nothing can switch the keyboard's mic on, so Scout's
  // mic is hidden; the keyboard's own mic works in the box.
  mic.hidden = phone;
  mic.addEventListener("click", () => {
    if (dictating) {
      dictation.stop();
      return;
    }
    setDictating(true);
    status.textContent = "Listening…";
    listen(pageVoice && micBlockedHere(micMemory, navigator.userAgent) ? pageVoice : panelVoice, question.value);
  });
  return {
    stop: () => {
      if (dictating) dictation.stop();
    },
  };
}
