// Quick ask box (owner request 2026-10-18, src/panel/quick-ask.ts has the
// rules). Drawn by the page tab script (src/edge.ts) in the tab's closed shadow
// root: plain elements, never an extension page in the website. It reads
// nothing from the page and holds no key; what is typed goes to the worker,
// which opens Scout's panel to answer it.
//
// Privacy: a website can listen for key presses on its own page before they
// reach this box (capture listeners on window). The box stops them going any
// further, which keeps them from ordinary page listeners, but not from those.
// Summarize this page types nothing. Recorded in docs/data-inventory.md.
import { placeQuickAsk, QUICK_ASK_MAX_CHARS, type QuickAsk } from "./panel/quick-ask";

/** Open and close animation, ms. Comet's takes about 250 ms each way. */
const GROW_MS = 260;
const SHRINK_MS = 200;

// Sized in em from --k, the tab's zoom-out scale, so the box looks the same on
// pages Safari shows zoomed out and the question field stays at 16 screen
// pixels (smaller makes iPhone Safari zoom into the page on focus).
export const QUICK_ASK_CSS = `
.qa-dim {
  position: fixed; top: 0; left: 0; width: 100%; height: 0; margin: 0; padding: 0; border: 0;
  background: linear-gradient(to bottom, rgb(0 0 0 / 37%) 0 55%, rgb(0 0 0 / 60%));
  -webkit-backdrop-filter: blur(10px); backdrop-filter: blur(10px);
  opacity: 0; transition: opacity ${GROW_MS}ms ease; touch-action: none;
}
.qa-dim.on { opacity: 1; }
.qa {
  position: fixed; left: 0; top: 0; box-sizing: border-box; margin: 0; padding: 0; border: 0;
  font: 400 calc(16px * var(--k, 1))/1.35 -apple-system, system-ui, sans-serif; color: #f2f2f7;
  display: grid; gap: 0.6em; transform-origin: 100% 50%;
  transition: transform ${GROW_MS}ms cubic-bezier(.2, .8, .2, 1), opacity ${GROW_MS}ms ease, top 250ms ease;
}
.qa.small { transform: scale(0.06); opacity: 0.01; }
.qa.closing { transition-duration: ${SHRINK_MS}ms, ${SHRINK_MS}ms, 0ms; }
.qa-sum {
  all: unset; box-sizing: border-box; display: flex; align-items: center; justify-content: space-between;
  padding: 0.2em 0.5em; font-size: 0.94em; color: rgb(255 255 255 / 86%); cursor: pointer; -webkit-tap-highlight-color: transparent;
}
.qa-sum svg { width: 1.15em; height: 1.15em; flex: none; }
.qa-box {
  box-sizing: border-box; display: grid; gap: 0.55em; padding: 0.75em 0.7em 0.6em; border-radius: 1.25em;
  background: #2b292a; border: 1px solid rgb(255 255 255 / 8%); box-shadow: 0 0.5em 2em rgb(0 0 0 / 35%);
}
.qa textarea {
  all: unset; box-sizing: border-box; display: block; width: 100%; min-height: 1.4em; max-height: 6.8em; overflow-y: auto;
  padding: 0 0.15em; font: inherit; font-size: 1em; color: #f2f2f7; caret-color: #0a84ff; white-space: pre-wrap; overflow-wrap: anywhere;
}
.qa textarea::placeholder { color: rgb(255 255 255 / 45%); }
.qa-tools { display: flex; align-items: center; gap: 0.5em; }
.qa-tools .grow { flex: 1; }
.qa-open, .qa-send {
  all: unset; box-sizing: border-box; display: inline-flex; align-items: center; justify-content: center; cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}
.qa-open { gap: 0.4em; height: 2.1em; padding: 0 0.8em; border-radius: 1.05em; background: rgb(255 255 255 / 8%); font-size: 0.85em; color: rgb(255 255 255 / 80%); }
.qa-open svg { width: 1.2em; height: 1.2em; }
.qa-open .body { fill: currentColor; stroke: #2b292a; stroke-width: 3; stroke-linejoin: round; }
.qa-open .lens { fill: #2b292a; }
.qa-send { width: 2.1em; height: 2.1em; border-radius: 50%; background: #0a84ff; color: #fff; }
.qa-send svg { width: 1.1em; height: 1.1em; }
.qa-send:disabled { background: rgb(255 255 255 / 14%); color: rgb(255 255 255 / 45%); cursor: default; }
.qa-sum:focus-visible, .qa-open:focus-visible, .qa-send:focus-visible { outline: 2px solid #2997ff; outline-offset: 2px; }
.qa[hidden], .qa-dim[hidden] { display: none; }
.tab.behind { opacity: 0; pointer-events: none; transition: opacity 120ms ease; }
@media (prefers-reduced-motion: reduce) { .qa, .qa-dim, .qa[hidden], .qa-dim[hidden] { display: none; }
.tab.behind { transition: none; } }
`;

const ARROW =
  '<svg viewBox="0 0 20 20" aria-hidden="true" focusable="false"><circle cx="10" cy="10" r="8.6" fill="none" stroke="currentColor" stroke-width="1.4"/>' +
  '<path d="M13 7 7.5 12.5M7.5 8.2v4.3h4.3" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const UP =
  '<svg viewBox="0 0 20 20" aria-hidden="true" focusable="false"><path d="M10 16V4.5M5 9.2 10 4.2l5 5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

export interface QuickAskUi {
  /** Opens from the tab. Call inside the tap's click handler: focusing the field there raises the keyboard. */
  open(): void;
  /** Closes; animated back into the tab unless `now`. */
  close(now?: boolean): void;
  isOpen(): boolean;
  destroy(): void;
}

export interface QuickAskDeps {
  root: ShadowRoot;
  tab: HTMLElement;
  /** The tab's zoom-out scale right now (tabScale). */
  scale(): number;
  /** Hands the question to the worker, which opens Scout's panel. Resolves whether the panel opened. */
  send(ask: QuickAsk): Promise<boolean>;
  /** Opens Scout's panel with nothing asked. */
  openPanel(): Promise<boolean>;
  /** Shown when Scout's panel could not open. */
  failed(): void;
}

export function mountQuickAsk(d: QuickAskDeps): QuickAskUi {
  const dim = document.createElement("div");
  dim.className = "qa-dim";
  dim.hidden = true;
  const box = document.createElement("form");
  box.className = "qa small";
  box.hidden = true;
  box.setAttribute("role", "dialog");
  box.setAttribute("aria-label", "Ask Scout for Safari");
  box.innerHTML =
    '<button type="button" class="qa-sum">Summarize this page' + ARROW + "</button>" +
    '<div class="qa-box"><textarea rows="1" placeholder="Ask anything…" aria-label="Ask Scout for Safari" autocomplete="off" enterkeyhint="send" maxlength="' + QUICK_ASK_MAX_CHARS + '"></textarea>' +
    '<div class="qa-tools"><button type="button" class="qa-open" aria-label="Open Scout for Safari">' + d.tab.querySelector("svg")?.outerHTML + "<span>Scout</span></button>" +
    '<span class="grow"></span><button type="button" class="qa-send" aria-label="Send" disabled>' + UP + "</button></div></div>";
  d.root.append(dim, box);
  const field = box.querySelector("textarea") as HTMLTextAreaElement;
  const sum = box.querySelector(".qa-sum") as HTMLButtonElement;
  const openBtn = box.querySelector(".qa-open") as HTMLButtonElement;
  const sendBtn = box.querySelector(".qa-send") as HTMLButtonElement;

  let open = false;
  let busy = false;
  let hideTimer = 0;
  const reduced = (): boolean => matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ---------- Place: above the keyboard, out of the bottom strip ----------
  const place = (): void => {
    if (!open) return;
    const k = d.scale();
    const vv = window.visualViewport;
    const view = { left: vv?.offsetLeft ?? 0, top: vv?.offsetTop ?? 0, width: vv?.width ?? innerWidth, height: vv?.height ?? innerHeight };
    box.style.setProperty("--k", String(k));
    const side = 12 * k;
    box.style.left = Math.round(view.left + side) + "px";
    box.style.width = Math.max(0, Math.round(view.width - 2 * side)) + "px";
    const at = placeQuickAsk({ layoutHeight: innerHeight, viewTop: view.top, viewHeight: view.height, boxHeight: box.offsetHeight, scale: k });
    box.style.top = at.boxTop + "px";
    dim.style.height = at.dimHeight + "px";
  };
  const grow = (): void => {
    field.style.height = "auto";
    field.style.height = field.scrollHeight + "px";
    sendBtn.disabled = !field.value.trim();
    place();
  };
  const listen = (on: boolean): void => {
    const f = on ? "addEventListener" : "removeEventListener";
    window.visualViewport?.[f]("resize", place);
    window.visualViewport?.[f]("scroll", place);
    window[f]("resize", place);
  };

  // The box grows out of the tab and shrinks back into it.
  const originAtTab = (): void => {
    const t = d.tab.getBoundingClientRect();
    const b = box.getBoundingClientRect();
    box.style.transformOrigin = Math.round(t.left + t.width / 2 - b.left) + "px " + Math.round(t.top + t.height / 2 - b.top) + "px";
  };

  const ui: QuickAskUi = {
    open() {
      if (open) return;
      open = true;
      window.clearTimeout(hideTimer);
      box.classList.remove("closing");
      box.classList.add("small");
      box.hidden = false;
      dim.hidden = false;
      d.tab.classList.add("behind");
      d.root.host.setAttribute("data-quick-ask", "open");
      listen(true);
      // First placement jumps straight there; only later moves (the keyboard
      // coming up) slide.
      box.style.transition = "none";
      grow();
      originAtTab();
      void box.offsetWidth;
      box.style.transition = "";
      // Focus now, inside the tap, so the keyboard comes up.
      field.focus({ preventScroll: true });
      void box.offsetWidth;
      box.classList.remove("small");
      dim.classList.add("on");
    },
    close(now = false) {
      if (!open) return;
      open = false;
      listen(false);
      // The dim goes at once, so nothing lingers once the box is dismissed.
      dim.classList.remove("on");
      dim.hidden = true;
      d.tab.classList.remove("behind");
      d.root.host.removeAttribute("data-quick-ask");
      if (d.root.activeElement === field) field.blur();
      const done = (): void => {
        box.hidden = true;
        box.classList.remove("closing");
      };
      if (now || reduced()) {
        box.classList.add("small");
        done();
        return;
      }
      originAtTab();
      box.classList.add("closing", "small");
      hideTimer = window.setTimeout(done, SHRINK_MS);
    },
    isOpen: () => open,
    destroy() {
      ui.close(true);
      window.clearTimeout(hideTimer);
      dim.remove();
      box.remove();
    },
  };

  // ---------- Ask ----------
  const hand = (p: Promise<boolean>, sent: () => void): void => {
    busy = true;
    // Safari's sheet comes up over the page: close at once, no shrink.
    ui.close(true);
    void p.then(
      (ok) => {
        busy = false;
        if (ok) sent();
        else d.failed();
      },
      () => {
        busy = false;
        d.failed();
      },
    );
  };
  const submit = (): void => {
    const q = field.value.trim();
    if (!q || busy) return;
    hand(d.send({ kind: "ask", question: q }), () => {
      field.value = "";
      grow();
    });
  };
  box.addEventListener("submit", (e) => e.preventDefault());
  sendBtn.addEventListener("click", (e) => {
    if (e.isTrusted) submit();
  });
  sum.addEventListener("click", (e) => {
    if (e.isTrusted && !busy) hand(d.send({ kind: "summarize", question: "" }), () => undefined);
  });
  openBtn.addEventListener("click", (e) => {
    if (e.isTrusted && !busy) hand(d.openPanel(), () => undefined);
  });
  // Buttons keep the focus in the field, so tapping one does not count as
  // leaving the box (which closes it).
  for (const b of [sum, openBtn, sendBtn]) b.addEventListener("mousedown", (e) => e.preventDefault());

  // ---------- Typing stays in the box ----------
  field.addEventListener("input", grow);
  field.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      ui.close();
    } else if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      if (e.isTrusted) submit();
    }
  });
  for (const type of ["keydown", "keyup", "keypress", "beforeinput", "input", "compositionstart", "compositionupdate", "compositionend", "paste", "cut", "copy", "select"]) {
    field.addEventListener(type, (e) => e.stopPropagation());
  }

  // ---------- Close: tap outside, keyboard dismissed, page hidden ----------
  dim.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    ui.close();
  });
  // Swiping the keyboard down or tapping Done blurs the field: shrink back
  // to the tab rather than follow the keyboard into the bottom strip.
  field.addEventListener("blur", () => {
    if (open && !busy) ui.close();
  });
  window.addEventListener("pagehide", () => ui.close(true));
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") ui.close(true);
  });

  return ui;
}
