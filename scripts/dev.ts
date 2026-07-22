#!/usr/bin/env bun
// Local dev loop for open-chat's Composer topology (S7/D2) — no cloud
// credentials. Unlike `bun run dev` (which runs src/server/index.ts
// directly, with hot reload), this boots the app through the exact same
// launcher path a deploy uses: src/composer/service.ts's compute() node,
// run() the way the deploy-printed bootstrap runs it, dynamically importing
// src/composer/start.ts once run() has resolved config/secrets. That's the
// point of this script — proving the topology's wiring locally, not fast
// iteration. `bun run dev` is untouched and remains the fast loop.
//
// Standing in for a deploy's provisioning + platform env vars:
//   - Postgres: local, via open-chat's own `db:dev` (`prisma dev --detach`),
//     then `prisma-next db init` (additive-only, safe to rerun).
//   - Streams: the streams module's own local stand-in
//     (startLocalStreamsServer from @prisma/composer-prisma-cloud/streams/testing)
//     — SQLite, loopback, no auth — NOT open-chat's embedded
//     @prisma/streams-local fallback (src/server/streams.ts's STREAMS_URL-unset
//     path). Using the module's stand-in, and feeding its URL through the same
//     COMPOSER_* config channel a deploy would, is what proves the topology's
//     streams *dependency* resolves locally, not just that the app can start
//     an embedded server on its own. The bearer key is a minted connection
//     param at deploy (ADR-0031, not a secret this script binds); locally it's
//     a placeholder value bound the same way the URL is, since the stand-in
//     doesn't check it.
//   - Secrets/params: written directly onto process.env in the wire format
//     target/src/serializer.ts defines (COMPOSER_<ADDRESS>_<NAME>, uppercased;
//     a secret slot is a pointer row naming a second env var that holds the
//     real value, while a dependency's own connection param — e.g. streams'
//     url/apiKey — is written directly, no pointer row) — the same protocol
//     the deploy-printed bootstrap.js and platform env injection produce,
//     reproduced by hand because there is no local-dev harness for a
//     compute() node with real deps. Built with this
//     package's own configKey() rather than a hand-rolled uppercase
//     transform, so this script cannot silently drift from the framework's
//     actual key format.
//
// OPENROUTER_API_KEY is the one genuine external credential in this graph.
// This script runs without it: the secret slot still needs a non-empty value
// (service.secrets() resolves every slot eagerly — one missing/empty slot
// fails the whole call, taking sign-in and the live-tail path down with it),
// so an unset OPENROUTER_API_KEY gets a harmless local placeholder. Chat
// generation will fail against OpenRouter with that placeholder; sign-in,
// history, and the live-tail SSE path do not depend on it and still work.
// Export a real OPENROUTER_API_KEY before running this script to also
// exercise generation.
//
// Binds to 3000 by default (open-chat's own default); PORT=3100 bun run
// dev:composer picks a different one if something else already holds it.
import { randomBytes } from "node:crypto";
import { configKey } from "@prisma/composer-prisma-cloud";
import { startLocalStreamsServer } from "@prisma/composer-prisma-cloud/streams/testing";
import chatService from "../src/composer/service";

// module.ts provisions the chat service at the module root with id "chat";
// Load derives a root-scope provision's address as its bare id (no dotted
// prefix), so "chat" is the real deployment address — using it here (rather
// than "") means the env vars this script writes are exactly what a real
// deploy would write, not a look-alike local shortcut.
const ADDRESS = "chat";

// 3000 matches the app's own default (env.ts, README) — but it's only a
// default. A previous dev.ts run, another local server, or (as found while
// testing this script) an unrelated process on the operator's machine can
// already hold 3000, so this must stay overridable: PORT=3100 bun run
// dev:composer.
const DEFAULT_PORT = 3000;

function resolvePort(): number {
  const override = process.env["PORT"];
  if (override === undefined || override === "") return DEFAULT_PORT;
  const parsed = Number(override);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`[dev:composer] PORT="${override}" is not a positive integer.`);
  }
  return parsed;
}

function randomHex(bytes: number) {
  return randomBytes(bytes).toString("hex");
}

async function run(cmd: string[]) {
  const proc = Bun.spawn(cmd, { stdout: "pipe", stderr: "inherit" });
  const output = await new Response(proc.stdout).text();
  const code = await proc.exited;
  if (code !== 0) {
    throw new Error(`${cmd.join(" ")} exited with code ${code}`);
  }
  return output.trim();
}

console.log("[dev:composer] starting local Postgres (prisma dev)...");
const dbUrlOutput = await run([
  "bunx",
  "prisma",
  "dev",
  "--name",
  "open-chat",
  "--detach",
]);
const databaseUrl = dbUrlOutput.split("\n").at(-1)?.trim();
if (!databaseUrl) {
  throw new Error(
    `[dev:composer] could not read the database URL from "prisma dev --detach"; got:\n${dbUrlOutput}`,
  );
}
console.log(`[dev:composer] Postgres ready: ${databaseUrl.replace(/:[^/:@]*@/, ":***@")}`);

console.log("[dev:composer] ensuring tables exist (prisma-next db init)...");
await run(["bunx", "prisma-next", "db", "init", "--db", databaseUrl, "-y"]);

console.log("[dev:composer] starting the streams module's local stand-in...");
const streams = await startLocalStreamsServer({ name: "open-chat-composer-dev" });
console.log(`[dev:composer] streams stand-in ready: ${streams.exports.http.url}`);

console.log("[dev:composer] building the app (bun run build:chat)...");
await run(["bun", "run", "build:chat"]);

function bindDependencyParam(input: string, name: string, value: string) {
  process.env[configKey(ADDRESS, { owner: { input }, name })] = value;
}

function bindLiteralParam(name: string, value: unknown) {
  process.env[configKey(ADDRESS, { owner: "service", name })] = JSON.stringify(value);
}

/**
 * Writes a secret slot's pointer row plus the platform var it points to —
 * the same two-write shape deploy-time secret binding produces, just with a
 * literal value here instead of a provisioned platform secret. Prefers a
 * value already in this shell's env (so a developer who exports a real
 * OPENROUTER_API_KEY, say, gets it used); otherwise falls back to a
 * generated placeholder and warns.
 */
function bindSecret(slot: string, platformVar: string, fallback: () => string) {
  const existing = process.env[platformVar];
  const value = existing && existing.length > 0 ? existing : fallback();
  if (!existing) {
    console.warn(
      `[dev:composer] ${platformVar} not set in this shell — using a local placeholder.`,
    );
  }
  process.env[configKey(ADDRESS, { owner: "service", name: slot })] = platformVar;
  process.env[platformVar] = value;
}

const port = resolvePort();
const appOrigin = `http://localhost:${port}`;

bindDependencyParam("db", "url", databaseUrl);
bindDependencyParam("streams", "url", streams.exports.http.url);
// The streams bearer key is minted by the target at deploy (ADR-0031), not a
// secret this script binds — it's the streams dependency's own `apiKey`
// connection param (see module.ts, service.ts). The local stand-in
// (startLocalStreamsServer) has no auth check, so any non-empty value
// resolves the param and lets the app send a bearer header the stand-in
// ignores — standing in for the real minted key the same way the other
// local placeholders below stand in for real secrets.
bindDependencyParam("streams", "apiKey", `local-placeholder-${randomHex(16)}`);
// The service's own origin is a framework-resolved provider param (ADR-0039),
// not a declared param: a deploy writes the addressed ORIGIN row and run()
// re-stashes it address-free as COMPOSER_ORIGIN, which service.origin() reads.
// Writing the addressed row here exercises that same stash path locally.
bindLiteralParam("ORIGIN", appOrigin);
// The reserved `port` param — run() re-exports whatever it resolves to as
// PORT (the convention Bun.serve reads), so this is the one write that
// actually chooses which port the app binds to.
bindLiteralParam("port", port);

bindSecret("openrouterApiKey", "OPENROUTER_API_KEY", () => `local-placeholder-${randomHex(8)}`);
bindSecret("betterAuthSecret", "BETTER_AUTH_SECRET", () => randomHex(32));
bindSecret("stripeSecretKey", "STRIPE_SECRET_KEY", () => `sk_test_local_${randomHex(16)}`);
bindSecret(
  "stripeWebhookSecret",
  "STRIPE_WEBHOOK_SECRET",
  () => `whsec_local_${randomHex(16)}`,
);

process.on("SIGINT", async () => {
  await streams.close();
  process.exit(0);
});

console.log("[dev:composer] booting open-chat through the Composer launcher...");
await chatService.run(ADDRESS, () => import("../src/composer/start"));
