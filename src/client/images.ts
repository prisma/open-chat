// Attachment preparation: images enter the durable event log as data URLs
// and are replayed on every reload, so they get downscaled client-side
// before sending — a phone photo would otherwise cost megabytes per replay.

const MAX_EDGE = 1568;
const PASSTHROUGH_BYTES = 400_000;

function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export async function imageFileToDataUrl(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    // Small files that need no resizing keep their original format
    // (screenshots stay crisp PNG); everything else becomes a JPEG.
    if (scale === 1 && file.size <= PASSTHROUGH_BYTES) {
      return await readAsDataUrl(file);
    }

    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas is unavailable");
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.85);
  } finally {
    bitmap.close();
  }
}
