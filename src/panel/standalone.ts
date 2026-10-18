// Scout as its own page (owner request 2026-10-18, Mac Safari only): the panel's
// "Open in new tab" button opens popup.html?view=page in a Safari tab the owner
// can bookmark. That page is not attached to a web page, so it reads no current tab and hides the
// page-only actions (Summarize, Explain, Find coupons, Scout mode).
export const STANDALONE_PATH = "popup.html?view=page";

/** True when this document is the standalone Scout page, not the toolbar panel. */
export function isStandalone(search: string): boolean {
  return new URLSearchParams(search).get("view") === "page";
}

/** Opens the standalone page in a new tab. Resolves false when the browser refused. */
export async function openStandalone(api: {
  runtime?: { getURL?(path: string): string };
  tabs?: { create?(props: { url: string; active?: boolean }): Promise<unknown> };
}): Promise<boolean> {
  const url = api.runtime?.getURL?.(STANDALONE_PATH);
  if (!url || !api.tabs?.create) return false;
  try {
    await api.tabs.create({ url, active: true });
    return true;
  } catch {
    return false;
  }
}
