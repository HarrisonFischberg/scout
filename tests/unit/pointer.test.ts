// iPhone coupon runs (owner request 2026-10-19): Safari's sheet covers the
// bottom half of the page and Scout cannot lower it, so the element the
// pointer works on is scrolled into the top part of the page.
import { describe, expect, it } from "vitest";
import { ABOVE_SHEET, ABOVE_SHEET_SPOT, aboveSheetScroll } from "../../src/actions/pointer";

const H = 800;

describe("aboveSheetScroll", () => {
  it("leaves an element already in the top part where it is", () => {
    expect(aboveSheetScroll(100, 140, H)).toBe(0);
    expect(aboveSheetScroll(H * 0.3, H * ABOVE_SHEET, H)).toBe(0);
  });

  it("moves an element behind the sheet up to the spot in the top quarter", () => {
    // Centered by scrollIntoView: middle of the screen, under the sheet's top edge.
    const by = aboveSheetScroll(380, 420, H);
    expect(by).toBe(400 - H * ABOVE_SHEET_SPOT);
    expect(380 - by + 20).toBe(H * ABOVE_SHEET_SPOT);
  });

  it("moves an element under the status bar down", () => {
    expect(aboveSheetScroll(5, 45, H)).toBeLessThan(0);
  });
});
