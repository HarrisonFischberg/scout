import { defineConfig, devices } from "@playwright/test";

// Not 4173: that is the Vite preview default and often busy on dev machines.
const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
const PORT = Number(env.E2E_PORT ?? 4317);
// Part 2 mock Scout server (scripts/mock-scout-server.mjs): a local fake provider stream.
const MOCK_PORT = Number(env.MOCK_PORT ?? 4318);

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: true,
  reporter: "list",
  use: { baseURL: `http://127.0.0.1:${PORT}` },
  projects: [{ name: "webkit", use: { ...devices["Desktop Safari"] } }],
  webServer: [
    {
      command: `node scripts/serve-fixtures.mjs ${PORT}`,
      url: `http://127.0.0.1:${PORT}/index.html`,
      reuseExistingServer: false,
    },
    {
      command: `node scripts/mock-scout-server.mjs ${MOCK_PORT}`,
      url: `http://127.0.0.1:${MOCK_PORT}/health`,
      reuseExistingServer: false,
    },
  ],
});
