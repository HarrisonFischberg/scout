// Docked composer on iPhone (owner request 2026-10-18). Safari draws the
// panel a frame or two behind its sheet while it is dragged (device log,
// #46), so anything laid out at the bottom of the page wobbled. The owner
// wants Summarize / Explain and the question box to stay put at the bottom
// while the sheet grows above them: they move into the composer, which is
// `position: fixed` to the bottom (WebKit places fixed layers against the new
// view size without waiting for the page to lay out again). The thread keeps
// room for it through --dock-h. While a text field has focus the composer
// goes back into the page flow, where the keyboard fit (src/panel/keyboard.ts)
// keeps it above the keyboard.

export function dockComposer(doc: Document, composer: HTMLElement, starters: HTMLElement, typing: () => boolean): void {
  composer.insertBefore(starters, composer.firstChild);
  const root = doc.documentElement;
  const update = (): void => {
    root.classList.toggle("docked", !typing());
  };
  new ResizeObserver(() => root.style.setProperty("--dock-h", `${Math.ceil(composer.getBoundingClientRect().height)}px`)).observe(composer);
  doc.addEventListener("focusin", update);
  doc.addEventListener("focusout", () => setTimeout(update, 0));
  update();
}
