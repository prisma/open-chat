// Server-side thumbnailing via Bun.Image (Bun >= 1.3.14). Generated images
// arrive with no client around to downscale them, so the server makes the
// inline thumbnail before the event enters the log. The API is feature-
// detected: on older Bun runtimes this is a no-op and the event carries
// only the content-store reference (the UI then loads the original).
import { parseDataUrl } from "./content";

type BunImageLike = {
  resize(
    width: number,
    height: number,
    options: { fit: "inside" },
  ): {
    jpeg(options: { quality: number }): { bytes(): Promise<Uint8Array> };
  };
};

const BunImage = (
  Bun as unknown as { Image?: new (data: Uint8Array) => BunImageLike }
).Image;

const THUMB_MAX_EDGE = 512;

export async function thumbnailFromDataUrl(dataUrl: string) {
  if (!BunImage) return undefined;
  try {
    const { bytes } = parseDataUrl(dataUrl);
    const thumb = await new BunImage(bytes)
      .resize(THUMB_MAX_EDGE, THUMB_MAX_EDGE, { fit: "inside" })
      .jpeg({ quality: 80 })
      .bytes();
    return `data:image/jpeg;base64,${Buffer.from(thumb).toString("base64")}`;
  } catch (error) {
    console.error("Thumbnailing failed; event will carry only the id", error);
    return undefined;
  }
}
