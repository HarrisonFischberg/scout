// Pasted images (owner request 2026-11-02): paste into the ask box, drop onto
// it, or "Add image" in the + menu. Each is scaled and re-encoded first
// (src/chat/images.ts); thumbnails sit above the ask box until sent or
// removed. The debug log gets counts and sizes only. Moved out of the panel's
// main() (audit 2026-11-10).
import { MAX_IMAGES, describeImages, imageFiles, prepareImage, renderTray, type PastedImage } from "../chat/images";

export interface ImageTrayDeps {
  question: HTMLTextAreaElement;
  composer: HTMLFormElement;
  status: HTMLElement;
  closePlus: () => void;
  trace: (stage: string) => void;
}

/** Wires paste, drop and Add image. `pending` is the list the next message sends; `show` redraws the thumbnails after it changes. */
export function imageTray(d: ImageTrayDeps): { pending: PastedImage[]; show: () => void } {
  const { question, composer, status } = d;
  const pending: PastedImage[] = [];
  const imgTray = document.getElementById("img-tray")!;
  const imgPick = document.getElementById("img-pick") as HTMLInputElement;
  function showTray(): void {
    renderTray(imgTray, pending, (i) => {
      pending.splice(i, 1);
      d.trace("images:removed");
      showTray();
      question.focus();
    });
  }
  async function addImages(files: File[]): Promise<void> {
    if (!files.length) return;
    const room = MAX_IMAGES - pending.length;
    if (room <= 0) {
      status.textContent = "You can add up to " + MAX_IMAGES + " images. Remove one first.";
      return;
    }
    if (files.length > room) status.textContent = "Only " + MAX_IMAGES + " images fit in one message.";
    for (const f of files.slice(0, room)) {
      try {
        const img = await prepareImage(f);
        if (pending.length >= MAX_IMAGES) break;
        pending.push(img);
        d.trace("images:added " + describeImages([img]));
      } catch (err) {
        status.textContent = err instanceof Error ? err.message : "Scout couldn't open that image.";
        d.trace("images:failed");
      }
    }
    showTray();
  }
  question.addEventListener("paste", (e) => {
    const files = imageFiles(e.clipboardData?.items);
    if (!files.length) return;
    // An image copied from a web page also carries its address as text; keep the box clean.
    e.preventDefault();
    void addImages(files);
  });
  composer.addEventListener("dragover", (e) => {
    if ([...(e.dataTransfer?.types ?? [])].includes("Files")) e.preventDefault();
  });
  composer.addEventListener("drop", (e) => {
    const files = imageFiles(e.dataTransfer?.files);
    if (!files.length) return;
    e.preventDefault();
    void addImages(files);
  });
  imgPick.addEventListener("change", () => {
    const files = imageFiles(imgPick.files);
    imgPick.value = "";
    void addImages(files);
  });
  document.getElementById("img-add")!.addEventListener("click", () => {
    d.closePlus();
    imgPick.click();
  });
  return { pending, show: showTray };
}
