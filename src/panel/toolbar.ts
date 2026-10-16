// Toolbar button identity (Part 1). Safari has no theme_icons, so the worker
// swaps the monochrome icon itself when the system theme changes. The active
// (filled-lens) icon is for Part 3, while the agent works.
export const TITLE_OPEN = "Open Safari Scout";
export const TITLE_CLOSE = "Close Safari Scout";

export const TOOLBAR_SIZES = [16, 19, 32, 38, 48, 64, 128] as const;

/** Icon paths for action.setIcon. `dark`: the toolbar is dark, so the glyph is light. */
export function toolbarIcon(dark: boolean, active = false): Record<string, string> {
  const name = "toolbar" + (active ? "-active" : "") + (dark ? "-dark" : "");
  return Object.fromEntries(TOOLBAR_SIZES.map((s) => [String(s), `icons/${name}-${s}.png`]));
}
