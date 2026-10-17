// Cleans what the page extractor returned before it leaves the device
// (Part 2, spec 6 and 10a): no credentials or tokens in page content, URLs
// without secret parameters, a size cap, and a short metadata header.
import type { PageContext } from "../chat/prompt";
import type { PageMeta, RawPage } from "./extract";

export const REDACTED = "[REDACTED]";

// Query and fragment parameters that carry credentials or one-time codes.
const SECRET_PARAM =
  /^(?:token|access_token|id_token|refresh_token|auth|auth_token|authorization|code|state|session|session_id|sessionid|sid|sig|signature|key|api_key|apikey|password|pass|pwd|secret|client_secret|jwt|otp|nonce|ticket|x-amz-signature|x-amz-credential|x-amz-security-token)$/i;

function cleanParams(params: URLSearchParams): boolean {
  let changed = false;
  for (const name of [...new Set(params.keys())]) {
    if (SECRET_PARAM.test(name)) {
      params.set(name, REDACTED);
      changed = true;
    }
  }
  return changed;
}

/** The URL without user info or secret query/fragment values. Non-URLs come back unchanged. */
export function cleanUrl(url: string): string {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return url;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return url;
  u.username = "";
  u.password = "";
  const query = new URLSearchParams(u.search);
  if (cleanParams(query)) u.search = query.toString();
  // OAuth implicit flows put tokens in the fragment (#access_token=...).
  if (u.hash.includes("=")) {
    const frag = new URLSearchParams(u.hash.slice(1));
    if (cleanParams(frag)) u.hash = frag.toString();
  }
  return u.toString();
}

const SECRET_PATTERNS: Array<[RegExp, string]> = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, REDACTED],
  // JSON Web Tokens.
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, REDACTED],
  // Provider and platform API keys (sk-ant-..., sk-proj-..., sk-...).
  [/\bsk-[A-Za-z0-9_-]{16,}/g, REDACTED],
  [/\b(?:ghp|gho|ghu|ghs|ghr|github_pat)_[A-Za-z0-9_]{20,}/g, REDACTED],
  [/\bAKIA[0-9A-Z]{16}\b/g, REDACTED],
  [/\bxox[abposr]-[A-Za-z0-9-]{10,}/g, REDACTED],
  [/\bAIza[0-9A-Za-z_-]{35}\b/g, REDACTED],
  // Authorization header values written out on a page.
  [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{16,}/g, "$1 " + REDACTED],
];

/** Removes credentials and tokens from page text, and secret parameters from the URLs in it. */
export function redactSecrets(text: string): string {
  let out = text;
  for (const [re, to] of SECRET_PATTERNS) out = out.replace(re, to);
  return out.replace(/https?:\/\/[^\s)\]>"']+/g, (u) => cleanUrl(u));
}

function metaLines(meta: PageMeta | undefined): string[] {
  if (!meta) return [];
  const lines: string[] = [];
  if (meta.site) lines.push("Site: " + meta.site);
  if (meta.description) lines.push("Description: " + meta.description);
  if (meta.author) lines.push("Author: " + meta.author);
  if (meta.published) lines.push("Published: " + meta.published);
  if (meta.lang) lines.push("Language: " + meta.lang);
  if (meta.canonical) lines.push("Canonical URL: " + cleanUrl(meta.canonical));
  return lines;
}

const str = (v: unknown): string => (typeof v === "string" ? v : "");

/**
 * Checks the extractor's result (page data is untrusted input) and returns a
 * cleaned page, or null when it is not a page. `partial` is true when the
 * text was cut to fit.
 */
export function toPageContext(raw: unknown, maxChars = 60_000): { page: PageContext; partial: boolean } | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Partial<RawPage> & Record<string, unknown>;
  const url = str(r.url);
  if (!url) return null;
  const meta = r.meta && typeof r.meta === "object" ? (r.meta as PageMeta) : undefined;
  const safeMeta: PageMeta = {};
  for (const k of ["description", "lang", "canonical", "site", "author", "published"] as const) {
    const v = meta?.[k];
    if (typeof v === "string" && v) safeMeta[k] = v.slice(0, 300);
  }
  let body = str(r.text);
  let partial = r.truncated === true;
  if (body.length > maxChars) {
    body = body.slice(0, maxChars);
    partial = true;
  }
  const header = metaLines(safeMeta);
  const text = redactSecrets((header.length ? header.join("\n") + "\n\n" : "") + body);
  return { page: { url: cleanUrl(url), title: redactSecrets(str(r.title).slice(0, 300)), text }, partial };
}
