// Checks App Store screenshots before they are uploaded
// (docs/app-store-submission.md, "Screenshots"). Sizes are App Store
// Connect's accepted sizes, checked 2026-10-20 at
// https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications/
// Usage: node scripts/check-store-screenshots.mjs [folder]
// The folder (default build/app-store-screenshots) holds iphone/, ipad/ and
// mac/, each with 1 to 10 PNG or JPEG files. Prints one line per problem and
// exits 1 if there is any.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

/** Accepted width x height per device folder (portrait and landscape). */
export const SIZES = {
  iphone: ["1320x2868", "2868x1320", "1290x2796", "2796x1290", "1179x2556", "2556x1179", "1206x2622", "2622x1206"],
  ipad: ["2064x2752", "2752x2064", "2048x2732", "2732x2048"],
  mac: ["1280x800", "1440x900", "2560x1600", "2880x1800"],
};

/** Width, height and alpha of a PNG or JPEG, or null if it is neither. */
export function imageInfo(bytes) {
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (buf.length > 26 && buf.readUInt32BE(0) === 0x89504e47) {
    const colorType = buf[25];
    let alpha = colorType === 4 || colorType === 6;
    // A tRNS chunk gives palette or grey images transparency too.
    for (let i = 8; i + 8 <= buf.length; ) {
      const len = buf.readUInt32BE(i);
      const type = buf.toString("latin1", i + 4, i + 8);
      if (type === "tRNS") alpha = true;
      if (type === "IDAT" || type === "IEND") break;
      i += 12 + len;
    }
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20), alpha };
  }
  if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    for (let i = 2; i + 9 < buf.length; ) {
      if (buf[i] !== 0xff) return null;
      const marker = buf[i + 1];
      const len = buf.readUInt16BE(i + 2);
      // SOF0-SOF15 except DHT (C4), JPG (C8) and DAC (CC).
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { width: buf.readUInt16BE(i + 7), height: buf.readUInt16BE(i + 5), alpha: false };
      }
      i += 2 + len;
    }
  }
  return null;
}

/** Problems with one device folder's files ({ name, buf } each). */
export function checkDevice(device, files) {
  const problems = [];
  const images = files.filter((f) => /\.(png|jpe?g)$/i.test(f.name));
  if (images.length < 1 || images.length > 10) problems.push(`${device}: ${images.length} screenshots (1 to 10 allowed)`);
  for (const f of images) {
    const info = imageInfo(f.buf);
    if (!info) {
      problems.push(`${device}/${f.name}: not a readable PNG or JPEG`);
      continue;
    }
    const size = `${info.width}x${info.height}`;
    if (!SIZES[device].includes(size)) problems.push(`${device}/${f.name}: ${size} is not an accepted size (${SIZES[device].join(", ")})`);
    if (info.alpha) problems.push(`${device}/${f.name}: has transparency; App Store Connect refuses alpha channels`);
  }
  return problems;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const dir = process.argv[2] ?? "build/app-store-screenshots";
  const problems = [];
  for (const device of Object.keys(SIZES)) {
    const sub = join(dir, device);
    let names = [];
    try {
      names = statSync(sub).isDirectory() ? readdirSync(sub).sort() : [];
    } catch {
      problems.push(`${device}: missing folder ${sub}`);
      continue;
    }
    problems.push(...checkDevice(device, names.map((name) => ({ name, buf: readFileSync(join(sub, name)) }))));
  }
  for (const p of problems) console.log(p);
  console.log(problems.length ? `${problems.length} problem(s)` : "screenshots ok");
  process.exit(problems.length ? 1 : 0);
}
