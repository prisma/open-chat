import { Pool } from "pg";
import postgres from "@prisma-next/postgres/runtime";
import { env } from "../server/env";
import type { Contract } from "./contract.d";
import contractJson from "./contract.json" with { type: "json" };

function createPool() {
  return new Pool({ connectionString: env.DATABASE_URL });
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
