import { describe, expect, it } from "vitest";
import { PANEL_EVENTS, checkSchema } from "../../src/bridge/messages";
import { addPageBlur, PAGE_BLUR_BOTTOM_GAP_PX, PAGE_BLUR_PX, PAGE_DIM, wantsPageBlur } from "../../src/panel/blur";

describe("page blur behind the panel (owner design 2026-10-17)", () => {
  it("only on a phone-sized touch screen", () => {
    expect(wantsPageBlur(true, 390)).toBe(true);
    expect(wantsPageBlur(true, 820)).toBe(false); // iPad: a popover, the page stays clear
    expect(wantsPageBlur(false, 390)).toBe(false); // Mac
  });

  it("panel.hello may say the page was blurred", () => {
    expect(checkSchema(PANEL_EVENTS["panel.hello"], { tabId: 1, blur: true })).toBeNull();
    expect(checkSchema(PANEL_EVENTS["panel.hello"], { tabId: 1 })).toBeNull();
    expect(checkSchema(PANEL_EVENTS["panel.hello"], { tabId: 1, blur: "yes" })).not.toBeNull();
  });

  it("is at least 35% lighter than the first design (owner, 2026-10-18)", () => {
    expect(parseFloat(PAGE_DIM)).toBeLessThanOrEqual(18 * 0.65);
    expect(PAGE_BLUR_PX).toBeLessThanOrEqual(14 * 0.65);
    // addPageBlur is injected on its own, so it spells the values out; keep them in step.
    const src = addPageBlur.toString();
    expect(src).toContain(`rgb(0 0 0 / ${PAGE_DIM})`);
    expect(src).toContain(`blur(${PAGE_BLUR_PX}px)`);
  });

  // Owner bug report 2026-10-18: closing Scout flashed a solid strip under
  // Safari's bottom bar while the full-screen layer was still on the page.
  it("stops above the bottom edge, so Safari never paints a solid strip under its bar", () => {
    const src = addPageBlur.toString();
    expect(PAGE_BLUR_BOTTOM_GAP_PX).toBeGreaterThanOrEqual(64);
    expect(src).toContain(`bottom: ${PAGE_BLUR_BOTTOM_GAP_PX}px`);
    expect(src).not.toMatch(/inset:\s*0/);
  });
});
