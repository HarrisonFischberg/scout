// Types for scripts/targets.mjs (used by tests/unit/targets.test.ts).
export type Target = "safari" | "chrome" | "firefox";
export const TARGETS: Target[];
export const ESBUILD_TARGET: Record<Target, string>;
export const GECKO_ID: string;
export function manifestFor(target: string, source: Record<string, unknown>): Record<string, any>;
export const CHROME_SHIM: string;
