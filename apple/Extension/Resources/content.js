"use strict";
(() => {
  // src/actions/dom.ts
  function fireInput(el) {
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }
  function wrap(el) {
    const input = el;
    return {
      tag: el.tagName.toLowerCase(),
      type: el instanceof HTMLInputElement ? el.type : void 0,
      get disabled() {
        return el.disabled === true || el.getAttribute("aria-disabled") === "true";
      },
      get connected() {
        return el.isConnected;
      },
      click: () => el.click(),
      getValue: () => input.value ?? "",
      setValue(value) {
        const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
        if (setter) setter.call(el, value);
        else input.value = value;
        el.focus();
        fireInput(el);
      },
      select(value) {
        if (!(el instanceof HTMLSelectElement)) return false;
        const want = value.trim().toLowerCase();
        const opts = Array.from(el.options);
        const hit = opts.find((o) => o.value === value) ?? opts.find((o) => o.text.trim().toLowerCase() === want) ?? opts.find((o) => o.value.toLowerCase() === want);
        if (!hit || hit.disabled) return false;
        el.value = hit.value;
        fireInput(el);
        return true;
      },
      scrollIntoView: () => el.scrollIntoView({ block: "center" })
    };
  }
  function domPage(refs, win) {
    return {
      baseUrl: win.location.href,
      resolve(ref) {
        const el = refs.get(ref);
        return el ? wrap(el) : void 0;
      },
      scroll(direction) {
        const h = win.document.documentElement.scrollHeight;
        const step = win.innerHeight * 0.8;
        if (direction === "top") win.scrollTo({ top: 0 });
        else if (direction === "bottom") win.scrollTo({ top: h });
        else win.scrollBy({ top: direction === "down" ? step : -step });
      },
      navigate(url) {
        win.location.assign(url);
      },
      sleep: (ms) => new Promise((r) => setTimeout(r, ms))
    };
  }

  // src/actions/executor.ts
  var MAX_WAIT_MS = 1e4;
  var TYPEABLE_INPUT_TYPES = /* @__PURE__ */ new Set([
    "text",
    "email",
    "search",
    "tel",
    "url",
    "number",
    "date",
    "time",
    "month",
    "week",
    "datetime-local",
    ""
  ]);
  var fail = (action, error, message, ref) => ({
    ok: false,
    action,
    ...ref ? { ref } : {},
    message,
    error
  });
  var isResult = (v) => "ok" in v;
  function lookup(page, action, ref) {
    if (typeof ref !== "string" || ref === "") return fail(action, "bad_args", "ref is required");
    const el = page.resolve(ref);
    if (!el) return fail(action, "no_ref", `No element with ref ${ref}. Take a new snapshot.`, ref);
    if (!el.connected) return fail(action, "stale_ref", `Element ${ref} is no longer on the page. Take a new snapshot.`, ref);
    return el;
  }
  async function executeAction(page, action) {
    const kind = action.type;
    try {
      switch (action.type) {
        case "click": {
          const el = lookup(page, "click", action.ref);
          if (isResult(el)) return el;
          if (el.disabled) return fail("click", "disabled", `Element ${action.ref} is disabled.`, action.ref);
          el.scrollIntoView();
          el.click();
          return { ok: true, action: "click", ref: action.ref, message: `Clicked ${action.ref}.` };
        }
        case "type": {
          if (typeof action.text !== "string") return fail("type", "bad_args", "text is required", action.ref);
          const el = lookup(page, "type", action.ref);
          if (isResult(el)) return el;
          if (el.disabled) return fail("type", "disabled", `Element ${action.ref} is disabled.`, action.ref);
          const typeable = el.tag === "textarea" || el.tag === "input" && TYPEABLE_INPUT_TYPES.has((el.type ?? "").toLowerCase());
          if (!typeable) return fail("type", "not_typeable", `Element ${action.ref} does not accept text.`, action.ref);
          el.scrollIntoView();
          el.setValue(action.clear === false ? el.getValue() + action.text : action.text);
          return {
            ok: true,
            action: "type",
            ref: action.ref,
            message: `Typed ${action.text.length} characters into ${action.ref}.`
          };
        }
        case "select": {
          if (typeof action.value !== "string") return fail("select", "bad_args", "value is required", action.ref);
          const el = lookup(page, "select", action.ref);
          if (isResult(el)) return el;
          if (el.disabled) return fail("select", "disabled", `Element ${action.ref} is disabled.`, action.ref);
          if (el.tag !== "select") return fail("select", "not_selectable", `Element ${action.ref} is not a select.`, action.ref);
          if (!el.select(action.value)) return fail("select", "no_option", `No option matches "${action.value}".`, action.ref);
          return { ok: true, action: "select", ref: action.ref, message: `Selected "${action.value}" in ${action.ref}.` };
        }
        case "scroll": {
          if (!["up", "down", "top", "bottom"].includes(action.direction)) {
            return fail("scroll", "bad_args", "direction must be up, down, top or bottom");
          }
          if (action.ref !== void 0) {
            const el = lookup(page, "scroll", action.ref);
            if (isResult(el)) return el;
            el.scrollIntoView();
            return { ok: true, action: "scroll", ref: action.ref, message: `Scrolled ${action.ref} into view.` };
          }
          page.scroll(action.direction);
          return { ok: true, action: "scroll", message: `Scrolled ${action.direction}.` };
        }
        case "navigate": {
          if (typeof action.url !== "string" || action.url === "") return fail("navigate", "bad_args", "url is required");
          let target;
          try {
            target = new URL(action.url, page.baseUrl);
          } catch {
            return fail("navigate", "bad_args", `Not a valid URL: ${action.url}`);
          }
          if (target.protocol !== "http:" && target.protocol !== "https:") {
            return fail("navigate", "blocked_url", `Only http and https pages can be opened, not ${target.protocol}`);
          }
          page.navigate(target.href);
          return { ok: true, action: "navigate", message: `Navigating to ${target.href}.` };
        }
        case "wait": {
          if (typeof action.ms !== "number" || !Number.isFinite(action.ms) || action.ms < 0) {
            return fail("wait", "bad_args", "ms must be a non-negative number");
          }
          const ms = Math.min(action.ms, MAX_WAIT_MS);
          await page.sleep(ms);
          return { ok: true, action: "wait", message: `Waited ${ms} ms.` };
        }
        default:
          return fail(String(kind), "unknown_action", `Unknown action: ${String(kind)}`);
      }
    } catch (err) {
      return fail(String(kind), "failed", err instanceof Error ? err.message : "Action failed.");
    }
  }

  // src/snapshot/snapshot.ts
  var DEFAULT_MAX_TEXT_CHARS = 2e4;
  var DEFAULT_MAX_ELEMENTS = 200;
  var MAX_NAME = 120;
  var MAX_VALUE = 200;
  var REDACTED = "[REDACTED]";
  var SKIP_TAGS = /* @__PURE__ */ new Set(["script", "style", "noscript", "template", "svg", "head", "iframe"]);
  var BLOCK_TAGS = /* @__PURE__ */ new Set([
    "p",
    "div",
    "section",
    "article",
    "main",
    "header",
    "footer",
    "nav",
    "aside",
    "ul",
    "ol",
    "li",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "form",
    "table",
    "tr",
    "br",
    "label",
    "fieldset",
    "blockquote",
    "pre"
  ]);
  var SENSITIVE_HINT = /card|cc[-_ ]?(num|number|exp|csc)|cvv|cvc|csc|security[-_ ]?code|ssn|social[-_ ]?security|passw|passcode|\bpin\b|otp|one[-_ ]?time/i;
  var SENSITIVE_AUTOCOMPLETE = /cc-|current-password|new-password|one-time-code/i;
  var INPUT_ROLES = {
    button: "button",
    submit: "button",
    reset: "button",
    image: "button",
    checkbox: "checkbox",
    radio: "radio",
    range: "slider",
    search: "searchbox"
  };
  var BUTTON_TYPES = ["button", "submit", "reset", "image"];
  function isSensitiveField(node) {
    if (node.tag !== "input" && node.tag !== "textarea" && node.tag !== "select") return false;
    const type = (node.attrs.type ?? "text").toLowerCase();
    if (type === "password") return true;
    if (SENSITIVE_AUTOCOMPLETE.test(node.attrs.autocomplete ?? "")) return true;
    const hint = [node.attrs.name, node.attrs.id, node.attrs["aria-label"], node.attrs.placeholder].join(" ");
    return SENSITIVE_HINT.test(hint);
  }
  function roleOf(node) {
    const explicit = node.attrs.role;
    if (node.tag === "a") return node.attrs.href !== void 0 ? "link" : null;
    if (node.tag === "button") return "button";
    if (node.tag === "select") return "combobox";
    if (node.tag === "textarea") return "textbox";
    if (node.tag === "input") {
      const type = (node.attrs.type ?? "text").toLowerCase();
      if (type === "hidden") return null;
      return INPUT_ROLES[type] ?? "textbox";
    }
    if (explicit && /^(button|link|checkbox|radio|tab|menuitem|switch|textbox|combobox)$/.test(explicit)) {
      return explicit;
    }
    return null;
  }
  function isHidden(node) {
    if (node.hidden) return true;
    const a = node.attrs;
    if (a.hidden !== void 0 || a["aria-hidden"] === "true") return true;
    return /display\s*:\s*none|visibility\s*:\s*hidden/i.test(a.style ?? "");
  }
  function collectText(node) {
    if (node.tag === "#text") return node.text ?? "";
    if (SKIP_TAGS.has(node.tag) || isHidden(node)) return "";
    if (isSensitiveField(node)) return "";
    return node.children.map(collectText).join(" ");
  }
  function squash(s, max) {
    const t = s.replace(/\s+/g, " ").trim();
    return t.length > max ? t.slice(0, max - 1) + "\u2026" : t;
  }
  function nameOf(node, labels) {
    const a = node.attrs;
    const own = a["aria-label"] || a.id && labels.get(a.id) || a.title || a.placeholder || a.alt;
    if (own) return squash(own, MAX_NAME);
    if (node.tag === "input") {
      const type = (a.type ?? "text").toLowerCase();
      if (BUTTON_TYPES.includes(type)) return squash(node.value ?? a.value ?? "", MAX_NAME);
      return squash(a.name ?? "", MAX_NAME);
    }
    return squash(collectText(node), MAX_NAME);
  }
  function findLabels(node, out) {
    if (SKIP_TAGS.has(node.tag) || isHidden(node)) return;
    if (node.tag === "label" && node.attrs.for) out.set(node.attrs.for, collectText(node));
    for (const c of node.children) findLabels(c, out);
  }
  function buildSnapshot(root, opts) {
    const maxText = opts.maxTextChars ?? DEFAULT_MAX_TEXT_CHARS;
    const maxEls = opts.maxElements ?? DEFAULT_MAX_ELEMENTS;
    const labels = /* @__PURE__ */ new Map();
    findLabels(root, labels);
    const parts = [];
    let used = 0;
    let truncated = false;
    const elements = [];
    const push = (s) => {
      if (!s || used >= maxText) return;
      if (used + s.length > maxText) {
        parts.push(s.slice(0, maxText - used));
        used = maxText;
        truncated = true;
        return;
      }
      parts.push(s);
      used += s.length;
    };
    const walk = (node) => {
      if (node.tag === "#text") {
        push(squash(node.text ?? "", maxText));
        return;
      }
      if (SKIP_TAGS.has(node.tag) || isHidden(node)) return;
      const role = roleOf(node);
      const sensitive = isSensitiveField(node);
      if (role) {
        if (elements.length >= maxEls) {
          truncated = true;
        } else {
          const ref = "e" + (elements.length + 1);
          const el = { ref, tag: node.tag, role, name: nameOf(node, labels) };
          if (node.tag === "input") el.type = (node.attrs.type ?? "text").toLowerCase();
          if (node.attrs.disabled !== void 0) el.disabled = true;
          if (node.tag === "a") el.href = squash(node.attrs.href ?? "", MAX_VALUE);
          if (sensitive) {
            el.redacted = true;
            el.value = REDACTED;
          } else if ((node.tag === "input" || node.tag === "textarea" || node.tag === "select") && !BUTTON_TYPES.includes(el.type ?? "")) {
            const v = node.value ?? node.attrs.value;
            if (v) el.value = squash(v, MAX_VALUE);
          }
          elements.push(el);
          opts.onRef?.(ref, node);
          push(`[${ref} ${role}${el.name ? ": " + el.name : ""}]`);
        }
        if (node.tag === "button" || node.tag === "a" || node.tag === "textarea" || node.tag === "select") return;
      }
      if (sensitive) return;
      const block = BLOCK_TAGS.has(node.tag);
      if (block) push("\n");
      for (const c of node.children) walk(c);
      if (block) push("\n");
    };
    walk(root);
    const text = parts.join(" ").replace(/[ \t]*\n[ \t\n]*/g, "\n").replace(/[ \t]{2,}/g, " ").trim();
    return { url: opts.url, title: opts.title, text, elements, truncated };
  }
  function fromElement(el, map) {
    const attrs = {};
    for (const a of Array.from(el.attributes)) attrs[a.name.toLowerCase()] = a.value;
    const node = { tag: el.tagName.toLowerCase(), attrs, children: [] };
    map?.set(node, el);
    if (el instanceof HTMLElement) {
      const cs = getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden") node.hidden = true;
    }
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) {
      node.value = el.value;
    }
    if (node.hidden) return node;
    for (const child of Array.from(el.childNodes)) {
      if (child.nodeType === 3) {
        node.children.push({ tag: "#text", attrs: {}, text: child.textContent ?? "", children: [] });
      } else if (child.nodeType === 1) {
        node.children.push(fromElement(child, map));
      }
    }
    return node;
  }

  // src/content.ts
  var FLAG = "__assistAntContent";
  var g = globalThis;
  if (!g[FLAG]) {
    g[FLAG] = true;
    let refs = /* @__PURE__ */ new Map();
    const snapshot = () => {
      const nodeToEl = /* @__PURE__ */ new Map();
      const root = fromElement(document.documentElement, nodeToEl);
      const next = /* @__PURE__ */ new Map();
      const snap = buildSnapshot(root, {
        url: location.href,
        title: document.title,
        onRef: (ref, node) => {
          const el = nodeToEl.get(node);
          if (el) next.set(ref, el);
        }
      });
      refs = next;
      return snap;
    };
    browser.runtime.onMessage.addListener((message) => {
      const req = message;
      if (req?.type === "assistant:snapshot") return Promise.resolve(snapshot());
      if (req?.type === "assistant:act") {
        return executeAction(domPage(refs, window), req.action);
      }
      return void 0;
    });
  }
})();
