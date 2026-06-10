# Key Features And User Flows

This file is both product documentation and a verification checklist. Each flow should remain testable locally.

## 1. Guest Session

A first-time visitor is signed in automatically as an anonymous guest and can chat immediately within a small lifetime budget.

## 2. Sign In

An existing user can sign in with email and password and land in the chat app. Public registration is closed (`disableSignUp` in `src/server/auth.ts`); guests are the default way in.

## 3. Sign Out

The active session can be revoked and the app returns to a fresh guest state with no data from the previous identity.

## 4. Create Chat

The user can create a new chat. Postgres stores the chat row with owner, title, model, and timestamps. The first message renames the chat from its prompt.

## 5. List And Search Chats

The sidebar lists only the signed-in user's chats, grouped by recency and filterable with `⌘K` search.

## 6. Rename And Delete Chat

The user can rename or delete a chat. Changes are persisted in Postgres and reflected in TanStack DB.

## 7. Select Model

The user can search and select an OpenRouter model. The app supports model ids returned by OpenRouter rather than a hard-coded allowlist, and the model can change mid-chat.

## 8. Send User Message

Submitting the composer appends a durable user message event to Prisma Streams with routing key `chat:<chatId>`.

## 9. Stream Assistant Response

Assistant output streams smoothly into the transcript with markdown rendering. Each delta is durable before the browser applies it, allowing reconnect and refresh recovery.

## 10. Resume Chat After Refresh

Reloading the browser replays durable events from Prisma Streams for the selected chat and reconstructs message state.

## 11. Switch Chats

Switching chats changes the active routing key, clears transient stream state, replays the selected chat history, and leaves other chat data intact.

## 12. Message Permalinks

Every message has a stable `#/chat/:chatId/message/:messageId` link. Opening one loads the chat, scrolls to the message, and highlights it.

## 13. Per-Message Model Attribution

Each assistant message records the model that produced it. The hover meta row under a message shows the model, so multi-model chats stay legible.

## 14. Usage Tracking And Budgets

Every completed assistant turn records tokens and cost (micro-USD) in Postgres. The sidebar meter shows spend against the guest or monthly budget, and the server rejects prompts once the budget is exhausted. The chat header shows a per-chat, per-model cost breakdown.

## 15. Handle Model Errors

If OpenRouter returns a pre-stream or mid-stream error, the assistant message is marked failed through a durable `message.error` event.

## 16. Auth-Protected Streams

Opening a message stream for another user's chat fails because Bun validates session and chat ownership before proxying Prisma Streams.

## 17. Local-Only Operation

With local Prisma Postgres and local Prisma Streams running, all app data except model calls stays on the machine.
