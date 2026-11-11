// Looks are color schemes (owner 2026-11-10): Bumper is the design every panel
// has, and its green is the default scheme; the six earlier looks stay in
// Settings > Look and now only supply their colors. Trailhead, Deal Hunter,
// Ink & Paper, Aurora and Classic were removed (owner 2026-10-26): a saved one
// reads as unknown, so that panel opens in the default. A scheme is a token set on
// html[data-look] (src/popup.html) plus the new-chat greeting set here.

export type LookId = "bumper" | "glasshouse" | "apple" | "bento" | "pebble" | "cinema" | "nightops";

export interface Look {
  id: LookId;
  name: string;
  /** One line under the name in Settings. */
  blurb: string;
  /** Three colors for the picker's swatch: canvas, accent, highlight. */
  swatch: [string, string, string];
  /** New-chat greeting; an empty title hides it. */
  greeting: { title: string; sub: string };
}

export const LOOKS: readonly Look[] = [
  { id: "bumper", swatch: ["#f3f7ef", "#3b7a2e", "#ffdf80"], name: "Bumper", blurb: "Scout green", greeting: { title: "Where to next?", sub: "" } },
  { id: "glasshouse", swatch: ["#eef3f6", "#00727f", "#ffffff"], name: "Glasshouse", blurb: "Cool sky and teal", greeting: { title: "Ask Scout anything", sub: "" } },
  { id: "apple", swatch: ["#f2f2f7", "#0a6cff", "#34c759"], name: "Pure Apple", blurb: "System grey and blue", greeting: { title: "Ask Scout", sub: "" } },
  { id: "bento", swatch: ["#f2f2f5", "#2747d6", "#ffffff"], name: "Bento", blurb: "Neutral grey and cobalt", greeting: { title: "Pick a start", sub: "" } },
  { id: "pebble", swatch: ["#e9edf3", "#3c5fa8", "#f4f6fa"], name: "Pebble", blurb: "Soft blue-grey", greeting: { title: "Hi, I'm Scout", sub: "" } },
  { id: "cinema", swatch: ["#050506", "#5e6ad2", "#ededef"], name: "Cinema", blurb: "Near-black and indigo", greeting: { title: "What's the plan?", sub: "" } },
  { id: "nightops", swatch: ["#0b0d0c", "#b8f35a", "#e8f0ea"], name: "Night Ops", blurb: "Black and signal lime", greeting: { title: "What should Scout do?", sub: "" } },
];

export const DEFAULT_LOOK: LookId = "bumper";

/** The look a panel opens in before the user picks one: Bumper on every device (owner 2026-11-10; was Glasshouse). */
export function defaultLook(_touch: boolean): LookId {
  return DEFAULT_LOOK;
}
/** storage.local key (source of truth). */
export const LOOK_KEY = "look";
/** localStorage mirror, read synchronously so the panel opens in its look without a flash. */
export const LOOK_CACHE_KEY = "scout.look";

export function parseLook(v: unknown, fallback: LookId = DEFAULT_LOOK): LookId {
  return LOOKS.some((l) => l.id === v) ? (v as LookId) : fallback;
}

export function lookById(id: LookId): Look {
  return LOOKS.find((l) => l.id === id) ?? LOOKS[0];
}

/** Sets the look on the page: the html attribute the CSS keys on, and the greeting text. */
export function applyLook(doc: Document, id: LookId): void {
  doc.documentElement.dataset.look = id;
  const g = lookById(id).greeting;
  const title = doc.getElementById("greeting-title");
  const sub = doc.getElementById("greeting-sub");
  if (title) title.textContent = g.title;
  if (sub) {
    sub.textContent = g.sub;
    sub.hidden = !g.sub;
  }
  const box = doc.getElementById("greeting");
  if (box) box.hidden = !g.title;
}

/** The page's localStorage, which holds only the look id and the mic-refused flag (voice.ts); undefined where blocked. */
export function pageCache(): Storage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

/** The cached look, or the default when storage is unavailable (private window, blocked). */
export function cachedLook(store: Pick<Storage, "getItem"> | undefined, fallback: LookId = DEFAULT_LOOK): LookId {
  try {
    return parseLook(store?.getItem(LOOK_CACHE_KEY), fallback);
  } catch {
    return fallback;
  }
}

export function cacheLook(store: Pick<Storage, "setItem"> | undefined, id: LookId): void {
  try {
    store?.setItem(LOOK_CACHE_KEY, id);
  } catch {
    // Not fatal: storage.local still has it; the next open may start in the default look for a moment.
  }
}

/**
 * On iPhone the look is shared between Scout in Safari and the Scout app's own
 * chat (owner request 2026-11-02), through the Keychain group they already
 * share for the API key. It is only a look id, not a secret; the item is
 * named "look" next to the provider keys.
 */
export const SHARED_LOOK_ACCOUNT = "look";

type Send = (message: unknown) => Promise<unknown>;

/** The look saved by the other side (app or extension), or null when none or unreadable. */
export async function readSharedLook(send: Send): Promise<LookId | null> {
  try {
    const r = (await send({ type: "keychain.get", account: SHARED_LOOK_ACCOUNT })) as { ok?: boolean; value?: unknown } | undefined;
    return r?.ok && LOOKS.some((l) => l.id === r.value) ? (r.value as LookId) : null;
  } catch {
    return null;
  }
}

export async function writeSharedLook(send: Send, id: LookId): Promise<void> {
  try {
    await send({ type: "keychain.set", account: SHARED_LOOK_ACCOUNT, value: id });
  } catch {
    // Not fatal: this side keeps the look; the other side keeps its own until the next change.
  }
}
