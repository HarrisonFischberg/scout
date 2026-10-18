// Getting Scout ready before it is opened (owner request 2026-10-18: from
// Safari not running to Scout open took 2-5 s on iPhone; it should be
// immediate). Two parts, shared by the worker, the panel and tests:
//
// - The worker wakes the app's native handler while a page with the Scout
//   button loads, and again the moment a finger lands on the button, so the
//   panel's Keychain reads find it running instead of starting it.
// - The panel remembers which providers have a saved key (true/false only,
//   never the key) and shows the composer at once from that, while the
//   Keychain read that actually unlocks it finishes in the background.
import type { NativeSend, Provider } from "../keychain";

// ---------- Worker: wake the native handler ----------
/** A page load or tap wakes the handler at most this often. */
export const WARM_EVERY_MS = 20_000;

/**
 * Returns a function that sends the native handler a harmless request
 * (policy.get, the organization blocklist; no Keychain access) unless one
 * went out in the last WARM_EVERY_MS. Resolves true when a request was sent
 * and answered.
 */
export function createWarmer(send: NativeSend, now: () => number = Date.now): () => Promise<boolean> {
  let last = -Infinity;
  let inflight: Promise<boolean> | null = null;
  return () => {
    if (inflight) return inflight;
    if (now() - last < WARM_EVERY_MS) return Promise.resolve(false);
    last = now();
    inflight = send({ type: "policy.get" }).then(
      () => true,
      () => false,
    );
    void inflight.finally(() => (inflight = null));
    return inflight;
  };
}

// ---------- Panel: which providers have a key ----------
/** browser.storage.local key: which providers had a saved key when last checked. */
export const KEY_HINT_KEY = "keyHint";

export type KeyHint = Record<Provider, boolean>;

/** Stored data is untrusted: anything but `true` counts as no key. */
export function parseKeyHint(raw: unknown): KeyHint {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return { anthropic: r.anthropic === true, openai: r.openai === true };
}

export function sameHint(a: KeyHint, b: KeyHint): boolean {
  return a.anthropic === b.anthropic && a.openai === b.openai;
}

/**
 * The provider the panel will most likely use, by the same order as the real
 * key lookup (the chosen provider first, then the other), or null when the
 * hint says no key is saved.
 */
export function hintedProvider(chosen: Provider, hint: KeyHint): Provider | null {
  const other: Provider = chosen === "openai" ? "anthropic" : "openai";
  if (hint[chosen]) return chosen;
  return hint[other] ? other : null;
}
