# Key Features And User Flows

This file is both product documentation and a verification checklist. Each flow should remain testable locally.

## 1. Sign Up

A new user can create an account with name, email, and password. Better Auth stores the account and starts a session.

## 2. Sign In

An existing user can sign in with email and password and land in the chat app.

## 3. Sign Out

The active session can be revoked and the app returns to the auth screen.

## 4. Create Chat

The user can create a new chat. Postgres stores the chat row with owner, title, model, and timestamps.

## 5. List Chats

The sidebar lists only the signed-in user's chats, sorted by most recently updated.

## 6. Rename Chat

The user can rename a chat. The new title is persisted in Postgres and reflected in TanStack DB.

## 7. Select Model

The user can search and select an OpenRouter model. The app supports model ids returned by OpenRouter rather than a hard-coded allowlist.

## 8. Send User Message

Submitting the composer appends a durable user message event to Prisma Streams with routing key `chat:<chatId>`.

## 9. Stream Assistant Response

Assistant output streams smoothly into the transcript. Each delta is durable before the browser applies it, allowing reconnect and refresh recovery.

## 10. Resume Chat After Refresh

Reloading the browser replays durable events from Prisma Streams for the selected chat and reconstructs message state.

## 11. Switch Chats

Switching chats changes the active routing key, clears transient stream state, replays the selected chat history, and leaves other chat data intact.

## 12. Handle Model Errors

If OpenRouter returns a pre-stream or mid-stream error, the assistant message is marked failed through a durable `message.error` event.

## 13. Auth-Protected Streams

Opening a message stream for another user's chat fails because Bun validates session and chat ownership before proxying Prisma Streams.

## 14. Local-Only Operation

With local Prisma Postgres and local Prisma Streams running, all app data except model calls stays on the machine.

