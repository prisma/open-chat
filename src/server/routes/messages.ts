// The core demo path: send a message, read history, tail the event log.
//
// sendMessage appends every event durably to Prisma Streams before and while
// the model streams; streamEvents proxies that same log over SSE, so the UI
// can resume from any offset after a refresh, reconnect, or server restart.
import type { ChatMessages } from "@openrouter/sdk/models";
import {
  sendMessageSchema,
  type MessageEvent,
  type MessageEventInput,
} from "../../shared/contracts";
import { materializeMessages } from "../../shared/messages";
import { db } from "../../prisma/db";
import {
  assertMethod,
  json,
  parseJson,
  requireUser,
  sseEncode,
} from "../http";
import { streamChatCompletion } from "../openrouter";
import {
  appendMessageEvent,
  loadAllMessageEvents,
  readMessageEvents,
} from "../streams";
import {
  assertWithinUsageLimit,
  recordUsage,
  summarizeUsage,
} from "../usage";
import { requireOwnedChat } from "./chats";

const encoder = new TextEncoder();

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

export async function getMessages(request: Request, chatId: string) {
  assertMethod(request, ["GET"]);
  const user = await requireUser(request);
  await requireOwnedChat(user.id, chatId);

  const { events, offset } = await loadAllMessageEvents(user.id, chatId);
  return json({ messages: materializeMessages(events), offset });
}

export async function streamEvents(request: Request, chatId: string) {
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

export async function sendMessage(request: Request, chatId: string) {
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
