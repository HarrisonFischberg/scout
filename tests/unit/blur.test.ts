import { describe, expect, it } from "vitest";
import { PANEL_EVENTS, checkSchema } from "../../src/bridge/messages";
import { isPhoneScreen } from "../../src/panel/blur";

describe("phone screens (owner design 2026-10-17)", () => {
  it("are phone-sized touch screens, not a Mac or an iPad", () => {
    expect(isPhoneScreen(true, 390)).toBe(true);
    expect(isPhoneScreen(true, 820)).toBe(false); // iPad
    expect(isPhoneScreen(false, 390)).toBe(false); // Mac
  });

  it("panel.hello names the tab and, optionally, the window", () => {
    expect(checkSchema(PANEL_EVENTS["panel.hello"], { tabId: 1 })).toBeNull();
    expect(checkSchema(PANEL_EVENTS["panel.hello"], { tabId: 1, windowId: 2 })).toBeNull();
  });
});
