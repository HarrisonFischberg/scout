// Which browser this build is for (scripts/build.mjs, SCOUT_TARGET), and the
// few words that differ between Safari, Chrome and Firefox.
export type Target = "safari" | "chrome" | "firefox";

export const TARGET: Target = typeof __SCOUT_TARGET__ !== "undefined" ? __SCOUT_TARGET__ : "safari";

const NAMES: Record<Target, string> = { safari: "Safari", chrome: "Chrome", firefox: "Firefox" };

/** "Safari", "Chrome" or "Firefox". */
export function browserName(target: Target = TARGET): string {
  return NAMES[target];
}

/** Where the API key is kept, to end "saved in …": the Keychain on Safari, local extension storage elsewhere. */
export function keyPlace(target: Target = TARGET): string {
  return target === "safari" ? "your Keychain" : "this browser";
}

/** Where the user removes Scout's site access by hand. */
export function siteAccessSettings(target: Target = TARGET): string {
  if (target === "chrome") return "In Chrome, open Extensions, then Scout AI Assistant, Details, Site access.";
  if (target === "firefox") return "In Firefox, open Add-ons and themes, then Scout AI Assistant, Permissions.";
  return "On iPhone, Settings > Apps > Safari > Extensions > Scout; on Mac, Safari > Settings > Extensions > Scout > Edit Websites.";
}

/**
 * Static panel text written for Safari carries its Chrome/Firefox wording in
 * data-other-browsers ({browser} becomes the browser's name). Swaps it in on
 * those browsers; Safari keeps the HTML as written.
 */
export function applyBrowserText(root: ParentNode, target: Target = TARGET): void {
  if (target === "safari") return;
  for (const el of Array.from(root.querySelectorAll<HTMLElement>("[data-other-browsers]"))) {
    el.textContent = (el.dataset.otherBrowsers ?? "").split("{browser}").join(browserName(target));
  }
}
