// Page snapshot builder (T008). Walks a minimal node tree, never the live DOM
// directly, so it unit-tests without a browser. `fromElement` adapts a DOM
// element. Page text is untrusted data; sensitive field values never leave here.

export interface SnapNode {
  tag: string;
  attrs: Record<string, string>;
  /** Text content, for the "#text" pseudo-tag only. */
  text?: string;
  children: SnapNode[];
  /** Set by the DOM adapter when computed style hides the node. */
  hidden?: boolean;
  /** Current value of a form control (property, not attribute). */
  value?: string;
}

export interface SnapElement {
  ref: string;
  tag: string;
  role: string;
  name: string;
  type?: string;
  value?: string;
  redacted?: boolean;
  disabled?: boolean;
  href?: string;
}

export interface Snapshot {
  url: string;
  title: string;
  text: string;
  elements: SnapElement[];
  truncated: boolean;
}

export interface SnapshotOptions {
  url: string;
  title: string;
  maxTextChars?: number;
  maxElements?: number;
  /** Called per element so the action executor (T009) can resolve refs. */
  onRef?: (ref: string, node: SnapNode) => void;
}

export const DEFAULT_MAX_TEXT_CHARS = 20_000;
export const DEFAULT_MAX_ELEMENTS = 200;
const MAX_NAME = 120;
const MAX_VALUE = 200;
export const REDACTED = "[REDACTED]";

const SKIP_TAGS = new Set(["script", "style", "noscript", "template", "svg", "head", "iframe"]);
const BLOCK_TAGS = new Set([
  "p", "div", "section", "article", "main", "header", "footer", "nav", "aside",
  "ul", "ol", "li", "h1", "h2", "h3", "h4", "h5", "h6", "form", "table", "tr",
  "br", "label", "fieldset", "blockquote", "pre",
]);
const SENSITIVE_HINT =
  /card|cc[-_ ]?(num|number|exp|csc)|cvv|cvc|csc|security[-_ ]?code|ssn|social[-_ ]?security|passw|passcode|\bpin\b|otp|one[-_ ]?time/i;
const SENSITIVE_AUTOCOMPLETE = /cc-|current-password|new-password|one-time-code/i;
const INPUT_ROLES: Record<string, string> = {
  button: "button",
  submit: "button",
  reset: "button",
  image: "button",
  checkbox: "checkbox",
  radio: "radio",
  range: "slider",
  search: "searchbox",
};
const BUTTON_TYPES = ["button", "submit", "reset", "image"];

export function isSensitiveField(node: SnapNode): boolean {
  if (node.tag !== "input" && node.tag !== "textarea" && node.tag !== "select") return false;
  const type = (node.attrs.type ?? "text").toLowerCase();
  if (type === "password") return true;
  if (SENSITIVE_AUTOCOMPLETE.test(node.attrs.autocomplete ?? "")) return true;
  const hint = [node.attrs.name, node.attrs.id, node.attrs["aria-label"], node.attrs.placeholder].join(" ");
  return SENSITIVE_HINT.test(hint);
}

function roleOf(node: SnapNode): string | null {
  const explicit = node.attrs.role;
  if (node.tag === "a") return node.attrs.href !== undefined ? "link" : null;
  if (node.tag === "button") return "button";
  if (node.tag === "select") return "combobox";
  if (node.tag === "textarea") return "textbox";
  if (node.tag === "input") {
    const type = (node.attrs.type ?? "text").toLowerCase();
    if (type === "hidden") return null;
    return INPUT_ROLES[type] ?? "textbox";
  }
  if (explicit && /^(button|link|checkbox|radio|tab|menuitem|switch|textbox|combobox)$/.test(explicit)) {
    return explicit;
  }
  return null;
}

function isHidden(node: SnapNode): boolean {
  if (node.hidden) return true;
  const a = node.attrs;
  if (a.hidden !== undefined || a["aria-hidden"] === "true") return true;
  return /display\s*:\s*none|visibility\s*:\s*hidden/i.test(a.style ?? "");
}

function collectText(node: SnapNode): string {
  if (node.tag === "#text") return node.text ?? "";
  if (SKIP_TAGS.has(node.tag) || isHidden(node)) return "";
  // Never let a sensitive field's content leak into a name.
  if (isSensitiveField(node)) return "";
  return node.children.map(collectText).join(" ");
}

function squash(s: string, max: number): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > max ? t.slice(0, max - 1) + "…" : t;
}

function nameOf(node: SnapNode, labels: Map<string, string>): string {
  const a = node.attrs;
  const own = a["aria-label"] || (a.id && labels.get(a.id)) || a.title || a.placeholder || a.alt;
  if (own) return squash(own, MAX_NAME);
  if (node.tag === "input") {
    const type = (a.type ?? "text").toLowerCase();
    if (BUTTON_TYPES.includes(type)) return squash(node.value ?? a.value ?? "", MAX_NAME);
    return squash(a.name ?? "", MAX_NAME);
  }
  return squash(collectText(node), MAX_NAME);
}

function findLabels(node: SnapNode, out: Map<string, string>): void {
  if (SKIP_TAGS.has(node.tag) || isHidden(node)) return;
  if (node.tag === "label" && node.attrs.for) out.set(node.attrs.for, collectText(node));
  for (const c of node.children) findLabels(c, out);
}

export function buildSnapshot(root: SnapNode, opts: SnapshotOptions): Snapshot {
  const maxText = opts.maxTextChars ?? DEFAULT_MAX_TEXT_CHARS;
  const maxEls = opts.maxElements ?? DEFAULT_MAX_ELEMENTS;
  const labels = new Map<string, string>();
  findLabels(root, labels);

  const parts: string[] = [];
  let used = 0;
  let truncated = false;
  const elements: SnapElement[] = [];

  const push = (s: string): void => {
    if (!s || used >= maxText) return;
    if (used + s.length > maxText) {
      parts.push(s.slice(0, maxText - used));
      used = maxText;
      truncated = true;
      return;
    }
    parts.push(s);
    used += s.length;
  };

  const walk = (node: SnapNode): void => {
    if (node.tag === "#text") {
      push(squash(node.text ?? "", maxText));
      return;
    }
    if (SKIP_TAGS.has(node.tag) || isHidden(node)) return;

    const role = roleOf(node);
    const sensitive = isSensitiveField(node);
    if (role) {
      if (elements.length >= maxEls) {
        truncated = true;
      } else {
        const ref = "e" + (elements.length + 1);
        const el: SnapElement = { ref, tag: node.tag, role, name: nameOf(node, labels) };
        if (node.tag === "input") el.type = (node.attrs.type ?? "text").toLowerCase();
        if (node.attrs.disabled !== undefined) el.disabled = true;
        if (node.tag === "a") el.href = squash(node.attrs.href ?? "", MAX_VALUE);
        if (sensitive) {
          el.redacted = true;
          el.value = REDACTED;
        } else if (
          (node.tag === "input" || node.tag === "textarea" || node.tag === "select") &&
          !BUTTON_TYPES.includes(el.type ?? "")
        ) {
          const v = node.value ?? node.attrs.value;
          if (v) el.value = squash(v, MAX_VALUE);
        }
        elements.push(el);
        opts.onRef?.(ref, node);
        push(`[${ref} ${role}${el.name ? ": " + el.name : ""}]`);
      }
      // Control content is already in the name or value; do not repeat it.
      if (node.tag === "button" || node.tag === "a" || node.tag === "textarea" || node.tag === "select") return;
    }
    if (sensitive) return;

    const block = BLOCK_TAGS.has(node.tag);
    if (block) push("\n");
    for (const c of node.children) walk(c);
    if (block) push("\n");
  };
  walk(root);

  const text = parts
    .join(" ")
    .replace(/[ \t]*\n[ \t\n]*/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
  return { url: opts.url, title: opts.title, text, elements, truncated };
}

/**
 * Adapt a live DOM element. Content script only; not unit-tested (no DOM in Vitest).
 * `map` records which element each node came from, so refs can be resolved (T009).
 */
export function fromElement(el: Element, map?: Map<SnapNode, Element>): SnapNode {
  const attrs: Record<string, string> = {};
  for (const a of Array.from(el.attributes)) attrs[a.name.toLowerCase()] = a.value;
  const node: SnapNode = { tag: el.tagName.toLowerCase(), attrs, children: [] };
  map?.set(node, el);
  if (el instanceof HTMLElement) {
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden") node.hidden = true;
  }
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) {
    node.value = el.value;
  }
  if (node.hidden) return node;
  for (const child of Array.from(el.childNodes)) {
    if (child.nodeType === 3) {
      node.children.push({ tag: "#text", attrs: {}, text: child.textContent ?? "", children: [] });
    } else if (child.nodeType === 1) {
      node.children.push(fromElement(child as Element, map));
    }
  }
  return node;
}
