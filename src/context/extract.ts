// Page extractor (Part 2, spec 6). Runs inside the page through
// scripting.executeScript({ func: extractPage }), so it must stay
// self-contained: every helper lives inside the function, and nothing outside
// it is referenced. Returns cleaned Markdown plus page metadata, never raw HTML.
//
// Left out on purpose: form controls and their values (input, textarea,
// select, option), password and hidden inputs, content the user is editing
// (contenteditable), scripts, styles, and anything hidden from view. Cookies
// and site storage are never read. The worker redacts token-like strings and
// secret URL parameters afterwards (src/context/clean.ts).

export interface PageMeta {
  description?: string;
  lang?: string;
  canonical?: string;
  site?: string;
  author?: string;
  published?: string;
}

export interface RawPage {
  url: string;
  title: string;
  /** Cleaned Markdown. */
  text: string;
  meta?: PageMeta;
  /** The page was longer than the extractor's cap. */
  truncated?: boolean;
}

export function extractPage(): RawPage {
  const MAX_CHARS = 60_000;
  const MAX_TABLE_ROWS = 50;
  const MAX_META = 300;
  const SKIP = new Set([
    "SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "SVG", "CANVAS", "IFRAME", "OBJECT", "EMBED", "AUDIO", "VIDEO",
    "MAP", "HEAD", "LINK", "META",
    // Form controls: their values are never read.
    "INPUT", "TEXTAREA", "SELECT", "OPTION", "OPTGROUP", "DATALIST", "OUTPUT", "METER", "PROGRESS",
  ]);
  const BLOCK = new Set([
    "P", "DIV", "SECTION", "ARTICLE", "MAIN", "HEADER", "FOOTER", "ASIDE", "NAV", "FIGURE", "FIGCAPTION",
    "ADDRESS", "DETAILS", "SUMMARY", "FORM", "FIELDSET", "LEGEND", "DL", "DT", "DD", "DIALOG", "BODY", "CENTER",
  ]);
  let size = 0;
  let truncated = false;

  const hidden = (el: Element): boolean => {
    const h = el as HTMLElement;
    if (h.hidden || el.getAttribute("aria-hidden") === "true" || el.hasAttribute("inert")) return true;
    if (h.isContentEditable && el.getAttribute("contenteditable") !== null) return true;
    const check = (el as Element & { checkVisibility?: (o?: object) => boolean }).checkVisibility;
    if (typeof check === "function") return !check.call(el, { visibilityProperty: true });
    const cs = getComputedStyle(el);
    return cs.display === "none" || cs.visibility === "hidden";
  };

  const squash = (s: string): string => s.replace(/\s+/g, " ");

  const inline = (el: Element): string => walkChildren(el, 0).replace(/\s*\n\s*/g, " ").trim();

  const walkChildren = (el: Element | ShadowRoot, depth: number): string => {
    let out = "";
    for (const child of Array.from(el.childNodes)) {
      if (truncated) break;
      out += walk(child, depth);
    }
    return out;
  };

  const listItems = (list: Element, depth: number, ordered: boolean): string => {
    let n = 0;
    let out = "";
    for (const li of Array.from(list.children)) {
      if (li.tagName !== "LI" || hidden(li)) continue;
      n++;
      const marker = ordered ? n + ". " : "- ";
      const body = walkChildren(li, depth + 1).trim().replace(/\n{2,}/g, "\n");
      if (!body) continue;
      const indent = "  ".repeat(depth);
      out += indent + marker + body.replace(/\n/g, "\n" + indent + "  ") + "\n";
    }
    return out ? "\n\n" + out + "\n" : "";
  };

  const table = (t: Element): string => {
    const rows = Array.from(t.querySelectorAll("tr")).filter((r) => !hidden(r)).slice(0, MAX_TABLE_ROWS);
    if (!rows.length) return "";
    const lines: string[] = [];
    rows.forEach((r, i) => {
      const cells = Array.from(r.children)
        .filter((c) => (c.tagName === "TD" || c.tagName === "TH") && !hidden(c))
        .map((c) => inline(c).replace(/\|/g, "\\|"));
      if (!cells.length) return;
      lines.push("| " + cells.join(" | ") + " |");
      if (i === 0) lines.push("|" + cells.map(() => " --- ").join("|") + "|");
    });
    return "\n\n" + lines.join("\n") + "\n\n";
  };

  const walk = (node: Node, depth: number): string => {
    if (truncated) return "";
    if (node.nodeType === Node.TEXT_NODE) {
      const t = squash(node.textContent ?? "");
      size += t.length;
      if (size > MAX_CHARS) {
        truncated = true;
        return t.slice(0, Math.max(0, t.length - (size - MAX_CHARS)));
      }
      return t;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return "";
    const el = node as Element;
    const tag = el.tagName.toUpperCase();
    if (SKIP.has(tag) || hidden(el)) return "";
    const heading = /^H([1-6])$/.exec(tag);
    if (heading) {
      const text = inline(el);
      return text ? "\n\n" + "#".repeat(Number(heading[1])) + " " + text + "\n\n" : "";
    }
    switch (tag) {
      case "BR":
        return "\n";
      case "HR":
        return "\n\n---\n\n";
      case "UL":
      case "MENU":
        return listItems(el, depth, false);
      case "OL":
        return listItems(el, depth, true);
      case "LI":
        return "\n- " + inline(el) + "\n";
      case "TABLE":
        return table(el);
      case "PRE": {
        const code = (el.textContent ?? "").replace(/\n+$/, "");
        size += code.length;
        if (size > MAX_CHARS) truncated = true;
        return code.trim() ? "\n\n```\n" + code + "\n```\n\n" : "";
      }
      case "CODE": {
        const code = squash(el.textContent ?? "").trim();
        return code ? "`" + code.replace(/`/g, "'") + "`" : "";
      }
      case "STRONG":
      case "B": {
        const t = inline(el);
        return t ? " **" + t + "** " : "";
      }
      case "EM":
      case "I": {
        const t = inline(el);
        return t ? " *" + t + "* " : "";
      }
      case "A": {
        const t = inline(el);
        if (!t) return "";
        const href = (el as HTMLAnchorElement).href;
        return /^https?:\/\//i.test(href) ? "[" + t + "](" + href + ")" : t;
      }
      case "IMG": {
        const alt = squash(el.getAttribute("alt") ?? "").trim();
        return alt ? " ![" + alt + "] " : "";
      }
      case "BLOCKQUOTE": {
        const body = walkChildren(el, depth).trim();
        return body ? "\n\n" + body.split("\n").map((l) => "> " + l).join("\n") + "\n\n" : "";
      }
    }
    const inner = walkChildren(el, depth);
    return BLOCK.has(tag) ? "\n\n" + inner + "\n\n" : inner;
  };

  const meta = (selector: string): string | undefined => {
    const v = document.querySelector(selector)?.getAttribute("content");
    const t = v ? squash(v).trim().slice(0, MAX_META) : "";
    return t || undefined;
  };

  // The main content when the page marks it, else the whole body.
  const main = document.querySelector("main, [role=main]");
  const root = main && !hidden(main) && (main.textContent ?? "").trim().length > 200 ? main : document.body;
  const text = (root ? walk(root, 0) : "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+(?=[^ \t\-\d>|`*#])/g, "\n")
    .replace(/ {2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  const out: PageMeta = {};
  const description = meta('meta[name="description"]') ?? meta('meta[property="og:description"]');
  if (description) out.description = description;
  const lang = document.documentElement.lang.trim().slice(0, 20);
  if (lang) out.lang = lang;
  const canonical = (document.querySelector('link[rel="canonical"]') as HTMLLinkElement | null)?.href;
  if (canonical && /^https?:\/\//i.test(canonical)) out.canonical = canonical.slice(0, MAX_META);
  const site = meta('meta[property="og:site_name"]');
  if (site) out.site = site;
  const author = meta('meta[name="author"]');
  if (author) out.author = author;
  const published = meta('meta[property="article:published_time"]') ?? document.querySelector("time[datetime]")?.getAttribute("datetime")?.slice(0, 40);
  if (published) out.published = published;

  return { url: location.href, title: squash(document.title).trim(), text, meta: out, ...(truncated ? { truncated: true } : {}) };
}
