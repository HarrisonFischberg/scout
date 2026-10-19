// Looks (owner choice 2026-10-19, UI review in impeccable-review/): Trailhead is
// the default; the other four refresh directions and the original design stay
// available in Settings > Look. A look is CSS on html[data-look] (src/popup.html)
// plus the new-chat greeting set here.

export type LookId = "trailhead" | "apple" | "nightops" | "dealhunter" | "ink" | "classic";

export interface Look {
  id: LookId;
  name: string;
  /** One line under the name in Settings. */
  blurb: string;
  /** Three colors for the picker's swatch: canvas, accent, highlight. */
  swatch: [string, string, string];
  /** New-chat greeting; empty for the original design, which has none. */
  greeting: { title: string; sub: string };
}

export const LOOKS: readonly Look[] = [
  { id: "trailhead", swatch: ["#f6f1e7", "#2f6b3a", "#f2c14e"], name: "Trailhead", blurb: "Warm sand and forest green", greeting: { title: "Where to next?", sub: "Ask about this page, or send Scout to do it." } },
  { id: "apple", swatch: ["#f2f2f7", "#0a6cff", "#34c759"], name: "Pure Apple", blurb: "Like Safari's own apps", greeting: { title: "Ask Scout", sub: "About this page, or a task to do on it." } },
  { id: "nightops", swatch: ["#0b0d0c", "#b8f35a", "#e8f0ea"], name: "Night Ops", blurb: "Dark console, signal lime", greeting: { title: "What should Scout do?", sub: "Type a question, or pick a command." } },
  { id: "dealhunter", swatch: ["#fff6e5", "#c2410c", "#ffd34d"], name: "Deal Hunter", blurb: "Bold and bright, for shopping", greeting: { title: "What are we hunting?", sub: "Deals, answers, or a job done on this page." } },
  { id: "ink", swatch: ["#fbfaf7", "#141414", "#8a2c0d"], name: "Ink & Paper", blurb: "Calm, for reading", greeting: { title: "What would you like to know?", sub: "On this page" } },
  { id: "classic", swatch: ["#f5f5f7", "#0071e3", "#e8e8ed"], name: "Classic", blurb: "The original gray and blue", greeting: { title: "", sub: "" } },
];

export const DEFAULT_LOOK: LookId = "trailhead";
/** storage.local key (source of truth). */
export const LOOK_KEY = "look";
/** localStorage mirror, read synchronously so the panel opens in its look without a flash. */
export const LOOK_CACHE_KEY = "scout.look";

export function parseLook(v: unknown): LookId {
  return LOOKS.some((l) => l.id === v) ? (v as LookId) : DEFAULT_LOOK;
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
  if (sub) sub.textContent = g.sub;
  const box = doc.getElementById("greeting");
  if (box) box.hidden = !g.title;
}

/** The page's localStorage, which holds only the look id; undefined where blocked. */
export function pageCache(): Storage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

/** The cached look, or the default when storage is unavailable (private window, blocked). */
export function cachedLook(store: Pick<Storage, "getItem"> | undefined): LookId {
  try {
    return parseLook(store?.getItem(LOOK_CACHE_KEY));
  } catch {
    return DEFAULT_LOOK;
  }
}

export function cacheLook(store: Pick<Storage, "setItem"> | undefined, id: LookId): void {
  try {
    store?.setItem(LOOK_CACHE_KEY, id);
  } catch {
    // Not fatal: storage.local still has it; the next open may start in the default look for a moment.
  }
}
