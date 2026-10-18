// Renders the toolbar icons (design/icons/scout-truck-outline*.svg)
// to src/icons/ without a browser, so it also runs where WebKit cannot launch.
// Supports only the SVG subset those files use: one stroke-width, and
// <rect x y width height rx>, <circle cx cy r>, <polygon points> and
// <path d="Mx yvN"> painted in
// order. Each shape erases what is under it (like the panel's .scout-mark,
// whose fill is the canvas color), then draws its outline; fill="currentColor"
// paints its inside instead. Outputs, per size: toolbar-N.png (glyph for light
// toolbars), toolbar-dark-N.png (glyph for dark toolbars), and the
// filled-lens toolbar-active[-dark]-N.png. Names and sizes match
// src/panel/toolbar.ts.
//
// The grays carry a faint warm tint on purpose. Safari paints a pure grayscale
// toolbar icon in the system accent color (blue) whenever the extension can
// read the page; an icon that is not grayscale is shown as drawn. Owner report
// 2026-10-18: the toolbar showed a blue icon, and he wants it gray.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { deflateSync } from "node:zlib";

const root = new URL("..", import.meta.url).pathname;
const out = join(root, "src", "icons");
const SIZES = [16, 19, 32, 38, 48, 64, 128];
const LIGHT_BAR_GLYPH = [0x76, 0x74, 0x6f];
const DARK_BAR_GLYPH = [0xa3, 0xa1, 0x9c];
const SAMPLES = 8; // 8x8 supersampling per pixel

const num = (attrs, name) => {
  const m = new RegExp(`\\b${name}="([-\\d.]+)"`).exec(attrs);
  return m ? Number(m[1]) : 0;
};

function parse(svg) {
  const view = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(svg);
  if (!view) throw new Error("viewBox 0 0 W H required");
  const stroke = num(/<g\b[^>]*>/.exec(svg)?.[0] ?? "", "stroke-width");
  if (!stroke) throw new Error("stroke-width on <g> required");
  const shapes = [];
  for (const m of svg.matchAll(/<(rect|circle|polygon|path)\b([^>]*)\/>/g)) {
    const [, tag, a] = m;
    const filled = /fill="currentColor"/.test(a);
    if (tag === "rect") shapes.push({ tag, x: num(a, "x"), y: num(a, "y"), w: num(a, "width"), h: num(a, "height"), rx: num(a, "rx"), filled });
    else if (tag === "polygon") {
      const p = (/points="([^"]+)"/.exec(a)?.[1] ?? "").trim().split(/[\s,]+/).map(Number);
      const pts = [];
      for (let k = 0; k + 1 < p.length; k += 2) pts.push([p[k], p[k + 1]]);
      if (pts.length < 3) throw new Error("<polygon> needs 3+ points");
      shapes.push({ tag, pts, filled });
    } else if (tag === "circle") shapes.push({ tag, cx: num(a, "cx"), cy: num(a, "cy"), r: num(a, "r"), filled });
    else {
      const d = /d="M([-\d.]+) ([-\d.]+)v([-\d.]+)"/.exec(a);
      if (!d) throw new Error("only <path d=\"Mx yvN\"> is supported");
      shapes.push({ tag: "line", x: Number(d[1]), y1: Number(d[2]), y2: Number(d[2]) + Number(d[3]) });
    }
  }
  return { width: Number(view[1]), half: stroke / 2, shapes };
}

// Signed distance from (x, y) to the shape's edge: negative inside.
function distance(s, x, y) {
  if (s.tag === "circle") return Math.hypot(x - s.cx, y - s.cy) - s.r;
  if (s.tag === "polygon") {
    // Nearest edge, with even-odd for the sign. Outer corners come out round, like stroke-linejoin="round".
    let d = Infinity;
    let inside = false;
    for (let k = 0, j = s.pts.length - 1; k < s.pts.length; j = k++) {
      const [ax, ay] = s.pts[j];
      const [bx, by] = s.pts[k];
      const ex = bx - ax, ey = by - ay;
      const t = Math.max(0, Math.min(1, ((x - ax) * ex + (y - ay) * ey) / (ex * ex + ey * ey)));
      d = Math.min(d, Math.hypot(x - ax - t * ex, y - ay - t * ey));
      if (ay > y !== by > y && x < ax + ((y - ay) * ex) / ey) inside = !inside;
    }
    return inside ? -d : d;
  }
  const r = Math.min(s.rx, s.w / 2, s.h / 2);
  const qx = Math.abs(x - (s.x + s.w / 2)) - (s.w / 2 - r);
  const qy = Math.abs(y - (s.y + s.h / 2)) - (s.h / 2 - r);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}

function ink(icon, x, y) {
  let on = false;
  for (const s of icon.shapes) {
    if (s.tag === "line") {
      // Butt caps: a plain band along the segment.
      if (Math.abs(x - s.x) <= icon.half && y >= Math.min(s.y1, s.y2) && y <= Math.max(s.y1, s.y2)) on = true;
      continue;
    }
    const d = distance(s, x, y);
    if (Math.abs(d) <= icon.half) on = true;
    else if (d < 0) on = s.filled;
  }
  return on;
}

function rasterize(icon, size, rgb) {
  const scale = icon.width / size;
  const px = Buffer.alloc(size * size * 4);
  for (let py = 0; py < size; py++) {
    for (let qx = 0; qx < size; qx++) {
      let hit = 0;
      for (let i = 0; i < SAMPLES; i++) {
        for (let j = 0; j < SAMPLES; j++) {
          if (ink(icon, (qx + (i + 0.5) / SAMPLES) * scale, (py + (j + 0.5) / SAMPLES) * scale)) hit++;
        }
      }
      const o = (py * size + qx) * 4;
      px[o] = rgb[0];
      px[o + 1] = rgb[1];
      px[o + 2] = rgb[2];
      px[o + 3] = Math.round((255 * hit) / (SAMPLES * SAMPLES));
    }
  }
  return png(size, size, px);
}

const CRC = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(w, h, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

await mkdir(out, { recursive: true });
const jobs = [
  ["scout-truck-outline.svg", "toolbar"],
  ["scout-truck-outline-active.svg", "toolbar-active"],
];
for (const [file, name] of jobs) {
  const icon = parse(await readFile(join(root, "design", "icons", file), "utf8"));
  for (const size of SIZES) {
    await writeFile(join(out, `${name}-${size}.png`), rasterize(icon, size, LIGHT_BAR_GLYPH));
    await writeFile(join(out, `${name}-dark-${size}.png`), rasterize(icon, size, DARK_BAR_GLYPH));
  }
}
console.log("toolbar icons rendered to " + out);
