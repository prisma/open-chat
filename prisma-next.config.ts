import 'dotenv/config';
import { defineConfig } from '@prisma-next/postgres/config';

// The deploy loads this file (by path, from module.ts's pnPostgres resource
// `config`) to resolve the contract and `migrations/` for the deploy-run
// migration step — it injects the provisioned URL itself, so `db.connection`
// only matters for local CLI use (db:init/db:push against a dev database).
export default defineConfig({
  contract: "./src/prisma/contract.prisma",
  db: {
    connection: process.env['DATABASE_URL'] ?? "postgres://localhost:5432/placeholder",
  },
});
