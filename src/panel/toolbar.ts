// Toolbar button identity (Part 1). Safari has no theme_icons, so the worker
// swaps the monochrome icon itself when the system theme changes. The active
// (filled-lens) icon is for Part 3, while the agent works.
export const TITLE_OPEN = "Open Scout for Safari";
export const TITLE_CLOSE = "Close Scout for Safari";

export const TOOLBAR_SIZES = [16, 19, 32, 38, 48, 64, 128] as const;

/** Icon paths for action.setIcon. `dark`: the toolbar is dark, so the glyph is light. */
export function toolbarIcon(dark: boolean, active = false): Record<string, string> {
  const name = "toolbar" + (active ? "-active" : "") + (dark ? "-dark" : "");
  return Object.fromEntries(TOOLBAR_SIZES.map((s) => [String(s), `icons/${name}-${s}.png`]));
}

/**
 * Opens the toolbar panel: a popover on Mac, Safari's sheet over the page on
 * iPhone and iPad. Used by the page button (src/edge.ts), which must never run
 * the panel inside the page: Safari loads such a frame in the page's process
 * and kills it when the frame uses extension APIs (owner report 2026-10-16).
 */
export async function openPanel(action: { openPopup?(): Promise<void> } | undefined): Promise<{ opened: boolean }> {
  if (!action?.openPopup) return { opened: false };
  try {
    await action.openPopup();
    return { opened: true };
  } catch {
    return { opened: false };
  }
}
