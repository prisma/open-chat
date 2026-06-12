// Attachment preparation. Each image is prepared in two sizes: a capped
// "full" version that the server parks in the content store (R2), and a
// small thumbnail that travels inline in the durable event log — replay
// stays cheap while the original remains one proxy request away.
import type { MessageImage } from "../shared/contracts";

const FULL_MAX_EDGE = 2560;
const THUMB_MAX_EDGE = 512;
const PASSTHROUGH_BYTES = 2_500_000;

export type PreparedImage = { full: string; thumb: string };

function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function scaled(bitmap: ImageBitmap, maxEdge: number, quality: number) {
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas is unavailable");
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", quality);
}

export async function prepareImage(file: File): Promise<PreparedImage> {
  const bitmap = await createImageBitmap(file);
  try {
    const fitsAlready =
      Math.max(bitmap.width, bitmap.height) <= FULL_MAX_EDGE &&
      file.size <= PASSTHROUGH_BYTES;
    return {
      // Small originals keep their format (screenshots stay crisp PNG);
      // anything larger is capped and re-encoded.
      full: fitsAlready
        ? await readAsDataUrl(file)
        : scaled(bitmap, FULL_MAX_EDGE, 0.9),
      thumb: scaled(bitmap, THUMB_MAX_EDGE, 0.8),
    };
  } finally {
    bitmap.close();
  }
}

/** The src for inline display: the thumbnail when one exists. */
export function imageThumbSrc(image: MessageImage) {
  if (typeof image === "string") return image;
  return image.thumb ?? `/api/content/${image.id}`;
}

/** The src for the lightbox: the stored original when one exists. */
export function imageFullSrc(image: MessageImage) {
  if (typeof image === "string") return image;
  return `/api/content/${image.id}`;
}
