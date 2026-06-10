# Verification

## Required Checks

- `bun run typecheck`: passed
- `bun test`: passed
- `bun run build`: passed
- local app smoke test at `http://localhost:3000`: passed

## User Flow Verification

Verified with Playwright CLI and direct `curl` checks on June 10, 2026.

| Flow | Status | Notes |
| --- | --- | --- |
| Sign Up | Verified | Created a local Better Auth user `qa-1781090800@example.com`. |
| Sign In | Verified | Signed in after a fresh browser context and recovered chat metadata. |
| Sign Out | Verified | Sign-out returns to the auth screen and no new protected history/stream requests are made after the final race fix. |
| Create Chat | Verified | Created an empty second chat; Postgres metadata appeared immediately in the sidebar. |
| List Chats | Verified | Sidebar listed the signed-in user's chats, newest first. |
| Rename Chat | Verified | Renamed the first chat to `Durable stream QA`; sidebar and header updated from persisted metadata. |
| Select Model | Verified | Model picker loaded the OpenRouter catalog and selected `google/gemini-2.5-flash-lite`. |
| Send User Message | Verified | Composer submission created a chat when needed and appended the user event. |
| Stream Assistant Response | Verified | `google/gemini-2.5-flash-lite` streamed a response through Prisma Streams and the UI stayed live past Bun's old timeout window. |
| Resume Chat After Refresh | Verified | Re-signing into a fresh browser context replayed message history from Prisma Streams and restored the chat model from Postgres. |
| Switch Chats | Verified | Switching between an empty chat and `Durable stream QA` changed routing keys and preserved per-chat message isolation. |
| Handle Model Errors | Verified | `google/gemma-4-26b-a4b-it:free` returned a provider error; the app persisted a durable `message.error` event and rendered the failed assistant turn. |
| Auth-Protected Streams | Verified | Unauthenticated `curl` calls to `/api/chats`, `/api/models`, and `/api/chats/:id/history` returned `401 Authentication required`. |
| Local-Only Operation | Verified | Prisma Dev provided local Postgres on TCP port `51297` and local Streams on `127.0.0.1:51299`; only OpenRouter calls left the machine. |

## UI Performance Notes

The transcript avoids whole-page state churn by ingesting durable events into TanStack DB and updating only affected message rows. Autoscroll now sticks only when the user is already near the bottom, so token streaming does not fight manual reading. The SSE proxy sends idle heartbeats and Bun's `idleTimeout` is raised to prevent silent disconnects.

## OpenRouter Model Verification

The app intentionally supports all text chat model ids returned by OpenRouter without a hard-coded allowlist. Verification proved that:

- `/api/models` returns the current OpenRouter catalog for authenticated users.
- model selection is data-driven from that catalog.
- the send endpoint accepts catalog model ids and persists the selected model on the chat.
- `google/gemini-2.5-flash-lite` streamed successfully with the configured key.
- provider/model failures are expected external states; they are recorded durably as `message.error` events.
