// Looks (owner choice 2026-10-19, UI review in impeccable-review/; five more and
// Glasshouse as the default on every device 2026-10-26; Trailhead, Aurora,
// Deal Hunter, Ink & Paper and Classic removed 2026-10-26, a saved one falls
// back to Glasshouse): the others stay in Settings > Look. A look is CSS on html[data-look] (src/popup.html)
// plus the new-chat greeting set here.

export type LookId = "apple" | "glasshouse" | "bento" | "pebble" | "cinema" | "nightops";

export interface Look {
  id: LookId;
  name: string;
  /** One line under the name in Settings. */
  blurb: string;
  /** Three colors for the picker's swatch: canvas, accent, highlight. */
  swatch: [string, string, string];
  /** New-chat greeting. */
  greeting: { title: string; sub: string };
}

export const LOOKS: readonly Look[] = [
  { id: "apple", swatch: ["#f2f2f7", "#0a6cff", "#34c759"], name: "Pure Apple", blurb: "Like Safari's own apps", greeting: { title: "Ask Scout", sub: "" } },
  // Round two (owner choice 2026-10-26, from the Liquid Glass, SwiftUI Expert and UI/UX Pro Max skills).
  { id: "glasshouse", swatch: ["#eef3f6", "#00727f", "#ffffff"], name: "Glasshouse", blurb: "Cool sky and teal, calm", greeting: { title: "Ask Scout anything", sub: "" } },
  { id: "bento", swatch: ["#f2f2f5", "#2747d6", "#ffffff"], name: "Bento", blurb: "Bold tiles, easy to scan", greeting: { title: "Pick a start", sub: "" } },
  { id: "pebble", swatch: ["#e9edf3", "#3c5fa8", "#f4f6fa"], name: "Pebble", blurb: "Soft and tactile", greeting: { title: "Hi, I'm Scout", sub: "" } },
  { id: "cinema", swatch: ["#050506", "#5e6ad2", "#ededef"], name: "Cinema", blurb: "Deep dark with an indigo glow", greeting: { title: "What's the plan?", sub: "" } },
  { id: "nightops", swatch: ["#0b0d0c", "#b8f35a", "#e8f0ea"], name: "Night Ops", blurb: "Dark console, signal lime", greeting: { title: "What should Scout do?", sub: "" } },
];

export const DEFAULT_LOOK: LookId = "glasshouse";

/** The look a panel opens in before the user picks one: Glasshouse on every device (owner 2026-10-26; was Pure Apple on iPhone, Trailhead on Mac). */
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
