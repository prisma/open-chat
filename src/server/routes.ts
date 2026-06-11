// HTTP API for chats, messages, models, and usage.
//
// Two stores back these routes: chat metadata lives in Postgres (queried
// through Prisma Next), while message history is an append-only event log
// in Prisma Streams — one stream per user, one routing key per chat. See
// docs/architecture.md for the full picture.
import type { ChatMessages } from "@openrouter/sdk/models";
import {
  createChatSchema,
  renameChatSchema,
  sendMessageSchema,
  topupCheckoutSchema,
  type ConfigDto,
  type MessageEvent,
  type MessageEventInput,
  type UsageDto,
} from "../shared/contracts";
import { GUEST_LIMIT_MICRO_USD, isTopupOption } from "../shared/billing";
import { materializeMessages } from "../shared/messages";
import { db } from "../prisma/db";
import { auth, configuredSocialProviders } from "./auth";
import {
  confirmTopup,
  createTopupCheckout,
  getCreditSummary,
  handleStripeWebhook,
} from "./billing";
import { env } from "./env";
import {
  HttpError,
  assertMethod,
  getPathId,
  gzipJson,
  handleError,
  json,
  noContent,
  parseJson,
  requireUser,
  sseEncode,
} from "./http";
import { listOpenRouterModels, streamChatCompletion } from "./openrouter";
import {
  appendMessageEvent,
  loadAllMessageEvents,
  readMessageEvents,
} from "./streams";
import {
  assertWithinUsageLimit,
  getGuestSpendMicroUsd,
  recordUsage,
  summarizeUsage,
} from "./usage";

const defaultModel = "openai/gpt-4.1-mini";
const encoder = new TextEncoder();

function chatDto(chat: {
  id: string;
  title: string;
  model: string;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: chat.id,
    title: chat.title,
    model: chat.model,
    createdAt: chat.createdAt.toISOString(),
    updatedAt: chat.updatedAt.toISOString(),
  };
}

function newEvent(event: MessageEventInput): MessageEvent {
  return {
    ...event,
    id: `evt_${crypto.randomUUID()}`,
    createdAt: new Date().toISOString(),
  } as MessageEvent;
}

function createChatTitle(prompt: string) {
  const compact = prompt.replace(/\s+/g, " ").trim();
  if (compact.length <= 56) return compact;
  return `${compact.slice(0, 53)}...`;
}

async function requireOwnedChat(userId: string, chatId: string) {
  const chat = await db.orm.Chat.where({ id: chatId, userId }).first();

  if (!chat) {
    throw new HttpError(404, "Chat not found");
  }

  return chat;
}

async function listChats(request: Request) {
  assertMethod(request, ["GET", "POST"]);
  const user = await requireUser(request);

  if (request.method === "POST") {
    const input = createChatSchema.parse(await parseJson(request));
    const now = new Date();
    const chat = await db.orm.Chat.create({
      id: `chat_${crypto.randomUUID()}`,
      userId: user.id,
      title: input.title ?? "New chat",
      model: input.model ?? defaultModel,
      createdAt: now,
      updatedAt: now,
    });

    return json(chatDto(chat), 201);
  }

  const chats = await db.orm.Chat.where({ userId: user.id })
    .orderBy((chat) => chat.updatedAt.desc())
    .all();

  return json(chats.map(chatDto));
}

async function updateChat(request: Request, chatId: string) {
  const user = await requireUser(request);
  await requireOwnedChat(user.id, chatId);

  if (request.method === "PATCH") {
    const input = renameChatSchema.parse(await parseJson(request));
    const chat = await db.orm.Chat.where({ id: chatId }).update({
      title: input.title,
      updatedAt: new Date(),
    });
    if (!chat) {
      throw new HttpError(404, "Chat not found");
    }
    return json(chatDto(chat));
  }

  if (request.method === "DELETE") {
    await db.orm.Chat.where({ id: chatId }).delete();
    return noContent();
  }

  throw new HttpError(405, "Method not allowed");
}

async function getMessages(request: Request, chatId: string) {
  assertMethod(request, ["GET"]);
  const user = await requireUser(request);
  await requireOwnedChat(user.id, chatId);

  const { events, offset } = await loadAllMessageEvents(user.id, chatId);
  return json({ messages: materializeMessages(events), offset });
}

async function streamEvents(request: Request, chatId: string) {
  assertMethod(request, ["GET"]);
  const user = await requireUser(request);
  await requireOwnedChat(user.id, chatId);

  const url = new URL(request.url);
  let offset = url.searchParams.get("offset") || "-1";

  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown, id?: string) => {
        controller.enqueue(encoder.encode(sseEncode(event, data, id)));
      };

      send("ready", { chatId, offset });

      try {
        while (!request.signal.aborted) {
          const batch = await readMessageEvents(user.id, chatId, offset, {
            live: true,
            signal: request.signal,
          });

          for (const event of batch.events) {
            send("message", event, event.id);
          }

          if (batch.nextOffset !== offset) {
            offset = batch.nextOffset;
            send("checkpoint", {
              chatId,
              offset,
              updatedAt: new Date().toISOString(),
            });
          } else if (batch.events.length === 0) {
            send("heartbeat", { chatId, offset });
          }
        }
      } catch (error) {
        if (!request.signal.aborted) {
          send("stream-error", {
            message:
              error instanceof Error ? error.message : "Stream proxy failed",
          });
        }
      } finally {
        controller.close();
      }
    },
    cancel() {
      // Client disconnected; the read loop exits via request.signal.
      // Throwing here would crash the process.
    },
  });

  return new Response(body, {
    headers: {
      "cache-control": "no-store",
      "connection": "keep-alive",
      "content-type": "text/event-stream",
      "x-accel-buffering": "no",
    },
  });
}

function toOpenRouterMessages(events: Array<MessageEvent>) {
  return materializeMessages(events)
    .filter((message) => message.status === "completed" && message.text.trim())
    .slice(-30)
    .map((message) => ({
      role: message.role,
      content: message.text,
    })) satisfies Array<ChatMessages>;
}

async function sendMessage(request: Request, chatId: string) {
  assertMethod(request, ["POST"]);
  const user = await requireUser(request);
  const chat = await requireOwnedChat(user.id, chatId);
  await assertWithinUsageLimit(user);
  const input = sendMessageSchema.parse(await parseJson(request));
  const model = input.model ?? chat.model;

  if (model !== chat.model) {
    await db.orm.Chat.where({ id: chat.id }).update({ model });
  }

  const userMessageId = `msg_${crypto.randomUUID()}`;
  const assistantMessageId = `msg_${crypto.randomUUID()}`;

  await appendMessageEvent(
    user.id,
    chat.id,
    newEvent({
      type: "message.created",
      chatId: chat.id,
      messageId: userMessageId,
      role: "user",
      text: input.text,
      model,
    }),
  );

  await appendMessageEvent(
    user.id,
    chat.id,
    newEvent({
      type: "message.created",
      chatId: chat.id,
      messageId: assistantMessageId,
      role: "assistant",
      text: "",
      model,
    }),
  );

  const renamedTitle =
    chat.title === "New chat" ? createChatTitle(input.text) : chat.title;
  await db.orm.Chat.where({ id: chat.id }).update({
    title: renamedTitle,
    model,
    updatedAt: new Date(),
  });

  const { events } = await loadAllMessageEvents(user.id, chat.id);
  const messages = toOpenRouterMessages(events);

  void (async () => {
    try {
      const stream = await streamChatCompletion({
        model,
        messages,
        userId: user.id,
        chatId: chat.id,
      });

      let finishReason: string | null = null;
      let usage:
        | {
            inputTokens?: number | undefined;
            outputTokens?: number | undefined;
            promptTokens?: number | undefined;
            completionTokens?: number | undefined;
            cost?: number | null | undefined;
          }
        | undefined;

      for await (const chunk of stream) {
        if (chunk.error) {
          throw new Error(chunk.error.message);
        }

        if (chunk.usage) usage = chunk.usage;

        for (const choice of chunk.choices) {
          finishReason = choice.finishReason ?? finishReason;
          const text = choice.delta.content ?? "";
          if (!text) continue;

          await appendMessageEvent(
            user.id,
            chat.id,
            newEvent({
              type: "message.delta",
              chatId: chat.id,
              messageId: assistantMessageId,
              role: "assistant",
              text,
              model,
            }),
          );
        }
      }

      const usageSummary = await summarizeUsage(model, usage);
      await appendMessageEvent(
        user.id,
        chat.id,
        newEvent({
          type: "message.completed",
          chatId: chat.id,
          messageId: assistantMessageId,
          role: "assistant",
          model,
          finishReason,
          usage: usageSummary,
        }),
      );
      await recordUsage(
        {
          id: user.id,
          isAnonymous: (user as { isAnonymous?: boolean | null }).isAnonymous,
        },
        usageSummary,
      );
      await db.orm.Chat.where({ id: chat.id }).update({
        updatedAt: new Date(),
      });
    } catch (error) {
      await appendMessageEvent(
        user.id,
        chat.id,
        newEvent({
          type: "message.error",
          chatId: chat.id,
          messageId: assistantMessageId,
          role: "assistant",
          model,
          error: error instanceof Error ? error.message : "Model call failed",
        }),
      );
    }
  })();

  return json({
    userMessageId,
    assistantMessageId,
  });
}

async function listModels(request: Request) {
  assertMethod(request, ["GET"]);
  await requireUser(request);
  // The catalog changes rarely; let the browser skip the refetch for a while.
  return gzipJson(request, await listOpenRouterModels(), {
    "Cache-Control": "private, max-age=300",
  });
}

async function getMe(request: Request) {
  assertMethod(request, ["GET"]);
  const user = await requireUser(request);
  return json({
    id: user.id,
    name: user.name,
    email: user.email,
  });
}

async function getUsage(request: Request) {
  assertMethod(request, ["GET"]);
  const user = await requireUser(request);
  const isAnonymous = Boolean(
    (user as { isAnonymous?: boolean | null }).isAnonymous,
  );

  if (isAnonymous) {
    const dto: UsageDto = {
      isAnonymous: true,
      spentMicroUsd: await getGuestSpendMicroUsd(user.id),
      limitMicroUsd: GUEST_LIMIT_MICRO_USD,
    };
    return json(dto);
  }

  const summary = await getCreditSummary(user.id);
  const dto: UsageDto = {
    isAnonymous: false,
    spentMicroUsd: summary.spentMicroUsd,
    grantedMicroUsd: summary.grantedMicroUsd,
    balanceMicroUsd: summary.balanceMicroUsd,
    freeTopupAt: summary.freeTopupAt?.toISOString() ?? null,
  };
  return json(dto);
}

function getConfig(request: Request) {
  assertMethod(request, ["GET"]);
  const dto: ConfigDto = {
    socialProviders: configuredSocialProviders(),
    billingEnabled: Boolean(env.STRIPE_SECRET_KEY),
  };
  return json(dto);
}

async function createCheckout(request: Request) {
  assertMethod(request, ["POST"]);
  const user = await requireUser(request);
  if ((user as { isAnonymous?: boolean | null }).isAnonymous) {
    throw new HttpError(403, "Create an account to top up credits");
  }

  const input = topupCheckoutSchema.parse(await parseJson(request));
  if (!isTopupOption(input.amountUsd)) {
    throw new HttpError(400, "Unsupported top-up amount");
  }

  const checkout = await createTopupCheckout(
    { id: user.id, email: user.email },
    input.amountUsd,
  );
  return json({ url: checkout.url, quote: checkout.quote });
}

async function confirmCheckout(request: Request) {
  assertMethod(request, ["GET"]);
  const user = await requireUser(request);
  const sessionId = new URL(request.url).searchParams.get("session_id");
  if (!sessionId) throw new HttpError(400, "session_id is required");

  return json(await confirmTopup(user.id, sessionId));
}

async function stripeWebhook(request: Request) {
  assertMethod(request, ["POST"]);
  return json(await handleStripeWebhook(request));
}

async function handleApi(request: Request) {
  const url = new URL(request.url);

  if (url.pathname.startsWith("/api/auth/")) {
    return auth.handler(request);
  }

  if (url.pathname === "/api/me") return getMe(request);
  if (url.pathname === "/api/config") return getConfig(request);
  if (url.pathname === "/api/usage") return getUsage(request);
  if (url.pathname === "/api/chats") return listChats(request);
  if (url.pathname === "/api/models") return listModels(request);
  if (url.pathname === "/api/billing/checkout") return createCheckout(request);
  if (url.pathname === "/api/billing/confirm") return confirmCheckout(request);
  if (url.pathname === "/api/billing/webhook") return stripeWebhook(request);

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
