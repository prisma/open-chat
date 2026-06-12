// Full-resolution image storage. Events carry only a small inline
// thumbnail; the original goes to the content store and is served back
// through GET /api/content/:id. In production the store is the same R2
// bucket the streams service tiers into (shared DURABLE_STREAMS_R2_* env,
// objects under content/); in local development it falls back to a
// directory on disk so the app stays fully local.
import { join } from "node:path";

const TYPE_BY_EXT: Record<string, string> = {
  png: "image/png",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
};

const LOCAL_DIR = join(process.cwd(), "var/content");

function r2Client() {
  const {
    DURABLE_STREAMS_R2_BUCKET: bucket,
    DURABLE_STREAMS_R2_ACCOUNT_ID: accountId,
    DURABLE_STREAMS_R2_ACCESS_KEY_ID: accessKeyId,
    DURABLE_STREAMS_R2_SECRET_ACCESS_KEY: secretAccessKey,
  } = process.env;
  if (!bucket || !accountId || !accessKeyId || !secretAccessKey) {
    return undefined;
  }
  return new Bun.S3Client({
    accessKeyId,
    secretAccessKey,
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    bucket,
  });
}

const r2 = r2Client();

export function parseDataUrl(dataUrl: string) {
  const match = /^data:image\/(png|jpeg|webp|gif);base64,(.+)$/s.exec(dataUrl);
  if (!match) throw new Error("Unsupported image data URL");
  const [, ext, base64] = match;
  return { ext: ext!, bytes: Buffer.from(base64!, "base64") };
}

/** Stores an image data URL and returns its content id. */
export async function storeContent(dataUrl: string) {
  const { ext, bytes } = parseDataUrl(dataUrl);
  const id = `${crypto.randomUUID()}.${ext}`;
  if (r2) {
    await r2
      .file(`content/${id}`)
      .write(bytes, { type: TYPE_BY_EXT[ext] ?? "application/octet-stream" });
  } else {
    await Bun.write(join(LOCAL_DIR, id), bytes);
  }
  return id;
}

/**
 * Serves a stored image. The id is validated by the route (a UUID plus
 * extension), so it cannot traverse outside the store.
 */
export async function readContent(id: string) {
  const type = TYPE_BY_EXT[id.split(".").at(-1)!] ?? "";
  const headers = {
    "Content-Type": type,
    // Ids are unique per object and never rewritten.
    "Cache-Control": "private, max-age=31536000, immutable",
  };

  if (r2) {
    const file = r2.file(`content/${id}`);
    if (!(await file.exists())) return undefined;
    return new Response(file.stream(), { headers });
  }

  const file = Bun.file(join(LOCAL_DIR, id));
  if (!(await file.exists())) return undefined;
  return new Response(file, { headers });
}
