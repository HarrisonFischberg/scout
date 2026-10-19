import { defineConfig } from "@playwright/test";
// Review-only capture config (not part of the test suite). Chromium from the container.
export default defineConfig({
  testDir: ".",
  testMatch: /.*\.capture\.ts/,
  workers: 2,
  reporter: "list",
  timeout: 120_000,
  use: { baseURL: "http://127.0.0.1:4317", launchOptions: { executablePath: "/opt/pw-browsers/chromium" } },
  webServer: [{ command: "node ../../scripts/serve-fixtures.mjs 4317", url: "http://127.0.0.1:4317/index.html", reuseExistingServer: true }],
});
