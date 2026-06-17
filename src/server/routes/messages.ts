// The core demo path: send a message, read history, tail the event log.
//
// sendMessage appends every event durably to Prisma Streams before and while
// the model streams; streamEvents proxies that same log over SSE, so the UI
// can resume from any offset after a refresh, reconnect, or server restart.
import {
  sendMessageSchema,
  type MessageEvent,
  type MessageEventInput,
  type UsageSummary,
} from "../../shared/contracts";
import {
  materializeMessages,
  stalledMessages,
} from "../../shared/messages";
import { splitCompletePcmFrames } from "../../shared/pcm";
import { db } from "../../prisma/db";
import {
  assertMethod,
  HttpError,
  json,
  parseJson,
  requireUser,
  sseEncode,
} from "../http";
import {
  modelCapabilities,
  streamSpeech,
  streamChatCompletion,
  type SpeechFormat,
  type WireContentPart,
  type WireMessage,
} from "../openrouter";
import { wavFromPcm16 } from "../audio";
import {
  AudioReadAlongBuilder,
  type AudioReadAlongOutput,
} from "../audio-readalong";
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
  summarizeSpeechUsage,
  summarizeUsage,
} from "../usage";
import { requireOwnedChat } from "./chats";

const encoder = new TextEncoder();
const PCM_EVENT_LIMIT_BYTES = 12 * 1024 * 1024;

type GenerationUser = {
  id: string;
  isAnonymous?: boolean | null | undefined;
};

// Voice notes are transcribed out-of-band by a cheap audio-in model and
// the text backfilled onto the user message — chat completions never
// return a transcript of *input* audio, only of generated speech.
const TRANSCRIBE_MODEL = "google/gemini-2.5-flash-lite";
const TRANSCRIBE_PROMPT =
  "Transcribe the attached audio verbatim. Reply with only the transcript text.";

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

async function recordUserUsage(
  user: GenerationUser,
  usage: UsageSummary,
) {
  await recordUsage(
    {
      id: user.id,
      isAnonymous: user.isAnonymous,
    },
    usage,
  );
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

function speechAudioDataUrl(
  format: SpeechFormat,
  audioBytes: Uint8Array,
  sampleRate: number,
  channels: number,
) {
  if (format === "pcm") {
    return `data:audio/wav;base64,${Buffer.from(
      wavFromPcm16(audioBytes, sampleRate, channels),
    ).toString("base64")}`;
  }

  const mime = format === "wav" ? "audio/wav" : "audio/mp3";
  return `data:${mime};base64,${Buffer.from(audioBytes).toString("base64")}`;
}

async function runSpeechGeneration({
  user,
  chatId,
  assistantMessageId,
  model,
  text,
}: {
  user: GenerationUser;
  chatId: string;
  assistantMessageId: string;
  model: string;
  text: string;
}) {
  await appendMessageEvent(
    user.id,
    chatId,
    newEvent({
      type: "message.delta",
      chatId,
      messageId: assistantMessageId,
      role: "assistant",
      text,
      model,
    }),
  );

  let format: SpeechFormat = "pcm";
  let sampleRate = 24_000;
  let channels = 1;
  let pcmRemainder = Buffer.alloc(0);
  const containerChunks: Array<Buffer> = [];
  const pcmChunks: Array<Buffer> = [];

  for await (const delta of streamSpeech({ model, text })) {
    if (delta.type === "metadata") {
      format = delta.format;
      sampleRate = delta.sampleRate;
      channels = delta.channels;
      pcmRemainder = Buffer.alloc(0);
      continue;
    }

    const chunk = Buffer.from(delta.bytes);
    if (format !== "pcm") {
      containerChunks.push(chunk);
      continue;
    }

    const split = splitCompletePcmFrames(pcmRemainder, chunk, channels * 2);
    pcmRemainder = Buffer.from(split.remainder);
    if (!split.complete.length) continue;

    const liveChunk = Buffer.from(split.complete);
    pcmChunks.push(liveChunk);
    await appendMessageEvent(
      user.id,
      chatId,
      newEvent({
        type: "message.audio.delta",
        chatId,
        messageId: assistantMessageId,
        role: "assistant",
        audio: liveChunk.toString("base64"),
        sampleRate,
        channels,
        model,
      }),
    );
  }

  const audioBytes = Buffer.concat(
    format === "pcm" ? pcmChunks : containerChunks,
  );
  if (!audioBytes.length) {
    throw new Error("Speech model returned no audio");
  }

  const audioId = await storeContent(
    speechAudioDataUrl(format, audioBytes, sampleRate, channels),
    user.id,
  );
  await appendMessageEvent(
    user.id,
    chatId,
    newEvent({
      type: "message.audio",
      chatId,
      messageId: assistantMessageId,
      role: "assistant",
      audio: { id: audioId },
      model,
    }),
  );

  const usageSummary = await summarizeSpeechUsage(model, text);
  await appendMessageEvent(
    user.id,
    chatId,
    newEvent({
      type: "message.completed",
      chatId,
      messageId: assistantMessageId,
      role: "assistant",
      model,
      finishReason: "stop",
      usage: usageSummary,
    }),
  );
  await recordUserUsage(user, usageSummary);
  await db.orm.Chat.where({ id: chatId }).update({
    updatedAt: new Date(),
  });
}

export async function sendMessage(request: Request, chatId: string) {
  assertMethod(request, ["POST"]);
  const user = await requireUser(request);
  const chat = await requireOwnedChat(user.id, chatId);
  await assertWithinUsageLimit(user);
  const input = sendMessageSchema.parse(await parseJson(request));
  const model = input.model ?? chat.model;
  const capabilities = await modelCapabilities(model);

  if (capabilities.outputsSpeech && !capabilities.outputsText) {
    if (!input.text.trim()) {
      throw new HttpError(400, "TTS models need text to speak.");
    }
    if (input.images?.length || input.audio) {
      throw new HttpError(400, "TTS models only accept text input.");
    }
  }

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
      if (capabilities.outputsSpeech && !capabilities.outputsText) {
        await runSpeechGeneration({
          user,
          chatId: chat.id,
          assistantMessageId,
          model,
          text: input.text,
        });
        return;
      }

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
      let livePcmBytes = 0;
      const readAlong = new AudioReadAlongBuilder();

      const appendReadAlongOutputs = async (
        outputs: Array<AudioReadAlongOutput>,
      ) => {
        for (const output of outputs) {
          if (output.type === "text") {
            await appendMessageEvent(
              user.id,
              chat.id,
              newEvent({
                type: "message.delta",
                chatId: chat.id,
                messageId: assistantMessageId,
                role: "assistant",
                text: output.text,
                model,
              }),
            );
          } else if (output.type === "timing") {
            await appendMessageEvent(
              user.id,
              chat.id,
              newEvent({
                type: "message.audio.timing",
                chatId: chat.id,
                messageId: assistantMessageId,
                role: "assistant",
                timings: output.timings,
                ...(output.spans?.length ? { spans: output.spans } : {}),
                model,
              }),
            );
          } else {
            await appendMessageEvent(
              user.id,
              chat.id,
              newEvent({
                type: "message.audio.delta",
                chatId: chat.id,
                messageId: assistantMessageId,
                role: "assistant",
                audio: output.audio,
                model,
              }),
            );
          }
        }
      };

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

        if (delta.audioChunk) {
          const audioChunk = Buffer.from(delta.audioChunk, "base64");
          pcmChunks.push(audioChunk);
          livePcmBytes += audioChunk.length;
        }

        // For spoken replies, only use the transcript attached to the audio
        // stream. Plain content deltas are not guaranteed to be synchronized
        // with the PCM chunk and make read-along highlighting drift.
        const text = capabilities.outputsAudio ? delta.audioTranscript : delta.text;
        if (capabilities.outputsAudio) {
          const outputs: Array<AudioReadAlongOutput> = [];
          const audioChunk =
            delta.audioChunk && livePcmBytes <= PCM_EVENT_LIMIT_BYTES
              ? Buffer.from(delta.audioChunk, "base64")
              : undefined;
          if (delta.audioChunk && audioChunk && text) {
            outputs.push(
              ...readAlong.addAudioTranscript(
                delta.audioChunk,
                audioChunk.length,
                text,
              ),
            );
          } else {
            if (delta.audioChunk && audioChunk) {
              outputs.push(
                ...readAlong.addAudio(delta.audioChunk, audioChunk.length),
              );
            }
            if (text) outputs.push(...readAlong.addTranscript(text));
          }
          if (outputs.length) await appendReadAlongOutputs(outputs);
        } else if (text) {
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

      await appendReadAlongOutputs(readAlong.finish());

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
            audio: {
              id: spokenAudio.id,
              ...(readAlong.timings.length ? { timings: readAlong.timings } : {}),
              ...(readAlong.spans.length ? { spans: readAlong.spans } : {}),
            },
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
      await recordUserUsage(user, usageSummary);
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
                  text: TRANSCRIBE_PROMPT,
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
          await recordUserUsage(
            user,
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
