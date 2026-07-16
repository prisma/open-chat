# Friction log — Composer port (S7)

Every workaround, missing capability, or illegible error hit while porting
open-chat onto Prisma Composer. Appended by each dispatch (D1–D5); filed as
`prisma/compose` issues in D5. Framework version under test: the pkg.pr.new
preview of `prisma/composer`'s `main` at `ac1e7b1` (`@prisma/composer` +
`@prisma/composer-prisma-cloud`).

## D1 — Topology scaffold

### 1. `pnPostgres(contract)` has no raw connection-URL accessor

**Where hit:** writing the launcher (`src/composer/start.ts`), which needs to
set `DATABASE_URL` for open-chat's own `src/prisma/db.ts` (`new
Pool({ connectionString: env.DATABASE_URL })` + its own
`@prisma-next/postgres/runtime` client — built by app code, not the
framework).

**Symptom:** `service.load()`'s `db` binding is a fully-typed Prisma Next
client (`Client<C>`); nothing on it, or on `service.load()`/`config()`/
`secrets()`, exposes the connection string that produced it.

**Cause:** `pnPostgres(contract)`'s dependency declaration
(`packages/1-prisma-cloud/1-extensions/target/src/prisma-next.ts`) is:

```ts
dependency({
  type: 'prisma-next',
  connection: { params: { url: string() }, hydrate: ({ url }) => buildClient(contract, url) },
  required: contract,
});
```

`hydrate` receives `url` but returns only the built client — the raw string
is discarded. This is deliberate for the common case (ADR-0022: the framework
constructs the typed client so the app never handles a bare connection
string), but open-chat's `db.ts` predates Composer and builds its own
`pg.Pool` + its own separate `@prisma-next/postgres/runtime` client from
`DATABASE_URL` directly — it does not accept a pre-built client object, and
changing that is app business logic (out of scope for this port).

**Workaround used:** the raw URL does still land in `process.env` — the
target's serializer (`serializer.ts`'s `stash()`) writes every dependency
connection param to an address-free env var
(`COMPOSER_<INPUT>_<PARAM>`, here `COMPOSER_DB_URL`) *before* `boot()` runs,
independently of whether anything ever calls `load()`. The launcher reads
`process.env.COMPOSER_DB_URL` directly. This is an internal, undocumented key
convention (not a public accessor) — grep-visible in `serializer.ts`'s
`configKey()`, not in any public type or doc.

**Recommendation:** either (a) add a public accessor for a `pnPostgres`
dependency's raw connection string (e.g. `pnPostgres.url(contract)` returning
a `postgres()`-shaped `{ url }` binding alongside the typed-client one), for
apps that need to build their own client, or (b) document
`COMPOSER_<INPUT>_<PARAM>` as a supported (if discouraged) escape hatch.

### 2. `pnPostgres(contract)`'s `load()` throws — contract-validation failure against the preview's bundled `@prisma-next` toolchain

**Where hit:** a boot-time smoke test of the launcher (`chatService.run()`
with fabricated `COMPOSER_*` env vars, see D1 verification), and would have
hit it for real on first deploy had it not been caught here.

**Symptom:**

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

**Cause:** version skew. The pkg.pr.new preview's `@prisma/composer-prisma-cloud`
declares its own `@prisma-next/*` dependencies at `0.15.0`; open-chat is
pinned to `@prisma-next/postgres@^0.13.0`, and `src/prisma/contract.json` was
emitted by that 0.13-vintage `prisma-next` CLI. Bun installs both — the
top-level hoisted `@prisma-next/postgres@0.13.0` (open-chat's own) and a
*nested* `node_modules/@prisma/composer-prisma-cloud/node_modules/@prisma-next/*@0.15.0`
(composer's own) — because the version ranges don't overlap. When
`pnPostgres(contract)`'s `hydrate` calls into the *0.15.0* runtime with
open-chat's *0.13-emitted* `contractJson`, the newer runtime's structural
validator rejects it: `execution.mutations.defaults[].ref.namespace` is a
field the 0.13 emitter didn't write.

This is not just a TypeScript nominal-branding annoyance (see the comment in
`src/composer/contract.ts` about `AnyPnContract` vs. open-chat's own
`Contract` type) — it is a genuine data-format incompatibility that crashes
at runtime.

**Compounding effect:** `hydrateSync` (`packages/0-framework/1-core/core/src/hydrate.ts`)
hydrates *every* declared dependency in one synchronous pass with no
per-key laziness or isolation:

```ts
for (const [name, inputNode] of Object.entries(root.inputs)) {
  deps[name] = inputNode.connection.hydrate(values as never); // throws here for "db"
}
```

So `db`'s failure poisons the *entire* `load()` call — the launcher cannot
call `service.load()` even just to read the harmless, trivially-hydrated
`streams.url` (`durableStreams()`'s hydrate is the identity function).

**Workaround used:** the launcher never calls `service.load()`. Both
dependency URLs (`db`, `streams`) are read via the same private
`COMPOSER_<INPUT>_URL` env vars as finding #1 — `stash()` writes them
regardless of whether `load()` is ever called, so this sidesteps the crash
entirely. `service.secrets()`/`service.config()` are unaffected (they never
touch `root.inputs`) and are used normally.

**Recommendation:** (a) real fix — align open-chat's `@prisma-next/*` pins
with whatever version `@prisma/composer-prisma-cloud` depends on (or vice
versa) and regenerate `contract.json`/`contract.d.ts`; deferred here as an
operator-level, whole-app dependency decision, not a topology-wiring one. (b)
framework-side — `hydrateSync`/`hydrate` failing one input shouldn't prevent
reading any other already-hydratable input; consider per-key error
attribution at minimum (the current error gives no indication *which*
dependency failed without reading the stack). (c) `@prisma-next/postgres`'s
runtime validator rejecting a same-`schemaVersion` (`"1"`) contract emitted
two minor versions back is itself worth a `@prisma-next` compat note —
`contract.json`'s own `schemaVersion` field implies forward compatibility
within a schema version that didn't hold here.

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

## Referenced elsewhere

The following are recorded in the slice spec's "Chosen design" and
"Pre-investigated edge cases" rather than duplicated here: cron not
applicable (no scheduled work in open-chat), OAuth secrets omitted (social
sign-in off), `DURABLE_STREAMS_R2_*` unsuppliable (local-disk fallback),
PRO-218 (Compute ingress buffers SSE), the `APP_ORIGIN` two-step deploy
(PRO-211).
