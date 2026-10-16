// Permission to share with a third-party AI provider (App Store Review
// Guideline 5.1.2(i)). Asked once per provider, before Safari Scout sends
// anything to it. Kept in `browser.storage.local`; Settings shows it and can
// withdraw it; Delete all data clears it with the rest of storage.
import type { Provider } from "../keychain";
import { ProviderError } from "../providers/errors";
import type { FetchLike } from "../providers/types";
import type { StorageArea } from "./settings";

export const CONSENT_KEY = "aiConsent";
/** Bump when what is shared changes materially, so everyone is asked again. */
export const CONSENT_VERSION = 1;

export interface ConsentRecord {
  at: number;
  version: number;
}

export type ConsentMap = Partial<Record<Provider, ConsentRecord>>;

export const PROVIDER_NAMES: Record<Provider, string> = { anthropic: "Anthropic", openai: "OpenAI" };

// OpenAI: its rest-of-world policy, which opens with links to the EU/UK/CH
// and US versions, so one link works in every market (owner, 2026-10-16).
export const PRIVACY_POLICY: Record<Provider, string> = {
  anthropic: "https://www.anthropic.com/legal/privacy",
  openai: "https://openai.com/policies/row-privacy-policy/",
};

// Both privacy policies say they do not cover content sent through the
// providers' business offerings (OpenAI names its API). Requests made with the
// user's own API key fall under these terms instead, so both are linked
// (checked 2026-10-16).
export const API_TERMS: Record<Provider, string> = {
  anthropic: "https://www.anthropic.com/legal/commercial-terms",
  openai: "https://openai.com/enterprise-privacy/",
};

const HOSTS: Record<string, Provider> = { "api.anthropic.com": "anthropic", "api.openai.com": "openai" };

// Stored data is untrusted input: anything malformed, or from an older
// disclosure, counts as no consent.
export function parseConsent(raw: unknown): ConsentMap {
  if (!raw || typeof raw !== "object") return {};
  const out: ConsentMap = {};
  for (const p of ["anthropic", "openai"] as const) {
    const r = (raw as Record<string, unknown>)[p] as Partial<ConsentRecord> | null | undefined;
    if (r && typeof r === "object" && typeof r.at === "number" && r.version === CONSENT_VERSION) {
      out[p] = { at: r.at, version: r.version };
    }
  }
  return out;
}

/**
 * The popup's view of consent. `has` is synchronous so a click handler can
 * check it without losing its user gesture (the site-access prompt needs one).
 */
export class Consent {
  private constructor(
    private readonly storage: StorageArea | undefined,
    private map: ConsentMap,
  ) {}

  static async load(storage: StorageArea | undefined): Promise<Consent> {
    const got = storage ? await storage.get(CONSENT_KEY).catch(() => ({}) as Record<string, unknown>) : {};
    return new Consent(storage, parseConsent(got[CONSENT_KEY]));
  }

  has(p: Provider): boolean {
    return this.map[p] !== undefined;
  }

  record(p: Provider): ConsentRecord | undefined {
    return this.map[p];
  }

  /** Opens the gate at once; the promise settles when storage has it. */
  grant(p: Provider, now: number): Promise<void> {
    this.map = { ...this.map, [p]: { at: now, version: CONSENT_VERSION } };
    return this.save();
  }

  /** Closes the gate at once; the promise settles when storage has it. */
  withdraw(p: Provider): Promise<void> {
    const next = { ...this.map };
    delete next[p];
    this.map = next;
    return this.save();
  }

  /** After Delete all data: storage is already clear. */
  forget(): void {
    this.map = {};
  }

  private async save(): Promise<void> {
    if (this.storage) await this.storage.set({ [CONSENT_KEY]: this.map });
  }
}

/** Shows the consent screen when needed. Nothing is stored unless the user allows it. */
export async function ensureConsent(
  consent: Consent,
  p: Provider,
  ask: (p: Provider) => Promise<boolean>,
  now: number,
): Promise<boolean> {
  if (consent.has(p)) return true;
  if (!(await ask(p))) return false;
  await consent.grant(p, now).catch(() => undefined);
  return true;
}

export function providerForUrl(url: string): Provider | null {
  try {
    return HOSTS[new URL(url).hostname] ?? null;
  } catch {
    return null;
  }
}

/** Wraps fetch so no request reaches a provider API without that provider's consent. */
export function gatedFetch(allowed: (p: Provider) => boolean, fetchFn: FetchLike): FetchLike {
  return async (input, init) => {
    const p = providerForUrl(input);
    if (p && !allowed(p)) throw new ProviderError(p, "consent_required");
    return fetchFn(input, init);
  };
}

export interface ConsentText {
  title: string;
  intro: string;
  items: string[];
  policyLabel: string;
  policyUrl: string;
  termsLabel: string;
  termsUrl: string;
  after: string;
}

/** The consent screen's words. Names only the provider that will receive the data. */
export function consentText(p: Provider): ConsentText {
  const name = PROVIDER_NAMES[p];
  return {
    title: "Share with " + name + "?",
    intro:
      "Safari Scout sends your requests to " + name + ", a third-party AI provider, using your own API key. " +
      "Each time you use Safari Scout, " + name + " receives:",
    items: [
      "Your messages and the tasks you type.",
      "When a request uses the page (questions, Summarize, Control Browser, Find coupons): the page's address, title, and text, " +
        "and for Control Browser and Find coupons its links, buttons, and form fields. Password and card fields are hidden first.",
      "Text of other tabs only when you choose them.",
      "Your API key, only to sign in to " + name + ". Safari Scout never sends it anywhere else.",
    ],
    policyLabel: name + " privacy policy",
    policyUrl: PRIVACY_POLICY[p],
    termsLabel: "How " + name + " handles API data",
    termsUrl: API_TERMS[p],
    after: "Nothing is sent until you choose Allow. You can withdraw this at any time in Settings.",
  };
}
