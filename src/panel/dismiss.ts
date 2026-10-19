// Mac: a panel Safari has hidden closes itself (owner report 2026-10-19).
// Clicking the page or another tab hides Safari's popover, but the panel page
// can stay loaded behind it: two Mac reports had a hidden panel still taking a
// coupon run's events for minutes, and in that time the Scout button on that
// tab did nothing, while other tabs opened as usual. Closing the hidden page
// lets the next click open a fresh panel, which catches up with anything still
// running in the worker (answers, Scout mode, Find coupons).
// Not on a touch screen (Safari's sheet already unloads its page) and not on
// the standalone Scout page (a hidden tab is still open there).

export interface DismissTarget {
  readonly visibilityState: string;
  addEventListener(type: "visibilitychange", fn: () => void): void;
}

/** Closes the panel once Safari hides it. `trace` gets each step for diagnostics. */
export function closeWhenHidden(doc: DismissTarget, close: () => void, trace: (stage: string) => void = () => undefined): void {
  let closed = false;
  doc.addEventListener("visibilitychange", () => {
    trace("panel:visibility " + doc.visibilityState);
    if (closed || doc.visibilityState !== "hidden") return;
    closed = true;
    trace("panel:close-hidden");
    close();
  });
}
