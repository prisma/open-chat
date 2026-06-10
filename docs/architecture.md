# Architecture

## Goals

Open Chat is a prominent learning example for Prisma Streams. The system should make durable, resumable chat streaming visible in the codebase without hiding it behind a framework or a bespoke state manager.

The app runs fully locally except for OpenRouter model calls. Local development uses Prisma Postgres through `prisma dev`. For durable streams, the app can either proxy to the Prisma Dev Streams endpoint via `STREAMS_URL` or start `@prisma/streams-local` itself when `STREAMS_URL` is omitted.

## Runtime Shape

- Bun owns the HTTP server, static HTML import, API routing, and the authenticated stream proxy.
- React renders the browser UI, bundled by Bun from `src/client/index.html`.
- Better Auth owns sign-in, sign-out, anonymous guest sessions, session cookies, and server-side session validation. Public sign-up is disabled.
- Prisma Next owns Postgres metadata access through the emitted contract (`src/prisma/contract.prisma`) and the `@prisma-next/postgres` runtime, sharing one `pg.Pool` with Better Auth.
- Prisma Streams owns append-only chat message history and assistant streaming events.
- TanStack DB owns browser state via query collections, local-only collections, and live queries.
- OpenRouter is the only external service.

## Data Ownership

Postgres stores metadata that must be queried relationally:

- Better Auth `user`, `session`, `account`, and `verification` records.
- `Chat` rows for listing, naming, sorting, and selecting chats.
- Chat preferences such as selected model.
- `Usage` rows: per-user, per-month token counts and cost in micro-USD, powering the spend meter and request budgets.

Prisma Streams stores chat message events:

- user message creation
- assistant message creation
- assistant text deltas
- assistant completion metadata
- assistant error records

This split keeps chat listing cheap in Postgres while preserving durable, resumable message delivery in Streams.

## Stream And Routing Key Pattern

Each user gets one durable JSON stream:

```text
u_<sha256(userId)[0..24]>_messages
```

Each chat uses a routing key inside that user stream:

```text
chat:<chatId>
```

Reasoning:

- A user can have many chats, but chat list and names are Postgres metadata, so stream discovery is not needed for listing.
- A single stream per user avoids a stream-per-chat explosion while preserving tenant isolation.
- Prisma Streams routing-key reads are designed for exact key-filtered access; chat history is a natural exact-key workload.
- Assistant streaming appends use the same routing key, so reconnecting clients can resume from the last durable offset.

The browser never talks to Prisma Streams directly. It calls Bun endpoints that validate the Better Auth session, resolve user ownership, and then proxy appends/reads to the user stream.

Streams are created with `content-type: application/json`. This is intentional: Prisma Streams fixes stream format at creation time, and byte-mode streams reject JSON appends and JSON reads. Appends use `Stream-Key: chat:<chatId>`.

## Message Event Contract

Stream entries are JSON events. The routing key is carried in the durable stream header, and the body remains self-describing:

```json
{
  "id": "evt_...",
  "chatId": "chat_...",
  "messageId": "msg_...",
  "type": "message.created | message.delta | message.completed | message.error",
  "role": "user | assistant",
  "text": "delta or full text",
  "model": "openrouter/model-id",
  "createdAt": "2026-06-10T00:00:00.000Z",
  "metadata": {}
}
```

The client materializes these events into TanStack DB message rows. Assistant messages are inserted on `message.created`, updated incrementally on `message.delta`, and marked complete or failed on terminal events.

## Durable Streaming Path

1. The user submits a prompt.
2. Bun validates the session and chat ownership.
3. Bun appends the user message event to Prisma Streams.
4. Bun creates an assistant message event.
5. Bun calls OpenRouter with `stream: true`.
6. Each OpenRouter delta is appended to Prisma Streams before it is visible to the UI.
7. The browser consumes `/api/chats/:id/events` through Bun, which performs authenticated long-poll reads against Prisma Streams using the chat routing key.
8. The client tracks the last durable offset per chat so refresh/reconnect resumes without losing tokens.

The SSE proxy emits heartbeats during idle long-poll cycles and the Bun server uses a longer `idleTimeout` so durable streams stay connected while waiting for the next event.

## TanStack DB State

TanStack DB is the only application state layer in the browser:

- `chatsCollection`: query collection backed by `/api/chats`.
- `modelsCollection`: query collection backed by `/api/models`.
- `usageCollection`: query collection backed by `/api/usage`, refreshed after every completed assistant turn.
- `messagesCollection`: local-only collection populated from durable stream events.
- `checkpointsCollection`: local-only collection tracking the last durable offset per chat, so reconnects resume rather than replay.
- `uiCollection`: a single local row for selected chat, composer draft, search filters, sidebar state, and stream status.

React components render with `useLiveQuery`. Event handlers mutate collections or call API methods that update collections after server confirmation.

## Auth Boundary

Better Auth is mounted at `/api/auth/*`. Every protected app API calls `auth.api.getSession({ headers })` and fails closed when the session is missing.

First-time visitors are signed in automatically as anonymous guests (Better Auth's `anonymous` plugin), so the app is usable without registration; the sign-in screen is opt-in and public sign-up is disabled (`disableSignUp`). Guests get a small lifetime budget, registered users a monthly one — `src/server/usage.ts` enforces both before each model call.

Only authenticated users (including guests) can:

- list their chats
- create or rename chats
- read message streams
- submit prompts
- list OpenRouter models through the app proxy

## Local Development

Expected local services:

- Postgres and Streams: `bun run db:dev`
- Active local URLs: `DATABASE_URL=... bunx prisma dev ls`
- App server: `bun --hot src/server/index.ts`

During verification, Prisma Dev reported Postgres on `localhost:51297` and Streams on `http://127.0.0.1:51299/v1/stream/prisma-wal`, so the app used `STREAMS_URL=http://127.0.0.1:51299`. The repo must not commit `.env` or secrets. `.env.example` documents required variables.

## Sources

- Prisma Streams overview and local API: https://github.com/prisma/streams/blob/main/docs/overview.md
- Prisma Streams Durable Streams HTTP protocol: https://github.com/prisma/streams/blob/main/docs/durable-streams-spec.md
- Prisma Streams local development: https://github.com/prisma/streams/blob/main/docs/local-dev.md
- Prisma `dev` local Postgres command: https://www.prisma.io/docs/cli/dev
- Prisma Next contract workflow: [`../prisma-next.md`](../prisma-next.md)
- Better Auth Prisma adapter: https://www.better-auth.com/docs/adapters/prisma
- Better Auth session management: https://www.better-auth.com/docs/concepts/session-management
- Bun full-stack dev server: https://bun.sh/docs/bundler/fullstack
- TanStack DB overview and query collections: https://tanstack.com/db/latest/docs/overview
- TanStack DB local-only collections: https://tanstack.com/db/latest/docs/collections/local-only-collection
- OpenRouter TypeScript SDK and streaming: https://openrouter.ai/docs/client-sdks/typescript/overview
