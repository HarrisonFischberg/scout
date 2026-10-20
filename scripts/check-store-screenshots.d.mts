// Types for scripts/check-store-screenshots.mjs (used by tests/unit/store-screenshots.test.ts).
export type Device = "iphone" | "ipad" | "mac";
export const SIZES: Record<Device, string[]>;
export function imageInfo(bytes: Uint8Array): { width: number; height: number; alpha: boolean } | null;
export function checkDevice(device: Device, files: { name: string; buf: Uint8Array }[]): string[];
