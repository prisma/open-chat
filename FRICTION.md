# Friction log — Composer port (S7)

Every workaround, missing capability, or illegible error hit while porting
open-chat onto Prisma Composer. Appended by each dispatch (D1–D5); filed as
`prisma/compose` issues in D5. Framework version under test: the pkg.pr.new
preview of `prisma/composer`'s `main` at `ac1e7b1` (`@prisma/composer` +
`@prisma/composer-prisma-cloud`).

## D1 — Topology scaffold

*Entries #1 and #2 below were rewritten in D1b (2026-07-16) after the
operator dropped `pnPostgres` for plain `postgres()` on both ends (spec:
open-chat-port Chosen design #7). Both workarounds they originally described
are gone from the code; the underlying framework gaps are not fixed, so the
findings stay, sharpened by having tried the fix.*

### 1. A `pnPostgres` resource cannot satisfy a plain `postgres()` dependency — and the converse is blocked too

**Where hit:** D1 wired `pnPostgres({ name, contract, config })` provisioning
a `pnPostgres(contract)` dependency. D1b then tried the shape this port
actually wants: provision a `pnPostgres` resource (framework-run migrations,
ADR-0022) but consume it through open-chat's own `pg.Pool` — i.e. a plain
`postgres()` dependency, since open-chat's `src/prisma/db.ts` builds its own
client from `{ url }` and does not accept a framework-built typed client.

**Symptom:** TypeScript rejects it at the `provision()` call site.
`pnPostgres({ ... })` returns a `ResourceNode<Contract<'prisma-next', PnCmp>>`;
`postgres()`'s dependency end requires a `Contract<'postgres', PostgresConfig>`.
The two contracts' `kind` literals (`'prisma-next'` vs `'postgres'`) don't
match, so assignability fails before `satisfies` is ever reached at Load —
"framework migrations + my own client" is inexpressible.

**Cause:** `Contract<Kind extends string, Cmp>`
(`packages/0-framework/1-core/core/src/contract.ts`) welds `Kind` into two
places at once, both using the SAME type parameter as the contract they're
declared on: the provision-site TypeScript assignability check
(`ResourceNode<C>` against a dependency's required contract, in `node.ts`),
and `satisfies(required: Contract<Kind, unknown>)`'s own signature. A
`prisma-next` database genuinely IS a Postgres database — its `PnCmp` carries
a `{ url }`-shaped connection underneath the typed client — but nothing in
`Contract`'s shape lets a `'prisma-next'`-kinded contract declare "I also
satisfy `'postgres'`". Kind equality is baked into the type itself, not a
policy `satisfies` chooses, so a cross-kind subtype relation can't be
expressed at all.

**Also tried, also blocked — the converse:** "provision a `pnPostgres`
resource but run my own migrations" (skip ADR-0022's framework-run migration)
is equally inexpressible. `PnPostgresResourceNode`'s `config` field (the
`prisma-next.config.ts` path) is required on the resource overload's argument
type — there is no `pnPostgres({ name, contract })` without it. And given a
`config` anyway, `prismaNextDescriptor`'s lowering
(`packages/1-prisma-cloud/1-extensions/target/src/descriptors/prisma-next.ts`)
unconditionally runs `PnMigration(...)` — no flag or resource variant
provisions the database and connection without migrating it.

**Workaround used:** neither direction — this port uses plain `postgres()`
on both ends (`module.ts`'s resource, `service.ts`'s dependency) and keeps
running open-chat's own `db:init`/`db:push` as an operator step (D3). Per
ADR-0022 the contract hash is the thing and migrations are only the means, so
this doesn't need the framework to run them; open-chat gets neither
framework-run migrations nor the typed client, by design (Chosen design #7)
— it only ever needed the URL.

**Recommendation:** let a `prisma-next` contract's `satisfies` accept a
`Contract<'postgres', unknown>` too, not just its own kind, when its
underlying storage genuinely is Postgres — which needs `Kind` widened off
`satisfies`'s parameter type, not just the value returned. Caution: a naive
"no required hash → satisfied" rule is wrong — it would let a `pnPostgres`
resource satisfy an unrelated `s3()`/`streams()` dependency too, since those
also have no required-hash concept. Any fix has to compare kind-compatibility
explicitly, not merely "hash present or absent". Not attempted here — a
`Contract` type change, out of scope for an app port.

### 2. Version skew: framework's bundled `@prisma-next` 0.15.0 vs open-chat's 0.13.0-emitted `contract.json`

**Where hit:** D1's boot-time smoke test of the launcher (`chatService.run()`
with fabricated `COMPOSER_*` env vars) when it still used `pnPostgres`.

**Symptom (as hit under `pnPostgres`, before D1b removed it):**

```
ContractValidationError: Contract structural validation failed:
execution.mutations.defaults[0].ref.namespace must be a string (was missing);
... [8 entries]
    at validateSqlContractStructure (.../@prisma-next/sql-contract/dist/validators.mjs)
    at deserializeContract (.../@prisma-next/family-sql/dist/sql-contract-serializer-*.mjs)
    at postgres (.../@prisma-next/postgres/dist/runtime.mjs)
    at hydrateSync (.../@prisma/composer/dist/dist-*.mjs)
```

thrown from inside `service.load()`.

**Cause:** the pkg.pr.new preview's `@prisma/composer-prisma-cloud` declares
its own `@prisma-next/*` dependencies at `0.15.0`; open-chat is pinned to
`@prisma-next/postgres@^0.13.0`, and `src/prisma/contract.json` was emitted
by that 0.13-vintage `prisma-next` CLI. Bun installs both — the top-level
hoisted `@prisma-next/postgres@0.13.0` (open-chat's own) and a *nested*
`node_modules/@prisma/composer-prisma-cloud/node_modules/@prisma-next/*@0.15.0`
(composer's own) — because the version ranges don't overlap. When
`pnPostgres(contract)`'s `hydrate` called into the *0.15.0* runtime with
open-chat's *0.13-emitted* `contractJson`, the newer runtime's structural
validator rejected it: `execution.mutations.defaults[].ref.namespace` is a
field the 0.13 emitter didn't write. A genuine data-format incompatibility,
not just a TypeScript nominal-branding annoyance.

**Compounding effect (also no longer hit, same reason):** `hydrateSync`
(`packages/0-framework/1-core/core/src/hydrate.ts`) hydrates *every* declared
dependency in one synchronous pass with no per-key laziness or isolation:

```ts
for (const [name, inputNode] of Object.entries(root.inputs)) {
  deps[name] = inputNode.connection.hydrate(values as never); // threw here for "db"
}
```

So `db`'s failure would have poisoned the *entire* `load()` call — the
launcher could not have called `service.load()` even just to read the
harmless, trivially-hydrated `streams.url`.

**Status:** not hit anymore — D1b dropped `pnPostgres` entirely (Chosen
design #7), so this port never calls into the 0.15.0 runtime with open-chat's
0.13-emitted contract. Recorded so the incompatibility isn't lost: any future
port or app that DOES need `pnPostgres`'s typed client will still hit it.

**Recommendation:** (a) real fix — align open-chat's `@prisma-next/*` pins
with whatever version `@prisma/composer-prisma-cloud` depends on (or vice
versa) and regenerate `contract.json`/`contract.d.ts`; an operator-level,
whole-app dependency decision, not a topology-wiring one. (b) framework-side
— `hydrateSync`/`hydrate` failing one input shouldn't prevent reading any
other already-hydratable input; consider per-key error attribution at
minimum (the current error gives no indication *which* dependency failed
without reading the stack). (c) `@prisma-next/postgres`'s runtime validator
rejecting a same-`schemaVersion` (`"1"`) contract emitted two minor versions
back is itself worth a `@prisma-next` compat note — `contract.json`'s own
`schemaVersion` field implies forward compatibility within a schema version
that didn't hold here.

### 3. `node()` build adapter's `assemble()` copies a single file — incompatible with a multi-file Bun static-asset build

**Where hit:** wiring the launcher's build script and reading
`@prisma/composer/node/control`'s `assemble()` source to understand what the
`entry` field needs to point at.

**Symptom (projected — not yet exercised; D3 will hit this for real):**
`open-chat`'s own build (`bun run build:chat`) produces **seven** files under
`dist/server/` — the server bundle plus the client bundle Bun's native HTML-import
feature emits alongside it:

```
start.js                     2.48 MB    (entry point)
index-<hash>.js               0.98 MB    (entry point)
client/index.html             3.10 KB    (entry point)
index-<hash>.css              31.44 KB   (asset)
og-tour-<hash>.png            103.0 KB   (asset)
tour-app-<hash>.webp           0.31 MB   (asset)
tour-console-<hash>.webp      215.54 KB  (asset)
```

`@prisma/composer/node/control`'s `assemble()`
(`packages/0-framework/2-authoring/node/src/control.ts`) does:

```ts
const entryFile = path.basename(entryPath);
const bundleDir = path.join(workDir, 'bundle');
await fs.promises.mkdir(bundleDir, { recursive: true });
await fs.promises.copyFile(entryPath, path.join(bundleDir, entryFile));
```

— a single `fs.copyFile`, not a directory copy. Only the one file the `entry`
field names reaches the deploy bundle; the other six (including the client
HTML/JS/CSS/images the chat UI actually serves) are silently dropped.

**Cause:** the `node` build type's `assemble()` assumes a single-file
runnable. `@prisma/composer/nextjs`'s `assemble()`
(`packages/0-framework/2-authoring/nextjs/src/control.ts`) does the opposite —
a recursive `fs.promises.cp(standaloneRoot, bundleDir, { recursive: true })`
— because Next's standalone output is inherently multi-file. `node` has no
equivalent.

**Not worked around in D1** (deploying is D3's job; this dispatch only had to
produce a build the `node()` adapter's `entry` field type-checks against).
Recorded now because it was discovered while wiring the build, and it *will*
block D3 as written: pointing `entry` at `dist/composer/start.js` (which
dynamically imports `dist/server/start.js` at runtime, see `start.ts`) only
carries `dist/composer/start.js` into the deploy artifact — the dynamically
imported `dist/server/start.js` and its sibling client assets never arrive.

**Recommendation:** extend `node`'s `assemble()` to copy the entry's sibling
files (mirroring `nextjs`'s directory copy, or reading a manifest such as
Bun's own build metadata) — or document that a `node`-built service must ship
a genuinely single-file bundle, which open-chat's HTML-import-based client
delivery cannot do without moving asset embedding into app code (out of
scope: "we don't bundle the app's code").

### 4. `bun build --external` doesn't match a dynamic import's as-written relative specifier

**Where hit:** wiring `build:launcher`'s bundling of `src/composer/start.ts`.

**Symptom:** `bun build --external "../../dist/server/start.js"` (the exact
string as written in the `await import(...)` call) has no effect — bun still
resolves and inlines the target, duplicating the ~2.5 MB already-built app
bundle into the launcher's own output (and breaking `chdir.ts`'s
`import.meta.dir`-relative asset resolution, since the re-bundled code's
`import.meta.dir` would then point at `dist/composer/`, not `dist/server/`).

**Cause:** bun's `--external` glob matching (for a dynamic import) matches
against the path *relative to the build's working directory*, not the
specifier as written relative to the importing file.

**Workaround used:** `--external './dist/server/start.js'` (or a
`*/dist/server/start.js'` glob) — either matches; documented in
`package.json`'s `build:launcher` script.

## D2 — Local dev loop

### 5. No local-dev harness for a `compute()` node with real dependencies — the deploy env-var wire protocol has to be hand-replicated

**Where hit:** writing `scripts/dev.ts` to run the app through the launcher
path (`src/composer/start.ts`), which reads `service.load()`/`config()`/`secrets()`.

**Symptom:** those three accessors read a process-local "stash" that only
`run(address, boot)` populates — and `run()` itself only exists to be called
by the bootstrap.js a deploy prints
(`packages/1-prisma-cloud/0-lowering/lowering/src/compute/artifact.ts`:
`` `import main from "./main.mjs"; await main.run(${address}, () => import("./${appEntry}"));` ``).
There is no local-dev equivalent of that bootstrap anywhere in the framework
or its examples. Grepping the whole framework repo for a working call to
`.run()` on a node with real deps/params turns up nothing — every example's
entry file only calls `.config()`/`.load()`, and the one example whose
`scripts/dev.ts` boots a `compute()` node locally
(`examples/store/scripts/dev.ts`) sidesteps the whole problem: that node
declares `deps: {}` and is driven through `@prisma/composer/rpc`'s `serve()`,
which never needs a real env var to be set.

**Cause:** `run()`'s job — deserialize the platform env keyed by the real
deployment address, then re-stash it address-free — is deploy machinery with
no local-dev-shaped door into it. To drive a real `compute()` node (deps,
params, secrets) outside a deploy, the only path is to write the exact env
vars `target/src/serializer.ts` expects and call `.run()` yourself: one write
per dependency's connection param (`COMPOSER_<ADDR>_<INPUT>_<NAME>`, the raw
resolved value), one per service param (same key shape minus the input
segment, JSON-encoded), and *two* per secret slot (a pointer row
`COMPOSER_<ADDR>_<SLOT>` naming a platform var, plus that platform var itself
holding the real value — never the value in the pointer row).

**Workaround used:** `scripts/dev.ts` does exactly that by hand, but built on
the extension's own exported `configKey()` (`@prisma/composer-prisma-cloud`)
rather than a re-derived uppercase transform, so the key format can't
silently drift from whatever `serializer.ts` actually does. Cross-checked
against `packages/1-prisma-cloud/1-extensions/target/src/__tests__/control-lowering.test.ts`'s
literal expected keys (e.g. `COMPOSER_INGEST_STRIPEKEY`,
`COMPOSER_WEB_APPORIGIN`) to confirm the format before trusting it.

**Compounding find:** the address to write these keys under isn't derivable
from the service declaration (`service.ts`) at all — it's assigned by
`provision()` in `load-module.ts` (`fullAddress = address === undefined ? id
: \`${address}.${id}\``), so a root-scope provision's address is its bare
`id`. `module.ts` provisions the chat service with `id: "chat"`, so the real
deploy address is `"chat"`, not `""` — nothing in `service.ts`, `start.ts`,
or any doc comment says so; it only falls out of reading the module-graph
builder. Using the wrong address (e.g. `""`) would still have worked for this
script, since it controls both the write side and the `run()` call — but it
would silently stop mirroring what a real deploy does, and wouldn't have
caught an address-handling bug if one existed.

**Recommendation:** ship a local-dev entry point for a `compute()` node with
real deps — something like `service.runLocal(values)` that takes hydrated
dependency bindings and param/secret values directly (mirroring how
`serve()` in `@prisma/composer/rpc` sidesteps the env-var channel entirely
for RPC services) instead of requiring a caller to reconstruct
`run()`'s deploy-shaped env-var protocol by hand. Short of that, exporting
the node's real deployment address (or a helper to compute it from a
module + provision id, matching `load-module.ts`'s logic) so a hand-written
dev script doesn't have to reverse-engineer it from `load-module.ts`.

### 6. `service.secrets()`'s eager, all-or-nothing resolution forces a placeholder for the one genuine external credential

**Where hit:** wiring `openrouterApiKey` for local dev with "no cloud
credentials" as a hard requirement.

**Symptom:** `service.secrets()` throws if *any* declared secret slot's
platform var is unset or empty (`deserializeSecrets` in `serializer.ts`) —
there's no way to leave one slot unbound and read the rest, and no
optional-secret declaration. Since `start.ts` calls `service.secrets()`
before doing anything else, an unset `OPENROUTER_API_KEY` doesn't just break
chat generation — it would crash the whole process before the HTTP server
ever starts, taking sign-in and the live-tail SSE path down too, neither of
which touches OpenRouter.

**Cause:** by design (ADR-0029/Chosen design #8) — a required secret slot
is meant to fail loudly rather than silently run with a missing credential in
a *deployed* environment, which is the right default there. Local dev has a
different, legitimate need this doesn't distinguish: "let me run everything
that doesn't need this one credential."

**Workaround used:** `scripts/dev.ts` generates a harmless local placeholder
string for `OPENROUTER_API_KEY` (and prints a warning) when the shell doesn't
already have one set, so `secrets()` resolves and the app boots. The
placeholder reaches OpenRouter's real API and fails there
(`"Missing Authentication header"`, confirmed by driving a message send
end-to-end) — chat generation fails exactly as expected, while sign-in,
history, and live tail all work, because none of them read that secret.
Exporting a real `OPENROUTER_API_KEY` before running the script uses it
instead (`scripts/dev.ts` prefers whatever's already in the shell's env over
generating a placeholder).

**Recommendation:** no framework change proposed here — the workaround is
adequate and the strict-by-default behavior is correct for deploys. Worth
noting in local-dev-facing docs (the framework's, not just this port's) that
"missing secret" and "missing *this* secret, on purpose, for local dev" are
different needs the API doesn't distinguish.

### 7. The `node()` build adapter's static entry means the launcher path can't hot-reload

**Where hit:** `scripts/dev.ts` boots through `src/composer/start.ts`, whose
last line unconditionally does `await import("../../dist/server/start.js")`
— the app's own *built* production bundle, not its source.

**Symptom:** `dev:composer` cannot be a fast edit-refresh loop the way `bun
run dev` (`bun --hot src/server/index.ts`) is — a code change requires
rerunning `bun run build:chat` (which `scripts/dev.ts` does unconditionally
on every invocation) before it's reflected.

**Cause:** not really a bug — `start.ts`'s whole point (per its own comment)
is to import "the app's existing, already-built server entry unchanged," so
that the dev loop exercises the same artifact a deploy would build, not a
bypass. A static, pre-built entry point is inherent to that goal; hot reload
and "prove the deploy-shaped wiring" are different things to optimize for.

**Workaround used:** none needed — `bun run dev` remains the fast loop for
business-logic iteration (untouched by this dispatch); `dev:composer` is a
separate, slower loop for proving the topology, rebuilding on every run.
Recorded because "why doesn't my composer dev loop hot-reload" is a
predictable point of confusion without this being written down somewhere.

## Referenced elsewhere

The following are recorded in the slice spec's "Chosen design" and
"Pre-investigated edge cases" rather than duplicated here: cron not
applicable (no scheduled work in open-chat), OAuth secrets omitted (social
sign-in off), `DURABLE_STREAMS_R2_*` unsuppliable (local-disk fallback),
PRO-218 (Compute ingress buffers SSE), the `APP_ORIGIN` two-step deploy
(PRO-211).
