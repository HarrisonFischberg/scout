#!/usr/bin/env node
// Real Safari (not Playwright WebKit) through safaridriver (QA 2026-10-29).
// Runs Scout mode's production action executor (src/actions/task.ts through
// src/actions/task-dom.ts) on fixture pages in the installed Safari and
// checks the results, as tests/e2e/task-dom.spec.ts does in WebKit. Safari
// WebDriver sessions do not load extensions, so this covers the page side of
// the extension, not the toolbar panel. No model, no network beyond localhost.
//
//   safaridriver --enable        (once, asks for the Mac password)
//   safaridriver -p 4444 &       then:  node scripts/safari-e2e.mjs
import { buildSync } from "esbuild";
import { spawn } from "node:child_process";

const DRIVER = "http://127.0.0.1:" + (process.env.SAFARIDRIVER_PORT ?? 4444);
const PORT = Number(process.env.E2E_PORT ?? 4317);
const BASE = "http://127.0.0.1:" + PORT;

const bundle = buildSync({
  stdin: {
    contents:
      'import { taskDomPage } from "./src/actions/task-dom"; import { performTaskAction } from "./src/actions/task";' +
      "const refs = new Map(); (globalThis as any).__task = (ids: Record<string, string>, action: any) => {" +
      " refs.clear(); for (const [r, id] of Object.entries(ids)) refs.set(r, document.getElementById(id));" +
      " return performTaskAction(taskDomPage(refs, window), action); };",
    resolveDir: ".",
    loader: "ts",
  },
  bundle: true,
  format: "iife",
  write: false,
}).outputFiles[0].text;

const server = spawn(process.execPath, ["scripts/serve-fixtures.mjs", String(PORT)], { stdio: "ignore" });
process.on("exit", () => server.kill());
for (let i = 0; i < 50; i++) {
  if (await fetch(BASE + "/index.html").then((r) => r.ok, () => false)) break;
  await new Promise((r) => setTimeout(r, 100));
}

const call = async (method, path, body) => {
  const r = await fetch(DRIVER + path, { method, headers: { "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const j = await r.json();
  if (!r.ok) throw new Error(path + ": " + (j.value?.message ?? r.status));
  return j.value;
};
const session = await call("POST", "/session", { capabilities: { alwaysMatch: { browserName: "safari" } } });
const sid = session.sessionId;
const caps = session.capabilities;
const exec = (script, args = []) => call("POST", "/session/" + sid + "/execute/sync", { script, args });
const open = async (path) => {
  await call("POST", "/session/" + sid + "/url", { url: BASE + path });
  await exec(bundle);
};
const act = (ids, action) => exec("return window.__task(arguments[0], arguments[1]);", [ids, action]);

const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok });
  console.log((ok ? "PASS " : "FAIL ") + name + (ok ? "" : " " + JSON.stringify(detail)));
};

try {
  await open("/task-controls.html");
  const c1 = await act({ e1: "locked-save" }, { type: "click", target: { ref: "e1" } });
  check("click in a disabled fieldset is refused", c1.ok === false && c1.error === "disabled", c1);
  const f1 = await act({ e1: "locked" }, { type: "fill_field", target: { ref: "e1" }, value: "Ada" });
  const locked = await exec("return document.getElementById('locked').value;");
  check("fill in a disabled fieldset is refused and the field stays empty", f1.ok === false && locked === "", { f1, locked });
  const f2 = await act({ e1: "total" }, { type: "fill_field", target: { ref: "e1" }, value: "$0.00" });
  const total = await exec("return document.getElementById('total').value;");
  check("a read-only field is not overwritten", f2.ok === false && total === "$42.00", { f2, total });
  const f3 = await act({ e1: "name" }, { type: "fill_field", target: { ref: "e1" }, value: "Ada Lovelace" });
  const vals = await exec("return [document.getElementById('name').value, document.getElementById('notes').value];");
  check("an enabled field is filled, its neighbour keeps its value", f3.ok && vals[0] === "Ada Lovelace" && vals[1] === "keep me", { f3, vals });
  const c2 = await act({ e1: "go" }, { type: "click", target: { ref: "e1" } });
  const clicked = await exec("return document.body.dataset.clicked || null;");
  check("an enabled button is clicked and its handler runs", c2.ok && clicked === "yes", { c2, clicked });

  await open("/forms.html");
  const sel = await exec("const s = document.querySelector('select'); return s ? s.id : null;");
  if (sel) {
    const want = await exec("const s = document.getElementById(arguments[0]); return s.options[s.options.length - 1].text;", [sel]);
    const s1 = await act({ e1: sel }, { type: "fill_field", target: { ref: "e1" }, value: want });
    const got = await exec("const s = document.getElementById(arguments[0]); return s.options[s.selectedIndex].text;", [sel]);
    check("a select is set by its visible label", s1.ok && got === want, { s1, got, want });
  }
} finally {
  await call("DELETE", "/session/" + sid).catch(() => undefined);
}
const failed = results.filter((r) => !r.ok).length;
console.log("\nSafari " + caps.browserVersion + " on " + caps.platformName + ": " + (results.length - failed) + "/" + results.length + " passed");
process.exit(failed ? 1 : 0);
