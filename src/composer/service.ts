// The open-chat compute service: a plain Postgres and a durable streams
// server as dependencies, plus the secrets and params the app's own
// process.env surface needs (see start.ts, the launcher that maps these onto
// it). GitHub/Google OAuth are intentionally not declared here — social
// sign-in is off in the port topology (spec: open-chat-port Chosen design #8).
//
// Postgres is a plain `postgres()` dep, not `pnPostgres()`: its binding is
// `{ url }`, which is exactly what open-chat's own `src/prisma/db.ts` needs
// to build its `pg.Pool` (Better Auth shares that pool) — open-chat keeps
// running its own migrations (spec: open-chat-port Chosen design #7).
import { secret, string } from "@prisma/composer";
import node from "@prisma/composer/node";
import { compute, postgres } from "@prisma/composer-prisma-cloud";
import { durableStreams } from "@prisma/composer-prisma-cloud/streams";

export default compute({
  name: "chat",
  deps: {
    db: postgres(),
    streams: durableStreams(),
  },
  params: {
    appOrigin: string(),
    openrouterAppName: string({ default: "Open Chat Local" }),
    openrouterSiteUrl: string({ default: "http://localhost:3000" }),
  },
  secrets: {
    openrouterApiKey: secret(),
    betterAuthSecret: secret(),
    streamsKey: secret(),
    stripeSecretKey: secret(),
    stripeWebhookSecret: secret(),
  },
  build: node({ module: import.meta.url, entry: "../../dist/composer/start.js" }),
});
