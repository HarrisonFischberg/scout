// Safe Markdown for model answers: parsed to a small AST, mounted with
// createElement and textContent only. No innerHTML, so model output (which may
// quote untrusted page text) cannot inject markup or scripts.
//
// Supports: paragraphs, headings (# to ######), bullet and numbered lists with
// one nested level, block quotes, tables, horizontal rules, fenced code,
// inline code, **bold**, *italic* / _italic_, ***bold italic***, ~~strike~~,
// and http(s) links.
export type Inline =
  | { type: "text"; text: string }
  | { type: "code"; text: string }
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
  | { type: "code"; text: string };

const SAFE_URL = /^https?:\/\//i;

// Order matters: code first (its content is literal), then links, then the
// longest emphasis markers. No lookbehind: Safari 16.0–16.3 lacks it.
const INLINE = new RegExp(
  [
    "`([^`]+)`", // 1 code
    "\\[([^\\]]+)\\]\\(((?:[^()\\s]|\\([^()\\s]*\\))+)\\)", // 2,3 link (URL may hold one level of parentheses)
    "\\*\\*\\*([^*\\s](?:[^*]*[^*\\s])?)\\*\\*\\*", // 4 bold italic
    "\\*\\*([^*\\s](?:[^*]*[^*\\s])?)\\*\\*", // 5 bold
    "__([^_\\s](?:[^_]*[^_\\s])?)__", // 6 bold (underscores)
    "~~([^~\\s](?:[^~]*[^~\\s])?)~~", // 7 strike
    "\\*([^*\\s](?:[^*]*[^*\\s])?)\\*", // 8 italic
    "(^|[^\\w])_([^_\\s](?:[^_]*[^_\\s])?)_(?![\\w])", // 9,10 italic (underscores, not inside words)
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
    else if (m[2] !== undefined && m[3] !== undefined) {
      if (SAFE_URL.test(m[3])) out.push({ type: "link", href: m[3], children: parseInline(m[2]) });
      else pushText(m[2]);
    } else if (m[4] !== undefined) out.push({ type: "strong", children: [{ type: "em", children: parseInline(m[4]) }] });
    else if (m[5] !== undefined) out.push({ type: "strong", children: parseInline(m[5]) });
    else if (m[6] !== undefined) out.push({ type: "strong", children: parseInline(m[6]) });
    else if (m[7] !== undefined) out.push({ type: "del", children: parseInline(m[7]) });
    else if (m[8] !== undefined) out.push({ type: "em", children: parseInline(m[8]) });
    else if (m[10] !== undefined) {
      pushText(m[9] ?? "");
      out.push({ type: "em", children: parseInline(m[10]) });
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
    if (/^\s*```/.test(line)) {
      flushAll();
      const code: string[] = [];
      for (i++; i < lines.length && !/^\s*```/.test(lines[i] ?? ""); i++) code.push(lines[i] ?? "");
      blocks.push({ type: "code", text: code.join("\n") });
      continue;
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

function mountInline(doc: Document, parent: Node, nodes: Inline[]): void {
  for (const n of nodes) {
    if (n.type === "text") parent.appendChild(doc.createTextNode(n.text));
    else if (n.type === "code") {
      const el = doc.createElement("code");
      el.textContent = n.text;
      parent.appendChild(el);
    } else if (n.type === "link") {
      const el = doc.createElement("a");
      el.setAttribute("href", n.href);
      el.setAttribute("target", "_blank");
      el.setAttribute("rel", "noopener noreferrer");
      mountInline(doc, el, n.children);
      parent.appendChild(el);
    } else {
      const el = doc.createElement(n.type);
      mountInline(doc, el, n.children);
      parent.appendChild(el);
    }
  }
}

function mountList(doc: Document, ordered: boolean, items: ListItem[]): HTMLElement {
  const el = doc.createElement(ordered ? "ol" : "ul");
  for (const item of items) {
    const li = doc.createElement("li");
    mountInline(doc, li, item.children);
    if (item.sub) li.appendChild(mountList(doc, item.sub.ordered, item.sub.items));
    el.appendChild(li);
  }
  return el;
}

export function renderMarkdown(doc: Document, target: HTMLElement, src: string): void {
  target.replaceChildren();
  for (const b of parseMarkdown(src)) {
    if (b.type === "paragraph") {
      const el = doc.createElement("p");
      mountInline(doc, el, b.children);
      target.appendChild(el);
    } else if (b.type === "heading") {
      const el = doc.createElement("h" + String(b.level + 2));
      mountInline(doc, el, b.children);
      target.appendChild(el);
    } else if (b.type === "list") {
      target.appendChild(mountList(doc, b.ordered, b.items));
    } else if (b.type === "quote") {
      const el = doc.createElement("blockquote");
      mountInline(doc, el, b.children);
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
        mountInline(doc, th, cell);
        hr.appendChild(th);
      }
      head.appendChild(hr);
      const body = doc.createElement("tbody");
      for (const row of b.rows) {
        const tr = doc.createElement("tr");
        for (const cell of row) {
          const td = doc.createElement("td");
          mountInline(doc, td, cell);
          tr.appendChild(td);
        }
        body.appendChild(tr);
      }
      table.append(head, body);
      wrap.appendChild(table);
      target.appendChild(wrap);
    } else if (b.type === "rule") {
      target.appendChild(doc.createElement("hr"));
    } else {
      const pre = doc.createElement("pre");
      const code = doc.createElement("code");
      code.textContent = b.text;
      pre.appendChild(code);
      target.appendChild(pre);
    }
  }
}
