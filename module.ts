// The open-chat Composer topology: storage's durable tier feeds the streams
// module (S6), a Prisma Next-typed Postgres carries the app's own schema and
// runs its migrations at deploy, and the chat compute service depends on
// both. `streamsKey` binds to the SAME platform variable as the streams
// module's own `apiKey` — one bearer key, two consumers of its name (spec:
// open-chat-port Chosen design #1). A closed root: no boundary argument, no
// return — it only provisions.
import { module } from "@prisma/composer";
import { envParam, envSecret } from "@prisma/composer-prisma-cloud";
import { pnPostgres } from "@prisma/composer-prisma-cloud/prisma-next";
import { storage } from "@prisma/composer-prisma-cloud/storage";
import { streams } from "@prisma/composer-prisma-cloud/streams";
import { openChatContract } from "./src/composer/contract";
import chatService from "./src/composer/service";

export default module("open-chat", ({ provision }) => {
  const store = provision(storage());
  const streamsModule = provision(streams(), {
    deps: { store: store.store },
    secrets: { apiKey: envSecret("STREAMS_API_KEY") },
  });

  const db = provision(
    pnPostgres({ name: "database", contract: openChatContract, config: "./prisma-next.config.ts" }),
    { id: "database" },
  );

  provision(chatService, {
    id: "chat",
    deps: { db, streams: streamsModule.streams },
    params: { appOrigin: envParam("APP_ORIGIN") },
    secrets: {
      openrouterApiKey: envSecret("OPENROUTER_API_KEY"),
      betterAuthSecret: envSecret("BETTER_AUTH_SECRET"),
      streamsKey: envSecret("STREAMS_API_KEY"),
      stripeSecretKey: envSecret("STRIPE_SECRET_KEY"),
      stripeWebhookSecret: envSecret("STRIPE_WEBHOOK_SECRET"),
    },
  });
});
