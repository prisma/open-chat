// The core demo path: send a message, read history, tail the event log.
//
// sendMessage appends every event durably to Prisma Streams before and while
// the model streams; streamEvents proxies that same log over SSE, so the UI
// can resume from any offset after a refresh, reconnect, or server restart.
import {
  sendMessageSchema,
  type MessageEvent,
  type MessageEventInput,
} from "../../shared/contracts";
import {
  materializeMessages,
  stalledMessages,
} from "../../shared/messages";
import { db } from "../../prisma/db";
import {
  assertMethod,
  json,
  parseJson,
  requireUser,
  sseEncode,
} from "../http";
import {
  modelOutputsImages,
  streamChatCompletion,
  type WireContentPart,
  type WireMessage,
} from "../openrouter";
import { storeContent } from "../content";
import { thumbnailFromDataUrl } from "../images";
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

  let { events, offset } = await loadAllMessageEvents(user.id, chatId);

  // Repair generations that died with their server (deploy, crash) before
  // appending a terminal event — otherwise the chat replays as eternally
  // "streaming". The repair is itself an event, so it heals durably.
  const stalled = stalledMessages(materializeMessages(events), Date.now());
  if (stalled.length) {
    for (const message of stalled) {
      await appendMessageEvent(
        user.id,
        chatId,
        newEvent({
          type: "message.error",
          chatId,
          messageId: message.id,
          role: "assistant",
          ...(message.model ? { model: message.model } : {}),
          error: "The model stream was interrupted.",
        }),
      );
    }
    ({ events, offset } = await loadAllMessageEvents(user.id, chatId));
  }

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
    .filter(
      (message) =>
        message.status === "completed" &&
        (message.text.trim() || message.images?.length),
    )
    .slice(-30)
    .map((message): WireMessage => {
      // User attachments go along as image_url parts so vision models keep
      // seeing them in follow-ups — the inline thumbnail is plenty for
      // context. Generated assistant images stay out — models reject image
      // parts in assistant turns.
      const images = (message.role === "user" ? (message.images ?? []) : [])
        .map((image) => (typeof image === "string" ? image : image.thumb))
        .filter((url): url is string => Boolean(url));
      if (!images.length) {
        return { role: message.role, content: message.text };
      }
      const parts: Array<WireContentPart> = images.map((image) => ({
        type: "image_url",
        image_url: { url: image },
      }));
      if (message.text.trim()) {
        parts.unshift({ type: "text", text: message.text });
      }
      return { role: message.role, content: parts };
    });
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

  // Originals go to the content store; only the id and the small inline
  // thumbnail enter the event log.
  const attachments = await Promise.all(
    (input.images ?? []).map(async (image) => ({
      id: await storeContent(image.full, user.id),
      thumb: image.thumb,
    })),
  );

  await appendMessageEvent(
    user.id,
    chat.id,
    newEvent({
      type: "message.created",
      chatId: chat.id,
      messageId: userMessageId,
      role: "user",
      text: input.text,
      ...(attachments.length ? { images: attachments } : {}),
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
    chat.title === "New chat"
      ? createChatTitle(input.text || "Image message")
      : chat.title;
  await db.orm.Chat.where({ id: chat.id }).update({
    title: renamedTitle,
    model,
    updatedAt: new Date(),
  });

  const { events } = await loadAllMessageEvents(user.id, chat.id);
  const messages = toOpenRouterMessages(events);

  void (async () => {
    try {
      const stream = streamChatCompletion({
        model,
        messages,
        userId: user.id,
        imageOutput: await modelOutputsImages(model),
      });

      let finishReason: string | null = null;
      let usage:
        | {
            promptTokens?: number | undefined;
            completionTokens?: number | undefined;
            cost?: number | null | undefined;
          }
        | undefined;

      for await (const delta of stream) {
        if (delta.usage) usage = delta.usage;
        finishReason = delta.finishReason ?? finishReason;

        if (delta.text) {
          await appendMessageEvent(
            user.id,
            chat.id,
            newEvent({
              type: "message.delta",
              chatId: chat.id,
              messageId: assistantMessageId,
              role: "assistant",
              text: delta.text,
              model,
            }),
          );
        }

        for (const image of delta.images ?? []) {
          // Generated images land here as data URLs; park the original in
          // the content store, thumbnail it for the event log (Bun.Image,
          // when the runtime has it), and log the reference.
          const [id, thumb] = await Promise.all([
            storeContent(image, user.id),
            thumbnailFromDataUrl(image),
          ]);
          await appendMessageEvent(
            user.id,
            chat.id,
            newEvent({
              type: "message.image",
              chatId: chat.id,
              messageId: assistantMessageId,
              role: "assistant",
              image: { id, ...(thumb ? { thumb } : {}) },
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
