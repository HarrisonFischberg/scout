// Safe Markdown for model answers: parsed to a small AST, mounted with
// createElement and textContent only. No innerHTML, so model output (which may
// quote untrusted page text) cannot inject markup or scripts.
//
// Supports: paragraphs, headings (# to ######), bullet and numbered lists with
// one nested level, block quotes, tables, horizontal rules, fenced code (with
// its language and a Copy button), inline code, **bold**, *italic* / _italic_,
// ***bold italic***, ~~strike~~, http(s) links, math ($...$, \(...\),
// $$...$$, \[...\] as MathML, src/chat/math.ts), and numbered citations [n]
// shown as site chips at the end of the paragraph, list item, quote, or table
// cell that cites them (src/chat/sources.ts).
import { texToMathML } from "./math";
import { siteName, type Source } from "./sources";

export type Inline =
  | { type: "text"; text: string }
  | { type: "code"; text: string }
  | { type: "math"; tex: string }
  | { type: "cite"; n: number }
  | { type: "strong"; children: Inline[] }
  | { type: "em"; children: Inline[] }
  | { type: "del"; children: Inline[] }
  | { type: "link"; href: string; children: Inline[] };

export interface ListItem {
  children: Inline[];
  sub?: { ordered: boolean; items: ListItem[] };
}

export type Block =
  | { type: "paragraph"; children: Inline[] }
  | { type: "heading"; level: 1 | 2 | 3; children: Inline[] }
  | { type: "list"; ordered: boolean; items: ListItem[] }
  | { type: "quote"; children: Inline[] }
  | { type: "table"; header: Inline[][]; rows: Inline[][][] }
  | { type: "rule" }
  | { type: "code"; text: string; lang?: string }
  | { type: "math"; tex: string };

const SAFE_URL = /^https?:\/\//i;

// Order matters: code first (its content is literal), then math (also
// literal), links, citations, then the longest emphasis markers. No
// lookbehind: Safari 16.0–16.3 lacks it.
const INLINE = new RegExp(
  [
    "`([^`]+)`", // 1 code
    "\\\\\\((.+?)\\\\\\)", // 2 math \( \)
    // 3,4 math $...$: no space just inside the dollars and no digit right after,
    // so prices like "$10 and $20" stay text.
    "(^|[^\\\\\\w$])\\$([^\\s$](?:[^$\\n]*?[^\\s$\\\\])?)\\$(?![\\d\\w])",
    "\\[([^\\]]+)\\]\\(((?:[^()\\s]|\\([^()\\s]*\\))+)\\)", // 5,6 link (URL may hold one level of parentheses)
    "\\[(\\d{1,2}(?:\\s*,\\s*\\d{1,2})*)\\](?!\\()", // 7 citation [n] or [n, m]
    "\\*\\*\\*([^*\\s](?:[^*]*[^*\\s])?)\\*\\*\\*", // 8 bold italic
    "\\*\\*([^*\\s](?:[^*]*[^*\\s])?)\\*\\*", // 9 bold
    "__([^_\\s](?:[^_]*[^_\\s])?)__", // 10 bold (underscores)
    "~~([^~\\s](?:[^~]*[^~\\s])?)~~", // 11 strike
    "\\*([^*\\s](?:[^*]*[^*\\s])?)\\*", // 12 italic
    "(^|[^\\w])_([^_\\s](?:[^_]*[^_\\s])?)_(?![\\w])", // 13,14 italic (underscores, not inside words)
  ].join("|"),
  "g",
);

export function parseInline(src: string): Inline[] {
  const out: Inline[] = [];
  const pushText = (text: string): void => {
    if (text) out.push({ type: "text", text });
  };
  let last = 0;
  const re = new RegExp(INLINE.source, "g");
  for (let m = re.exec(src); m; m = re.exec(src)) {
    pushText(src.slice(last, m.index));
    if (m[1] !== undefined) out.push({ type: "code", text: m[1] });
    else if (m[2] !== undefined) out.push({ type: "math", tex: m[2] });
    else if (m[4] !== undefined) {
      pushText(m[3] ?? "");
      out.push({ type: "math", tex: m[4] });
    } else if (m[5] !== undefined && m[6] !== undefined) {
      if (SAFE_URL.test(m[6])) out.push({ type: "link", href: m[6], children: parseInline(m[5]) });
      else pushText(m[5]);
    } else if (m[7] !== undefined) for (const n of m[7].split(",")) out.push({ type: "cite", n: Number(n) });
    else if (m[8] !== undefined) out.push({ type: "strong", children: [{ type: "em", children: parseInline(m[8]) }] });
    else if (m[9] !== undefined) out.push({ type: "strong", children: parseInline(m[9]) });
    else if (m[10] !== undefined) out.push({ type: "strong", children: parseInline(m[10]) });
    else if (m[11] !== undefined) out.push({ type: "del", children: parseInline(m[11]) });
    else if (m[12] !== undefined) out.push({ type: "em", children: parseInline(m[12]) });
    else if (m[14] !== undefined) {
      pushText(m[13] ?? "");
      out.push({ type: "em", children: parseInline(m[14]) });
    }
    last = m.index + m[0].length;
  }
  pushText(src.slice(last));
  return out;
}

const splitRow = (line: string): string[] =>
  line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());

const isTableRule = (line: string): boolean => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line);

export function parseMarkdown(src: string): Block[] {
  const blocks: Block[] = [];
  const lines = src.replace(/\r\n?/g, "\n").split("\n");
  let para: string[] = [];
  let quote: string[] = [];
  let list: { ordered: boolean; items: ListItem[] } | null = null;
  const flushPara = (): void => {
    if (para.length) blocks.push({ type: "paragraph", children: parseInline(para.join(" ")) });
    para = [];
  };
  const flushQuote = (): void => {
    if (quote.length) blocks.push({ type: "quote", children: parseInline(quote.join(" ")) });
    quote = [];
  };
  const flushList = (): void => {
    if (list) blocks.push({ type: "list", ordered: list.ordered, items: list.items });
    list = null;
  };
  const flushAll = (): void => {
    flushPara();
    flushQuote();
    flushList();
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const fence = /^\s*```\s*([\w+#.-]*)/.exec(line);
    if (fence) {
      flushAll();
      const code: string[] = [];
      for (i++; i < lines.length && !/^\s*```/.test(lines[i] ?? ""); i++) code.push(lines[i] ?? "");
      blocks.push({ type: "code", text: code.join("\n"), ...(fence[1] ? { lang: fence[1].slice(0, 20) } : {}) });
      continue;
    }
    // Display math: $$...$$ or \[...\], on one line or several.
    const dm = /^\s*(\$\$|\\\[)(.*)$/.exec(line);
    if (dm) {
      const close = dm[1] === "$$" ? "$$" : "\\]";
      const first = dm[2] ?? "";
      const at = first.indexOf(close);
      if (at >= 0 && first.slice(at + close.length).trim() === "") {
        flushAll();
        blocks.push({ type: "math", tex: first.slice(0, at).trim() });
        continue;
      }
      if (at < 0) {
        const body = [first];
        let j = i + 1;
        for (; j < lines.length; j++) {
          const l = lines[j] ?? "";
          const k = l.indexOf(close);
          if (k >= 0) {
            body.push(l.slice(0, k));
            break;
          }
          body.push(l);
        }
        if (j < lines.length) {
          flushAll();
          blocks.push({ type: "math", tex: body.join("\n").trim() });
          i = j;
          continue;
        }
      }
    }
    // Table: a row with pipes followed by a |---|---| rule.
    if (line.includes("|") && isTableRule(lines[i + 1] ?? "")) {
      flushAll();
      const header = splitRow(line).map(parseInline);
      const rows: Inline[][][] = [];
      for (i += 2; i < lines.length && (lines[i] ?? "").includes("|") && (lines[i] ?? "").trim() !== ""; i++) {
        rows.push(splitRow(lines[i] ?? "").map(parseInline));
      }
      i--;
      blocks.push({ type: "table", header, rows });
      continue;
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      flushAll();
      blocks.push({ type: "rule" });
      continue;
    }
    const heading = /^\s*(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    const bullet = /^(\s*)[-*+•]\s+(.*)$/.exec(line);
    const numbered = /^(\s*)\d+[.)]\s+(.*)$/.exec(line);
    const quoted = /^\s*>\s?(.*)$/.exec(line);
    if (heading) {
      flushAll();
      const level = Math.min((heading[1] ?? "#").length, 3) as 1 | 2 | 3;
      blocks.push({ type: "heading", level, children: parseInline(heading[2] ?? "") });
    } else if (bullet || numbered) {
      flushPara();
      flushQuote();
      const m = (bullet ?? numbered) as RegExpExecArray;
      const ordered = !bullet;
      const indent = (m[1] ?? "").length;
      const item: ListItem = { children: parseInline(m[2] ?? "") };
      const parent = list?.items[list.items.length - 1];
      if (indent >= 2 && list && parent) {
        if (!parent.sub || parent.sub.ordered !== ordered) parent.sub = { ordered, items: [] };
        parent.sub.items.push(item);
      } else {
        if (list && list.ordered !== ordered) flushList();
        if (!list) list = { ordered, items: [] };
        list.items.push(item);
      }
    } else if (quoted) {
      flushPara();
      flushList();
      quote.push((quoted[1] ?? "").trim());
    } else if (line.trim() === "") {
      flushAll();
    } else if (list && /^\s{2,}\S/.test(line)) {
      // Continuation line of the last list item.
      const items = (list as { items: ListItem[] }).items;
      const lastItem = items[items.length - 1];
      if (lastItem) lastItem.children.push({ type: "text", text: " " }, ...parseInline(line.trim()));
    } else {
      flushList();
      flushQuote();
      para.push(line.trim());
    }
  }
  flushAll();
  return blocks;
}

export interface RenderOptions {
  /** Sources the answer may cite as [n]: the shared pages, then web citations. */
  sources?: Source[];
}

/** The source behind each citation chip, for the panel's hover card. */
export const chipSources = new WeakMap<Element, Source>();

// Citations go to the end of their block as chips, so text around a removed
// marker loses the space before it: "rated 4.5 [2]." reads "rated 4.5." .
function mountInline(doc: Document, parent: Node, nodes: Inline[], opts: RenderOptions, cites: number[]): void {
  for (const [i, n] of nodes.entries()) {
    if (n.type === "text") parent.appendChild(doc.createTextNode(n.text));
    else if (n.type === "math") parent.appendChild(texToMathML(doc, n.tex, false));
    else if (n.type === "cite") {
      const src = opts.sources?.[n.n - 1];
      if (src && SAFE_URL.test(src.url)) {
        if (!cites.includes(n.n)) cites.push(n.n);
        const next = nodes[i + 1];
        const before = parent.lastChild;
        if (before?.nodeType === 3 && (!next || next.type === "cite" || (next.type === "text" && /^[\s.,;:!?)]/.test(next.text)))) {
          before.textContent = (before.textContent ?? "").replace(/\s+$/, "");
        }
      } else parent.appendChild(doc.createTextNode("[" + n.n + "]"));
    } else if (n.type === "code") {
      const el = doc.createElement("code");
      el.textContent = n.text;
      parent.appendChild(el);
    } else if (n.type === "link") {
      const el = doc.createElement("a");
      el.setAttribute("href", n.href);
      el.setAttribute("target", "_blank");
      el.setAttribute("rel", "noopener noreferrer");
      mountInline(doc, el, n.children, opts, cites);
      parent.appendChild(el);
    } else {
      const el = doc.createElement(n.type);
      mountInline(doc, el, n.children, opts, cites);
      parent.appendChild(el);
    }
  }
}

/** A block's inline content, then a chip for each source it cites. */
function mountBlock(doc: Document, el: HTMLElement, nodes: Inline[], opts: RenderOptions): void {
  const cites: number[] = [];
  mountInline(doc, el, nodes, opts, cites);
  for (const n of cites) {
    const src = opts.sources![n - 1]!;
    const a = doc.createElement("a");
    a.className = "cite";
    a.setAttribute("href", src.url);
    a.setAttribute("target", "_blank");
    a.setAttribute("rel", "noopener noreferrer");
    a.setAttribute("aria-label", "Source " + n + ": " + (src.title ? src.title + ", " : "") + siteName(src.url));
    a.dataset.cite = String(n);
    a.textContent = siteName(src.url);
    chipSources.set(a, src);
    el.append(" ", a);
  }
}

function mountList(doc: Document, ordered: boolean, items: ListItem[], opts: RenderOptions): HTMLElement {
  const el = doc.createElement(ordered ? "ol" : "ul");
  for (const item of items) {
    const li = doc.createElement("li");
    mountBlock(doc, li, item.children, opts);
    if (item.sub) li.appendChild(mountList(doc, item.sub.ordered, item.sub.items, opts));
    el.appendChild(li);
  }
  return el;
}

export function renderMarkdown(doc: Document, target: HTMLElement, src: string, opts: RenderOptions = {}): void {
  target.replaceChildren();
  for (const b of parseMarkdown(src)) {
    if (b.type === "paragraph") {
      const el = doc.createElement("p");
      mountBlock(doc, el, b.children, opts);
      target.appendChild(el);
    } else if (b.type === "heading") {
      const el = doc.createElement("h" + String(b.level + 2));
      mountBlock(doc, el, b.children, opts);
      target.appendChild(el);
    } else if (b.type === "list") {
      target.appendChild(mountList(doc, b.ordered, b.items, opts));
    } else if (b.type === "quote") {
      const el = doc.createElement("blockquote");
      mountBlock(doc, el, b.children, opts);
      target.appendChild(el);
    } else if (b.type === "table") {
      const wrap = doc.createElement("div");
      wrap.className = "table-wrap";
      const table = doc.createElement("table");
      const head = doc.createElement("thead");
      const hr = doc.createElement("tr");
      for (const cell of b.header) {
        const th = doc.createElement("th");
        th.setAttribute("scope", "col");
        mountBlock(doc, th, cell, opts);
        hr.appendChild(th);
      }
      head.appendChild(hr);
      const body = doc.createElement("tbody");
      for (const row of b.rows) {
        const tr = doc.createElement("tr");
        for (const cell of row) {
          const td = doc.createElement("td");
          mountBlock(doc, td, cell, opts);
          tr.appendChild(td);
        }
        body.appendChild(tr);
      }
      table.append(head, body);
      wrap.appendChild(table);
      target.appendChild(wrap);
    } else if (b.type === "rule") {
      target.appendChild(doc.createElement("hr"));
    } else if (b.type === "math") {
      const wrap = doc.createElement("div");
      wrap.className = "math-block";
      wrap.appendChild(texToMathML(doc, b.tex, true));
      target.appendChild(wrap);
    } else {
      const wrap = doc.createElement("div");
      wrap.className = "code-block";
      const head = doc.createElement("div");
      head.className = "code-head";
      const lang = doc.createElement("span");
      lang.className = "code-lang";
      lang.textContent = b.lang ?? "";
      const copy = doc.createElement("button");
      copy.type = "button";
      copy.className = "code-copy";
      copy.textContent = "Copy";
      copy.setAttribute("aria-label", "Copy code" + (b.lang ? " (" + b.lang + ")" : ""));
      const text = b.text;
      copy.addEventListener("click", () => {
        void navigator.clipboard?.writeText(text).then(
          () => (copy.textContent = "Copied"),
          () => (copy.textContent = "Copy failed"),
        );
      });
      head.append(lang, copy);
      const pre = doc.createElement("pre");
      const code = doc.createElement("code");
      code.textContent = b.text;
      pre.appendChild(code);
      wrap.append(head, pre);
      target.appendChild(wrap);
    }
  }
}
