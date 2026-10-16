// Bundles src/ into the Safari extension Resources folder and copies static files.
import { build } from "esbuild";
import { copyFile, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const src = join(root, "src");
const out = join(root, "apple", "Extension", "Resources");
// Debug builds include local diagnostics (src/diagnostics.ts). Release builds
// (`npm run build:release`) compile them out entirely.
const release = process.env.ASSISTANT_BUILD === "release";

await build({
  entryPoints: {
    background: join(src, "background.ts"),
    popup: join(src, "popup.ts"),
    content: join(src, "content.ts"),
  },
  outdir: out,
  bundle: true,
  format: "iife",
  target: "safari16",
  platform: "browser",
  logLevel: "warning",
  // Needed so `if (__ASSISTANT_DEBUG__)` branches are removed, not just skipped.
  minifySyntax: release,
  treeShaking: true,
  define: {
    __ASSISTANT_DEBUG__: release ? "false" : "true",
    __ASSISTANT_VERSION__: JSON.stringify(JSON.parse(await readFile(join(src, "manifest.json"), "utf8")).version),
  },
});

await copyFile(join(src, "manifest.json"), join(out, "manifest.json"));
const popupHtml = await readFile(join(src, "popup.html"), "utf8");
await writeFile(
  join(out, "popup.html"),
  release ? popupHtml.replace(/\s*<!-- debug:start[\s\S]*?<!-- debug:end -->/g, "") : popupHtml,
);

console.log(`built extension to ${out} (${release ? "release" : "debug"})`);

// Legal drafts (docs/legal/*.md) become static pages bundled with the
// extension so S08 can link to them. Markdown subset: #/##/### headings,
// "- " lists, "> " quotes, paragraphs. Text is escaped; no raw HTML passes.
const esc = (t) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const inline = (t) => esc(t).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/`(.+?)`/g, "<code>$1</code>");

function markdownToHtml(md) {
  const out = [];
  let list = false;
  let para = [];
  const flush = () => {
    if (para.length) out.push("<p>" + inline(para.join(" ")) + "</p>");
    para = [];
  };
  const closeList = () => {
    if (list) out.push("</ul>");
    list = false;
  };
  for (const line of md.split("\n")) {
    const h = /^(#{1,3}) (.+)$/.exec(line);
    if (h) {
      flush();
      closeList();
      out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`);
    } else if (line.startsWith("- ")) {
      flush();
      if (!list) out.push("<ul>");
      list = true;
      out.push("<li>" + inline(line.slice(2)) + "</li>");
    } else if (line.trim() === "") {
      flush();
      closeList();
    } else if (line.startsWith(">")) {
      flush();
      closeList();
      out.push("<p><em>" + inline(line.replace(/^>\s?/, "")) + "</em></p>");
    } else {
      closeList();
      para.push(line.trim());
    }
  }
  flush();
  closeList();
  return out.join("\n");
}

const legalPages = [
  ["privacy-policy.md", "privacy.html", "Privacy policy"],
  ["terms.md", "terms.html", "Terms of service"],
];
for (const [from, to, title] of legalPages) {
  const body = markdownToHtml(await readFile(join(root, "docs", "legal", from), "utf8"));
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="color-scheme" content="light dark" />
<title>${title} (DRAFT) - AssistAnt</title>
<style>body{font:15px/1.5 -apple-system,system-ui,sans-serif;max-width:42rem;margin:0 auto;padding:16px}body{background:#FFFFFF;color:#1D1D1F}a{color:#6D28D9;text-decoration:underline}@media (prefers-color-scheme:dark){body{background:#1C1C1E;color:#F5F5F7}a{color:#C4B5FD}}a:focus-visible{outline:2px solid currentColor;outline-offset:2px}</style>
</head>
<body>
<main>
<p><strong>DRAFT. Not approved by legal review.</strong></p>
${body}
<p><a href="popup.html">Back to AssistAnt</a></p>
</main>
</body>
</html>
`;
  await writeFile(join(out, to), html);
}
