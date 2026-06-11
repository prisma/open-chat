// Standalone Prisma Streams service, deployable as its own Compute app.
//
// @prisma/streams-local trusts every caller, so this wrapper fronts it with
// a single shared bearer key: the embedded server listens on localhost only,
// and this proxy is the sole way in. The open-chat app points STREAMS_URL at
// this service and authenticates with STREAMS_API_KEY.
import { startLocalDurableStreamsServer } from "@prisma/streams-local";
import { createR2Persistence, predictedSqlitePath } from "./r2-persistence";

const apiKeyFromEnv = process.env.STREAMS_API_KEY;
if (!apiKeyFromEnv || apiKeyFromEnv.length < 24) {
  throw new Error(
    "STREAMS_API_KEY is required (min 24 chars) — refusing to expose an unauthenticated streams server",
  );
}
const apiKey: string = apiKeyFromEnv;

const port = Number(process.env.PORT ?? 8080);
const upstreamPort = Number(process.env.UPSTREAM_STREAMS_PORT ?? 52123);
const name = process.env.STREAMS_NAME ?? "open-chat";

// Rehydrate the store from R2 before the server boots — the instance disk
// is ephemeral, so on a fresh instance this is where history comes from.
const r2 = createR2Persistence(name);
if (r2) {
  console.log(`R2 restore: ${await r2.restore(predictedSqlitePath(name))}`);
} else {
  console.warn(
    "R2 persistence disabled (R2_* env vars not set) — events will not survive instance replacement",
  );
}

const upstream = await startLocalDurableStreamsServer({
  name,
  hostname: "127.0.0.1",
  port: upstreamPort,
});
const upstreamUrl = upstream.exports.http.url.replace(/\/$/, "");

if (r2) {
  const dbPath = upstream.exports.sqlite.path;
  if (dbPath !== predictedSqlitePath(name)) {
    // The restore above targeted the wrong file — snapshots still work
    // (they use the live path), but rehydration would silently miss.
    console.error(
      `R2 restore path mismatch: predicted ${predictedSqlitePath(name)}, server uses ${dbPath}`,
    );
  }
  r2.beginSnapshots(dbPath);
}

function authorized(request: Request) {
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (token.length !== apiKey.length) return false;
  // Constant-time comparison; a plain === would leak prefix length via timing.
  let mismatch = 0;
  for (let i = 0; i < token.length; i++) {
    mismatch |= token.charCodeAt(i) ^ apiKey.charCodeAt(i);
  }
  return mismatch === 0;
}

const server = Bun.serve({
  port,
  // Live long-poll reads hold the connection open between events.
  idleTimeout: 255,
  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === "/healthz") {
      return Response.json({ status: "ok", name: upstream.exports.name });
    }

    if (!authorized(request)) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    return fetch(`${upstreamUrl}${url.pathname}${url.search}`, {
      method: request.method,
      headers: request.headers,
      body: request.body,
      signal: request.signal,
    });
  },
});

console.log(
  `Streams proxy on ${server.url} → durable streams at ${upstreamUrl}`,
);
