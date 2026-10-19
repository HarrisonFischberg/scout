// Per-browser differences for scripts/build.mjs. Safari is the source
// manifest as is; Chrome and Firefox get store packages (dist/<target>/ and a
// zip) from the same code. Pure functions, unit tested in tests/unit/targets.test.ts.

export const TARGETS = ["safari", "chrome", "firefox"];

/** esbuild `target` per browser. */
export const ESBUILD_TARGET = { safari: "safari16", chrome: "chrome120", firefox: "firefox140" };

/** Firefox add-on ID. AMO ties the listing to it: never change it after the first upload. */
export const GECKO_ID = "scout-ai-assistant@harrisonfischberg";

/** Returns the manifest for `target`, built from src/manifest.json (the Safari one). */
export function manifestFor(target, source) {
  if (!TARGETS.includes(target)) throw new Error(`unknown target ${target}`);
  const m = structuredClone(source);
  if (target === "safari") return m;
  // The Keychain bridge (native messaging) exists only inside the Safari app.
  // No code uses contextMenus, and both stores reject unused permissions.
  m.permissions = m.permissions.filter((p) => p !== "nativeMessaging" && p !== "contextMenus");
  if (target === "chrome") {
    m.background = { service_worker: m.background.scripts[0] };
    m.minimum_chrome_version = "120";
  } else {
    m.background = { scripts: m.background.scripts };
    m.browser_specific_settings = {
      gecko: {
        id: GECKO_ID,
        // 140: first version with data_collection_permissions (and tabs.group).
        strict_min_version: "140.0",
        // Page text and addresses go to the AI provider the user picks, with their own key.
        data_collection_permissions: { required: ["websiteContent", "browsingActivity"] },
      },
      gecko_android: { strict_min_version: "142.0" },
    };
  }
  return m;
}

/**
 * Chrome's extension API is `chrome`, and its runtime.onMessage ignores a
 * returned Promise. Prepended to every Chrome bundle: exposes `browser` and
 * answers with the Promise's value through sendResponse, as Safari and Firefox do.
 */
export const CHROME_SHIM = `(() => {
  if (typeof globalThis.browser !== "undefined" || typeof chrome === "undefined") return;
  const wrapped = new WeakMap();
  const onMessage = chrome.runtime && chrome.runtime.onMessage;
  const messages = onMessage && {
    addListener(fn) {
      const w = (message, sender, sendResponse) => {
        const r = fn(message, sender);
        if (!r || typeof r.then !== "function") return false;
        r.then((v) => sendResponse(v), () => sendResponse(undefined));
        return true;
      };
      wrapped.set(fn, w);
      onMessage.addListener(w);
    },
    removeListener(fn) {
      onMessage.removeListener(wrapped.get(fn) || fn);
      wrapped.delete(fn);
    },
    hasListener(fn) {
      return onMessage.hasListener(wrapped.get(fn) || fn);
    },
  };
  // Chrome's API functions must be called on their own object, so bind them.
  const view = (target, swap) =>
    new Proxy(target, {
      get(t, k) {
        if (k in swap) return swap[k];
        const v = t[k];
        return typeof v === "function" ? v.bind(t) : v;
      },
    });
  const runtime = messages ? view(chrome.runtime, { onMessage: messages }) : chrome.runtime;
  globalThis.browser = view(chrome, { runtime });
})();`;
