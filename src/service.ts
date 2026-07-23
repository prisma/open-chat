// The open-chat compute service: the Prisma Next-typed Postgres and the
// durable streams server as dependencies, plus the params and secrets the
// server modules read straight off this node (service.load() / config() /
// secrets() / origin()).
//
// The `db` dependency's binding is `{ url, client }` with the typed client
// built lazily on first access (ADR-0040). This app owns its `pg.Pool`
// (Better Auth shares it — src/prisma/db.ts), so it reads only `db.url` and
// the lazy client is never constructed; the contract on the edge is what
// gets the deploy to run migrations/ before this service starts.
//
// GitHub/Google OAuth are intentionally not declared here — social sign-in
// is off in this topology.
import { secret, string } from "@prisma/composer";
import node from "@prisma/composer/node";
import { compute } from "@prisma/composer-prisma-cloud";
import { pnPostgres } from "@prisma/composer-prisma-cloud/prisma-next";
import { durableStreams } from "@prisma/composer-prisma-cloud/streams";
import { chatData } from "./data";

export default compute({
  name: "chat",
  deps: {
    db: pnPostgres(chatData),
    streams: durableStreams(),
  },
  params: {
    openrouterAppName: string({ default: "Open Chat Local" }),
    openrouterSiteUrl: string({ default: "http://localhost:3000" }),
  },
  secrets: {
    openrouterApiKey: secret(),
    betterAuthSecret: secret(),
    stripeSecretKey: secret(),
    stripeWebhookSecret: secret(),
  },
  // The directory form: `bun run build` emits the compiled server (start.js),
  // the client JS/CSS/image assets its HTML import produces, and
  // client/index.html into dist/server/ — that tree IS the deploy artifact,
  // copied verbatim, and the deploy-printed bootstrap boots `start.js`.
  build: node({ module: import.meta.url, dir: "../dist/server", entry: "start.js" }),
});
