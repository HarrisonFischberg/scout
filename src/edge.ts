// Page button content script (owner request 2026-10-16). The worker registers
// it only on sites the user let Scout access, and only while Settings > Button
// on webpages is on; it never runs in frames or Private Browsing, and it reads
// nothing from the page. It draws a tab on the edge of the viewport in a closed
// shadow root. The tab tucks in when idle and can be dragged up and down or to
// the other side. Tapping it asks the worker to open Scout's toolbar panel
// (Safari's sheet over the page on iPhone). It never puts an extension page in
// the website: Safari runs such a frame in the page's process and kills that
// process when the frame uses extension APIs (owner bug report 2026-10-16).
import { request } from "./bridge/messages";
import { clampY, isDrag, KEY_STEP, PAGE_BUTTON_KEY, parsePageButton, snapSide, TUCK_AFTER_MS, type PageButton, type Side } from "./panel/edge";

const FLAG = "__safariScoutEdge";
const g = globalThis as unknown as Record<string, unknown>;

const CANT_OPEN = "Couldn't open Scout for Safari here. Use the Scout button in Safari's page menu.";

// Monochrome binoculars (design/icons/safari-scout-binoculars.svg). Lenses are
// drawn in the pill color instead of a mask: url(#id) masks are unreliable
// inside shadow roots.
const GLYPH =
  '<svg viewBox="0 0 64 64" aria-hidden="true" focusable="false"><g class="body">' +
  '<rect x="11.5" y="5" width="11" height="11" rx="2.5"/><rect x="41.5" y="5" width="11" height="11" rx="2.5"/>' +
  '<rect x="26" y="17" width="12" height="11" rx="3"/><rect x="5" y="14" width="24" height="28" rx="7"/>' +
  '<rect x="35" y="14" width="24" height="28" rx="7"/><circle cx="17" cy="44" r="14"/><circle cx="47" cy="44" r="14"/></g>' +
  '<circle class="lens" cx="17" cy="44" r="8"/><circle class="lens" cx="47" cy="44" r="8"/></svg>';

// Dark glass in both themes, like Safari's own controls: it stands out on
// light pages, and the light border keeps it visible on dark ones. Awake: a
// 56 x 60 pill in a 60 x 64 target. Tucked: a 16 px sliver in a 32 px target.
const CSS = `
:host { all: initial; }
.tab {
  position: fixed; z-index: 1; top: 45%; right: 0; left: auto; width: 60px; height: 64px; margin: 0; padding: 0;
  border: 0; background: transparent; display: flex; align-items: center; justify-content: flex-end;
  transform: translateY(-50%); cursor: pointer; touch-action: none; user-select: none; -webkit-user-select: none;
  -webkit-tap-highlight-color: transparent; -webkit-touch-callout: none; outline: none;
}
.tab[data-side="left"] { right: auto; left: 0; justify-content: flex-start; }
.tab.tucked { width: 32px; }
.pill {
  box-sizing: border-box; display: flex; align-items: center; justify-content: center; width: 56px; height: 60px;
  border-radius: 30px 0 0 30px; border: 1px solid rgb(255 255 255 / 22%); border-right: 0;
  background: rgb(44 44 46 / 94%); color: #f2f2f7; box-shadow: 0 2px 14px rgb(0 0 0 / 30%);
  -webkit-backdrop-filter: blur(12px); backdrop-filter: blur(12px);
}
.tab[data-side="left"] .pill { border-radius: 0 30px 30px 0; border-right: 1px solid rgb(255 255 255 / 22%); border-left: 0; }
.tab.tucked .pill { width: 16px; }
.pill svg { width: 30px; height: 30px; flex: none; }
.pill .body { fill: currentColor; }
.pill .lens { fill: rgb(44 44 46); }
.tab.tucked svg { opacity: 0; }
.tab:focus-visible .pill { outline: 2px solid #2997ff; outline-offset: 2px; }
.tab.dragging { left: 0; right: auto; width: 64px; justify-content: center; transform: translate(-50%, -50%); }
.tab.dragging .pill { width: 60px; border-radius: 30px; border: 1px solid rgb(255 255 255 / 22%); }
@media (prefers-reduced-motion: no-preference) {
  .tab:not(.dragging) .pill { transition: width 180ms ease; }
  .pill svg { transition: opacity 150ms ease; }
}
.toast {
  position: fixed; left: 50%; bottom: 24px; transform: translateX(-50%); box-sizing: border-box; margin: 0;
  width: max-content; max-width: calc(100vw - 32px); padding: 8px 12px; border-radius: 10px;
  font: 14px/1.4 -apple-system, system-ui, sans-serif; background: rgb(44 44 46); color: #f5f5f7;
}
.toast:empty { display: none; }
`;

// Inline !important on the host beats any page stylesheet.
const HOST_STYLE = [
  "all: initial",
  "display: block",
  "position: fixed",
  "top: 0",
  "left: 0",
  "width: 0",
  "height: 0",
  "margin: 0",
  "padding: 0",
  "border: 0",
  "overflow: visible",
  "background: transparent",
  "z-index: 2147483647",
  "opacity: 1",
  "visibility: visible",
  "transform: none",
  "filter: none",
  "clip-path: none",
  "contain: none",
  "pointer-events: auto",
]
  .map((d) => d + " !important")
  .join("; ");

interface EdgeUi {
  place(p: PageButton): void;
  destroy(): void;
}

function mount(initial: PageButton, save: (side: Side, y: number) => void): EdgeUi {
  const host = document.createElement("div");
  host.setAttribute("style", HOST_STYLE);
  const root = host.attachShadow({ mode: "closed" });
  root.innerHTML =
    "<style>" + CSS + "</style>" +
    '<button class="tab" type="button" aria-label="Open Scout for Safari"><span class="pill">' + GLYPH + "</span></button>" +
    '<p class="toast" role="status"></p>';
  const tab = root.querySelector("button") as HTMLButtonElement;
  const toastNode = root.querySelector("p") as HTMLParagraphElement;

  let side = initial.side;
  let y = initial.y;
  const placeTab = (): void => {
    tab.dataset.side = side;
    tab.style.top = (y * 100).toFixed(2) + "%";
    tab.style.left = "";
  };
  placeTab();

  // ---------- Small when not in use ----------
  let tuckTimer = 0;
  let pointer: { x: number; y: number; id: number } | null = null;
  let dragging = false;
  let suppressClick = false;
  const wake = (): void => {
    tab.classList.remove("tucked");
    window.clearTimeout(tuckTimer);
    tuckTimer = window.setTimeout(() => {
      if (root.activeElement !== tab && !pointer) tab.classList.add("tucked");
    }, TUCK_AFTER_MS);
  };

  // ---------- Move: drag, or arrow keys when focused ----------
  tab.addEventListener("pointerdown", (e) => {
    if (!e.isTrusted || e.button !== 0) return;
    pointer = { x: e.clientX, y: e.clientY, id: e.pointerId };
    dragging = false;
    wake();
    try {
      tab.setPointerCapture(e.pointerId);
    } catch {
      // Not capturable (pointer already gone): the drag simply ends early.
    }
  });
  tab.addEventListener("pointermove", (e) => {
    if (!pointer || e.pointerId !== pointer.id) return;
    if (!dragging && !isDrag(e.clientX - pointer.x, e.clientY - pointer.y)) return;
    dragging = true;
    tab.classList.add("dragging");
    tab.style.left = e.clientX + "px";
    tab.style.top = e.clientY + "px";
  });
  const endPointer = (e: PointerEvent, cancelled: boolean): void => {
    if (!pointer || e.pointerId !== pointer.id) return;
    pointer = null;
    if (dragging) {
      dragging = false;
      suppressClick = true;
      window.setTimeout(() => (suppressClick = false), 400);
      tab.classList.remove("dragging");
      if (!cancelled && innerWidth > 0 && innerHeight > 0) {
        side = snapSide(e.clientX, innerWidth);
        y = clampY(e.clientY / innerHeight);
        save(side, y);
      }
      placeTab();
    }
    wake();
  };
  tab.addEventListener("pointerup", (e) => endPointer(e, false));
  tab.addEventListener("pointercancel", (e) => endPointer(e, true));
  tab.addEventListener("pointerenter", wake);
  tab.addEventListener("focus", wake);
  tab.addEventListener("blur", wake);
  tab.addEventListener("keydown", (e) => {
    if (!e.isTrusted) return;
    if (e.key === "ArrowUp") y = clampY(y - KEY_STEP);
    else if (e.key === "ArrowDown") y = clampY(y + KEY_STEP);
    else if (e.key === "ArrowLeft") side = "left";
    else if (e.key === "ArrowRight") side = "right";
    else return;
    e.preventDefault();
    e.stopPropagation();
    placeTab();
    save(side, y);
  });

  // ---------- Status line ----------
  let toastTimer = 0;
  const toast = (text: string): void => {
    toastNode.textContent = text;
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => (toastNode.textContent = ""), 5000);
  };

  // ---------- Open Scout ----------
  let opening = false;
  tab.addEventListener("click", (e) => {
    if (suppressClick) {
      suppressClick = false;
      return;
    }
    // Only a real tap or key press opens Scout; page scripts cannot.
    if (!e.isTrusted || opening) return;
    opening = true;
    void request<{ opened?: boolean }>((m) => browser.runtime.sendMessage(m), "panel.open", {})
      .then(
        (r) => r.opened === true,
        () => false,
      )
      .then((opened) => {
        opening = false;
        if (!opened) toast(CANT_OPEN);
      });
  });

  // ---------- Attach ----------
  // Top layer when the browser has popovers, so page overlays do not cover the tab.
  const usePopover = typeof host.showPopover === "function";
  if (usePopover) host.setAttribute("popover", "manual");
  document.documentElement.appendChild(host);
  if (usePopover) {
    try {
      host.showPopover();
    } catch {
      // Stays a fixed element with the top z-index.
    }
  }
  wake();

  return {
    place(p) {
      if (pointer) return;
      side = p.side;
      y = p.y;
      placeTab();
    },
    destroy() {
      window.clearTimeout(tuckTimer);
      window.clearTimeout(toastTimer);
      host.remove();
    },
  };
}

async function start(): Promise<void> {
  const storage = browser.storage?.local;
  if (!storage) return;
  const read = async (): Promise<PageButton> =>
    parsePageButton((await storage.get(PAGE_BUTTON_KEY).catch(() => ({}) as Record<string, unknown>))[PAGE_BUTTON_KEY]);
  let pref = await read();
  // Position changes keep whatever on/off state is stored now.
  const save = (side: Side, y: number): void => {
    void read()
      .then((latest) => storage.set({ [PAGE_BUTTON_KEY]: { ...latest, side, y } }))
      .catch(() => undefined);
  };
  let ui: EdgeUi | null = pref.on ? mount(pref, save) : null;
  browser.storage?.onChanged?.addListener((changes, area) => {
    if (area !== "local" || !(PAGE_BUTTON_KEY in changes)) return;
    pref = parsePageButton(changes[PAGE_BUTTON_KEY]?.newValue);
    if (!pref.on) {
      ui?.destroy();
      ui = null;
    } else if (!ui) ui = mount(pref, save);
    else ui.place(pref);
  });
}

if (!g[FLAG] && window.top === window && browser.extension?.inIncognitoContext !== true) {
  g[FLAG] = true;
  void start();
}
