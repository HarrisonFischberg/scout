import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: ".", testMatch: /appstore\.capture\.ts/, workers: 3, reporter: "list", timeout: 120_000,
  use: { baseURL: "http://127.0.0.1:4317", launchOptions: { executablePath: "/opt/pw-browsers/chromium" } },
  webServer: [{ command: "node ../../scripts/serve-fixtures.mjs 4317", url: "http://127.0.0.1:4317/index.html", reuseExistingServer: true }],
});
