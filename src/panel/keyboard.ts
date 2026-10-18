// Keyboard on iPhone (owner bug 2026-10-18): tapping the question box grows
// Safari's sheet to full height and the keyboard slides over the bottom of the
// panel, hiding the whole composer (box, +, mode switch, model, mic, Send) and
// the starters. The panel page keeps its full height under the keyboard, so
// the visible area is only what the visual viewport reports. While the
// keyboard is up the body is sized to that visible area, which keeps the
// composer pinned just above the keyboard. Mac popovers never install this.

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

/** Keeps `body` the size of the area above the keyboard. Returns the update
 *  function so callers (and tests) can run it on demand. */
export function fitAboveKeyboard(
  win: { readonly innerHeight: number; scrollTo(x: number, y: number): void },
  view: ViewportLike,
  body: { style: { height: string } },
): () => void {
  const update = (): void => {
    const height = keyboardHeight(win.innerHeight, view);
    const next = height === null ? "" : `${height}px`;
    if (body.style.height !== next) body.style.height = next;
    // WebKit may scroll the page to reveal the focused field; with the body
    // now the visible size that scroll would push the header off the top.
    if (view.offsetTop !== 0) win.scrollTo(0, 0);
  };
  view.addEventListener("resize", update);
  view.addEventListener("scroll", update);
  update();
  return update;
}
