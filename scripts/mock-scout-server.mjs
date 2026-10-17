// Mock Scout server for local end-to-end runs (Part 2). Speaks the Anthropic
// Messages streaming format, so the real Scout server in the worker
// (src/server/engine.ts) runs unchanged against it: sample text, a tool
// request, and a stream that drops. Local only: binds 127.0.0.1. No API key
// is checked or stored; nothing is forwarded anywhere.
//
//   node scripts/mock-scout-server.mjs [port]      (default 4318)
//   MOCK_LOG=file node scripts/mock-scout-server.mjs   also appends each
//   request body (JSON, one per line) to `file`, to check what the extension
//   sends. Use synthetic pages only: the log holds page text as sent.
//
// Debug builds use it when Settings > Diagnostics > "Answer from the local
// mock server" is on. Put a marker in the question to pick a scenario:
//   [mock:tool=read_page]         request a tool (any name, also unknown ones),
//   [mock:tool=open_tab {"url":"https://example.com/"}]   with this input,
//   [mock:drop]                   send part of the answer, then cut the connection,
//   [mock:slow]                   stream slowly (for Stop and reconnect tests),
//   [mock:long]                   stream 40 words over about 24 s (close and reopen the panel meanwhile),
//   [mock:error]                  answer HTTP 500.
// Without a marker it streams a sample answer with Markdown, a table, code, and math.
//
// Scout mode (Part 3): a request that offers the `act` tool is a task turn.
// Markers in the goal pick the batch, e.g.
//   [mock:actions=click e3|fill e1 Ada|click e2 approved|hack]
// (click/double_click/right_click/scroll_to REF, fill REF VALUE, type TEXT,
// key KEY, scroll DIR, wait MS, screenshot; "approved" marks the action as
// pre-approved by the server; anything else is sent as an unknown action).
// Without a marker: scroll down, then finish. The turn after a batch finishes
// with a summary of the results it got back.
//
// Find coupons (a request with the web search tool) gets a coupon search that
// pauses once, as the real server loop does ("pause_turn"); the resumed turn
// must send the paused one back intact (thinking signature, tool input) or it
// gets HTTP 400. Codes come from MOCK_COUPONS (a file of "CODE | url" lines)
// or default to the synthetic codes of the local fake Shopify store.
import { appendFileSync, readFileSync } from "node:fs";
import { createServer } from "node:http";

const port = Number(process.argv[2] ?? process.env.MOCK_PORT ?? 4318);

const DEFAULT_INPUT = {
  read_page: {},
  search_tabs: { query: "fixture" },
  screenshot_visible: {},
  open_tab: { url: "http://127.0.0.1:4317/forms.html" },
  close_tabs: { tab_ids: [2] },
  group_tabs: { tab_ids: [1, 2] },
  run_task: { goal: "test" },
};

const SAMPLE = [
  "This is a **sample answer** from the Scout mock server [1].",
  "",
  "- It streams in small pieces.",
  "- It shows Markdown, a table, code, and math.",
  "",
  "| Item | Price |",
  "|---|---:|",
  "| Widget | $10 |",
  "",
  "```js",
  "console.log(\"hello\");",
  "```",
  "",
  "Energy: $E = mc^2$.",
].join("\n");

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "content-type, x-api-key, anthropic-version, anthropic-dangerous-direct-browser-access",
};

function textOf(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((p) => (p && p.type === "text" ? p.text : "")).join("");
  return "";
}

/** What to stream for a request body: { text, tool?: {name, input}, drop?, slow? } or { status }. */
function plan(body) {
  const messages = Array.isArray(body?.messages) ? body.messages : [];
  const last = messages[messages.length - 1];
  const lastText = textOf(last?.content);
  // Markers count only in the newest question, not earlier turns in the history.
  const all = lastText;
  if (/Tool results/.test(lastText)) {
    const status = /status="([\w-]+)"/.exec(lastText)?.[1] ?? "unknown";
    const name = /<tool_result name="([\w-]+)"/.exec(lastText)?.[1] ?? "tool";
    // Echo what is not page text: notes after the fenced data, or the message
    // of a result that is not ok, and how many images came with it.
    const body = /<tool_result[^>]*>\n([\s\S]*?)\n<\/tool_result>/.exec(lastText)?.[1] ?? "";
    const fenced = body.includes("</untrusted_page_content>");
    const note = fenced ? body.split("</untrusted_page_content>").pop().trim() : body.slice(0, 160);
    const images = Array.isArray(last?.content) ? last.content.filter((p) => p && p.type === "image").length : 0;
    return {
      text:
        "The " + name + " tool answered with status " + status + "." +
        (images ? " It came with " + images + (images === 1 ? " image." : " images.") : "") +
        (note ? " Note: " + note : "") +
        " That finishes the mock answer.",
    };
  }
  // Continue after a drop: the rest of the answer, without the start again.
  if (/^Continue your previous answer/.test(lastText)) return { text: ["and the rest ", "of the answer."] };
  const tool = /\[mock:tool=([\w-]+)(?:\s+(\{[^\]]*\}))?\]/.exec(all);
  if (tool) {
    // close_tabs closes the tab an earlier open_tab answer named, when there was one.
    const history = messages.map((m) => textOf(m.content)).join("\n");
    const opened = [...history.matchAll(/Opened tab (\d+)/g)].pop();
    let input = tool[1] === "close_tabs" && opened ? { tab_ids: [Number(opened[1])] } : DEFAULT_INPUT[tool[1]] ?? {};
    try {
      if (tool[2]) input = JSON.parse(tool[2]);
    } catch {
      // keep the default input
    }
    return { text: "Let me use a tool. ", tool: { name: tool[1], input } };
  }
  if (/\[mock:error\]/.test(all)) return { status: 500 };
  if (/\[mock:long\]/.test(all)) {
    return { text: Array.from({ length: 40 }, (_, i) => "w" + (i + 1) + (i === 39 ? "." : " ")), delay: 600 };
  }
  const words = (/\[mock:(?:drop|slow)\]/.test(all) ? "One two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen." : SAMPLE).split(/(?<= )/);
  return { text: words, drop: /\[mock:drop\]/.test(all), slow: /\[mock:slow\]/.test(all) };
}

function sse(res, data) {
  res.write("event: " + data.type + "\ndata: " + JSON.stringify(data) + "\n\n");
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function stream(res, p) {
  res.writeHead(200, { ...CORS, "content-type": "text/event-stream", "cache-control": "no-cache" });
  sse(res, { type: "message_start", message: { usage: { input_tokens: 25, output_tokens: 1 } } });
  sse(res, { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } });
  const pieces = Array.isArray(p.text) ? p.text : [p.text];
  for (let i = 0; i < pieces.length; i++) {
    if (res.destroyed) return;
    sse(res, { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: pieces[i] } });
    if (p.drop && i === 5) {
      // Cut the connection mid-answer, as a network drop would.
      await wait(50);
      res.destroy();
      return;
    }
    await wait(p.delay ?? (p.slow ? 150 : 15));
  }
  sse(res, { type: "content_block_stop", index: 0 });
  if (p.tool) {
    sse(res, { type: "content_block_start", index: 1, content_block: { type: "tool_use", id: "toolu_mock_1", name: p.tool.name, input: {} } });
    sse(res, { type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: JSON.stringify(p.tool.input) } });
    sse(res, { type: "content_block_stop", index: 1 });
  }
  sse(res, { type: "message_delta", delta: { stop_reason: p.tool ? "tool_use" : "end_turn" }, usage: { output_tokens: 40 } });
  sse(res, { type: "message_stop" });
  res.end();
}

const DEFAULT_COUPONS = [
  "NOPE10 | http://127.0.0.1:4317/deals.html",
  "**KETO10** | [deals](http://127.0.0.1:4317/deals.html)",
  "BEEFY15 | http://127.0.0.1:4317/deals.html",
];

function couponLines() {
  if (!process.env.MOCK_COUPONS) return DEFAULT_COUPONS;
  return readFileSync(process.env.MOCK_COUPONS, "utf8").split("\n").map((l) => l.trim()).filter(Boolean);
}

const SIGNATURE = "mock-signature-1";

/** The first half of the lines, then a pause; the rest once the paused turn comes back intact. */
async function couponStream(res, body) {
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const last = messages[messages.length - 1];
  const lines = couponLines();
  const half = Math.ceil(lines.length / 2);
  const urls = [...new Set(lines.map((l) => /(https?:\/\/[^\s)\]]+)/.exec(l)?.[1]).filter(Boolean))];
  if (last?.role === "assistant") {
    const blocks = Array.isArray(last.content) ? last.content : [];
    const intact =
      blocks.some((b) => b.type === "thinking" && b.signature === SIGNATURE) &&
      blocks.some((b) => b.type === "server_tool_use" && b.input && typeof b.input.query === "string") &&
      blocks.some((b) => b.type === "web_search_tool_result") &&
      blocks.every((b) => b.type !== "text" || (typeof b.text === "string" && b.text !== ""));
    if (!intact) return res.writeHead(400, { ...CORS, "content-type": "application/json" }).end('{"type":"error","error":{"type":"invalid_request_error","message":"paused turn not sent back intact"}}');
    res.writeHead(200, { ...CORS, "content-type": "text/event-stream", "cache-control": "no-cache" });
    sse(res, { type: "message_start", message: { usage: { input_tokens: 900, output_tokens: 1 } } });
    sse(res, { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } });
    for (const l of lines.slice(half)) {
      sse(res, { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: l + "\n" } });
      await wait(30);
    }
    sse(res, { type: "content_block_stop", index: 0 });
    sse(res, { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 60, server_tool_use: { web_search_requests: 1 } } });
    sse(res, { type: "message_stop" });
    return res.end();
  }
  res.writeHead(200, { ...CORS, "content-type": "text/event-stream", "cache-control": "no-cache" });
  sse(res, { type: "message_start", message: { usage: { input_tokens: 400, output_tokens: 1 } } });
  sse(res, { type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "" } });
  sse(res, { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "Search coupon sites first." } });
  sse(res, { type: "content_block_delta", index: 0, delta: { type: "signature_delta", signature: SIGNATURE } });
  sse(res, { type: "content_block_stop", index: 0 });
  sse(res, { type: "content_block_start", index: 1, content_block: { type: "server_tool_use", id: "srvtoolu_mock_1", name: "web_search", input: {} } });
  sse(res, { type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: '{"query":"store promo code"}' } });
  sse(res, { type: "content_block_stop", index: 1 });
  sse(res, {
    type: "content_block_start",
    index: 2,
    content_block: {
      type: "web_search_tool_result",
      tool_use_id: "srvtoolu_mock_1",
      content: urls.map((url) => ({ type: "web_search_result", url, title: "Mock coupon page", encrypted_content: "mock" })),
    },
  });
  sse(res, { type: "content_block_stop", index: 2 });
  sse(res, { type: "content_block_start", index: 3, content_block: { type: "text", text: "" } });
  for (const l of lines.slice(0, half)) {
    sse(res, { type: "content_block_delta", index: 3, delta: { type: "text_delta", text: l + "\n" } });
    await wait(30);
  }
  sse(res, { type: "content_block_stop", index: 3 });
  sse(res, { type: "message_delta", delta: { stop_reason: "pause_turn" }, usage: { output_tokens: 80, server_tool_use: { web_search_requests: 1 } } });
  sse(res, { type: "message_stop" });
  res.end();
}

const TASK_DEFAULT = [{ type: "scroll", direction: "down" }];

function taskAction(spec) {
  const [verb, ...rest] = spec.trim().split(/\s+/);
  const approved = rest[rest.length - 1] === "approved";
  if (approved) rest.pop();
  const target = (s) => (/^e\d+$/.test(s ?? "") ? { ref: s } : s && s.includes(",") ? { x: Number(s.split(",")[0]), y: Number(s.split(",")[1]) } : undefined);
  let a;
  switch (verb) {
    case "click":
    case "double_click":
    case "right_click":
      a = { type: verb, target: target(rest[0]) };
      break;
    case "scroll_to":
      a = { type: "scroll_to_element", target: target(rest[0]) };
      break;
    case "fill":
      a = { type: "fill_field", target: target(rest[0]), value: rest.slice(1).join(" ") };
      break;
    case "type":
      a = { type: "type", text: rest.join(" ") };
      break;
    case "key":
      a = { type: "key", key: rest[0] ?? "Enter", modifiers: [] };
      break;
    case "scroll":
      a = { type: "scroll", direction: rest[0] ?? "down" };
      break;
    case "wait":
      a = { type: "wait", ms: Number(rest[0] ?? 500) };
      break;
    case "screenshot":
      a = { type: "screenshot" };
      break;
    default:
      a = { type: verb || "unknown" };
  }
  return approved ? { ...a, approved: true } : a;
}

/** A Scout mode turn: the first observation gets a batch, the next the finish. */
function taskPlan(body) {
  const messages = Array.isArray(body?.messages) ? body.messages : [];
  const first = textOf(messages[0]?.content);
  const last = textOf(messages[messages.length - 1]?.content);
  const goal = /<user_goal>([\s\S]*?)<\/user_goal>/.exec(first)?.[1] ?? "";
  // The results of the previous batch arrive in the same turn as the new observation.
  if (/Action results/.test(last)) {
    const ok = (last.match(/"ok":true/g) ?? []).length;
    const failed = (last.match(/"ok":false/g) ?? []).length;
    return { text: "", tool: { name: "finish", input: { summary: "Mock task finished: " + ok + " action(s) done, " + failed + " not done." } } };
  }
  const marker = /\[mock:actions=([^\]]+)\]/.exec(goal);
  const actions = marker ? marker[1].split("|").map(taskAction) : TASK_DEFAULT;
  return { text: "Working on it. ", tool: { name: "act", input: { actions } } };
}

createServer(async (req, res) => {
  const path = new URL(req.url ?? "/", "http://localhost").pathname;
  if (req.method === "OPTIONS") return res.writeHead(204, CORS).end();
  if (path === "/health") return res.writeHead(200, { ...CORS, "content-type": "text/plain" }).end("ok");
  if (path !== "/v1/messages" || req.method !== "POST") return res.writeHead(404, CORS).end();
  let raw = "";
  for await (const chunk of req) raw += chunk;
  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    return res.writeHead(400, CORS).end("{}");
  }
  if (process.env.MOCK_LOG) appendFileSync(process.env.MOCK_LOG, JSON.stringify({ at: new Date().toISOString(), body }) + "\n");
  if (Array.isArray(body.tools) && body.tools.some((t) => String(t?.type).startsWith("web_search"))) return couponStream(res, body);
  const p = Array.isArray(body.tools) && body.tools.some((t) => t?.name === "act") ? taskPlan(body) : plan(body);
  if (p.status) return res.writeHead(p.status, { ...CORS, "content-type": "application/json" }).end("{}");
  await stream(res, p);
}).listen(port, "127.0.0.1", () => console.log("mock Scout server on http://127.0.0.1:" + port + "/v1/messages"));
