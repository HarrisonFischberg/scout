// Renders the monochrome toolbar icons (design/icons/safari-scout-binoculars*.svg)
// to src/icons/ without a browser, so it also runs where WebKit cannot launch.
// Supports only the SVG subset those files use: <rect x y width height rx>,
// <circle cx cy r>, and one <mask> whose black circles cut holes. Outputs, per
// size: toolbar-N.png (dark glyph for light toolbars), toolbar-dark-N.png (light
// glyph for dark toolbars), and the filled-lens toolbar-active[-dark]-N.png.
// Names and sizes match src/panel/toolbar.ts.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { deflateSync } from "node:zlib";

const root = new URL("..", import.meta.url).pathname;
const out = join(root, "src", "icons");
const SIZES = [16, 19, 32, 38, 48, 64, 128];
const LIGHT_BAR_GLYPH = [0x4a, 0x4a, 0x4f];
const DARK_BAR_GLYPH = [0xd8, 0xd8, 0xdc];
const SAMPLES = 8; // 8x8 supersampling per pixel

const num = (attrs, name) => {
  const m = new RegExp(`\\b${name}="([-\\d.]+)"`).exec(attrs);
  return m ? Number(m[1]) : 0;
};

function shapes(fragment) {
  const list = [];
  for (const m of fragment.matchAll(/<(rect|circle)\b([^>]*)\/>/g)) {
    const [, tag, a] = m;
    if (tag === "rect") list.push({ tag, x: num(a, "x"), y: num(a, "y"), w: num(a, "width"), h: num(a, "height"), rx: num(a, "rx"), black: /fill="#000"/.test(a) });
    else list.push({ tag, cx: num(a, "cx"), cy: num(a, "cy"), r: num(a, "r"), black: /fill="#000"/.test(a) });
  }
  return list;
}

function inside(s, x, y) {
  if (s.tag === "circle") return (x - s.cx) ** 2 + (y - s.cy) ** 2 <= s.r * s.r;
  if (x < s.x || x > s.x + s.w || y < s.y || y > s.y + s.h) return false;
  const r = Math.min(s.rx, s.w / 2, s.h / 2);
  const dx = Math.max(s.x + r - x, 0, x - (s.x + s.w - r));
  const dy = Math.max(s.y + r - y, 0, y - (s.y + s.h - r));
  return dx * dx + dy * dy <= r * r;
}

function parse(svg) {
  const view = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(svg);
  if (!view) throw new Error("viewBox 0 0 W H required");
  const mask = /<mask\b[\s\S]*?<\/mask>/.exec(svg)?.[0] ?? "";
  const body = svg.replace(/<defs>[\s\S]*?<\/defs>/, "");
  return { width: Number(view[1]), fill: shapes(body), holes: shapes(mask).filter((s) => s.black) };
}

function rasterize(icon, size, rgb) {
  const scale = icon.width / size;
  const px = Buffer.alloc(size * size * 4);
  for (let py = 0; py < size; py++) {
    for (let qx = 0; qx < size; qx++) {
      let hit = 0;
      for (let i = 0; i < SAMPLES; i++) {
        for (let j = 0; j < SAMPLES; j++) {
          const x = (qx + (i + 0.5) / SAMPLES) * scale;
          const y = (py + (j + 0.5) / SAMPLES) * scale;
          if (icon.fill.some((s) => inside(s, x, y)) && !icon.holes.some((s) => inside(s, x, y))) hit++;
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
  ["safari-scout-binoculars.svg", "toolbar"],
  ["safari-scout-binoculars-active.svg", "toolbar-active"],
];
for (const [file, name] of jobs) {
  const icon = parse(await readFile(join(root, "design", "icons", file), "utf8"));
  for (const size of SIZES) {
    await writeFile(join(out, `${name}-${size}.png`), rasterize(icon, size, LIGHT_BAR_GLYPH));
    await writeFile(join(out, `${name}-dark-${size}.png`), rasterize(icon, size, DARK_BAR_GLYPH));
  }
}
console.log("toolbar icons rendered to " + out);
