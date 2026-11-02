// Codes the page the user is on shows anywhere in it (owner report
// 2026-11-02: bunkerkc.com showed KCMO15 and Find coupons found nothing).
// The page snapshot is built for the model: it stops at 20,000 characters,
// skips anything hidden, and never looks inside shadow roots or frames, so a
// code in a sign-up popup at the end of the page, a rotating announcement
// slide that is hidden at that moment, an image's alt text or a "copy code"
// button's data attribute was never read. This reads the whole page,
// hidden parts included, and keeps only codes with the words around them.
// Nothing leaves the device but those codes, and no model is involved.
import type { SnapNode } from "../snapshot/snapshot";
import { codesWithContext, MAX_STORE_CODES, type StoreCode } from "./store";

const SKIP = new Set(["script", "style", "noscript", "template", "head", "title", "svg", "canvas", "video", "audio"]);
// Elements whose edges end a phrase, so text from two boxes does not run together.
const BLOCK = new Set([
  "div", "p", "section", "article", "aside", "header", "footer", "nav", "main", "li", "ul", "ol", "dialog", "form", "table", "tr", "td", "th",
  "h1", "h2", "h3", "h4", "h5", "h6", "br", "hr", "button", "a", "label", "figure", "figcaption", "blockquote", "dd", "dt", "#shadow", "#frame",
]);
// Words a page uses to describe an image or a control: banners are often images with the offer in alt text.
const LABEL_ATTRS = ["alt", "title", "aria-label"];
// Attributes "copy code" buttons and popups keep the code in (data-code, data-coupon-code, data-clipboard-text).
const CODE_ATTR = /^data-[\w-]*(?:code|coupon|promo|clipboard|copy)[\w-]*$/;
const ATTR_CODE = /^[A-Za-z0-9][A-Za-z0-9_-]{2,24}$/;
/** Text read at most, so a huge page cannot stall the run. */
export const PAGE_TEXT_MAX = 400_000;

/** All text of a page, hidden parts included, with image labels and code attributes as text. */
export function pageCodeText(root: SnapNode, max = PAGE_TEXT_MAX): string {
  const parts: string[] = [];
  let used = 0;
  const push = (s: string): void => {
    if (used >= max || !s) return;
    parts.push(s);
    used += s.length;
  };
  const walk = (n: SnapNode): void => {
    if (used >= max) return;
    if (n.tag === "#text") return push(n.text ?? "");
    if (SKIP.has(n.tag)) return;
    const block = BLOCK.has(n.tag);
    if (block) push("\n");
    for (const a of LABEL_ATTRS) if (n.attrs[a]) push(" " + n.attrs[a] + " ");
    for (const [k, v] of Object.entries(n.attrs)) {
      if (CODE_ATTR.test(k) && ATTR_CODE.test(v.trim()) && /\d|^[A-Z]+$/.test(v.trim())) {
        push(" Code: " + v.trim() + " ");
        break;
      }
    }
    // A read-only box in a popup that holds the code to copy; never a field the user types in.
    if (n.tag === "input" && n.attrs.readonly !== undefined && n.value && ATTR_CODE.test(n.value.trim())) push(" Code: " + n.value.trim() + " ");
    for (const c of n.children) walk(c);
    if (block) push("\n");
  };
  walk(root);
  return parts.join(" ").replace(/[ \t\f\v\r]+/g, " ").replace(/ ?\n[\n ]*/g, "\n");
}

/** Codes the page shows, strict matches first (see codesWithContext). */
export function pageCodes(root: SnapNode, max = MAX_STORE_CODES): StoreCode[] {
  return codesWithContext(pageCodeText(root), max);
}

/**
 * The live page as a node tree for `pageCodeText`: unlike the snapshot's
 * adapter it keeps hidden elements and enters open shadow roots and
 * same-origin frames. Content script only (no DOM in Vitest).
 */
export function domCodeTree(el: Element, depth = 0): SnapNode {
  const attrs: Record<string, string> = {};
  for (const a of Array.from(el.attributes)) attrs[a.name.toLowerCase()] = a.value;
  const node: SnapNode = { tag: el.tagName.toLowerCase(), attrs, children: [] };
  if (SKIP.has(node.tag) || depth > 200) return node;
  if (el instanceof HTMLInputElement && el.readOnly) node.value = el.value;
  const kids = (from: ParentNode & Node, into: SnapNode[]): void => {
    for (const child of Array.from(from.childNodes)) {
      if (child.nodeType === 3) into.push({ tag: "#text", attrs: {}, text: child.textContent ?? "", children: [] });
      else if (child.nodeType === 1) into.push(domCodeTree(child as Element, depth + 1));
    }
  };
  const shadow = (el as Element & { shadowRoot?: ShadowRoot | null }).shadowRoot;
  if (shadow) {
    const wrap: SnapNode = { tag: "#shadow", attrs: {}, children: [] };
    kids(shadow, wrap.children);
    node.children.push(wrap);
  }
  if (el instanceof HTMLIFrameElement) {
    try {
      const body = el.contentDocument?.body;
      if (body) node.children.push({ tag: "#frame", attrs: {}, children: [domCodeTree(body, depth + 1)] });
    } catch {
      // A frame from another site cannot be read.
    }
  }
  kids(el, node.children);
  return node;
}
