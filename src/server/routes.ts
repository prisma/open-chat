// HTTP API for chats, messages, models, and usage.
//
// Two stores back these routes: chat metadata lives in Postgres (queried
// through Prisma Next), while message history is an append-only event log
// in Prisma Streams — one stream per user, one routing key per chat. See
// docs/architecture.md for the full picture.
//
// This file is just the table of contents: it maps URLs to the handlers in
// src/server/routes/. Start with routes/messages.ts for the durable
// streaming path the demo is about.
import { auth } from "./auth";
import { HttpError, getPathId, handleError } from "./http";
import { getConfig, getMe, getUsage, listModels } from "./routes/account";
import {
  confirmCheckout,
  createCheckout,
  stripeWebhook,
} from "./routes/billing";
import { listChats, updateChat } from "./routes/chats";
import { getContent } from "./routes/content";
import { getMessages, sendMessage, streamEvents } from "./routes/messages";
import { getStats } from "./routes/stats";

async function handleApi(request: Request) {
  const url = new URL(request.url);

  if (url.pathname.startsWith("/api/auth/")) {
    return auth.handler(request);
  }

  if (url.pathname === "/api/stats") return getStats(request);
  if (url.pathname === "/api/me") return getMe(request);
  if (url.pathname === "/api/config") return getConfig(request);
  if (url.pathname === "/api/usage") return getUsage(request);
  if (url.pathname === "/api/chats") return listChats(request);
  if (url.pathname === "/api/models") return listModels(request);
  if (url.pathname === "/api/billing/checkout") return createCheckout(request);
  if (url.pathname === "/api/billing/confirm") return confirmCheckout(request);
  if (url.pathname === "/api/billing/webhook") return stripeWebhook(request);

  const contentId = getPathId(url.pathname, "/api/content/");
  if (contentId) return getContent(request, contentId);

  const messageChatId = getPathId(url.pathname, "/api/chats/", "/messages");
  if (messageChatId) return sendMessage(request, messageChatId);

  const eventsChatId = getPathId(url.pathname, "/api/chats/", "/events");
  if (eventsChatId) return streamEvents(request, eventsChatId);

  const messagesChatId = getPathId(url.pathname, "/api/chats/", "/history");
  if (messagesChatId) return getMessages(request, messagesChatId);

  const chatId = getPathId(url.pathname, "/api/chats/");
  if (chatId) return updateChat(request, chatId);

  throw new HttpError(404, "Not found");
}

export async function routeApi(request: Request) {
  try {
    return await handleApi(request);
  } catch (error) {
    return handleError(error);
  }
}
