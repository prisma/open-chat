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
import { configKey } from "@prisma/composer-prisma-cloud";
import service from "./service";

const { db } = service.load();
const {
  openrouterApiKey,
  betterAuthSecret,
  stripeSecretKey,
  stripeWebhookSecret,
} = service.secrets();
const { openrouterAppName, openrouterSiteUrl } = service.config();

// The streams dependency's bearer key is now minted by the target per
// streams module (ADR-0031), not a secret this launcher binds — see
// service.ts's `streams: durableStreams()` dep. `service.load().streams`
// hydrates to a `StreamsClient` whose `url`/`apiKey` are private fields (no
// public accessor), but this app's own client (src/server/streams.ts) needs
// the raw strings to set STREAMS_URL/STREAMS_API_KEY, not a StreamsClient
// instance. The only public accessor for a dependency's raw connection
// values is `configKey()` — the same key format `compute()`'s `run()`
// already stashed address-free onto process.env before this file was
// imported (the same channel `service.load()`/`config()`/`secrets()` read).
// Recorded in FRICTION.md — there is no `load()`-shaped way to get here.
function rawStreamsParam(name: "url" | "apiKey"): string {
  const key = configKey("", { owner: { input: "streams" }, name });
  const value = process.env[key];
  if (!value) {
    throw new Error(`missing resolved streams dependency param "${name}" (env ${key})`);
  }
  return value;
}

process.env["DATABASE_URL"] = db.url;
process.env["STREAMS_URL"] = rawStreamsParam("url");
process.env["STREAMS_API_KEY"] = rawStreamsParam("apiKey");
process.env["OPENROUTER_API_KEY"] = openrouterApiKey.expose();
process.env["BETTER_AUTH_SECRET"] = betterAuthSecret.expose();
process.env["STRIPE_SECRET_KEY"] = stripeSecretKey.expose();
process.env["STRIPE_WEBHOOK_SECRET"] = stripeWebhookSecret.expose();
// The app's own public URL is a platform-resolved property of the service
// (ADR-0039), not operator config — service.origin() reads the framework-
// injected COMPOSER_ORIGIN row.
process.env["APP_ORIGIN"] = service.origin();
process.env["OPENROUTER_APP_NAME"] = openrouterAppName;
process.env["OPENROUTER_SITE_URL"] = openrouterSiteUrl;

// compute()'s own run() already exports the resolved `port` param as PORT
// (the near-universal convention), which the app's Bun.serve listener reads
// via src/server/env.ts — nothing to do here.

// @ts-expect-error — the app's built server entry ships no declaration file
// (a Bun bundle, not a TS build); imported for its side effect only.
await import("../../dist/server/start.js");
