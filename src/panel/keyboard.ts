// Keyboard on iPhone (owner bug 2026-10-18): tapping the question box grows
// Safari's sheet to full height and the keyboard slides over the bottom of the
// panel, hiding the whole composer (box, +, mode switch, model, mic, Send) and
// the starters. The panel page keeps its full height under the keyboard, so
// the visible area is only what the visual viewport reports. While the
// keyboard is up the body is sized to that visible area, which keeps the
// composer pinned just above the keyboard. Mac popovers never install this.
//
// Dragging the sheet (owner bug 2026-10-18, "jittery at medium or fast
// speed"): while Safari resizes the sheet, innerHeight and the visual
// viewport update at different moments, so for a frame or two they differ by
// more than a keyboard. Sizing the body on those frames made the composer
// jump up and back while the panel moved. The keyboard can only be up while a
// text field has focus, so nothing is resized otherwise, and updates are
// folded into one per frame.

/** The part of window.visualViewport the panel reads. */
export interface ViewportLike {
  readonly height: number;
  readonly offsetTop: number;
  addEventListener(type: "resize" | "scroll", listener: () => void): void;
}

/** Less than this between the page and the visible area is not a keyboard
 *  (rounding, Safari's own bars). */
const KEYBOARD_MIN = 80;

/** The body height to use, in CSS pixels, or null to keep the stylesheet's full height. */
export function keyboardHeight(pageHeight: number, view: Pick<ViewportLike, "height">): number | null {
  const visible = Math.round(view.height);
  return pageHeight - visible >= KEYBOARD_MIN ? visible : null;
}

/** True when the focused element brings up the on-screen keyboard. */
export function editableFocused(active: Element | null): boolean {
  if (!active) return false;
  const tag = active.tagName;
  if (tag === "TEXTAREA") return true;
  if (tag === "INPUT") {
    const type = (active.getAttribute("type") ?? "text").toLowerCase();
    return !["button", "checkbox", "radio", "range", "color", "file", "submit", "reset", "image", "hidden"].includes(type);
  }
  return (active as HTMLElement).isContentEditable === true;
}

export interface KeyboardWindow {
  readonly innerHeight: number;
  scrollTo(x: number, y: number): void;
  /** One update per frame; tests run it at once. */
  requestAnimationFrame?(cb: () => void): number;
  addEventListener?(type: "focusin" | "focusout", listener: () => void): void;
}

/** Keeps `body` the size of the area above the keyboard. Returns the update
 *  function so callers (and tests) can run it on demand. */
export function fitAboveKeyboard(
  win: KeyboardWindow,
  view: ViewportLike,
  body: { style: { height: string } },
  typing: () => boolean = () => true,
): () => void {
  const update = (): void => {
    const height = typing() ? keyboardHeight(win.innerHeight, view) : null;
    const next = height === null ? "" : `${height}px`;
    if (body.style.height !== next) body.style.height = next;
    // WebKit may scroll the page to reveal the focused field; with the body
    // now the visible size that scroll would push the header off the top.
    if (height !== null && view.offsetTop !== 0) win.scrollTo(0, 0);
  };
  let queued = false;
  const schedule = (): void => {
    if (!win.requestAnimationFrame) return update();
    if (queued) return;
    queued = true;
    win.requestAnimationFrame(() => {
      queued = false;
      update();
    });
  };
  view.addEventListener("resize", schedule);
  view.addEventListener("scroll", schedule);
  win.addEventListener?.("focusin", schedule);
  win.addEventListener?.("focusout", schedule);
  update();
  return update;
}
