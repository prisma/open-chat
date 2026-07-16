// The open-chat compute service: a Prisma Next-typed Postgres and a durable
// streams server as dependencies, plus the secrets and params the app's own
// process.env surface needs (see start.ts, the launcher that maps these onto
// it). GitHub/Google OAuth are intentionally not declared here — social
// sign-in is off in the port topology (spec: open-chat-port Chosen design #8).
import { secret, string } from "@prisma/composer";
import node from "@prisma/composer/node";
import { compute } from "@prisma/composer-prisma-cloud";
import { pnPostgres } from "@prisma/composer-prisma-cloud/prisma-next";
import { durableStreams } from "@prisma/composer-prisma-cloud/streams";
import { openChatContract } from "./contract";

export default compute({
  name: "chat",
  deps: {
    db: pnPostgres(openChatContract),
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
