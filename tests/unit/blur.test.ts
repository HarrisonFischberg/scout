import { describe, expect, it } from "vitest";
import { PANEL_EVENTS, checkSchema } from "../../src/bridge/messages";
import { wantsPageBlur } from "../../src/panel/blur";

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
});
