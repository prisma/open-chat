# Implementation Plan

## Phase 1: Project Foundation

- Create Bun/TypeScript project metadata.
- Add React client entrypoint served by Bun HTML imports.
- Add strict TypeScript configuration.
- Add environment examples without secrets.
- Add Prisma schema, Prisma config, and generated client output path.

## Phase 2: Metadata And Auth

- Model Better Auth tables and `Chat` metadata in Postgres.
- Configure Prisma ORM 7 with `@prisma/adapter-pg`.
- Configure Better Auth with the Prisma adapter and email/password auth.
- Mount `/api/auth/*` directly on Bun.
- Add protected route helpers.

## Phase 3: Prisma Streams

- Start a local Prisma Streams server when `STREAMS_URL` is not provided.
- Implement stream naming from the authenticated user id.
- Ensure user streams are created lazily.
- Append JSON events with `Stream-Key: chat:<chatId>`.
- Implement authenticated long-poll reads with durable offsets.

## Phase 4: OpenRouter

- Configure the official OpenRouter TypeScript SDK.
- Proxy model listing from `/api/models`.
- Support any text chat model returned by OpenRouter.
- Stream chat completions from OpenRouter and append every visible delta to Prisma Streams before the browser receives it.
- Persist terminal completion/error events.

## Phase 5: TanStack DB UI

- Create TanStack DB collections for chats, models, messages, and UI state.
- Use `useLiveQuery` for chat list, selected chat, messages, model list, and composer state.
- Build the primary app surface: sidebar, chat transcript, composer, model picker, auth screen.
- Use durable stream offsets to resume after reloads.

## Phase 6: Verification

- Run typecheck and tests.
- Start local services and app server.
- Verify at least ten user flows from `docs/features.md`.
- Verify OpenRouter model listing and representative model streaming.
- Inspect UI smoothness with browser automation and performance-oriented checks.
- Update docs with any implementation corrections.

## Commit Strategy

Logical commits:

1. Documentation and architecture decisions.
2. Project scaffold and dependency setup.
3. Prisma schema, auth, and metadata APIs.
4. Prisma Streams service and durable event API.
5. OpenRouter model and streaming integration.
6. TanStack DB client UI.
7. Verification docs and fixes.

