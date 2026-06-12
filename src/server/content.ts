// Full-resolution image storage. Events carry only a small inline
// thumbnail; the original goes to the content store and is served back
// through GET /api/content/:id. In production the store is the same R2
// bucket the streams service tiers into (shared DURABLE_STREAMS_R2_* env,
// objects under content/); in local development it falls back to a
// directory on disk so the app stays fully local.
import { join } from "node:path";
import { db } from "../prisma/db";

const TYPE_BY_EXT: Record<string, string> = {
  png: "image/png",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  wav: "audio/wav",
  mp3: "audio/mpeg",
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
  const match =
    /^data:(?:image\/(png|jpeg|webp|gif)|audio\/(wav|mpeg|mp3));base64,(.+)$/s.exec(
      dataUrl,
    );
  if (!match) throw new Error("Unsupported data URL");
  const [, imageExt, audioExt, base64] = match;
  const ext = imageExt ?? (audioExt === "mpeg" ? "mp3" : audioExt!);
  return { ext, bytes: Buffer.from(base64!, "base64") };
}

/** Stores an image data URL for a user and returns its content id. */
export async function storeContent(dataUrl: string, userId: string) {
  const { ext, bytes } = parseDataUrl(dataUrl);
  const id = `${crypto.randomUUID()}.${ext}`;
  if (r2) {
    await r2
      .file(`content/${id}`)
      .write(bytes, { type: TYPE_BY_EXT[ext] ?? "application/octet-stream" });
  } else {
    await Bun.write(join(LOCAL_DIR, id), bytes);
  }
  await db.orm.Content.create({ id, userId, createdAt: new Date() });
  return id;
}

/**
 * Whether a user may read a content object. Objects stored before
 * ownership tracking have no row and stay readable by any signed-in
 * session — their ids are unguessable UUIDs.
 */
export async function contentReadableBy(id: string, userId: string) {
  const row = await db.orm.Content.where({ id }).first();
  return !row || row.userId === userId;
}

/**
 * Serves a stored object, honoring HTTP Range requests — the <audio>
 * scrubber can't seek without 206 responses. The id is validated by the
 * route (a UUID plus extension), so it cannot traverse outside the store.
 */
export async function readContent(id: string, range?: string | null) {
  const file = r2 ? r2.file(`content/${id}`) : Bun.file(join(LOCAL_DIR, id));
  if (!(await file.exists())) return undefined;
  const size = r2
    ? (await (file as Bun.S3File).stat()).size
    : (file as Bun.BunFile).size;

  const headers: Record<string, string> = {
    "Content-Type": TYPE_BY_EXT[id.split(".").at(-1)!] ?? "",
    // Ids are unique per object and never rewritten.
    "Cache-Control": "private, max-age=31536000, immutable",
    "Accept-Ranges": "bytes",
  };

  const match = range ? /^bytes=(\d*)-(\d*)$/.exec(range) : null;
  if (match && (match[1] || match[2])) {
    // "bytes=a-b", "bytes=a-" or the suffix form "bytes=-n".
    const start = match[1]
      ? Number(match[1])
      : Math.max(0, size - Number(match[2]));
    const end = match[1] && match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
    if (start >= size || start > end) {
      return new Response(null, {
        status: 416,
        headers: { ...headers, "Content-Range": `bytes */${size}` },
      });
    }
    return new Response(file.slice(start, end + 1).stream(), {
      status: 206,
      headers: {
        ...headers,
        "Content-Range": `bytes ${start}-${end}/${size}`,
        "Content-Length": String(end - start + 1),
      },
    });
  }

  return new Response(file.stream(), {
    headers: { ...headers, "Content-Length": String(size) },
  });
}
