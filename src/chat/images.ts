// Images the user pastes, drops or picks into the ask box (owner request
// 2026-11-02: "allow for pasting in images to Scout and have Claude read
// them"). Each one is redrawn on a canvas before it is sent: that scales its
// long edge to MAX_EDGE (larger images cost the same and are scaled down by
// the provider anyway), keeps it under the provider's 5 MB limit, and drops
// the file's metadata (a phone photo's location never leaves the device).
// Image data is never written to the debug log or saved with the chat.
import { MAX_BASE64, MAX_EDGE } from "../tools/image";
import type { ContentPart } from "../providers/types";

/** Images per message. */
export const MAX_IMAGES = 4;
/** Files larger than this are refused before decoding (a 48 MP photo is ~25 MB). */
export const MAX_FILE_BYTES = 40_000_000;
/** The question sent when the user sends images with no words. */
export const IMAGE_ONLY_QUESTION = "What's in this image?";
export const IMAGES_ONLY_QUESTION = "What's in these images?";
/** Apple's on-device model can't see images; shown when there is no key to hand them to. */
export const IMAGES_NEED_KEY = "Reading images needs an API key. Apple's on-device model can't see images.";

export interface PastedImage {
  mediaType: "image/jpeg" | "image/png";
  /** Base64 without the data: prefix. */
  data: string;
  width: number;
  height: number;
}

/** The size to draw at: the long edge at most `maxEdge`, never enlarged. */
export function fitSize(width: number, height: number, maxEdge = MAX_EDGE): { width: number; height: number } {
  const scale = Math.min(1, maxEdge / Math.max(width, height, 1));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** Image files among pasted, dropped or picked items. */
export function imageFiles(list: ArrayLike<{ kind?: string; type: string; getAsFile?: () => File | null }> | null | undefined): File[] {
  const out: File[] = [];
  for (const item of Array.from(list ?? [])) {
    if (!/^image\//i.test(item.type)) continue;
    const file = typeof item.getAsFile === "function" ? (item.kind === "file" ? item.getAsFile() : null) : (item as unknown as File);
    if (file) out.push(file);
  }
  return out;
}

/** The question to send: the typed words, or a default one for images alone. */
export function questionFor(text: string, images: number): string {
  const t = text.trim();
  if (t || images === 0) return t;
  return images === 1 ? IMAGE_ONLY_QUESTION : IMAGES_ONLY_QUESTION;
}

/** The user turn: text alone, or text followed by the images. */
export function withImages(text: string, images: readonly PastedImage[]): string | ContentPart[] {
  if (!images.length) return text;
  return [{ type: "text", text }, ...images.map((i): ContentPart => ({ type: "image", mediaType: i.mediaType, data: i.data }))];
}

/** What history keeps of a turn that had images: the words and a note, never the images. */
export function historyText(text: string, images: number): string {
  return images ? text + "\n\n[" + (images === 1 ? "1 image was" : images + " images were") + " attached to this message.]" : text;
}

/** For the debug log: counts and sizes only. */
export function describeImages(images: readonly PastedImage[]): string {
  return images.map((i) => i.mediaType.slice(6) + " " + i.width + "x" + i.height + " " + Math.round((i.data.length * 3) / 4 / 1024) + "KB").join(", ");
}

export function dataUrl(img: PastedImage): string {
  return "data:" + img.mediaType + ";base64," + img.data;
}

async function decode(file: Blob): Promise<{ source: CanvasImageSource; width: number; height: number; close(): void }> {
  if (typeof createImageBitmap === "function") {
    try {
      const b = await createImageBitmap(file);
      return { source: b, width: b.width, height: b.height, close: () => b.close() };
    } catch {
      // Some formats (HEIC in older Safari) decode only through <img>.
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return { source: img, width: img.naturalWidth, height: img.naturalHeight, close: () => undefined };
  } finally {
    URL.revokeObjectURL(url);
  }
}

function encode(canvas: HTMLCanvasElement, type: "image/png" | "image/jpeg", quality?: number): { mediaType: PastedImage["mediaType"]; data: string } | null {
  const m = /^data:(image\/(?:png|jpeg));base64,(.+)$/.exec(canvas.toDataURL(type, quality));
  return m ? { mediaType: m[1] as PastedImage["mediaType"], data: m[2]! } : null;
}

/**
 * Redraws an image file for sending. PNG stays PNG when it fits (screenshots
 * keep sharp text); everything else, and any PNG too large, becomes JPEG on
 * white. Throws a message fit to show when the file can't be used.
 */
export async function prepareImage(file: Blob): Promise<PastedImage> {
  if (file.size > MAX_FILE_BYTES) throw new Error("That image is too large. Try a smaller one.");
  let bmp: Awaited<ReturnType<typeof decode>>;
  try {
    bmp = await decode(file);
  } catch {
    throw new Error("Scout couldn't open that image. Try a PNG or JPEG.");
  }
  try {
    for (const edge of [MAX_EDGE, 1092, 768]) {
      const size = fitSize(bmp.width, bmp.height, edge);
      const canvas = document.createElement("canvas");
      canvas.width = size.width;
      canvas.height = size.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) break;
      if (file.type === "image/png") {
        ctx.drawImage(bmp.source, 0, 0, size.width, size.height);
        const png = encode(canvas, "image/png");
        if (png && png.data.length <= MAX_BASE64 / 4) return { ...png, ...size };
      }
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, size.width, size.height);
      ctx.drawImage(bmp.source, 0, 0, size.width, size.height);
      const jpeg = encode(canvas, "image/jpeg", 0.85);
      if (jpeg && jpeg.data.length <= MAX_BASE64) return { ...jpeg, ...size };
    }
  } finally {
    bmp.close();
  }
  throw new Error("Scout couldn't open that image. Try a PNG or JPEG.");
}

/**
 * The thumbnails row above the ask box: one 56 px tile per image with a
 * remove button. The caller owns the list and re-renders after changes.
 */
export function renderTray(tray: HTMLElement, images: readonly PastedImage[], onRemove: (index: number) => void): void {
  tray.replaceChildren(
    ...images.map((img, i) => {
      const tile = document.createElement("div");
      tile.className = "img-tile";
      const pic = document.createElement("img");
      pic.src = dataUrl(img);
      pic.alt = "Image " + (i + 1);
      const x = document.createElement("button");
      x.type = "button";
      x.className = "img-remove";
      x.setAttribute("aria-label", "Remove image " + (i + 1));
      x.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M7 7l10 10M17 7 7 17"/></svg>';
      x.addEventListener("click", () => onRemove(i));
      tile.append(pic, x);
      return tile;
    }),
  );
  tray.hidden = images.length === 0;
}

/** Small thumbnails inside a sent message. */
export function messageThumbs(images: readonly PastedImage[]): HTMLElement {
  const row = document.createElement("div");
  row.className = "msg-images";
  for (const [i, img] of images.entries()) {
    const pic = document.createElement("img");
    pic.src = dataUrl(img);
    pic.alt = "Image " + (i + 1);
    row.appendChild(pic);
  }
  return row;
}
