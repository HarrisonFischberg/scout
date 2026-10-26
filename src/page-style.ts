// Styles for what Scout draws on a page (overlay, pointer, page button) that
// the page's Content Security Policy cannot block. Safari applies a page's
// style-src to elements a content script creates, so on a strict page
// (checkout.stripe.com, owner report 2026-10-26) a `style` attribute and a
// <style> element are dropped: the overlay's popover host then showed as
// Safari's default popover, a bordered square in the middle of the page.
// CSSOM writes and constructed style sheets are not subject to style-src.

/** Sets an element's inline style through the CSSOM. */
export function setHostStyle(host: HTMLElement, css: string): void {
  host.style.cssText = css;
}

/** Adds `css` to a shadow root as a constructed sheet, or a <style> element where those are missing. */
export function adoptStyle(root: ShadowRoot, css: string): void {
  try {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(css);
    root.adoptedStyleSheets = [...root.adoptedStyleSheets, sheet];
    return;
  } catch {
    // Older Safari: no constructed sheets.
  }
  const style = (root.ownerDocument ?? document).createElement("style");
  style.textContent = css;
  root.prepend(style);
}
