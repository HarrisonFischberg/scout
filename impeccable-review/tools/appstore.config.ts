import { defineConfig } from "@playwright/test";
import { existsSync } from "node:fs";
// The cloud sandbox keeps Chromium here; on a Mac, Playwright uses its own download.
const CHROMIUM = "/opt/pw-browsers/chromium";
export default defineConfig({
  testDir: ".", testMatch: /appstore\.capture\.ts/, workers: 3, reporter: "list", timeout: 120_000,
  use: { baseURL: "http://127.0.0.1:4317", launchOptions: existsSync(CHROMIUM) ? { executablePath: CHROMIUM } : {} },
  webServer: [{ command: "node ../../scripts/serve-fixtures.mjs 4317", url: "http://127.0.0.1:4317/index.html", reuseExistingServer: true }],
});
