# Verification

## Required Checks

- `bun run typecheck`
- `bun test`
- `bun run build`
- local app smoke test at `http://localhost:3000`

## User Flow Verification

Each key flow in `docs/features.md` must be verified manually or with browser automation before completion. Results should be recorded here as the implementation stabilizes.

| Flow | Status | Notes |
| --- | --- | --- |
| Sign Up | Pending | |
| Sign In | Pending | |
| Sign Out | Pending | |
| Create Chat | Pending | |
| List Chats | Pending | |
| Rename Chat | Pending | |
| Select Model | Pending | |
| Send User Message | Pending | |
| Stream Assistant Response | Pending | |
| Resume Chat After Refresh | Pending | |
| Switch Chats | Pending | |
| Handle Model Errors | Pending | |
| Auth-Protected Streams | Pending | |
| Local-Only Operation | Pending | |

## UI Performance Notes

The transcript should avoid whole-page re-rendering during token streaming. The intended shape is durable event ingestion into TanStack DB, incremental assistant row updates, and transcript autoscroll only when the user is already near the bottom.

## OpenRouter Model Verification

The app does not need to invoke every OpenRouter model during verification. It must prove that:

- `/api/models` returns the current OpenRouter catalog.
- model selection is data-driven from that catalog.
- the send endpoint accepts any text chat model id from the catalog.
- at least one low-cost model streams successfully with the configured key.

