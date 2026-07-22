// The open-chat Composer topology: storage's durable tier feeds the streams
// module (S6), a plain Postgres resource carries the app's own schema (the
// app runs its own migrations — see service.ts), and the chat compute
// service depends on both. The streams bearer key is minted by the target
// per streams module (ADR-0031) and delivered through the chat service's
// `durableStreams()` binding — nobody supplies it here (framework #92; see
// FRICTION.md's superseded note on the old two-consumer wiring). A closed
// root: no boundary argument, no return — it only provisions.
import { module } from "@prisma/composer";
import { envSecret, postgres } from "@prisma/composer-prisma-cloud";
import { storage } from "@prisma/composer-prisma-cloud/storage";
import { streams } from "@prisma/composer-prisma-cloud/streams";
import chatService from "./src/composer/service";

export default module("open-chat", ({ provision }) => {
  const store = provision(storage());
  const streamsModule = provision(streams(), {
    deps: { store: store.store },
  });

  const db = provision(postgres({ name: "database" }), { id: "database" });

  provision(chatService, {
    id: "chat",
    deps: { db, streams: streamsModule.streams },
    secrets: {
      openrouterApiKey: envSecret("OPENROUTER_API_KEY"),
      betterAuthSecret: envSecret("BETTER_AUTH_SECRET"),
      stripeSecretKey: envSecret("STRIPE_SECRET_KEY"),
      stripeWebhookSecret: envSecret("STRIPE_WEBHOOK_SECRET"),
    },
  });
});
