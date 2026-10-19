// Review-only mockups of the Mac and iPhone setup app (apple/App/OnboardingView.swift),
// "before" recreated from the SwiftUI source and one per refresh direction.
// HTML renderings, not Xcode captures: the cloud has no Xcode or Simulator.
import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const ROOT = resolve(new URL(".", import.meta.url).pathname, "../..");
const FONTS = join(ROOT, "impeccable-review/tools/fonts");
const TMP = join(ROOT, "test-results/native-mocks");
const TRUCK = `<svg viewBox="0 0 64 64" class="truck" aria-hidden="true"><polygon points="13,26 16.5,11 36,11 40.5,26"/><polygon points="21,16 32.5,16 34.5,23 21,23"/><rect x="5" y="26" width="54" height="17" rx="4"/><circle cx="18" cy="44" r="9"/><circle cx="46" cy="44" r="9"/><circle class="hub" cx="18" cy="44" r="2.5"/><circle class="hub" cx="46" cy="44" r="2.5"/></svg>`;
const ff = (name, file, w) => `@font-face{font-family:${name};font-weight:${w};src:url("file://${FONTS}/${file}")}`;
const FONTFACES = [400, 600, 700, 800, 900].map((w) => ff("RevRound", `nunito-latin-${w}-normal.woff2`, w)).join("")
  + [400, 500, 600, 700].map((w) => ff("RevGro", `space-grotesk-latin-${w}-normal.woff2`, w)).join("")
  + [400, 600].map((w) => ff("RevMono", `jetbrains-mono-latin-${w}-normal.woff2`, w)).join("");

const isMac = (p) => p === "mac";
const enableCopy = (p) => isMac(p) ? "Open Safari's extension settings, then switch on Scout." : "Open Settings › Apps › Safari › Extensions, switch on Scout, and allow it on the sites you choose.";

// Each design returns { css, body(plat) }. Variables: light/dark via prefers-color-scheme.
const designs = {
  before: {
    css: `:root{--bg:#fff;--fg:#1d1d1f;--sec:#6e6e73;--link:#0066cc;--btn:#e8e8ed}
      @media (prefers-color-scheme:dark){:root{--bg:#1e1e1e;--fg:#f5f5f7;--sec:#98989d;--link:#2997ff;--btn:#3a3a3c}}
      body{background:var(--bg);color:var(--fg);font-family:Inter,sans-serif}
      .wrap{padding:24px;max-width:560px} h1{font-size:30px;font-weight:700;margin:0 0 6px} .sub{font-size:19px;color:var(--sec);margin:0 0 24px}
      h2{font-size:22px;font-weight:700;margin:0 0 12px} section{margin-bottom:24px} p{margin:0 0 12px;font-size:14px;line-height:1.4}
      .mac-btn{display:inline-block;padding:3px 10px;border-radius:6px;background:var(--btn);font-size:13px;box-shadow:0 0.5px 1px rgb(0 0 0/.3)}
      .link{display:block;color:var(--link);margin:0 0 10px;font-size:14px} b{font-weight:700}
      .iphone p{font-size:17px}.iphone .link{font-size:17px}.iphone h1{font-size:34px}.iphone .sub{font-size:20px}`,
    body: (p) => `<div class="wrap"><h1>Set up Scout for Safari</h1><p class="sub">Your AI Scout for the Safari Browser</p>
      <section><h2>1. Turn on the extension</h2><p>${isMac(p) ? "Open Safari extension settings, then switch on Scout for Safari." : "Open the Settings app. Go to Apps, then Safari, then Extensions. Switch on Scout for Safari and allow it on the websites you choose."}</p>${isMac(p) ? '<span class="mac-btn">Open Safari Extension Settings</span>' : ""}</section>
      <section><h2>2. Add your API key</h2><p>Scout for Safari sends page content to the provider you choose, using your own key. The key is stored in Keychain on this device.</p><p>Your provider bills your account for every request Scout for Safari makes, at the provider's prices. Scout for Safari shows an estimated cost after each answer or task.</p><p><b>${isMac(p) ? "Add your key in Safari: click the Scout for Safari icon in the toolbar, then Settings." : "Add your key in Safari: open Scout for Safari from the menu in the address bar, then tap Settings."}</b></p></section>
      <section><h2>Legal (DRAFT)</h2><p>Drafts awaiting legal review. Not final.</p><span class="link">Privacy policy (draft)</span><span class="link">Terms of service (draft)</span></section></div>`,
  },
  "option-1": {
    css: `:root{--bg:#f6f1e7;--card:#fffdf8;--fg:#1f2a1f;--sec:#5a6356;--acc:#2f6b3a;--on:#fff;--line:#e3d9c5;--sun:#f2c14e;--chip:#e2ead6}
      @media (prefers-color-scheme:dark){:root{--bg:#131913;--card:#1b231c;--fg:#eef1e8;--sec:#a6ae9f;--acc:#8fd19b;--on:#0f1f11;--line:#2b352b;--sun:#e9b949;--chip:#2b3a2c}}
      body{background:var(--bg);color:var(--fg);font-family:RevRound,sans-serif}
      .wrap{padding:28px 24px;max-width:560px;margin:0 auto}
      .badge{width:84px;height:84px;border-radius:50%;padding:15px;background:radial-gradient(circle at 50% 120%,var(--sun) 0 38%,transparent 39%),var(--acc);box-shadow:0 0 0 6px var(--bg),0 0 0 7px var(--line)}
      .truck{fill:var(--acc);stroke:var(--on);stroke-width:3.6;stroke-linejoin:round}.truck .hub{fill:var(--on)}
      h1{font:800 30px/1.1 RevRound;letter-spacing:-.02em;margin:18px 0 6px} .sub{color:var(--sec);font-size:16px;margin:0 0 22px}
      .step{display:flex;gap:14px;background:var(--card);border:1px solid var(--line);border-radius:20px;padding:16px;margin-bottom:12px}
      .n{flex:none;width:30px;height:30px;border-radius:50%;display:grid;place-items:center;background:var(--chip);color:var(--acc);font-weight:800}
      .done .n{background:var(--acc);color:var(--on)} h2{font:800 17px RevRound;margin:3px 0 4px} p{margin:0 0 10px;color:var(--sec);font-size:14.5px;line-height:1.45}
      .btn{display:inline-block;padding:9px 18px;border-radius:999px;background:var(--acc);color:var(--on);font-weight:800;font-size:14px}
      .tag{display:inline-block;font-size:12px;font-weight:800;padding:2px 9px;border-radius:999px;background:var(--chip);color:var(--acc);margin-left:6px;vertical-align:2px}
      .foot{color:var(--sec);font-size:13px;margin-top:14px}.foot u{color:var(--acc)}`,
    body: (p) => `<div class="wrap"><div class="badge">${TRUCK}</div><h1>Let's get Scout on the trail</h1><p class="sub">Two quick steps, then Scout lives in Safari.</p>
      <div class="step done"><span class="n">✓</span><div><h2>Turn on Scout in Safari <span class="tag">On</span></h2><p>${enableCopy(p)}</p></div></div>
      <div class="step"><span class="n">2</span><div><h2>Add your API key</h2><p>Use your own Anthropic or OpenAI key. It stays in your Keychain; your provider bills you directly.</p><span class="btn">${isMac(p) ? "Open Scout in Safari" : "Show me where"}</span></div></div>
      <p class="foot">Privacy and terms are drafts: <u>Privacy</u> · <u>Terms</u></p></div>`,
  },
  "option-2": {
    css: `:root{--bg:#f2f2f7;--cell:#fff;--fg:#000;--sec:#6c6c70;--tint:#0064e0;--line:#d1d1d6;--green:#248a3d}
      @media (prefers-color-scheme:dark){:root{--bg:#000;--cell:#1c1c1e;--fg:#fff;--sec:#98989f;--tint:#3d9bff;--line:#38383a;--green:#30d158}}
      body{background:var(--bg);color:var(--fg);font-family:Inter,sans-serif}.wrap{padding:20px 16px;max-width:600px;margin:0 auto}
      .icon{width:64px;height:64px;border-radius:15px;background:linear-gradient(#ffe9a8,#f6c445);display:grid;place-items:center;margin:8px auto 10px}
      .truck{width:44px;fill:#2f7a3a;stroke:#173d1d;stroke-width:3;stroke-linejoin:round}.truck .hub{fill:#173d1d}
      h1{text-align:center;font-size:28px;font-weight:700;margin:0} .sub{text-align:center;color:var(--sec);font-size:15px;margin:4px 0 22px}
      .hdr{font-size:13px;color:var(--sec);text-transform:uppercase;margin:0 16px 6px}.group{background:var(--cell);border-radius:12px;margin-bottom:8px;overflow:hidden}
      .row{display:flex;align-items:center;gap:12px;min-height:46px;padding:0 16px;font-size:16px}.row+.row{border-top:.5px solid var(--line)}
      .row .val{margin-left:auto;color:var(--sec)} .row .val.ok{color:var(--green)} .chev{color:var(--sec);font-size:18px}
      .sym{width:28px;height:28px;border-radius:7px;display:grid;place-items:center;color:#fff;font-size:15px}
      .ftr{font-size:13px;color:var(--sec);margin:0 16px 22px;line-height:1.35} .tint{color:var(--tint)}`,
    body: (p) => `<div class="wrap"><div class="icon">${TRUCK}</div><h1>Scout</h1><p class="sub">AI help in Safari with your own key</p>
      <p class="hdr">Setup</p><div class="group"><div class="row"><span class="sym" style="background:#0a84ff">◎</span>Safari extension<span class="val ok">On</span><span class="chev">›</span></div>
      <div class="row"><span class="sym" style="background:#8e8e93">⚿</span>API key<span class="val">Not added</span><span class="chev">›</span></div></div>
      <p class="ftr">${enableCopy(p)} Add the key in Scout's own Settings in Safari; it stays in your Keychain.</p>
      <p class="hdr">About</p><div class="group"><div class="row tint">Privacy policy</div><div class="row tint">Terms of service</div></div></div>`,
  },
  "option-3": {
    css: `:root{--bg:#f3f5f2;--card:#fff;--fg:#0e1210;--sec:#5c6860;--sig:#2d6a10;--btn:#0e1210;--on:#c6f77a;--line:#d9dfd8}
      @media (prefers-color-scheme:dark){:root{--bg:#0b0d0c;--card:#121614;--fg:#e8f0ea;--sec:#85958b;--sig:#b8f35a;--btn:#b8f35a;--on:#0b0d0c;--line:#232a26}}
      body{background:var(--bg);color:var(--fg);font-family:RevGro,sans-serif}.wrap{padding:28px 24px;max-width:560px;margin:0 auto}
      .mono{font-family:RevMono,monospace}.k{font:600 11px RevMono;letter-spacing:.14em;color:var(--sig)} h1{font:600 30px/1.1 RevGro;letter-spacing:-.02em;margin:10px 0 6px}
      .sub{color:var(--sec);margin:0 0 24px}.check{border:1px solid var(--line);border-radius:10px;background:var(--card);overflow:hidden}
      .item{display:grid;grid-template-columns:28px 1fr auto;gap:10px;padding:14px 16px;align-items:start}.item+.item{border-top:1px solid var(--line)}
      .st{font:600 11px RevMono;letter-spacing:.08em;padding:2px 7px;border-radius:4px;border:1px solid var(--line)} .st.ok{color:var(--sig);border-color:var(--sig)}
      .num{font:600 12px RevMono;color:var(--sec);padding-top:3px} h2{font:600 16px RevGro;margin:0 0 4px} p{margin:0;color:var(--sec);font-size:14px;line-height:1.45}
      .btn{display:inline-block;margin-top:20px;padding:10px 16px;border-radius:7px;background:var(--btn);color:var(--on);font:600 12px RevMono;letter-spacing:.08em}
      .truck{width:34px;fill:none;stroke:var(--sig);stroke-width:3}.truck .hub{fill:var(--sig)}`,
    body: (p) => `<div class="wrap">${TRUCK}<div class="k">SCOUT · SETUP</div><h1>Bring Scout online</h1><p class="sub">Two checks. Scout updates them live.</p>
      <div class="check"><div class="item"><span class="num">01</span><div><h2>Safari extension</h2><p>${enableCopy(p)}</p></div><span class="st ok">● ON</span></div>
      <div class="item"><span class="num">02</span><div><h2>Provider key</h2><p>Anthropic or OpenAI. Stored in Keychain; billed to your account.</p></div><span class="st">○ NOT SET</span></div></div>
      <span class="btn">${isMac(p) ? "OPEN SCOUT IN SAFARI →" : "SHOW ME WHERE →"}</span></div>`,
  },
  "option-4": {
    css: `:root{--bg:#fff6e5;--card:#fff;--fg:#1b1712;--sec:#5d5345;--acc:#c2410c;--on:#fff;--ink:#1b1712;--gold:#ffd34d}
      @media (prefers-color-scheme:dark){:root{--bg:#17130e;--card:#231c14;--fg:#fbefd9;--sec:#c8b697;--acc:#ff8a3d;--on:#1b1712;--ink:#fbefd9;--gold:#ffcf40}}
      body{background:var(--bg);color:var(--fg);font-family:RevRound,sans-serif;font-weight:700}.wrap{padding:28px 24px;max-width:560px;margin:0 auto}
      .truck{width:70px;fill:var(--gold);stroke:var(--ink);stroke-width:3.5;stroke-linejoin:round;transform:rotate(-6deg)}.truck .hub{fill:var(--ink)}
      h1{font:900 32px/1.05 RevRound;letter-spacing:-.03em;margin:10px 0 8px}.sub{color:var(--sec);margin:0 0 22px}
      .card{border:2px solid var(--ink);border-radius:18px;background:var(--card);box-shadow:3px 3px 0 var(--ink);padding:16px;margin-bottom:14px;display:flex;gap:14px}
      .n{flex:none;width:34px;height:34px;border:2px solid var(--ink);border-radius:50%;display:grid;place-items:center;font-weight:900;background:var(--gold);color:#1b1712}
      h2{font:900 18px RevRound;margin:3px 0 4px}p{margin:0 0 10px;color:var(--sec);font-size:14.5px;font-weight:600;line-height:1.45}
      .btn{display:inline-block;padding:9px 18px;border:2px solid var(--ink);border-radius:999px;background:var(--acc);color:var(--on);font-weight:900;box-shadow:2px 2px 0 var(--ink)}
      .done{background:var(--gold);color:#1b1712}.done p{color:#3f372c}`,
    body: (p) => `<div class="wrap">${TRUCK}<h1>Let's get you saving.</h1><p class="sub">Scout finds coupons, compares prices and answers questions right in Safari.</p>
      <div class="card done"><span class="n">✓</span><div><h2>Scout is on in Safari</h2><p>${enableCopy(p)}</p></div></div>
      <div class="card"><span class="n">2</span><div><h2>Add your AI key</h2><p>Bring your own Anthropic or OpenAI key. Kept in your Keychain.</p><span class="btn">${isMac(p) ? "Open Scout in Safari" : "Show me where"}</span></div></div></div>`,
  },
  "option-5": {
    css: `:root{--bg:#fbfaf7;--fg:#141414;--sec:#5e5e59;--acc:#8a2c0d;--line:#e3e0d8;--btn:#141414;--on:#fbfaf7}
      @media (prefers-color-scheme:dark){:root{--bg:#131211;--fg:#eeebe4;--sec:#a39e94;--acc:#eba286;--line:#2d2b27;--btn:#eeebe4;--on:#131211}}
      body{background:var(--bg);color:var(--fg);font-family:Inter,sans-serif}.wrap{padding:30px 26px;max-width:560px;margin:0 auto}
      .k{font-size:11px;font-weight:600;letter-spacing:.16em;text-transform:uppercase;color:var(--sec)} h1{font:400 38px/1.08 "Bitstream Charter",Georgia,serif;letter-spacing:-.02em;margin:10px 0 10px} h1 i{color:var(--acc)}
      .sub{font:italic 17px "Bitstream Charter",serif;color:var(--sec);margin:0 0 24px;padding-bottom:20px;border-bottom:1px solid var(--fg)}
      .st{display:grid;grid-template-columns:40px 1fr;padding:16px 0;border-bottom:1px solid var(--line)} .n{font:400 26px "Bitstream Charter",serif;color:var(--acc)}
      h2{font:400 21px "Bitstream Charter",serif;margin:0 0 4px} p{margin:0;color:var(--sec);font-size:14px;line-height:1.5}
      .ok{font-size:10.5px;font-weight:600;letter-spacing:.12em;text-transform:uppercase;color:var(--acc);margin-left:8px;vertical-align:4px}
      .btn{display:inline-block;margin-top:22px;padding:10px 18px;border-radius:3px;background:var(--btn);color:var(--on);font-weight:600;font-size:14px}`,
    body: (p) => `<div class="wrap"><div class="k">Scout · for Safari</div><h1>A reader's assistant, <i>in every tab.</i></h1><p class="sub">Two steps to begin.</p>
      <div class="st"><span class="n">i.</span><div><h2>Turn on Scout <span class="ok">Done</span></h2><p>${enableCopy(p)}</p></div></div>
      <div class="st"><span class="n">ii.</span><div><h2>Add your key</h2><p>Your own Anthropic or OpenAI key, kept in Keychain and billed by your provider.</p></div></div>
      <span class="btn">${isMac(p) ? "Open Scout in Safari" : "Show me where"}</span></div>`,
  },
};

const macChrome = `<div class="tb"><i style="background:#ff5f57"></i><i style="background:#febc2e"></i><i style="background:#28c840"></i></div>`;
const iosChrome = `<div class="sb"><b>9:41</b><span>●●● ▲ ▮</span></div>`;
await mkdir(TMP, { recursive: true });
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
for (const [name, d] of Object.entries(designs)) {
  const out = join(ROOT, "impeccable-review", name === "before" ? "before" : name);
  await mkdir(out, { recursive: true });
  for (const plat of ["mac", "iphone"]) {
    const html = `<!doctype html><meta charset="utf-8"><style>${FONTFACES}*{box-sizing:border-box}html,body{margin:0}${d.css}
      .tb{height:28px;display:flex;gap:8px;align-items:center;padding:0 12px}.tb i{width:12px;height:12px;border-radius:50%;display:block}
      .sb{display:flex;justify-content:space-between;padding:14px 28px 6px;font:600 15px Inter,sans-serif}</style>
      <body class="${plat}">${isMac(plat) ? macChrome : iosChrome}<div class="${plat === "iphone" ? "iphone" : ""}">${d.body(plat)}</div></body>`;
    const file = join(TMP, `${name}-${plat}.html`);
    await writeFile(file, html);
    for (const scheme of ["light", "dark"]) {
      const page = await browser.newPage({ viewport: isMac(plat) ? { width: 640, height: 620 } : { width: 393, height: 852 }, deviceScaleFactor: 2, colorScheme: scheme });
      await page.goto("file://" + file);
      await page.waitForTimeout(300);
      await page.screenshot({ path: join(out, `${plat}-${scheme}-20-setup-app.png`) });
      await page.close();
    }
  }
}
await browser.close();
console.log("native mocks done");
