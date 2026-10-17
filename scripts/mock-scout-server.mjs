// Mock Scout server for local end-to-end runs (Part 2). Speaks the Anthropic
// Messages streaming format, so the real Scout server in the worker
// (src/server/engine.ts) runs unchanged against it: sample text, a tool
// request, and a stream that drops. Local only: binds 127.0.0.1. No API key
// is checked or stored; nothing is forwarded anywhere.
//
//   node scripts/mock-scout-server.mjs [port]      (default 4318)
//
// Debug builds use it when Settings > Diagnostics > "Answer from the local
// mock server" is on. Put a marker in the question to pick a scenario:
//   [mock:tool=read_page]         request a tool (any name, also unknown ones),
//   [mock:tool=open_tab {"url":"https://example.com/"}]   with this input,
//   [mock:drop]                   send part of the answer, then cut the connection,
//   [mock:slow]                   stream slowly (for Stop and reconnect tests),
//   [mock:error]                  answer HTTP 500.
// Without a marker it streams a sample answer with Markdown, a table, code, and math.
import { createServer } from "node:http";

const port = Number(process.argv[2] ?? process.env.MOCK_PORT ?? 4318);

const DEFAULT_INPUT = {
  read_page: {},
  search_tabs: { query: "widget" },
  screenshot_visible: {},
  open_tab: { url: "https://example.com/" },
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
  const all = messages.map((m) => textOf(m.content)).join("\n");
  const lastText = textOf(last?.content);
  if (/Tool results/.test(lastText)) {
    const status = /status="([\w-]+)"/.exec(lastText)?.[1] ?? "unknown";
    const name = /<tool_result name="([\w-]+)"/.exec(lastText)?.[1] ?? "tool";
    return { text: "The " + name + " tool answered with status " + status + ". That finishes the mock answer." };
  }
  // Continue after a drop: the rest of the answer, without the start again.
  if (/^Continue your previous answer/.test(lastText)) return { text: ["and the rest ", "of the answer."] };
  const tool = /\[mock:tool=([\w-]+)(?:\s+(\{[^\]]*\}))?\]/.exec(all);
  if (tool) {
    let input = DEFAULT_INPUT[tool[1]] ?? {};
    try {
      if (tool[2]) input = JSON.parse(tool[2]);
    } catch {
      // keep the default input
    }
    return { text: "Let me use a tool. ", tool: { name: tool[1], input } };
  }
  if (/\[mock:error\]/.test(all)) return { status: 500 };
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
    await wait(p.slow ? 150 : 15);
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
  const p = plan(body);
  if (p.status) return res.writeHead(p.status, { ...CORS, "content-type": "application/json" }).end("{}");
  await stream(res, p);
}).listen(port, "127.0.0.1", () => console.log("mock Scout server on http://127.0.0.1:" + port + "/v1/messages"));
