<p align="center">
  <img src="docs/logo/icon.svg" alt="Open Chat logo" width="96">
</p>

# Open Chat

> [!TIP]
> **Try it live at [oss.chat](https://oss.chat)** — no sign-up required, you get a guest budget and can start chatting right away. Then take the **[guided tour](https://oss.chat/tour)**: a scroll-through of how the whole system works, from prompt to durable stream.

A local-first, multi-model AI chat app — and a working demonstration of how [Prisma Streams](https://github.com/prisma/streams), [Prisma Postgres](https://www.prisma.io/postgres), and Prisma Next fit together in a real application.

![Open Chat — durable streaming chat over Prisma Streams](docs/screenshot.png)

Every assistant token is appended to a durable stream **before** the browser renders it. Close the tab mid-answer, reopen it, and the response replays and finishes exactly where it left off. No message is ever lost to a dropped connection.

## What it demonstrates

- **Prisma Streams** as the system of record for chat messages: an append-only event log per user, with a routing key per chat. Appends are durable before delivery; reads resume from any offset.
- **Prisma Postgres** (via `prisma dev`) for everything relational: users, sessions, chat metadata, and usage accounting — fully local.
- **Prisma Next** as the typed data layer: the contract in [`src/prisma/contract.prisma`](src/prisma/contract.prisma) drives an end-to-end typed client, sharing one `pg.Pool` with Better Auth.

## Features

- Streaming chat with any model on [OpenRouter](https://openrouter.ai) — text, vision, and image generation; switch models mid-conversation; each message records which model wrote it
- Durable, resumable streams: refresh, reconnect, or restart the server without losing tokens
- Anonymous guest sessions to try it instantly; sign up with email, GitHub, or Google and your guest chats come with you
- Credit-based billing: $2.00 free on signup, Stripe top-ups from $5 to $100 with a transparent 10% fee, and a free $0.50 drip after a month at zero
- Usage metering in micro-USD with a per-chat, per-model cost breakdown
- Markdown rendering, message permalinks, chat search, rename, and delete
- Image and audio models: attach, paste, or drop images and audio, dictate voice notes, hear spoken replies live with durable read-along highlighting, and try OpenRouter text-to-speech models through `/audio/speech`
- A public [/stats](https://oss.chat/stats) page of anonymous usage aggregates — counts and token sums only, drawn with dependency-free SVG charts
- One process, no build step: Bun serves the API, the SSE proxy, and the React client

## How it works

```text
Browser (React + TanStack DB)
   │  fetch /api/*            ▲ SSE /api/chats/:id/events
   ▼                          │
Bun server ── Better Auth (sessions, guests)
   │
   ├── Prisma Next ──► Prisma Postgres   chats, users, usage
   │
   ├── Prisma Streams                    durable message events
   │     one stream per user, routing key per chat
   │
   └── OpenRouter                        model streaming (only external call)
```

Sending a message appends a durable `message.created` event, then streams the model's reply as `message.delta` events into the same stream. The browser consumes them over an authenticated SSE proxy and folds them into messages with the same pure function the server uses for history replay ([`src/shared/messages.ts`](src/shared/messages.ts)).

The full design is written up in [`docs/architecture.md`](docs/architecture.md).

## A tour of the code

The whole app is ~5,500 lines, and the durable-streaming core is much smaller
than that. Reading these files in order tells the entire story:

| | File | What it shows |
| --- | --- | --- |
| 1 | [`src/prisma/contract.prisma`](src/prisma/contract.prisma) | The **Prisma Next** contract: users, sessions, chats, usage — everything relational, fully typed end to end |
| 2 | [`src/server/streams.ts`](src/server/streams.ts) | The **Prisma Streams** client: one append-only stream per user, one routing key per chat, reads resumable from any offset |
| 3 | [`src/server/routes/messages.ts`](src/server/routes/messages.ts) | The core path: append the user's message durably, stream model deltas into the same log, tail it over SSE |
| 4 | [`src/shared/messages.ts`](src/shared/messages.ts) | The materializer that folds the event log into messages — shared by server-side replay and the live client feed, so both always agree |
| 5 | [`src/client/stream.ts`](src/client/stream.ts) | The client side of resumability: consume SSE, fold events, reconnect from the last offset |
| 6 | [`src/client/db.ts`](src/client/db.ts) | UI state as TanStack DB collections over the API |
| 7 | [`src/streams-app/index.ts`](src/streams-app/index.ts) | The deployable Streams service: `@prisma/streams-server` with R2 as the durable tier, in ~30 lines of deployment defaults |

Everything else is ordinary app code: route handlers grouped by domain in
[`src/server/routes/`](src/server/routes), React components in
[`src/client/components/`](src/client/components), and billing/auth as
supporting features around the core.

## Getting started

You need [Bun](https://bun.sh) ≥ 1.2 and an [OpenRouter API key](https://openrouter.ai/keys).

```bash
# 1. Install dependencies
bun install

# 2. Run the app — provisions a local Prisma Postgres (schema included) and
#    a local Streams stand-in, then boots through the Composer service node.
#    Export a real OPENROUTER_API_KEY first to exercise chat generation;
#    without it, sign-in and history still work.
bun run dev
```

Open <http://localhost:3000> — you'll be signed in as a guest automatically and can start chatting.

## Deploy

The whole application — chat server, durable Streams service, its storage
tier, and the Postgres database — is one
[Prisma Composer](https://github.com/prisma/composer) topology, declared in
[`module.ts`](module.ts). One command provisions everything, applies the
database migrations, and wires every connection:

```bash
# Platform credentials (a Prisma service token + workspace id) in the shell,
# app secrets in ./.env — see .env.example
PRISMA_DEPLOY_ENV=<path-to-platform-env> bun run deploy
```

There is nothing else to do. Three things the previous per-app deploy story
required an operator to hand-carry are resolved by the platform:

- **The schema.** The database is a contract-carrying `pnPostgres` resource;
  the deploy applies [`migrations/`](migrations) to it before the chat
  service starts.
- **The app's own URL.** Better Auth and Stripe need the public origin; the
  service reads it back with `service.origin()` — no placeholder-then-redeploy
  dance.
- **The streams credentials.** The platform mints the bearer key per streams
  module and injects both ends; there is no `STREAMS_API_KEY` to invent and
  copy between services.

`bun run destroy` tears the stack down. Stage previews (`--stage`) give every
branch its own isolated database and services.

<details>
<summary>Previous deployment story (per-app Prisma CLI targets)</summary>

```bash
# 1. Sign in and create a project (this also provisions a Prisma Postgres database)
bunx --bun @prisma/cli@latest auth login
bunx --bun @prisma/cli@latest project create my-open-chat

# 2. Create the tables in the project's primary database
bunx --bun @prisma/cli@latest database connection create <database-id>   # prints DATABASE_URL
DATABASE_URL=<that-url> bun run db:init

# 3. Deploy the Streams service target from prisma.compute.ts (pick any
#    long random key). It runs @prisma/streams-server — the full Prisma
#    Streams runtime — with R2 as the durable tier: segments upload
#    continuously, and a fresh instance rehydrates from the bucket, so chat
#    history survives the platform replacing the instance.
bunx --bun @prisma/cli@latest app deploy streams \
  --env STREAMS_API_KEY=<random-key> \
  --env DURABLE_STREAMS_R2_BUCKET=<bucket-name> \
  --env DURABLE_STREAMS_R2_ACCOUNT_ID=<cloudflare-account-id> \
  --env DURABLE_STREAMS_R2_ACCESS_KEY_ID=<r2-access-key> \
  --env DURABLE_STREAMS_R2_SECRET_ACCESS_KEY=<r2-secret> \
  --no-db --prod --yes

# 4. Deploy the chat app target, pointing it at the database and the
#    Streams URL from step 3
bunx --bun @prisma/cli@latest app deploy open-chat \
  --env DATABASE_URL=<that-url> \
  --env STREAMS_URL=<streams-app-url> \
  --env STREAMS_API_KEY=<random-key> \
  --env BETTER_AUTH_SECRET=<random-secret> \
  --env OPENROUTER_API_KEY=<your-openrouter-key> \
  --env APP_ORIGIN=<chat-app-url> \
  --no-db --prod --yes
```

The target names come from [`prisma.compute.ts`](prisma.compute.ts), which
pins each Compute app's framework, entrypoint, port, build command, and output
directory. After both apps have their environment variables configured, a bare
`bunx --bun @prisma/cli@latest app deploy --prod --yes` deploys every target
in order.

That's it — the CLI builds locally, uploads, and the deployment is live in seconds. Secrets live only in Compute's env config, never in the repo. (On the very first deploy you don't know the app URL yet: deploy once, then set `APP_ORIGIN` to the printed URL and deploy again. Subsequent deploys keep their env vars.)

This is how the live instance at [oss.chat](https://oss.chat) was first
deployed, driven by [`prisma.compute.ts`](prisma.compute.ts) and the
standalone [`src/streams-app/`](src/streams-app) target. It is superseded by
the Composer topology above.

</details>

### Upgrading the Streams service safely

Prisma Streams acknowledges appends once they are durable in the service's
local WAL; the durable tier receives them when the background segmenter seals
WAL rows into segments and publishes them. A replaced instance restores from
the published state, not a still-local WAL tail. So when a deploy replaces
the Streams service: avoid generating writes during the cutover, and leave a
~30-second window after the last write so the final segments publish. After
the cutover, reloading an existing chat should replay every message with its
durable checkmark.

## Project layout

| Path | What lives there |
| --- | --- |
| [`src/server/`](src/server) | Bun HTTP server; route handlers grouped by domain in [`routes/`](src/server/routes), plus the Streams client, OpenRouter client, usage budgets, and auth |
| [`src/client/`](src/client) | React UI: a thin [`App.tsx`](src/client/App.tsx) gate, views in [`components/`](src/client/components), state as TanStack DB collections in [`db.ts`](src/client/db.ts) |
| [`src/shared/`](src/shared) | Zod contracts and the event-log → message materializer, shared by both sides |
| [`src/prisma/`](src/prisma) | Prisma Next contract and the typed database client |
| [`src/streams-app/`](src/streams-app) | The standalone Streams service deployed next to the app |
| [`docs/`](docs) | Architecture, feature checklist, design system, verification log; brand assets in [`docs/logo/`](docs/logo) |

## Scripts

| Command | Purpose |
| --- | --- |
| `bun run dev` | Local dev loop: provisions a local Postgres + Streams stand-in, then boots the app through the Composer service node (no hot reload) |
| `bun run db:dev` | Local Prisma Postgres + Streams via `prisma dev` |
| `bun run db:init` | Create tables from the Prisma Next contract |
| `bun run db:generate` | Re-emit contract types after editing `contract.prisma` |
| `bun run build` | Build the deployable server tree (`dist/server/`) |
| `bun run build:streams` | Build the standalone Streams service target |
| `bun test` / `bun run typecheck` | Tests and strict TypeScript |

## Learn more

- [oss.chat/tour](https://oss.chat/tour) — the guided tour: an animated walk through the whole flow, one section per piece of the stack
- [`docs/architecture.md`](docs/architecture.md) — the stream-per-user / routing-key-per-chat pattern, data ownership, and the durable streaming path
- [`docs/features.md`](docs/features.md) — every user flow, written as a verification checklist
- [`prisma-next.md`](prisma-next.md) — how the Prisma Next contract workflow operates in this repo

## License

[MIT](LICENSE)
