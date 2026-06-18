// Self-hosted Prisma Streams server, deployable as its own Compute app.
//
// @prisma/streams-server is the full production runtime — SQLite WAL,
// segmenting, R2 object-store upload, recovery, bearer-key auth — so this
// entry only sets deployment defaults and delegates. (Local development
// never runs this file: the chat server embeds @prisma/streams-local when
// STREAMS_URL is unset.)
//
// R2 is configured with DURABLE_STREAMS_R2_BUCKET / _ACCOUNT_ID /
// _ACCESS_KEY_ID / _SECRET_ACCESS_KEY; the open-chat app authenticates
// with the same `Authorization: Bearer` header the previous custom proxy
// checked, so STREAMS_API_KEY carries over unchanged.
import { existsSync } from "node:fs";

// The runtime reads API_KEY; reuse the key the chat app already sends.
process.env.API_KEY ??= process.env.STREAMS_API_KEY;
// Bind beyond loopback so the Compute router can reach the server.
process.env.DS_HOST ??= "0.0.0.0";
// The container home dir has almost no writable space; keep the hot tier
// on /tmp — R2 is the durable tier, so losing /tmp is expected and fine.
process.env.DS_ROOT ??= "/tmp/ds-data";
// By default segments seal only at 16 MB or 100k rows, which a chat app
// may never reach — events would wait in the local WAL indefinitely and
// die with the instance. Sealing at least every 5s bounds the window of
// events that an abrupt instance death can lose.
process.env.DS_SEGMENT_MAX_INTERVAL_MS ??= "5000";
// R2 restores and uploads run over the public S3-compatible API. Keep the
// object-store timeout realistic and let bootstrap validate segment heads in
// parallel so a cold instance can come up from published R2 state quickly.
process.env.DS_OBJECTSTORE_TIMEOUT_MS ??= "60000";
process.env.STREAMS_BOOTSTRAP_HEAD_CONCURRENCY ??= "32";

process.argv.push("--auth-strategy", "api-key");
// Rehydrate from R2 only when the disk is fresh (new instance). On a warm
// restart the local WAL may hold rows not yet uploaded; bootstrap clears
// local state first, so running it unconditionally would drop them.
if (!existsSync(`${process.env.DS_ROOT}/wal.sqlite`)) {
  console.log("Prisma Streams bootstrapping local state from R2");
  process.argv.push("--bootstrap-from-r2");
}

await import("@prisma/streams-server/compute");
