import { describe, expect, it } from "vitest";
import { checkDevice, imageInfo } from "../../scripts/check-store-screenshots.mjs";

const u32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const ascii = (s: string) => Array.from(s, (c) => c.charCodeAt(0));
// Length, type, data and a CRC placeholder (the check does not verify CRCs).
const chunk = (type: string, data: number[]) => [...u32(data.length), ...ascii(type), ...data, 0, 0, 0, 0];

// Minimal PNG: signature, IHDR (+ optional tRNS), IDAT, IEND; pixels are not read.
function png(width: number, height: number, colorType: number, trns = false): Uint8Array {
  return new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ...chunk("IHDR", [...u32(width), ...u32(height), 8, colorType, 0, 0, 0]),
    ...(trns ? chunk("tRNS", [0]) : []),
    ...chunk("IDAT", [0]),
    ...chunk("IEND", []),
  ]);
}

// Minimal JPEG: SOI, an APP0 segment, then SOF0 with the size.
function jpeg(width: number, height: number): Uint8Array {
  return new Uint8Array([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00,
    0xff, 0xc0, 0x00, 0x0b, 0x08, height >> 8, height & 255, width >> 8, width & 255, 0x01, 0x01, 0x11, 0x00,
  ]);
}

describe("App Store screenshot check", () => {
  it("reads PNG and JPEG sizes and PNG transparency", () => {
    expect(imageInfo(png(1206, 2622, 2))).toEqual({ width: 1206, height: 2622, alpha: false });
    expect(imageInfo(png(1206, 2622, 6))?.alpha).toBe(true);
    expect(imageInfo(png(1206, 2622, 3, true))?.alpha).toBe(true);
    expect(imageInfo(jpeg(2880, 1800))).toEqual({ width: 2880, height: 1800, alpha: false });
    expect(imageInfo(new Uint8Array(ascii("not an image")))).toBeNull();
  });

  it("accepts the sizes App Store Connect takes for each device", () => {
    expect(checkDevice("iphone", [{ name: "1.png", buf: png(1206, 2622, 2) }, { name: "2.jpg", buf: jpeg(2556, 1179) }])).toEqual([]);
    expect(checkDevice("ipad", [{ name: "1.png", buf: png(2064, 2752, 2) }])).toEqual([]);
    expect(checkDevice("mac", [{ name: "1.png", buf: png(2880, 1800, 2) }])).toEqual([]);
  });

  it("names wrong sizes, transparency and counts", () => {
    expect(checkDevice("mac", [{ name: "a.png", buf: png(2560, 1664, 6) }])).toEqual([
      "mac/a.png: 2560x1664 is not an accepted size (1280x800, 1440x900, 2560x1600, 2880x1800)",
      "mac/a.png: has transparency; App Store Connect refuses alpha channels",
    ]);
    expect(checkDevice("ipad", [])).toEqual(["ipad: 0 screenshots (1 to 10 allowed)"]);
    const eleven = Array.from({ length: 11 }, (_, i) => ({ name: `${i}.png`, buf: png(1206, 2622, 2) }));
    expect(checkDevice("iphone", eleven)).toEqual(["iphone: 11 screenshots (1 to 10 allowed)"]);
  });
});
