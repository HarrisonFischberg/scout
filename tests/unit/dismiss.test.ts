// Mac: a panel Safari has hidden closes itself, so the Scout button on that
// tab opens a fresh one (owner report 2026-10-19). Fake document, no browser.
import { describe, expect, it } from "vitest";
import { closeWhenHidden } from "../../src/panel/dismiss";

function fakeDoc() {
  const fns: Array<() => void> = [];
  const doc = {
    visibilityState: "visible",
    addEventListener: (_t: "visibilitychange", fn: () => void) => fns.push(fn),
    set(state: string) {
      doc.visibilityState = state;
      fns.forEach((f) => f());
    },
  };
  return doc;
}

describe("closeWhenHidden", () => {
  it("closes the panel once Safari hides it, and only once", () => {
    const doc = fakeDoc();
    const stages: string[] = [];
    let closes = 0;
    closeWhenHidden(doc, () => closes++, (s) => stages.push(s));
    doc.set("visible");
    expect(closes).toBe(0);
    doc.set("hidden");
    doc.set("hidden");
    expect(closes).toBe(1);
    expect(stages).toEqual(["panel:visibility visible", "panel:visibility hidden", "panel:close-hidden", "panel:visibility hidden"]);
  });

  it("stays open while visible", () => {
    const doc = fakeDoc();
    let closes = 0;
    closeWhenHidden(doc, () => closes++);
    doc.set("visible");
    expect(closes).toBe(0);
  });
});
