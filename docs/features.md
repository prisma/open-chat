# Key Features And User Flows

This file is both product documentation and a verification checklist. Each flow should remain testable locally.

## 1. Guest Session

A first-time visitor is signed in automatically as an anonymous guest and can chat immediately within a small lifetime budget ($0.50).

## 2. Sign Up

A new user can create an account with email/password, GitHub, or Google, and receives $2.00 in free credit. If they were chatting as a guest, their chats — including the durable stream events — migrate to the new account.

## 3. Sign In

An existing user can sign in with email/password, GitHub, or Google. Social providers appear only when their credentials are configured.

## 4. Sign Out

The active session can be revoked and the app returns to a fresh guest state with no data from the previous identity.

## 5. Credits And Top-Ups

Spend draws down the account's credit balance. Users top up in fixed increments ($5–$100) through Stripe Checkout; a transparent 10% fee on top covers Stripe and OpenRouter costs, and the exact total is shown before checkout. An account that has sat at $0 for a month automatically receives a free $0.50 top-up.

## 6. Create Chat

The user can create a new chat. Postgres stores the chat row with owner, title, model, and timestamps. The first message renames the chat from its prompt.

## 7. List And Search Chats

The sidebar lists only the signed-in user's chats, grouped by recency and filterable with `⌘K` search.

## 8. Rename And Delete Chat

The user can rename or delete a chat. Changes are persisted in Postgres and reflected in TanStack DB.

## 9. Select Model

The user can search and select an OpenRouter model. The app supports model ids returned by OpenRouter rather than a hard-coded allowlist, and the model can change mid-chat.

## 10. Send User Message

Submitting the composer appends a durable user message event to Prisma Streams with routing key `chat:<chatId>`.

## 11. Stream Assistant Response

Assistant output streams smoothly into the transcript with markdown rendering. Each delta is durable before the browser applies it, allowing reconnect and refresh recovery.

## 11a. Read-Along Spoken Replies

Chat-completion audio models stream speech live; the stored reply replays through a normal player. OpenRouter transcript fragments are paired with their PCM audio spans and appended as durable `message.audio.timing` events, so playback highlights the spoken phrase while the model is speaking and preserves the same read-along experience after refresh. Once the WAV is stored, clicking a highlighted phrase seeks to it.

## 11b. Text-To-Speech Models

OpenRouter `speech` models are selectable from the same model picker. These models synthesize the submitted text through `/audio/speech`; PCM responses stream live through durable `message.audio.delta` events, while MP3-only responses appear as a replayable audio attachment once the request completes.

Dedicated TTS models do not provide transcript timing metadata, so they do not support read-along highlighting. They read the submitted text aloud rather than generating a conversational reply.

## 12. Resume Chat After Refresh

Reloading the browser replays durable events from Prisma Streams for the selected chat and reconstructs message state.

## 13. Switch Chats

Switching chats changes the active routing key, clears transient stream state, replays the selected chat history, and leaves other chat data intact.

## 14. Message Permalinks

Every message has a stable `#/chat/:chatId/message/:messageId` link. Opening one loads the chat, scrolls to the message, and highlights it.

## 15. Per-Message Model Attribution

Each assistant message records the model that produced it. The hover meta row under a message shows the model, so multi-model chats stay legible.

## 16. Usage Tracking And Budgets

Every completed assistant turn records tokens and cost (micro-USD) in Postgres. Guests see spend against their lifetime budget; signed-in users see their remaining credit balance. The server rejects prompts once the budget or balance is exhausted. The chat header shows a per-chat, per-model cost breakdown.

## 17. Handle Model Errors

If OpenRouter returns a pre-stream or mid-stream error, the assistant message is marked failed through a durable `message.error` event.

## 18. Auth-Protected Streams

Opening a message stream for another user's chat fails because Bun validates session and chat ownership before proxying Prisma Streams.

## 19. Local-Only Operation

With local Prisma Postgres and local Prisma Streams running, all app data except model calls stays on the machine.
