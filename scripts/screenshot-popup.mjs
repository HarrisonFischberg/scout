// Renders the built popup (apple/Extension/Resources) in WebKit with stubbed
// extension APIs and synthetic data, for visual review. Writes PNGs to build/.
import { webkit } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const res = join(root, "apple", "Extension", "Resources");
const now = Date.now();
const data = {
  settings: { provider: "anthropic", model: "claude-sonnet-5-5", retention: "7" },
  history: [
    {
      at: now - 60000,
      question: "Summarize this page: one or two sentences on what it is about, then 3 to 6 bullet points with the key facts.",
      answer: [
        "A shooting at an elementary school left **three children and a teacher** dead, according to police, and the suspected gunman is also dead.",
        "",
        "- Police said a bystander confronted the suspect.",
        "- Officials *have not released* the victims' names.",
        "- The school district closed schools for the rest of the week.",
        "  - Counseling is offered at the district office.",
        "",
        "> \"We are heartbroken,\" the superintendent said.",
      ].join("\n"),
      kind: "chat",
    },
    { at: now - 30000, question: "Compare the jacket price on these tabs.", answer: "The jacket is cheapest on the outlet page.\n\n| Store | Price |\n|---|---:|\n| Outlet | **$89** |\n| Main store | $120 |", kind: "chat" },
  ],
};

const stub = `
  const data = ${JSON.stringify(data)};
  globalThis.browser = {
    runtime: { sendMessage: async () => ({ ok: true }), onMessage: { addListener() {} },
      sendNativeMessage: async (_a, m) => m.type === "keychain.get" && m.account === "anthropic" ? { ok: true, value: "sk-ant-synthetic" } : { ok: true } },
    tabs: { query: async () => [{ id: 1, url: "https://shop.test/", title: "Test shop", active: true }, { id: 2, url: "https://reviews.test/", title: "Reviews", active: false }] },
    permissions: { request: async () => true, getAll: async () => ({ origins: ["https://shop.test/*"] }), remove: async () => true },
    scripting: { executeScript: async () => [{ result: null }] },
    storage: { local: { get: async (k) => Object.fromEntries((Array.isArray(k) ? k : [k]).filter((x) => x in data).map((x) => [x, data[x]])), set: async (o) => Object.assign(data, o), clear: async () => {} } },
  };`;

const browser = await webkit.launch();
for (const scheme of ["light", "dark"]) {
  const page = await browser.newPage({ viewport: { width: 400, height: 600 }, colorScheme: scheme, deviceScaleFactor: 2 });
  await page.addInitScript(stub);
  await page.route("http://popup.test/**", async (r) => {
    const name = new URL(r.request().url()).pathname.slice(1);
    const type = name.endsWith(".js") ? "text/javascript" : name.endsWith(".png") ? "image/png" : "text/html";
    await r.fulfill({ body: await readFile(join(res, name)), contentType: type });
  });
  await page.goto("http://popup.test/popup.html");
  await page.waitForSelector("#status:has-text('Ready')");
  await page.getByRole("radio", { name: "Control Browser" }).check();
  await page.getByLabel("Ask about this page").fill("Compare this jacket with the same one on two other stores");
  await page.waitForTimeout(300); // let the 150 ms color transitions finish
  await page.screenshot({ path: join(root, "build", `popup-chat-${scheme}.png`) });
  await page.getByRole("button", { name: "More actions" }).click();
  await page.screenshot({ path: join(root, "build", `popup-menu-${scheme}.png`) });
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Settings" }).click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(root, "build", `popup-settings-${scheme}.png`) });
  await page.close();
}
await browser.close();
console.log("screenshots in build/");
