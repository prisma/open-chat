// Durable persistence for the embedded streams store. A Compute instance's
// filesystem is ephemeral — when the platform replaces the instance, the
// SQLite store under /tmp is gone, and with it every chat's event log. This
// module closes that gap with R2 (or any S3-compatible store): on boot, a
// fresh instance rehydrates the store from the latest snapshot; while
// running, it uploads a new snapshot whenever the store has changed.
//
// Configured entirely from env; with no R2_* vars set (local dev) it is a
// no-op. The snapshot interval bounds the durability window: events
// appended after the last upload die with the instance.

import { Database } from "bun:sqlite";
import envPaths from "env-paths";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

// Mirrors @prisma/streams-local's internal layout (src/local/state.ts),
// which honors XDG_DATA_HOME via env-paths. The restore must run before
// the server boots, so the path has to be predicted; index.ts asserts the
// running server agrees with it afterwards.
export function predictedSqlitePath(serverName: string) {
  return join(
    envPaths("prisma-dev").data,
    "durable-streams",
    serverName,
    "durable-streams.sqlite",
  );
}

export function createR2Persistence(serverName: string) {
  const { R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_ENDPOINT, R2_BUCKET } =
    process.env;
  if (!R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_ENDPOINT || !R2_BUCKET) {
    return null;
  }

  const client = new Bun.S3Client({
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY,
    endpoint: R2_ENDPOINT,
    bucket: R2_BUCKET,
  });
  const snapshot = client.file(`${serverName}/durable-streams.sqlite`);
  const intervalMs = Number(process.env.R2_SNAPSHOT_INTERVAL_MS ?? 30_000);
  let lastUploadedHash: ReturnType<typeof Bun.hash> | undefined;

  return {
    // Pull the latest snapshot onto an empty disk. A store that already
    // exists locally wins — it is at least as new as any snapshot.
    async restore(dbPath: string) {
      if (existsSync(dbPath)) return "local-store-exists" as const;
      if (!(await snapshot.exists())) return "no-snapshot" as const;
      const bytes = await snapshot.arrayBuffer();
      mkdirSync(dirname(dbPath), { recursive: true });
      await Bun.write(dbPath, bytes);
      lastUploadedHash = Bun.hash(bytes);
      return "restored" as const;
    },

    // Serialize a consistent copy of the live store (a read-only SQLite
    // connection sees a stable snapshot through the WAL) and upload it if
    // it differs from what's already in R2.
    async uploadIfChanged(dbPath: string) {
      const db = new Database(dbPath, { readonly: true });
      let bytes: Uint8Array;
      try {
        bytes = db.serialize();
      } finally {
        db.close();
      }
      const hash = Bun.hash(bytes);
      if (hash === lastUploadedHash) return false;
      await snapshot.write(bytes);
      lastUploadedHash = hash;
      return true;
    },

    beginSnapshots(dbPath: string) {
      const tick = () =>
        this.uploadIfChanged(dbPath).catch((error) => {
          console.error("R2 snapshot failed; will retry", error);
        });
      const timer = setInterval(tick, intervalMs);
      // A pending snapshot alone shouldn't keep the process alive.
      timer.unref();
      // Flush a final snapshot when the platform stops the instance.
      process.on("SIGTERM", () => {
        clearInterval(timer);
        void this.uploadIfChanged(dbPath)
          .catch((error) => console.error("Final R2 snapshot failed", error))
          .finally(() => process.exit(0));
      });
    },
  };
}
