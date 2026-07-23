// One `pg.Pool` built straight from the service node's `db.url`, shared with
// Better Auth (src/server/auth.ts). The binding's lazy typed client
// (`db.client`, ADR-0040) is deliberately never touched: this pool is the
// app's one set of database connections.
import { Pool } from "pg";
import postgres from "@prisma-next/postgres/runtime";
import service from "../service";
import type { Contract } from "./contract.d";
import contractJson from "./contract.json" with { type: "json" };

function createPool() {
  return new Pool({ connectionString: service.load().db.url });
}

function createDb(pg: Pool) {
  return postgres<Contract>({ contractJson, pg });
}

const globalForDb = globalThis as unknown as {
  dbPool?: ReturnType<typeof createPool>;
  db?: ReturnType<typeof createDb>;
};

export const pool = globalForDb.dbPool ?? createPool();
export const db = globalForDb.db ?? createDb(pool);

if (process.env.NODE_ENV !== "production") {
  globalForDb.dbPool = pool;
  globalForDb.db = db;
}
