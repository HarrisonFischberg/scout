// The Scout app's own chat screen (owner request 2026-11-01): open the app and
// ask Claude anything, no Safari needed. Runs in a web view inside the iOS app
// (apple/App/ChatView.swift), reusing the panel's provider, answer rendering
// and sources. The key comes from the Keychain the Safari extension uses, over
// the app's native bridge; it is read for each answer and never stored here.
import { renderMarkdown } from "../chat/markdown";
import { cachedLook, cacheLook, LOOKS, lookById, pageCache, parseLook, readSharedLook, writeSharedLook, type LookId } from "../panel/look";
import { answerText, displayHost, linkHref, siteIcon, siteName, type Source } from "../chat/sources";
import { formatCostLine } from "../cost";
import type { NativeSend } from "../keychain";
import { createAnthropic } from "../providers/anthropic";
import { appleStatus, createApple } from "../providers/apple";
import { checkKey, looksLikeKey } from "../providers/keytest";
import { BUILTIN_MODELS } from "../providers/models";
import type { Effort } from "../providers/types";
import { DEFAULT_EFFORT, DEFAULT_MODEL } from "../settings/settings";
import { IMAGES_NEED_KEY, MAX_IMAGES, imageFiles, messageThumbs, prepareImage, questionFor, renderTray, type PastedImage } from "../chat/images";
import { ask } from "./ask";
import { LAST_STARTERS_KEY, pickStarters } from "./starters";
import { chatTitle, deleteChat, historyFor, loadChats, newChatId, saveChats, upsertChat, type AppChat, type AppTurn, type TextStorage } from "./chats";

declare global {
  interface Window {
    webkit?: { messageHandlers?: { scout?: { postMessage(message: unknown): Promise<unknown> } } };
  }
}

const SETTINGS_KEY = "scout.app.settings";
const CONSENT_KEY = "scout.app.consent";
/** Bump when what is sent to Anthropic changes materially. */
const CONSENT_VERSION = 1;

interface AppSettings {
  model: string;
  appleFirst: boolean;
}

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

/** Web storage, or a memory stand-in where it is blocked. */
function pickStorage(): TextStorage {
  try {
    const s = window.localStorage;
    s.setItem("scout.app.probe", "1");
    s.removeItem("scout.app.probe");
    return s;
  } catch {
    const m = new Map<string, string>();
    return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k) };
  }
}
const storage = pickStorage();

/**
 * The app's native bridge (Keychain, Apple's model, setup). Debug builds
 * opened outside the app (tests) keep a stand-in key in web storage; release
 * builds never do.
 */
function nativeBridge(): NativeSend {
  const handler = window.webkit?.messageHandlers?.scout;
  if (handler) return (message) => handler.postMessage(message);
  if (__SCOUT_DEBUG__) {
    return async (message) => {
      const m = (message ?? {}) as { type?: string; account?: string; value?: string };
      const k = "scout.app.devKey" + (m.account && m.account !== "anthropic" ? "." + m.account : "");
      if (m.type === "keychain.get") return { ok: true, value: storage.getItem(k) ?? undefined };
      if (m.type === "keychain.set") return storage.setItem(k, String(m.value ?? "")), { ok: true };
      if (m.type === "keychain.delete") return storage.removeItem(k), { ok: true };
      if (m.type === "ai.apple.status") return { ok: true, available: false, reason: "unknown" };
      return { ok: false, error: "unsupported" };
    };
  }
  return async () => ({ ok: false, error: "no_native" });
}
const send = nativeBridge();

/** Native feedback for the few events that earn it (apple/App/ChatView.swift); a no-op outside the app. */
function haptic(kind: "success" | "error" | "selection"): void {
  void send({ type: "haptic", kind }).catch(() => undefined);
}

async function getKey(): Promise<string | null> {
  try {
    const r = (await send({ type: "keychain.get", account: "anthropic" })) as { ok?: boolean; value?: string } | undefined;
    return r?.ok && typeof r.value === "string" && r.value ? r.value : null;
  } catch {
    return null;
  }
}

function loadSettings(): AppSettings {
  try {
    const raw = JSON.parse(storage.getItem(SETTINGS_KEY) ?? "{}") as Partial<AppSettings>;
    const known = BUILTIN_MODELS.anthropic.some((m) => m.id === raw.model);
    return { model: known ? raw.model! : DEFAULT_MODEL.anthropic, appleFirst: raw.appleFirst === true };
  } catch {
    return { model: DEFAULT_MODEL.anthropic, appleFirst: false };
  }
}
function saveSettings(s: AppSettings): void {
  storage.setItem(SETTINGS_KEY, JSON.stringify(s));
}

function hasConsent(): boolean {
  try {
    return (JSON.parse(storage.getItem(CONSENT_KEY) ?? "null") as { version?: number } | null)?.version === CONSENT_VERSION;
  } catch {
    return false;
  }
}

/** The default model's effort (Haiku 5.5 at High, owner 2026-10-17); others use their own default. */
function effortFor(model: string): Effort | undefined {
  const e = DEFAULT_EFFORT.anthropic;
  return model === DEFAULT_MODEL.anthropic && e !== "default" ? e : undefined;
}

/** True while a question is on its way to being sent (key read, consent), before state.running is set. */
let starting = false;

const state = {
  settings: loadSettings(),
  chat: null as AppChat | null,
  hasKey: false,
  appleReady: false,
  running: null as AbortController | null,
};

const thread = $<HTMLDivElement>("thread");
const scroller = $<HTMLElement>("scroller");
const question = $<HTMLTextAreaElement>("question");
const sendBtn = $<HTMLButtonElement>("send");

function scrollToEnd(): void {
  scroller.scrollTop = scroller.scrollHeight;
}

function svgIcon(path: string): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "i");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
  p.setAttribute("d", path);
  svg.appendChild(p);
  return svg;
}

function modelLabel(model: string): string {
  if (model === "apple") return "Apple · on device";
  return BUILTIN_MODELS.anthropic.find((m) => m.id === model)?.name ?? model;
}

/** Copy, the "N sources" list, and which model answered. */
function answerFoot(turn: AppTurn, cost?: string): HTMLElement {
  const wrap = document.createElement("div");
  const row = document.createElement("div");
  row.className = "answer-actions";
  const copy = document.createElement("button");
  copy.type = "button";
  copy.append(svgIcon("M9 9h10v12H9zM5 15V3h10"), document.createTextNode("Copy"));
  copy.addEventListener("click", () => {
    void navigator.clipboard?.writeText(answerText(turn.text, turn.sources ?? [])).then(
      () => (copy.lastChild!.textContent = "Copied"),
      () => (copy.lastChild!.textContent = "Copy failed"),
    );
  });
  row.appendChild(copy);
  const sources = turn.sources ?? [];
  let list: HTMLUListElement | null = null;
  if (sources.length) {
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "sources-toggle";
    toggle.setAttribute("aria-expanded", "false");
    const stack = document.createElement("span");
    stack.className = "site-stack";
    const seen = new Set<string>();
    for (const s of sources) {
      const name = siteName(s.url);
      if (seen.has(name) || seen.size >= 3) continue;
      seen.add(name);
      stack.appendChild(siteIcon(document, s.url));
    }
    toggle.append(stack, document.createTextNode(sources.length === 1 ? "1 source" : sources.length + " sources"));
    list = document.createElement("ul");
    list.className = "source-list";
    list.hidden = true;
    for (const s of sources) list.appendChild(sourceRow(s));
    toggle.addEventListener("click", () => {
      const open = toggle.getAttribute("aria-expanded") !== "true";
      toggle.setAttribute("aria-expanded", String(open));
      list!.hidden = !open;
    });
    row.appendChild(toggle);
  }
  if (turn.model) {
    const meta = document.createElement("span");
    meta.className = "meta";
    meta.textContent = modelLabel(turn.model) + (cost ? " · " + cost.replace(/^Cost: /, "") : "");
    row.appendChild(meta);
  }
  wrap.appendChild(row);
  if (list) wrap.appendChild(list);
  return wrap;
}

function sourceRow(s: Source): HTMLLIElement {
  const li = document.createElement("li");
  const href = linkHref(s.url);
  const a = document.createElement(href ? "a" : "span");
  if (href) {
    a.setAttribute("href", href);
    a.setAttribute("target", "_blank");
    a.setAttribute("rel", "noopener noreferrer");
  }
  const site = document.createElement("span");
  site.className = "source-site";
  site.textContent = displayHost(s.url);
  const title = document.createElement("span");
  title.className = "source-title";
  title.textContent = s.title || s.url;
  a.append(siteIcon(document, s.url), site, title);
  li.appendChild(a);
  return li;
}

/** A question; with images just sent, their thumbnails; a saved one notes them (images aren't saved). */
function userBubble(text: string, images: readonly PastedImage[] | number = 0): HTMLElement {
  const el = document.createElement("div");
  el.className = "msg user";
  el.textContent = text;
  if (typeof images !== "number" && images.length) el.prepend(messageThumbs(images));
  else if (typeof images === "number" && images > 0) {
    const note = document.createElement("span");
    note.className = "img-note";
    note.textContent = images === 1 ? "1 image" : images + " images";
    el.prepend(note);
  }
  return el;
}

function assistantBubble(turn: AppTurn, cost?: string): HTMLElement {
  const el = document.createElement("div");
  el.className = "msg assistant" + (turn.error ? " error" : "");
  const body = document.createElement("div");
  body.className = "body";
  if (turn.error) body.textContent = turn.text;
  else renderMarkdown(document, body, turn.text, { sources: turn.sources ?? [] });
  el.appendChild(body);
  if (!turn.error && turn.text.trim()) el.appendChild(answerFoot(turn, cost));
  return el;
}

function renderThread(): void {
  thread.replaceChildren();
  const turns = state.chat?.turns ?? [];
  for (const t of turns) thread.appendChild(t.role === "user" ? userBubble(t.text, t.images ?? 0) : assistantBubble(t));
  updateEmpty();
  scrollToEnd();
}

function updateEmpty(): void {
  const empty = !state.chat?.turns.length && !state.running;
  $("empty").hidden = !empty;
  const needKey = !state.hasKey && !state.appleReady;
  $("key-card").hidden = !needKey;
  $("starters").hidden = needKey;
  $("empty-note").textContent = state.hasKey
    ? "Claude answers, and searches the web when it helps."
    : state.appleReady
      ? "Apple's on-device model answers for free. Add an Anthropic key in Settings for researched answers."
      : "Answers come from Claude, with your own Anthropic API key.";
  updateSend();
}

function updateSend(): void {
  const running = !!state.running;
  sendBtn.disabled = !running && ((!question.value.trim() && !pending.length) || (!state.hasKey && !state.appleReady));
  sendBtn.setAttribute("aria-label", running ? "Stop" : "Send");
  $("send-icon").toggleAttribute("hidden", running);
  $("stop-icon").toggleAttribute("hidden", !running);
}

function autosize(): void {
  question.style.height = "auto";
  question.style.height = Math.min(question.scrollHeight, 160) + "px";
}

/** Asks once before anything is sent to Anthropic (App Store 5.1.2(i)). */
function askConsent(): Promise<boolean> {
  if (hasConsent()) return Promise.resolve(true);
  const dialog = $<HTMLDialogElement>("consent");
  return new Promise((resolve) => {
    const done = (ok: boolean): void => {
      $("consent-yes").removeEventListener("click", yes);
      $("consent-no").removeEventListener("click", no);
      dialog.removeEventListener("cancel", no);
      dialog.close();
      if (ok) storage.setItem(CONSENT_KEY, JSON.stringify({ version: CONSENT_VERSION, at: Date.now() }));
      resolve(ok);
    };
    const yes = (): void => done(true);
    const no = (): void => done(false);
    $("consent-yes").addEventListener("click", yes);
    $("consent-no").addEventListener("click", no);
    dialog.addEventListener("cancel", no);
    dialog.showModal();
  });
}

// Pasted or picked images (owner request 2026-11-02), scaled and re-encoded
// first (src/chat/images.ts); thumbnails sit above the ask box until sent.
const pending: PastedImage[] = [];

function showTray(): void {
  renderTray($("img-tray"), pending, (i) => {
    pending.splice(i, 1);
    showTray();
  });
  updateSend();
}

async function addImages(files: File[]): Promise<void> {
  for (const f of files.slice(0, Math.max(0, MAX_IMAGES - pending.length))) {
    try {
      const img = await prepareImage(f);
      if (pending.length < MAX_IMAGES) pending.push(img);
    } catch (err) {
      thread.appendChild(assistantBubble({ role: "assistant", text: err instanceof Error ? err.message : "Scout couldn't open that image.", error: true }));
      scrollToEnd();
    }
  }
  showTray();
}

async function submit(text: string): Promise<void> {
  const typed = text.trim();
  const q = questionFor(typed, pending.length);
  // A second tap while the first is still reading the key or asking consent would send the question twice.
  if (!q || state.running || starting) return;
  starting = true;
  let key: string | null;
  try {
    key = await getKey();
    state.hasKey = !!key;
    if (!key && !state.appleReady) return updateEmpty();
    if (pending.length && !key) {
      thread.appendChild(assistantBubble({ role: "assistant", text: IMAGES_NEED_KEY, error: true }));
      return scrollToEnd();
    }
    if (key && !(await askConsent())) return;
  } finally {
    starting = false;
  }
  const useApple = state.appleReady && (!key || state.settings.appleFirst);

  question.value = "";
  autosize();
  const images = pending.splice(0);
  showTray();
  const chat: AppChat = state.chat ?? { id: newChatId(), title: chatTitle(q), at: Date.now(), turns: [] };
  const history = historyFor(chat.turns);
  chat.turns.push({ role: "user", text: q, ...(images.length ? { images: images.length } : {}) });
  chat.at = Date.now();
  state.chat = chat;
  const sent = userBubble(typed, images);
  sent.classList.add("new"); // just sent: it rises in (app.html); saved messages do not
  thread.appendChild(sent);

  const live = document.createElement("div");
  live.className = "msg assistant";
  const body = document.createElement("div");
  body.className = "body";
  const dots = document.createElement("div");
  dots.className = "working";
  dots.setAttribute("aria-label", "Scout is answering");
  dots.append(document.createElement("span"), document.createElement("span"), document.createElement("span"));
  body.appendChild(dots);
  live.appendChild(body);
  thread.appendChild(live);
  const controller = new AbortController();
  state.running = controller;
  updateEmpty();
  scrollToEnd();

  let frame = 0;
  const result = await ask({
    ...(key ? { claude: { client: createAnthropic({ apiKey: key, fetch: (u, i) => fetch(u, i) }), model: state.settings.model, ...(effortFor(state.settings.model) ? { effort: effortFor(state.settings.model)! } : {}) } } : {}),
    ...(useApple ? { apple: createApple(send) } : {}),
    appleFirst: state.settings.appleFirst,
    history,
    question: q,
    ...(images.length ? { images } : {}),
    signal: controller.signal,
    onText: (t) => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const nearEnd = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 80;
        renderMarkdown(document, body, t, {});
        if (nearEnd) scrollToEnd();
      });
    },
  });
  cancelAnimationFrame(frame);
  // A chat left mid-answer (New chat, another chat, Delete) may already have a newer request running: leave that one alone.
  if (state.running === controller) state.running = null;

  const turn: AppTurn = result.error
    ? { role: "assistant", text: result.text.trim() ? result.text + "\n\n" + result.error : result.error, error: true }
    : { role: "assistant", text: result.text || (result.stopped ? "Stopped." : ""), ...(result.sources.length ? { sources: result.sources } : {}), model: result.model };
  chat.turns.push(turn);
  chat.at = Date.now();
  if (!deleted.has(chat.id)) upsertChat(storage, chat);
  if (result.error) haptic("error");
  const cost = result.usage && result.model !== "apple" ? formatCostLine(result.model, result.usage) : undefined;
  live.replaceWith(assistantBubble(turn, cost));
  updateEmpty();
  scrollToEnd();
}

/** Four fresh starter questions, different from the last set shown. */
function renderStarters(): void {
  let avoid: string[] = [];
  try {
    avoid = JSON.parse(storage.getItem(LAST_STARTERS_KEY) ?? "[]") as string[];
  } catch {
    avoid = [];
  }
  const picked = pickStarters({ web: state.hasKey, avoid: Array.isArray(avoid) ? avoid : [] });
  storage.setItem(LAST_STARTERS_KEY, JSON.stringify(picked));
  $("starters").replaceChildren(
    ...picked.map((text) => {
      const li = document.createElement("li");
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = text;
      li.appendChild(b);
      return li;
    }),
  );
}

/** Stops the answer on screen; the next question does not have to wait for it to wind down. */
function leaveAnswer(): void {
  state.running?.abort();
  state.running = null;
}

function newChat(): void {
  leaveAnswer();
  state.chat = null;
  renderStarters();
  renderThread();
  question.focus();
}

function relativeDay(at: number): string {
  const d = new Date(at);
  const today = new Date();
  const days = Math.round((new Date(today.toDateString()).getTime() - new Date(d.toDateString()).getTime()) / 86_400_000);
  if (days === 0) return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (days === 1) return "Yesterday";
  if (days < 7) return d.toLocaleDateString([], { weekday: "long" });
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

function renderChatList(): void {
  const list = $<HTMLUListElement>("chat-list");
  list.replaceChildren();
  const chats = loadChats(storage);
  $("chats-empty").hidden = chats.length > 0;
  for (const c of chats) {
    const li = document.createElement("li");
    const open = document.createElement("button");
    open.type = "button";
    open.className = "open";
    if (c.id === state.chat?.id) open.setAttribute("aria-current", "true");
    const title = document.createElement("span");
    title.className = "title";
    title.textContent = c.title;
    const when = document.createElement("span");
    when.className = "when";
    when.textContent = relativeDay(c.at);
    open.append(title, when);
    open.addEventListener("click", () => {
      leaveAnswer();
      state.chat = c;
      $<HTMLDialogElement>("chats").close();
      renderThread();
    });
    const del = document.createElement("button");
    del.type = "button";
    del.className = "delete";
    del.setAttribute("aria-label", "Delete chat: " + c.title);
    del.appendChild(svgIcon("M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"));
    del.addEventListener("click", () => {
      const before = loadChats(storage);
      deleted.add(c.id);
      deleteChat(storage, c.id);
      if (state.chat?.id === c.id) newChat();
      renderChatList();
      offerUndo($("chats-undo"), "Chat deleted.", before);
    });
    li.append(open, del);
    list.appendChild(li);
  }
}

// A delete happens at once and can be taken back for a few seconds (owner
// convention: Undo, not "Are you sure?"). One offer at a time.
const UNDO_MS = 7_000;
/** Chats deleted this session: an answer still winding down must not save one back. */
const deleted = new Set<string>();
let undoTimer: ReturnType<typeof setTimeout> | undefined;
function offerUndo(bar: HTMLElement, text: string, before: AppChat[]): void {
  clearTimeout(undoTimer);
  for (const other of document.querySelectorAll<HTMLElement>(".undo")) other.hidden = true;
  const say = document.createElement("span");
  say.textContent = text;
  const b = document.createElement("button");
  b.type = "button";
  b.className = "btn";
  b.textContent = "Undo";
  b.addEventListener("click", () => {
    clearTimeout(undoTimer);
    bar.hidden = true;
    // Chats saved since the delete stay; the deleted ones come back beside them.
    const now = loadChats(storage);
    saveChats(storage, [...now, ...before.filter((c) => !now.some((n) => n.id === c.id))]);
    for (const c of before) deleted.delete(c.id);
    renderChatList();
  });
  bar.replaceChildren(say, b);
  bar.hidden = false;
  const tick = (): void => {
    if (bar.matches(":focus-within")) undoTimer = setTimeout(tick, 1_000);
    else bar.hidden = true;
  };
  undoTimer = setTimeout(tick, UNDO_MS);
}

async function saveKey(input: HTMLInputElement, note: HTMLElement): Promise<boolean> {
  const key = input.value.trim();
  note.classList.remove("bad");
  if (!looksLikeKey("anthropic", key)) {
    note.textContent = "That doesn't look like an Anthropic key. It starts with sk-ant-.";
    note.classList.add("bad");
    return false;
  }
  note.textContent = "Checking the key with Anthropic…";
  const check = await checkKey("anthropic", key, (u, i) => fetch(u, i));
  if (check !== "valid") {
    note.textContent = check === "invalid" ? "Anthropic rejected this key. Check it and try again." : "Couldn't reach Anthropic. Check your connection.";
    note.classList.add("bad");
    haptic("error");
    return false;
  }
  try {
    const r = (await send({ type: "keychain.set", account: "anthropic", value: key })) as { ok?: boolean } | undefined;
    if (!r?.ok) throw new Error("keychain");
  } catch {
    note.textContent = "Couldn't save the key to your Keychain.";
    note.classList.add("bad");
    return false;
  }
  input.value = "";
  note.textContent = "Key saved in your Keychain.";
  haptic("success");
  state.hasKey = true;
  updateEmpty();
  void refreshSettings();
  return true;
}

async function refreshSettings(): Promise<void> {
  state.hasKey = !!(await getKey());
  $("key-status").textContent = state.hasKey
    ? "Your key is saved in your Keychain, shared with Scout in Safari."
    : "No key saved. Add one to chat with Claude.";
  $("key-remove").hidden = !state.hasKey;
  const select = $<HTMLSelectElement>("model-select");
  select.value = state.settings.model;
  $("apple-first-row").hidden = !state.appleReady;
  $<HTMLInputElement>("apple-first").checked = state.settings.appleFirst;
  updateEmpty();
}

// ---------- Look (Settings > Look, owner request 2026-11-02) ----------
// The same seven looks as Scout in Safari (src/panel/look.ts), and the same
// choice: it is shared with the extension through the Keychain group, so a
// pick on either side shows on the other the next time it opens.
const lookCache = pageCache();

function showLook(id: LookId): void {
  document.documentElement.dataset.look = id;
  $("empty-title").textContent = lookById(id).greeting.title || "Where to next?";
  cacheLook(lookCache, id);
  for (const i of document.querySelectorAll<HTMLInputElement>('input[name="look"]')) i.checked = i.value === id;
}

async function syncLook(): Promise<void> {
  const shared = await readSharedLook(send);
  if (shared && shared !== document.documentElement.dataset.look) showLook(shared);
}

function buildLookPicker(): void {
  const list = $("look-list");
  for (const look of LOOKS) {
    const label = document.createElement("label");
    const input = document.createElement("input");
    input.type = "radio";
    input.name = "look";
    input.value = look.id;
    const sw = document.createElement("span");
    sw.className = "sw";
    sw.setAttribute("aria-hidden", "true");
    for (const c of look.swatch) {
      const dot = document.createElement("i");
      dot.style.background = c;
      sw.appendChild(dot);
    }
    const name = document.createElement("span");
    name.textContent = look.name;
    const blurb = document.createElement("span");
    blurb.className = "blurb";
    blurb.textContent = look.blurb;
    label.append(input, sw, name, blurb);
    input.addEventListener("change", () => {
      if (!input.checked) return;
      const id = parseLook(input.value);
      showLook(id);
      haptic("selection");
      void writeSharedLook(send, id);
    });
    list.appendChild(label);
  }
}

function wire(): void {
  buildLookPicker();
  showLook(cachedLook(lookCache));
  const select = $<HTMLSelectElement>("model-select");
  for (const m of BUILTIN_MODELS.anthropic) {
    const o = document.createElement("option");
    o.value = m.id;
    o.textContent = m.name + (m.id === DEFAULT_MODEL.anthropic ? " (default)" : "");
    select.appendChild(o);
  }
  select.addEventListener("change", () => {
    state.settings = { ...state.settings, model: select.value };
    saveSettings(state.settings);
  });
  $<HTMLInputElement>("apple-first").addEventListener("change", (e) => {
    state.settings = { ...state.settings, appleFirst: (e.target as HTMLInputElement).checked };
    saveSettings(state.settings);
  });

  question.addEventListener("input", () => {
    autosize();
    updateSend();
  });
  question.addEventListener("paste", (e) => {
    const files = imageFiles(e.clipboardData?.items);
    if (!files.length) return;
    e.preventDefault();
    void addImages(files);
  });
  $("img-add").addEventListener("click", () => $<HTMLInputElement>("img-pick").click());
  $<HTMLInputElement>("img-pick").addEventListener("change", (e) => {
    const input = e.target as HTMLInputElement;
    const files = imageFiles(input.files);
    input.value = "";
    void addImages(files);
  });
  question.addEventListener("keydown", (e) => {
    // Return sends on a hardware keyboard; Shift-Return adds a line.
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing && matchMedia("(hover: hover)").matches) {
      e.preventDefault();
      void submit(question.value);
    }
  });
  $("composer").addEventListener("submit", (e) => {
    e.preventDefault();
    if (state.running) state.running.abort();
    else void submit(question.value);
  });
  $("starters").addEventListener("click", (e) => {
    const b = (e.target as Element).closest("button");
    if (b) void submit(b.textContent ?? "");
  });
  $("new-btn").addEventListener("click", newChat);
  $("chats-new").addEventListener("click", () => {
    $<HTMLDialogElement>("chats").close();
    newChat();
  });
  $("chats-btn").addEventListener("click", () => {
    renderChatList();
    $<HTMLDialogElement>("chats").showModal();
  });
  $("chats-close").addEventListener("click", () => $<HTMLDialogElement>("chats").close());
  $("settings-btn").addEventListener("click", () => {
    void refreshSettings();
    $<HTMLDialogElement>("settings").showModal();
  });
  $("settings-close").addEventListener("click", () => $<HTMLDialogElement>("settings").close());
  $("key-form").addEventListener("submit", (e) => {
    e.preventDefault();
    void saveKey($<HTMLInputElement>("key-input"), $("key-note"));
  });
  $("settings-key-form").addEventListener("submit", (e) => {
    e.preventDefault();
    void saveKey($<HTMLInputElement>("settings-key-input"), $("settings-key-note"));
  });
  $("key-remove").addEventListener("click", async () => {
    if (!confirm("Remove your Anthropic key from this iPhone? Scout in Safari uses the same key.")) return;
    await send({ type: "keychain.delete", account: "anthropic" }).catch(() => undefined);
    void refreshSettings();
  });
  $("delete-chats").addEventListener("click", () => {
    const before = loadChats(storage);
    if (!before.length) return void ($("delete-chats-note").textContent = "No saved chats to delete.");
    for (const c of before) deleted.add(c.id);
    saveChats(storage, []);
    newChat();
    $("delete-chats-note").textContent = "";
    offerUndo($("delete-chats-undo"), before.length === 1 ? "1 chat deleted." : before.length + " chats deleted.", before);
  });
  $("open-setup").addEventListener("click", () => void send({ type: "app.setup" }).catch(() => undefined));

  // Coming back to the app: the key may have changed in Safari.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      void refreshSettings();
      void syncLook();
    }
  });
}

async function start(): Promise<void> {
  wire();
  void syncLook();
  const [key, apple] = await Promise.all([getKey(), appleStatus(send)]);
  state.hasKey = !!key;
  state.appleReady = apple.available;
  // A fresh chat on every launch, like the Claude app; earlier ones are under Chats.
  state.chat = null;
  renderStarters();
  renderThread();
  void refreshSettings();
}

void start();
