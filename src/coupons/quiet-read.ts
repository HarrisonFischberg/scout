// Quiet page reading for Find coupons (owner's choice "Quiet only",
// 2026-10-19): coupon pages the provider's reader could not load are
// downloaded from the background worker and read there, so no tab ever opens
// in the user's Safari, on Mac or iPhone. A download runs no page scripts and
// cannot press "Show code", so codes a site keeps in its page data
// (data-code attributes, embedded JSON) are written into the text as
// "Code: X" lines; a code shown only after a press is not found.
//
// Requests carry no cookies (`credentials: "omit"`): the user's sign-ins never
// reach coupon sites, and nothing lands in Safari's history.
import { buildSnapshot, type SnapNode, type Snapshot } from "../snapshot/snapshot";
import type { PageBrowser } from "./browser-read";

export const QUIET_FETCH_MS = 15_000;
/** Bytes of HTML read from one page; coupon pages are well under this. */
export const QUIET_MAX_BYTES = 3_000_000;
const SNAPSHOT = { maxElements: 600, maxTextChars: 60_000 };
const MAX_DATA_CODES = 60;

const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);
const RAW = new Set(["script", "style", "textarea", "title", "noscript", "template"]);
// Attributes coupon sites keep the full code in, behind a masked "Show code" button.
const CODE_ATTR = /^data-(?:clipboard-text|code|coupon|coupon-?code|promo|promo-?code|discount-?code|voucher|voucher-?code)$/;
const DATA_CODE = /^[A-Za-z0-9][A-Za-z0-9_-]{3,24}$/;
const JSON_CODE = /"(?:code|couponCode|coupon_code|promoCode|promo_code|discountCode|discount_code|voucherCode)"\s*:\s*"([A-Za-z0-9][A-Za-z0-9_-]{3,24})"/g;
const JSON_LABEL = /"(?:title|name|description|offer|headline)"\s*:\s*"((?:[^"\\]|\\.){3,160})"/g;

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—", hellip: "…", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“" };
export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

function parseAttrs(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /([^\s=/"'>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
  for (let m = re.exec(s); m; m = re.exec(s)) {
    const name = m[1]!.toLowerCase();
    if (!(name in out)) out[name] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? "");
  }
  return out;
}

const text = (t: string): SnapNode => ({ tag: "#text", attrs: {}, text: t, children: [] });

/** "Code: X" lines for codes in a page's embedded JSON, each with the nearest offer title. */
export function jsonCodes(json: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const labels: Array<{ at: number; label: string }> = [];
  for (let m = JSON_LABEL.exec(json); m; m = JSON_LABEL.exec(json)) labels.push({ at: m.index, label: m[1]!.replace(/\\(.)/g, "$1") });
  JSON_LABEL.lastIndex = 0;
  for (let m = JSON_CODE.exec(json); m && out.length < MAX_DATA_CODES; m = JSON_CODE.exec(json)) {
    const code = m[1]!;
    if (seen.has(code)) continue;
    seen.add(code);
    const at = m.index;
    // The offer's title is a sibling key in the same JSON object as the code.
    const from = json.lastIndexOf("{", at);
    const to = json.indexOf("}", at);
    const near = labels.filter((l) => l.at > from && (to < 0 || l.at < to)).sort((a, b) => Math.abs(a.at - at) - Math.abs(b.at - at))[0];
    out.push((near ? decodeEntities(near.label) + " " : "") + "Code: " + code);
  }
  JSON_CODE.lastIndex = 0;
  return out;
}

/**
 * A tolerant HTML parser into the snapshot's node tree (no DOM needed, so it
 * runs in the worker and in unit tests). Codes held in data attributes and
 * embedded JSON become visible "Code: X" text.
 */
export function parseHtml(html: string): { root: SnapNode; title: string } {
  const root: SnapNode = { tag: "body", attrs: {}, children: [] };
  const stack: SnapNode[] = [root];
  const data: string[] = [];
  let title = "";
  const top = (): SnapNode => stack[stack.length - 1]!;
  const re = /<!--[\s\S]*?-->|<![^>]*>|<\?[^>]*>|<\/\s*([a-zA-Z][\w:-]*)\s*>|<([a-zA-Z][\w:-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g;
  let last = 0;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    if (m.index > last) top().children.push(text(decodeEntities(html.slice(last, m.index))));
    last = re.lastIndex;
    if (m[1]) {
      const tag = m[1].toLowerCase();
      const i = stack.map((n) => n.tag).lastIndexOf(tag);
      if (i > 0) stack.length = i;
      continue;
    }
    if (!m[2]) continue;
    const tag = m[2].toLowerCase();
    const raw = m[3] ?? "";
    const attrs = parseAttrs(raw.replace(/\/\s*$/, ""));
    if (tag === "html" || tag === "body" || tag === "head") continue;
    const node: SnapNode = { tag, attrs, children: [] };
    for (const [k, v] of Object.entries(attrs)) {
      if (CODE_ATTR.test(k) && DATA_CODE.test(v.trim())) {
        node.children.push(text(" Code: " + v.trim() + " "));
        break;
      }
    }
    if (tag === "input" && attrs.value !== undefined) node.value = attrs.value;
    if (RAW.has(tag)) {
      const end = html.toLowerCase().indexOf("</" + tag, last);
      const body = html.slice(last, end < 0 ? html.length : end);
      const close = end < 0 ? html.length : html.indexOf(">", end) + 1 || html.length;
      re.lastIndex = last = close;
      if (tag === "title") title ||= decodeEntities(body).trim();
      else if (tag === "textarea") node.children.push(text(decodeEntities(body)));
      else if (tag === "script" && /json/i.test(attrs.type ?? "")) data.push(...jsonCodes(body));
      if (tag !== "title") top().children.push(node);
      continue;
    }
    top().children.push(node);
    if (!VOID.has(tag) && !/\/\s*$/.test(raw)) stack.push(node);
  }
  if (last < html.length) top().children.push(text(decodeEntities(html.slice(last))));
  if (data.length) {
    root.children.push({ tag: "section", attrs: {}, children: [...new Set(data)].slice(0, MAX_DATA_CODES).map((l) => ({ tag: "p", attrs: {}, children: [text(l)] })) });
  }
  return { root, title };
}

/** A downloaded page as the coupon reader's snapshot. */
export function htmlSnapshot(html: string, url: string): Snapshot {
  const { root, title } = parseHtml(html);
  return buildSnapshot(root, { url, title, ...SNAPSHOT });
}

export interface QuietDeps {
  fetch: (url: string, init: RequestInit) => Promise<Response>;
  /** Whether Safari gives Scout access to the page's site. */
  hasAccess: (origin: string) => Promise<boolean>;
  timeoutMs?: number;
}

/**
 * Find coupons' page browser that opens no tabs: each page is downloaded once
 * and read as it arrived. `quiet` tells browserRead not to wait for rendering
 * or press anything.
 */
export function quietPages(deps: QuietDeps): PageBrowser {
  const pages = new Map<number, Snapshot>();
  let next = 1;
  return {
    quiet: true,
    open: async (url) => {
      let origin: string;
      try {
        origin = new URL(url).origin + "/*";
      } catch {
        return null;
      }
      if (!(await deps.hasAccess(origin).catch(() => false))) return null;
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), deps.timeoutMs ?? QUIET_FETCH_MS);
      try {
        const res = await deps.fetch(url, { credentials: "omit", redirect: "follow", signal: ctl.signal, headers: { Accept: "text/html,application/xhtml+xml" } });
        if (!res.ok) throw new Error("http " + res.status);
        const type = res.headers.get("content-type") ?? "";
        if (type && !/html|xml/i.test(type)) throw new Error("not html");
        const html = (await res.text()).slice(0, QUIET_MAX_BYTES);
        const id = next++;
        pages.set(id, htmlSnapshot(html, res.url || url));
        return id;
      } finally {
        clearTimeout(timer);
      }
    },
    read: async (tab) => pages.get(tab) ?? null,
    click: async () => false,
    close: async (tab) => void pages.delete(tab),
    wait: (ms) => new Promise((r) => setTimeout(r, ms)),
  };
}
