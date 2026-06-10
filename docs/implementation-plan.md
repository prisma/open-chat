# Implementation Plan

This is the historical build plan, kept for reference. Phase notes describe the state of the code when each phase landed; where the code has since moved on, the current state is called out inline.

## Status

Implemented and verified locally on June 10, 2026. The final implementation keeps app data local in Prisma Dev Postgres and Prisma Streams, with OpenRouter as the only external service.

## Phase 1: Project Foundation

- Completed: Bun/TypeScript metadata, React HTML import, strict TypeScript, `.env.example`, Prisma schema/config, generated client output path.

## Phase 2: Metadata And Auth

- Completed: Better Auth tables, `Chat` metadata, Prisma ORM 7 with `@prisma/adapter-pg`, email/password auth, `/api/auth/*`, and session-protected route helpers.
- Since then: the data layer migrated from Prisma ORM 7 to Prisma Next (`@prisma-next/postgres`), sharing one `pg.Pool` with Better Auth. Anonymous guest sessions and usage budgets were added after the initial plan.

## Phase 3: Prisma Streams

- Completed: optional embedded Streams server, user stream naming, lazy JSON stream creation, `Stream-Key: chat:<chatId>` appends, authenticated offset reads, SSE heartbeat proxy.

## Phase 4: OpenRouter

- Completed: official OpenRouter TypeScript SDK, model catalog proxy, catalog-driven model ids, streamed chat completions, durable completion/error events.

## Phase 5: TanStack DB UI

- Completed: TanStack DB query/local collections, `useLiveQuery` rendering, sidebar, transcript, composer, model picker, auth screen, and durable offset replay.

## Phase 6: Verification

- Completed: `bun test`, `bun run typecheck`, `bun run build`, local Playwright flow verification, OpenRouter catalog/stream/error checks, UI smoothness fixes, and updated docs.

## Commit Strategy

Logical commits:

1. Documentation and architecture decisions.
2. Project scaffold and dependency setup.
3. Prisma schema, auth, and metadata APIs.
4. Prisma Streams service and durable event API.
5. OpenRouter model and streaming integration.
6. TanStack DB client UI.
7. Verification docs and fixes.

Actual commits follow this strategy with a few adjacent fixes grouped by behavior.
