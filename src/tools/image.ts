// Screenshot sizing for screenshot_visible: a data URL from
// tabs.captureVisibleTab becomes base64 for the provider, scaled so its long
// edge is at most 1568 px (larger images are scaled down by the provider
// anyway, at the same cost) and re-encoded as JPEG.
import type { ToolImage } from "./host";

export const MAX_EDGE = 1568;
/** Provider limit is 5 MB per image; stay under it with room for base64. */
export const MAX_BASE64 = 4_500_000;

export function parseDataUrl(dataUrl: string): ToolImage | null {
  const m = /^data:(image\/(?:jpeg|png));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  return m ? { mediaType: m[1] as ToolImage["mediaType"], data: m[2]! } : null;
}

/** The sent image, with its pixel size when it could be measured (Part 3 scales coordinates with it). */
export type SizedImage = ToolImage & { width?: number; height?: number };

export async function shrinkScreenshot(dataUrl: string, maxEdge = MAX_EDGE): Promise<SizedImage> {
  const parsed = parseDataUrl(dataUrl);
  if (!parsed) throw new Error("not an image data URL");
  try {
    if (typeof createImageBitmap === "function" && typeof document !== "undefined") {
      const bitmap = await createImageBitmap(await (await fetch(dataUrl)).blob());
      const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
      if (scale < 1 || parsed.data.length > MAX_BASE64) {
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(bitmap.width * scale);
        canvas.height = Math.round(bitmap.height * scale);
        canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        const smaller = parseDataUrl(canvas.toDataURL("image/jpeg", 0.75));
        if (smaller) return { ...smaller, width: canvas.width, height: canvas.height };
      }
      if (parsed.data.length <= MAX_BASE64) return { ...parsed, width: bitmap.width, height: bitmap.height };
    }
  } catch {
    // Fall through to the original if it is small enough.
  }
  if (parsed.data.length > MAX_BASE64) throw new Error("screenshot too large");
  return parsed;
}
