// Minimal safe Markdown: parsed to a small AST, mounted with createElement and
// textContent only. No innerHTML, so model output cannot inject markup.
export type Inline =
  | { type: "text"; text: string }
  | { type: "code"; text: string }
  | { type: "strong"; children: Inline[] }
  | { type: "link"; href: string; children: Inline[] };

export type Block =
  | { type: "paragraph"; children: Inline[] }
  | { type: "heading"; level: 1 | 2 | 3; children: Inline[] }
  | { type: "list"; ordered: boolean; items: Inline[][] }
  | { type: "code"; text: string };

const SAFE_URL = /^https?:\/\//i;

export function parseInline(src: string): Inline[] {
  const out: Inline[] = [];
  const re = /`([^`]+)`|\*\*([^*]+)\*\*|\[([^\]]+)\]\(([^)\s]+)\)/g;
  let last = 0;
  for (let m = re.exec(src); m; m = re.exec(src)) {
    if (m.index > last) out.push({ type: "text", text: src.slice(last, m.index) });
    if (m[1] !== undefined) out.push({ type: "code", text: m[1] });
    else if (m[2] !== undefined) out.push({ type: "strong", children: parseInline(m[2]) });
    else if (m[3] !== undefined && m[4] !== undefined) {
      if (SAFE_URL.test(m[4])) out.push({ type: "link", href: m[4], children: parseInline(m[3]) });
      else out.push({ type: "text", text: m[3] });
    }
    last = m.index + m[0].length;
  }
  if (last < src.length) out.push({ type: "text", text: src.slice(last) });
  return out;
}

export function parseMarkdown(src: string): Block[] {
  const blocks: Block[] = [];
  const lines = src.replace(/\r\n?/g, "\n").split("\n");
  let para: string[] = [];
  let list: { ordered: boolean; items: Inline[][] } | null = null;
  const flushPara = () => {
    if (para.length) blocks.push({ type: "paragraph", children: parseInline(para.join(" ")) });
    para = [];
  };
  const flushList = () => {
    if (list) blocks.push({ type: "list", ordered: list.ordered, items: list.items });
    list = null;
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (line.startsWith("```")) {
      flushPara();
      flushList();
      const code: string[] = [];
      for (i++; i < lines.length && !(lines[i] ?? "").startsWith("```"); i++) code.push(lines[i] ?? "");
      blocks.push({ type: "code", text: code.join("\n") });
      continue;
    }
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    const bullet = /^\s*[-*]\s+(.*)$/.exec(line);
    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (heading) {
      flushPara();
      flushList();
      blocks.push({
        type: "heading",
        level: (heading[1] ?? "#").length as 1 | 2 | 3,
        children: parseInline(heading[2] ?? ""),
      });
    } else if (bullet || numbered) {
      flushPara();
      const ordered = !bullet;
      if (list && list.ordered !== ordered) flushList();
      if (!list) list = { ordered, items: [] };
      list.items.push(parseInline((bullet ?? numbered)?.[1] ?? ""));
    } else if (line.trim() === "") {
      flushPara();
      flushList();
    } else {
      flushList();
      para.push(line.trim());
    }
  }
  flushPara();
  flushList();
  return blocks;
}

function mountInline(doc: Document, parent: Node, nodes: Inline[]): void {
  for (const n of nodes) {
    if (n.type === "text") parent.appendChild(doc.createTextNode(n.text));
    else if (n.type === "code") {
      const el = doc.createElement("code");
      el.textContent = n.text;
      parent.appendChild(el);
    } else if (n.type === "strong") {
      const el = doc.createElement("strong");
      mountInline(doc, el, n.children);
      parent.appendChild(el);
    } else {
      const el = doc.createElement("a");
      el.setAttribute("href", n.href);
      el.setAttribute("target", "_blank");
      el.setAttribute("rel", "noopener noreferrer");
      mountInline(doc, el, n.children);
      parent.appendChild(el);
    }
  }
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
      const el = doc.createElement(b.ordered ? "ol" : "ul");
      for (const item of b.items) {
        const li = doc.createElement("li");
        mountInline(doc, li, item);
        el.appendChild(li);
      }
      target.appendChild(el);
    } else {
      const pre = doc.createElement("pre");
      const code = doc.createElement("code");
      code.textContent = b.text;
      pre.appendChild(code);
      target.appendChild(pre);
    }
  }
}
