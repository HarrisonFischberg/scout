#!/usr/bin/env node
// Combined tally across live-suite runs: the latest result per merchant (a run that
// failed inside the runner itself does not replace an earlier real result), with the
// popup build it ran on and a category for the write-up.
//
//   node scripts/live-suite-tally.mjs ralph/evidence/live-suite/<dir> [<dir> ...]   (prints Markdown)
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const dirs = process.argv.slice(2);
if (!dirs.length) {
  console.error("usage: node scripts/live-suite-tally.mjs <run dir> [...]");
  process.exit(2);
}
// Outcomes of the runner itself (a crash, a cart it could not fill, a checkout it could not open, a
// cart-only dry run): they never replace a result the engine produced on an earlier run.
const RUNNER_ERROR = /^error: \(intermediate value\)|^error: browserContext|^error: page\.|^error: evaluate timed out|^blocked: (could not add to cart|no Checkout button|Checkout button did not|the store removed|site unreachable)|^cart ok/;
const latest = new Map();
for (const dir of dirs) {
  const file = join(dir, "results.json");
  if (!existsSync(file)) continue;
  const run = JSON.parse(readFileSync(file, "utf8"));
  for (const r of run.results) {
    const entry = { ...r, run: dir.replace(/.*\//, ""), browser: run.browser, build: r.build || "old (pre-hash)" };
    const prev = latest.get(r.name);
    if (RUNNER_ERROR.test(r.outcome) && prev) continue;
    if (!prev || prev.startedAt <= r.startedAt || RUNNER_ERROR.test(prev.outcome)) latest.set(r.name, entry);
  }
}
function category(r) {
  const o = r.outcome;
  if (/did not confirm/.test(o)) return "claimed a saving the cart API did not confirm";
  if (o.startsWith("applied")) return "applied";
  if (o === "no working code") return "no working code";
  if (o === "no codes found") return "no codes found (masked only)";
  if (o === "discovery failed") return "discovery failed";
  if (o === "no coupon box") return "discount field only at checkout";
  if (/zero|total is \$0\.00/.test(o)) return "blocked: cart read $0";
  if (/unreadable total/.test(o)) return "blocked: unreadable total";
  if (/^blocked/.test(o)) return "blocked: " + (/(bot check|captcha)/i.test(o) ? "bot wall" : "harness");
  if (/^cart ok/.test(o)) return "blocked: harness (cart only)";
  return "error";
}
const rows = [...latest.values()].sort((a, b) => a.name.localeCompare(b.name));
const counts = {};
for (const r of rows) counts[category(r)] = (counts[category(r)] ?? 0) + 1;
const applied = rows.filter((r) => category(r) === "applied");
const searched = rows.filter((r) => (r.stages || []).includes("coupons:search") && !(r.stages || []).some((s) => s.startsWith("coupons:search-error")));
const testable = rows.filter((r) => !/^blocked|^error|discount field only/.test(category(r)));
console.log("Merchants: " + rows.length + ". Applied: " + applied.length + " (" + Math.round((100 * applied.length) / rows.length) + "% of all; " + Math.round((100 * applied.length) / Math.max(testable.length, 1)) + "% of the " + testable.length + " where a code could be tested; " + Math.round((100 * applied.filter((r) => searched.includes(r)).length) / Math.max(searched.length, 1)) + "% of the " + searched.length + " whose web search completed).");
console.log("");
console.log("| Category | Count | Merchants |");
console.log("|---|---|---|");
for (const [k, v] of Object.entries(counts).sort((a, b) => b[1] - a[1])) console.log("| " + k + " | " + v + " | " + rows.filter((r) => category(r) === k).map((r) => r.name).join(", ") + " |");
console.log("");
console.log("| Merchant | Category | Latest run | Build | Codes (store/verified/reported/masked) | Result |");
console.log("|---|---|---|---|---|---|");
for (const r of rows) {
  const cand = ((r.stages || []).find((s) => s.startsWith("coupons:candidates ")) || "").replace("coupons:candidates ", "").replace(/dropped=\d+ /, "");
  const best = /([A-Z0-9,+ _-]+?) is the best: your total drops from \*?\*?([^*\s]+)\*?\*? to \*?\*?([^*\s]+)/.exec((r.summary || "").replace(/\*\*/g, ""));
  const result = r.verify ? (best ? best[1].trim() + " " : "") + r.verify.before + " -> " + r.verify.after + (r.verify.confirmed ? " (cart confirmed)" : " (not confirmed)") : r.outcome.slice(0, 70);
  console.log("| " + r.name + " | " + category(r) + " | " + r.run + " | " + r.build + " | " + cand + " | " + result + " |");
}
