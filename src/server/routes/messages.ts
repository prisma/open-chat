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
  modelCapabilities,
  streamChatCompletion,
  type WireContentPart,
  type WireMessage,
} from "../openrouter";
import { wavFromPcm16, whisperWordTimings, WHISPER_USD_PER_MINUTE } from "../audio";
import { alignWordsToTranscript } from "../audio-timings";
import { env } from "../env";
import { waitUntil } from "../compute";
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

// Voice notes are transcribed out-of-band by a cheap audio-in model and
// the text backfilled onto the user message — chat completions never
// return a transcript of *input* audio, only of generated speech.
const TRANSCRIBE_MODEL = "google/gemini-2.5-flash-lite";

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

function toOpenRouterMessages(
  events: Array<MessageEvent>,
  options: {
    currentAudio?: { data: string; format: "wav" | "mp3" } | undefined;
    seesImages: boolean;
    hearsAudio: boolean;
  },
) {
  const eligible = materializeMessages(events).filter(
    (message) =>
      message.status === "completed" &&
      (message.text.trim() || message.images?.length || message.audio),
  );
  const lastUserId = eligible.findLast((m) => m.role === "user")?.id;
  return eligible
    .slice(-30)
    .map((message): WireMessage => {
      // User attachments go along as image_url parts so vision models keep
      // seeing them in follow-ups — the inline thumbnail is plenty for
      // context. Generated assistant images stay out — models reject image
      // parts in assistant turns.
      const images = (message.role === "user" && options.seesImages
        ? (message.images ?? [])
        : []
      )
        .map((image) => (typeof image === "string" ? image : image.thumb))
        .filter((url): url is string => Boolean(url));
      // Only the current turn's audio is uploaded to the model; earlier
      // voice notes would re-send megabytes per turn. Anything the target
      // model can't take (a text model seeing images, a deaf model hearing
      // audio) degrades to a marker it can still read in context.
      const audio =
        message.id === lastUserId && options.hearsAudio
          ? options.currentAudio
          : undefined;
      const markers = [
        message.audio && !audio ? "[voice message]" : "",
        message.images?.length && !images.length ? "[image]" : "",
      ].filter(Boolean);
      if (!images.length && !audio) {
        return {
          role: message.role,
          content: [message.text, ...markers].filter(Boolean).join(" "),
        };
      }
      const parts: Array<WireContentPart> = images.map((image) => ({
        type: "image_url",
        image_url: { url: image },
      }));
      if (audio) {
        parts.push({ type: "input_audio", input_audio: audio });
      }
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
  const audioNote = input.audio
    ? { id: await storeContent(input.audio, user.id) }
    : undefined;
  const wireAudio = input.audio
    ? {
        data: input.audio.slice(input.audio.indexOf(",") + 1),
        format: (input.audio.startsWith("data:audio/wav") ? "wav" : "mp3") as
          | "wav"
          | "mp3",
      }
    : undefined;

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
      ...(audioNote ? { audio: audioNote } : {}),
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
      ? createChatTitle(input.text || (input.audio ? "Voice message" : "Image message"))
      : chat.title;
  await db.orm.Chat.where({ id: chat.id }).update({
    title: renamedTitle,
    model,
    updatedAt: new Date(),
  });

  const capabilities = await modelCapabilities(model);
  const { events } = await loadAllMessageEvents(user.id, chat.id);
  const messages = toOpenRouterMessages(events, {
    currentAudio: wireAudio,
    seesImages: capabilities.seesImages,
    hearsAudio: capabilities.hearsAudio,
  });

  // The generation runs past this request's lifetime; without a sleep
  // guard, Compute suspends the instance ~5s after the response and the
  // model stream freezes mid-answer.
  const generation = (async () => {
    try {
      const stream = streamChatCompletion({
        model,
        messages,
        userId: user.id,
        imageOutput: capabilities.outputsImages,
        audioOutput: capabilities.outputsAudio,
      });

      // Spoken audio: chunks are appended as events for live playback and
      // collected here; the completed answer is assembled into a WAV in
      // the content store, which replay uses instead of the chunks.
      const pcmChunks: Array<Buffer> = [];
      let pcmBytes = 0;
      const PCM_EVENT_LIMIT = 12 * 1024 * 1024;
      // The reply text, accumulated for forced alignment of the speech.
      let spokenText = "";

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

        // Audio models speak their answer; the transcript fragments are
        // the message text and stream like ordinary deltas.
        const text = delta.text ?? delta.audioTranscript;
        if (text) {
          spokenText += text;
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

        if (delta.audioChunk) {
          const chunk = Buffer.from(delta.audioChunk, "base64");
          pcmChunks.push(chunk);
          pcmBytes += chunk.length;
          if (pcmBytes <= PCM_EVENT_LIMIT) {
            await appendMessageEvent(
              user.id,
              chat.id,
              newEvent({
                type: "message.audio.delta",
                chatId: chat.id,
                messageId: assistantMessageId,
                role: "assistant",
                audio: delta.audioChunk,
                model,
              }),
            );
          }
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

      let spokenAudio: { wav: Uint8Array; id: string } | undefined;
      if (pcmChunks.length) {
        const wav = wavFromPcm16(Buffer.concat(pcmChunks));
        const dataUrl = `data:audio/wav;base64,${Buffer.from(wav).toString("base64")}`;
        spokenAudio = { wav, id: await storeContent(dataUrl, user.id) };
        await appendMessageEvent(
          user.id,
          chat.id,
          newEvent({
            type: "message.audio",
            chatId: chat.id,
            messageId: assistantMessageId,
            role: "assistant",
            audio: { id: spokenAudio.id },
            model,
          }),
        );
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

      // Read-along timings: whisper timestamps the stored speech, a pure
      // aligner maps them onto the reply text, and the result is appended
      // as one more durable audio event. Optional (needs OPENAI_API_KEY)
      // and best-effort — the reply is already complete either way.
      if (spokenAudio && spokenText && env.OPENAI_API_KEY) {
        try {
          const recognized = await whisperWordTimings(spokenAudio.wav);
          const timings = alignWordsToTranscript(spokenText, recognized);
          if (timings.length) {
            await appendMessageEvent(
              user.id,
              chat.id,
              newEvent({
                type: "message.audio",
                chatId: chat.id,
                messageId: assistantMessageId,
                role: "assistant",
                audio: { id: spokenAudio.id, timings },
                model,
              }),
            );
            const minutes = pcmBytes / 2 / 24_000 / 60;
            await recordUsage(
              {
                id: user.id,
                isAnonymous: (user as { isAnonymous?: boolean | null })
                  .isAnonymous,
              },
              {
                inputTokens: 0,
                outputTokens: 0,
                costMicroUsd: Math.ceil(
                  minutes * WHISPER_USD_PER_MINUTE * 1_000_000,
                ),
              },
            );
          }
        } catch (error) {
          console.error("Read-along timing alignment failed", error);
        }
      }
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

    // After the reply settles (so usage rows never race), transcribe the
    // voice note. A transcript is a nicety — failures stay silent.
    if (audioNote && wireAudio) {
      try {
        let transcript = "";
        let usage: Parameters<typeof summarizeUsage>[1];
        for await (const delta of streamChatCompletion({
          model: TRANSCRIBE_MODEL,
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "text",
                  text: "Transcribe the attached audio verbatim. Reply with only the transcript text.",
                },
                { type: "input_audio", input_audio: wireAudio },
              ],
            },
          ],
          userId: user.id,
        })) {
          if (delta.text) transcript += delta.text;
          if (delta.usage) usage = delta.usage;
        }
        transcript = transcript.trim().slice(0, 2_000);
        if (transcript) {
          await appendMessageEvent(
            user.id,
            chat.id,
            newEvent({
              type: "message.audio",
              chatId: chat.id,
              messageId: userMessageId,
              role: "user",
              audio: { id: audioNote.id, transcript },
              model,
            }),
          );
          await recordUsage(
            {
              id: user.id,
              isAnonymous: (user as { isAnonymous?: boolean | null })
                .isAnonymous,
            },
            await summarizeUsage(TRANSCRIBE_MODEL, usage),
          );
        }
      } catch (error) {
        console.error("Voice note transcription failed", error);
      }
    }
  })().catch((error) => {
    console.error("Generation task failed", error);
  });
  waitUntil(generation);

  return json({
    userMessageId,
    assistantMessageId,
  });
}
