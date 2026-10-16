import { defineConfig, devices } from "@playwright/test";

// Not 4173: that is the Vite preview default and often busy on dev machines.
const PORT = Number(process.env.E2E_PORT ?? 4317);

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: true,
  reporter: "list",
  use: { baseURL: `http://127.0.0.1:${PORT}` },
  projects: [{ name: "webkit", use: { ...devices["Desktop Safari"] } }],
  webServer: {
    command: `node scripts/serve-fixtures.mjs ${PORT}`,
    url: `http://127.0.0.1:${PORT}/index.html`,
    reuseExistingServer: false,
  },
});
