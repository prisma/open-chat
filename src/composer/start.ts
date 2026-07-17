// The launcher: the `node()` build adapter's `entry` (see service.ts). The
// pack-printed bootstrap dynamically imports this build's output AFTER
// main.run(address, boot) has re-keyed the platform environment
// address-free, so service.load()/config()/secrets() read it here with no
// address — the same shape as the streams module's own entrypoint
// (packages/1-prisma-cloud/2-shared-modules/streams/src/streams-entrypoint.ts
// in the framework repo), the precedent for this file.
//
// Assigns the env names open-chat's app already reads (src/server/env.ts),
// then imports the app's existing, already-built server entry unchanged —
// business logic is not touched (mission: lift the app into Composer without
// modifying it).
//
// The `node()` build adapter's directory form (service.ts) ships this
// launcher and the built server together as one copied tree. Bun resolves a
// dynamic import()'s specifier against the SOURCE file's on-disk location at
// build time (then leaves the string untouched in the bundle) — so the
// specifier below must exist on disk relative to this file both at build
// time and, unchanged, relative to wherever the bundle lands at runtime.
// "../../dist/server/start.js" satisfies both: two levels up from
// src/composer/ lands at the repo root, matching two levels up from
// dist/composer/ once built — and `bun run build:pack` (package.json)
// reproduces that exact nesting (dist/pack/dist/{composer,server}/) inside
// the tree `dir` ships, so the same string still resolves after deploy
// copies it verbatim into `bundle/`.
import service from "./service";

const { db, streams } = service.load();
const {
  openrouterApiKey,
  betterAuthSecret,
  streamsKey,
  stripeSecretKey,
  stripeWebhookSecret,
} = service.secrets();
const { appOrigin, openrouterAppName, openrouterSiteUrl } = service.config();

process.env["DATABASE_URL"] = db.url;
process.env["STREAMS_URL"] = streams.url;
process.env["STREAMS_API_KEY"] = streamsKey.expose();
process.env["OPENROUTER_API_KEY"] = openrouterApiKey.expose();
process.env["BETTER_AUTH_SECRET"] = betterAuthSecret.expose();
process.env["STRIPE_SECRET_KEY"] = stripeSecretKey.expose();
process.env["STRIPE_WEBHOOK_SECRET"] = stripeWebhookSecret.expose();
process.env["APP_ORIGIN"] = appOrigin;
process.env["OPENROUTER_APP_NAME"] = openrouterAppName;
process.env["OPENROUTER_SITE_URL"] = openrouterSiteUrl;

// compute()'s own run() already exports the resolved `port` param as PORT
// (the near-universal convention), which the app's Bun.serve listener reads
// via src/server/env.ts — nothing to do here.

// @ts-expect-error — the app's built server entry ships no declaration file
// (a Bun bundle, not a TS build); imported for its side effect only.
await import("../../dist/server/start.js");
