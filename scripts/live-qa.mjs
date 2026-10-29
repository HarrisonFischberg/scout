#!/usr/bin/env node
// Live chat evaluation (QA 2026-10-29): runs the production answer engine
// (src/server/engine.ts ScoutServer, the real provider clients and prompts)
// on the labeled cases in tests/evals/chat-v1.json, with bounded live calls.
// Deterministic checks only (text includes/excludes, tool chosen, route);
// no model grades another model.
//
//   SCOUT_LIVE_KEY=... node scripts/live-qa.mjs [--key-only | --apple | --router] [options]
//     --key-only     Anthropic through the engine, no Apple (default)
//     --apple        Apple's on-device model alone (scripts/apple-fm.swift; macOS 26+, outside the sandbox)
//     --router       production routing: Apple first, the key's model when Apple can't answer
//     --only id,id   some cases      --repeat N   run each case N times (max 3)
//     --model ID     key model (default claude-haiku-5-5)
//     --out DIR      default ralph/evidence/live-qa/<stamp>
// Bounds: one call at a time, 90 s per case, no retries, at most 40 runs.
// The key is read from the environment only and never written anywhere.
import { buildSync } from "esbuild";
import { spawn, execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createInterface } from "node:readline";

const args = process.argv.slice(2);
const has = (f) => args.includes("--" + f);
const opt = (f, d) => (args.includes("--" + f) ? args[args.indexOf("--" + f) + 1] : d);
const mode = has("apple") ? "apple" : has("router") ? "router" : "key";
const model = opt("model", "claude-haiku-5-5");
const repeat = Math.min(3, Math.max(1, Number(opt("repeat", "1"))));
const only = opt("only", "") ? opt("only", "").split(",") : null;
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const out = opt("out", join("ralph/evidence/live-qa", stamp + "-" + mode));
const MAX_RUNS = 40;
const CASE_MS = 90_000;

const key = process.env.SCOUT_LIVE_KEY || "";
if (mode !== "apple" && !key) {
  console.error("SCOUT_LIVE_KEY is not set for this process. Nothing was run.");
  process.exit(2);
}

// The engine and providers, bundled from source as the extension bundles them.
const lib = join(tmpdir(), "scout-live-qa-" + process.pid + ".mjs");
buildSync({
  stdin: {
    contents:
      'export { ScoutServer } from "./src/server/engine"; export { createProvider } from "./src/providers"; export { createApple, APPLE_MODEL } from "./src/providers/apple";' +
      'export { offeredTools } from "./src/tools/registry"; export { estimateCostUsd } from "./src/cost";',
    resolveDir: ".",
    loader: "ts",
  },
  bundle: true,
  format: "esm",
  platform: "node",
  define: { __SCOUT_DEBUG__: "false" },
  outfile: lib,
});
const { ScoutServer, createProvider, createApple, APPLE_MODEL, offeredTools, estimateCostUsd } = await import(lib);

// Apple's model through the helper: one JSON line per request.
let appleSend = null;
if (mode !== "key") {
  const bin = join(tmpdir(), "scout-apple-fm");
  if (!existsSync(bin)) execFileSync("xcrun", ["swiftc", "-parse-as-library", "-o", bin, "scripts/apple-fm.swift"], { stdio: "inherit" });
  const child = spawn(bin, [], { stdio: ["pipe", "pipe", "inherit"] });
  const lines = createInterface({ input: child.stdout })[Symbol.asyncIterator]();
  let queue = Promise.resolve();
  appleSend = (m) => {
    if (m.type === "ai.apple.status") return Promise.resolve({ ok: true, available: true });
    const run = queue.then(async () => {
      child.stdin.write(JSON.stringify({ system: m.system, prompt: m.prompt, maxTokens: m.maxTokens }) + "\n");
      const { value } = await lines.next();
      return JSON.parse(value ?? '{"ok":false,"error":"generation_failed"}');
    });
    queue = run.catch(() => undefined);
    return run;
  };
  process.on("exit", () => child.kill());
}

const dataset = JSON.parse(readFileSync("tests/evals/chat-v1.json", "utf8"));
const cases = dataset.cases.filter((c) => !only || only.includes(c.id));
const tools = offeredTools({ searchTabs: false, tabGroups: false, scoutMode: false });
let calls = 0;
const keyCalls = { n: 0 };
const fetchCounted = (url, init) => {
  keyCalls.n++;
  return fetch(url, init);
};

async function runCase(c) {
  const started = Date.now();
  const toolCalls = [];
  const s = new ScoutServer({
    provider: async (_p, m) => (m === APPLE_MODEL ? createApple(appleSend) : createProvider("anthropic", { apiKey: key, fetch: fetchCounted })),
    tools: async () => tools,
    save: async () => undefined,
    now: () => Date.now(),
  });
  const req = {
    message_id: "eval-" + c.id + "-" + ++calls,
    conv: "eval",
    provider: "anthropic",
    model: mode === "key" ? model : APPLE_MODEL,
    ...(mode === "router" ? { fallback: { provider: "anthropic", model } } : {}),
    question: c.question,
    history: c.history ?? [],
    pages: c.pages ?? [],
    ...(c.pages?.length ? {} : { scope: "general" }),
  };
  s.start(req);
  const events = await new Promise((resolve) => {
    const got = [];
    const timer = setTimeout(() => (s.stop(req.message_id), resolve([...got, { kind: "error", code: "timeout" }])), CASE_MS);
    s.subscribe(req.message_id, 0, ({ event }) => {
      got.push(event);
      // Tools are declined: the eval checks which tool the model picked, it never acts.
      if (event.kind === "tool_request") {
        toolCalls.push({ name: event.name, input: event.input });
        s.toolResult(req.message_id, event.request_id, { status: "declined", text: "Not available in this evaluation." });
      }
      if (event.kind === "done" || event.kind === "error") (clearTimeout(timer), resolve(got));
    });
  });
  const end = events[events.length - 1];
  const text = end.kind === "done" ? end.text : "";
  const usage = events.filter((e) => e.kind === "usage").reduce((u, e) => ({ inputTokens: u.inputTokens + e.usage.inputTokens, outputTokens: u.outputTokens + e.usage.outputTokens, webSearches: (u.webSearches ?? 0) + (e.usage.webSearches ?? 0) }), { inputTokens: 0, outputTokens: 0, webSearches: 0 });
  // The key's model answered when it reported usage (after a handoff, or when the router skipped Apple).
  const route = mode === "key" || events.some((e) => e.kind === "usage") ? "key" : "apple";
  const fails = [];
  if (end.kind !== "done") fails.push("ended with " + end.kind + (end.code ? " " + end.code : ""));
  for (const w of c.includes ?? []) if (!text.toLowerCase().includes(w.toLowerCase())) fails.push("missing " + JSON.stringify(w));
  for (const w of c.excludes ?? []) if (text.toLowerCase().includes(w.toLowerCase())) fails.push("contains " + JSON.stringify(w));
  if (c.matches && !new RegExp(c.matches, "i").test(text)) fails.push("does not match /" + c.matches + "/");
  if (c.notMatches && new RegExp(c.notMatches, "i").test(text)) fails.push("matches /" + c.notMatches + "/");
  // Apple's model has no tools, so a tool case only counts where the key's model can answer.
  if (c.tool && mode !== "apple" && toolCalls[0]?.name !== c.tool) fails.push("tool " + (toolCalls[0]?.name ?? "none") + ", expected " + c.tool);
  if (mode === "router" && c.route && route !== c.route) fails.push("route " + route + ", expected " + c.route);
  const cost = usage.inputTokens || usage.outputTokens ? estimateCostUsd(model, usage) : 0;
  return { id: c.id, kind: c.kind, pass: fails.length === 0, fails, route, ms: Date.now() - started, usage, costUsd: cost, tools: toolCalls, text: text.slice(0, 600) };
}

const results = [];
for (const c of cases) {
  for (let i = 0; i < repeat && results.length < MAX_RUNS; i++) {
    const r = await runCase(c);
    results.push(r);
    console.log((r.pass ? "PASS " : "FAIL ") + r.id + " [" + r.route + ", " + r.ms + " ms" + (r.costUsd ? ", $" + r.costUsd.toFixed(5) : "") + "]" + (r.fails.length ? " " + r.fails.join("; ") : ""));
  }
}
const total = results.reduce((s, r) => s + (r.costUsd ?? 0), 0);
const tokens = results.reduce((s, r) => ({ in: s.in + r.usage.inputTokens, out: s.out + r.usage.outputTokens, web: s.web + (r.usage.webSearches ?? 0) }), { in: 0, out: 0, web: 0 });
mkdirSync(out, { recursive: true });
const meta = { dataset: "chat-v" + dataset.version, mode, model: mode === "apple" ? "apple-on-device" : model, repeat, at: new Date().toISOString(), node: process.version, keyHttpCalls: keyCalls.n };
writeFileSync(join(out, "results.json"), JSON.stringify({ meta, results }, null, 2));
const lines = [
  "# Live chat eval (" + mode + ")",
  "",
  "- Dataset " + meta.dataset + ", model " + meta.model + ", " + results.length + " runs, " + new Date().toISOString(),
  "- Passed " + results.filter((r) => r.pass).length + "/" + results.length,
  "- Anthropic HTTP calls " + keyCalls.n + ", tokens in " + tokens.in + " / out " + tokens.out + ", web searches " + tokens.web + ", estimated cost $" + total.toFixed(4) + " (list prices, src/cost.ts)",
  "- Median latency " + [...results].sort((a, b) => a.ms - b.ms)[Math.floor(results.length / 2)]?.ms + " ms",
  "",
  "| case | kind | result | route | ms | notes |",
  "| --- | --- | --- | --- | --- | --- |",
  ...results.map((r) => "| " + r.id + " | " + r.kind + " | " + (r.pass ? "pass" : "FAIL") + " | " + r.route + " | " + r.ms + " | " + r.fails.join("; ") + " |"),
];
writeFileSync(join(out, "summary.md"), lines.join("\n") + "\n");
console.log("\n" + lines.slice(2, 6).join("\n") + "\nWrote " + out);
process.exit(0);
