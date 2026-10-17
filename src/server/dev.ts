// Debug builds only: point the Scout server at a local mock provider
// (scripts/mock-scout-server.mjs) to try the whole flow without spending
// tokens. Release builds never read this key (`if (__SCOUT_DEBUG__)`).
export const DEV_MOCK_KEY = "devMockServer";
export const DEV_MOCK_URL = "http://127.0.0.1:4318/v1/messages";

/** Only a loopback http(s) URL is accepted as a mock server. */
export function mockServerUrl(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  try {
    const u = new URL(raw);
    return (u.protocol === "http:" || u.protocol === "https:") && (u.hostname === "127.0.0.1" || u.hostname === "localhost") ? u.toString() : null;
  } catch {
    return null;
  }
}
