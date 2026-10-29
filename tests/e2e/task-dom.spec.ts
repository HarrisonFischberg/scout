import { expect, test } from "@playwright/test";
import { buildSync } from "esbuild";

// Scout mode's own action executor (src/actions/task.ts through the content
// script adapter src/actions/task-dom.ts) on a fixture page: checks that it
// refuses controls a person could not use instead of reporting success.
// QA 2026-10-29. Synthetic page, no model.
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
}).outputFiles[0]!.text;

type Result = { ok: boolean; error?: string };
const act = (page: import("@playwright/test").Page, ids: Record<string, string>, action: unknown): Promise<Result> =>
  page.evaluate(([i, a]) => (globalThis as unknown as { __task: (i: unknown, a: unknown) => Result }).__task(i, a), [ids, action] as const);

test.beforeEach(async ({ page }) => {
  await page.goto("/task-controls.html");
  await page.addScriptTag({ content: bundle });
});

test("a control inside a disabled fieldset is reported disabled, not clicked or filled", async ({ page }) => {
  const click = await act(page, { e1: "locked-save" }, { type: "click", target: { ref: "e1" } });
  expect(click).toMatchObject({ ok: false, error: "disabled" });
  const fill = await act(page, { e1: "locked" }, { type: "fill_field", target: { ref: "e1" }, value: "Ada" });
  expect(fill).toMatchObject({ ok: false, error: "disabled" });
  await expect(page.locator("#locked")).toHaveValue("");
  expect(await page.evaluate(() => document.body.dataset.saved)).toBeUndefined();
});

test("a read-only field is not overwritten", async ({ page }) => {
  const fill = await act(page, { e1: "total" }, { type: "fill_field", target: { ref: "e1" }, value: "$0.00" });
  expect(fill.ok).toBe(false);
  await expect(page.locator("#total")).toHaveValue("$42.00");
});

test("an enabled field is filled and its neighbours keep their values", async ({ page }) => {
  const fill = await act(page, { e1: "name" }, { type: "fill_field", target: { ref: "e1" }, value: "Ada Lovelace" });
  expect(fill.ok).toBe(true);
  await expect(page.locator("#name")).toHaveValue("Ada Lovelace");
  await expect(page.locator("#notes")).toHaveValue("keep me");
  const click = await act(page, { e1: "go" }, { type: "click", target: { ref: "e1" } });
  expect(click.ok).toBe(true);
  expect(await page.evaluate(() => document.body.dataset.clicked)).toBe("yes");
});
