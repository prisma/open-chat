// The launcher: the `node()` build adapter's `entry` (see service.ts). The
// pack-printed bootstrap dynamically imports this build's output AFTER
// main.run(address, boot) has re-keyed the platform environment
// address-free, so service.config()/secrets() read it here with no address —
// the same shape as the streams module's own entrypoint
// (packages/1-prisma-cloud/2-shared-modules/streams/src/streams-entrypoint.ts
// in the framework repo), the precedent for this file.
//
// Assigns the env names open-chat's app already reads (src/server/env.ts),
// then imports the app's existing, already-built server entry unchanged —
// business logic is not touched (mission: lift the app into Composer without
// modifying it).
import service from "./service";

// Deliberately not calling service.load(): it hydrates every declared
// dependency eagerly, including "db" — and hydrating "db" throws. The
// pkg.pr.new preview's @prisma/composer-prisma-cloud bundles
// @prisma-next/sql-contract@0.15.0, whose runtime structural validator
// rejects open-chat's committed contract.json (emitted by prisma-next
// 0.13.0): "execution.mutations.defaults[N].ref.namespace must be a string
// (was missing)". FRICTION.md: "pnPostgres contract validation fails against
// the composer preview's bundled @prisma-next toolchain". Both dependency
// values are read the same way instead: the address-free env var the
// target's serializer stashes into process.env before boot() runs — an
// internal, undocumented key convention (COMPOSER_<input>_<param>), not a
// public accessor. FRICTION.md: "pnPostgres has no raw connection-URL
// accessor" covers why "db" needs this regardless of the validation crash.
function stashedUrl(input: "db" | "streams"): string {
  const key = `COMPOSER_${input.toUpperCase()}_URL`;
  const value = process.env[key];
  if (!value) {
    throw new Error(`${key} is unset — the "${input}" dependency did not stash a URL before boot.`);
  }
  return value;
}

const {
  openrouterApiKey,
  betterAuthSecret,
  streamsKey,
  stripeSecretKey,
  stripeWebhookSecret,
} = service.secrets();
const { appOrigin, openrouterAppName, openrouterSiteUrl } = service.config();

process.env["DATABASE_URL"] = stashedUrl("db");
process.env["STREAMS_URL"] = stashedUrl("streams");
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
