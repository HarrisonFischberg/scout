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

/** Waits before trying `openPopup` again after Safari refuses it. */
export const OPEN_RETRY_MS = [250, 600] as const;

export interface PanelOpened {
  opened: boolean;
  /** Safari's reason for the last refusal (its error text, no page data). */
  reason?: string;
  /** How many times `openPopup` was called. */
  tries: number;
}

/**
 * Opens the toolbar panel: a popover on Mac, Safari's sheet over the page on
 * iPhone and iPad. Used by the page button (src/edge.ts), which must never run
 * the panel inside the page: Safari loads such a frame in the page's process
 * and kills it when the frame uses extension APIs (owner report 2026-10-16).
 *
 * Safari sometimes refuses with "Another popup is already open" right after a
 * sheet closes (owner report 2026-10-19: the page button would not open Scout
 * until he went through the extensions menu), so a refusal is retried twice
 * after short waits before the tab says it could not open.
 */
export async function openPanel(
  action: { openPopup?(): Promise<void> } | undefined,
  wait: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
): Promise<PanelOpened> {
  if (!action?.openPopup) return { opened: false, reason: "openPopup unavailable", tries: 0 };
  let reason = "";
  for (let tries = 1; ; tries++) {
    try {
      await action.openPopup();
      return { opened: true, tries };
    } catch (err) {
      reason = err instanceof Error ? err.message : String(err);
    }
    const ms = OPEN_RETRY_MS[tries - 1];
    if (ms === undefined) return { opened: false, reason: reason.slice(0, 200), tries };
    await wait(ms);
  }
}

/**
 * Whether the worker opens the panel after switching to a tab for the chats
 * menu. Not on a Mac (owner report 2026-10-19): `openPopup` there, with no
 * click behind it, showed nothing and left Scout's button dead on that tab
 * until the coupon search ended. iPhone and iPad keep it (the page button
 * opens the sheet the same way). Unknown counts as not a Mac.
 */
export function reopensAfterSwitch(os: string | undefined): boolean {
  return os !== "mac";
}
