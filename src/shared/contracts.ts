import { z } from "zod";

export const chatDtoSchema = z.object({
  id: z.string(),
  title: z.string(),
  model: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type ChatDto = z.infer<typeof chatDtoSchema>;

export const modelDtoSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  contextLength: z.number().nullable(),
  created: z.number(),
  inputModalities: z.array(z.string()),
  outputModalities: z.array(z.string()),
  pricing: z.unknown(),
});

export type ModelDto = z.infer<typeof modelDtoSchema>;

// Images are stored in two tiers: a small thumbnail travels inline in the
// event log (so replay stays cheap), while the full-resolution original
// lives in the content store (R2 in production) and is served back through
// GET /api/content/:id.
export const contentIdSchema = z
  .string()
  .regex(/^[0-9a-f-]{36}\.(png|jpeg|webp|gif|wav|mp3)$/);

// An image as it appears in events and messages. Plain strings are inline
// data URLs — how the earliest events stored images; still rendered.
export const messageImageSchema = z.union([
  z.string(),
  z.object({
    id: contentIdSchema,
    thumb: z.string().optional(),
  }),
]);

export type MessageImage = z.infer<typeof messageImageSchema>;

const dataUrlPattern = /^data:image\/(png|jpeg|webp|gif);base64,/;
const audioDataUrlPattern = /^data:audio\/(wav|mpeg|mp3);base64,/;

// A voice note or audio file attached to a message, or a model's spoken
// reply. Like images, the payload lives in the content store; the event
// log carries the reference (and the transcript, for model speech).
export const messageAudioSchema = z.object({
  id: contentIdSchema,
  transcript: z.string().optional(),
});

export type MessageAudio = z.infer<typeof messageAudioSchema>;

// What the client uploads per attachment: the original (capped client-side
// at 2560px) and the inline thumbnail (512px). Caps here are backstops.
const attachmentSchema = z.object({
  full: z.string().regex(dataUrlPattern).max(9_000_000),
  thumb: z.string().regex(dataUrlPattern).max(400_000),
});

export const sendMessageSchema = z
  .object({
    text: z.string().trim().max(24_000),
    model: z.string().trim().min(1).optional(),
    images: z.array(attachmentSchema).max(4).optional(),
    // One voice note / audio file per message (wav or mp3, ~8 MB cap).
    audio: z.string().regex(audioDataUrlPattern).max(12_000_000).optional(),
  })
  .refine(
    (input) =>
      input.text.length > 0 ||
      (input.images?.length ?? 0) > 0 ||
      Boolean(input.audio),
    { message: "A message needs text, an image, or audio" },
  );

export const createChatSchema = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  model: z.string().trim().min(1).optional(),
});

export const renameChatSchema = z.object({
  title: z.string().trim().min(1).max(120),
});

const eventBaseSchema = z.object({
  id: z.string(),
  chatId: z.string(),
  messageId: z.string(),
  createdAt: z.string(),
  model: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const messageEventSchema = z.discriminatedUnion("type", [
  eventBaseSchema.extend({
    type: z.literal("message.created"),
    role: z.enum(["user", "assistant"]),
    text: z.string(),
    images: z.array(messageImageSchema).optional(),
    audio: messageAudioSchema.optional(),
  }),
  eventBaseSchema.extend({
    type: z.literal("message.delta"),
    role: z.literal("assistant"),
    text: z.string(),
  }),
  // A generated image, appended as its own event when the model emits one
  // mid-stream — durable like every text delta.
  eventBaseSchema.extend({
    type: z.literal("message.image"),
    role: z.literal("assistant"),
    image: messageImageSchema,
  }),
  // A chunk of spoken audio (base64 PCM16) from an audio-output model —
  // the audio equivalent of message.delta. The client plays these as they
  // arrive; once the answer completes, the assembled WAV is stored and
  // referenced by a message.audio event, which replay uses instead.
  eventBaseSchema.extend({
    type: z.literal("message.audio.delta"),
    role: z.literal("assistant"),
    audio: z.string(),
  }),
  eventBaseSchema.extend({
    type: z.literal("message.audio"),
    role: z.literal("assistant"),
    audio: messageAudioSchema,
  }),
  eventBaseSchema.extend({
    type: z.literal("message.completed"),
    role: z.literal("assistant"),
    finishReason: z.string().nullable().optional(),
    usage: z.unknown().optional(),
  }),
  eventBaseSchema.extend({
    type: z.literal("message.error"),
    role: z.literal("assistant"),
    error: z.string(),
  }),
]);

export type MessageEvent = z.infer<typeof messageEventSchema>;

// A MessageEvent before the server stamps `id` and `createdAt`. The
// conditional type distributes over the union so each variant loses the
// stamped fields individually.
export type MessageEventInput = MessageEvent extends infer Event
  ? Event extends MessageEvent
    ? Omit<Event, "id" | "createdAt">
    : never
  : never;

export const usageSummarySchema = z.object({
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  costMicroUsd: z.number().int().nonnegative(),
});

export type UsageSummary = z.infer<typeof usageSummarySchema>;

export type UsageDto =
  | {
      isAnonymous: true;
      spentMicroUsd: number;
      limitMicroUsd: number;
    }
  | {
      isAnonymous: false;
      spentMicroUsd: number;
      grantedMicroUsd: number;
      balanceMicroUsd: number;
      /** ISO date when the free top-up unlocks; null unless at $0. */
      freeTopupAt: string | null;
    };

export const topupCheckoutSchema = z.object({
  amountUsd: z.number().int().positive(),
});

export type ConfigDto = {
  socialProviders: Array<string>;
  billingEnabled: boolean;
};

export type ChatMessage = {
  id: string;
  chatId: string;
  role: "user" | "assistant";
  text: string;
  images?: Array<MessageImage> | undefined;
  audio?: MessageAudio | undefined;
  /** True while spoken audio is streaming live (before the WAV is stored). */
  audioLive?: boolean | undefined;
  status: "streaming" | "completed" | "error";
  model?: string | undefined;
  error?: string | undefined;
  usage?: UsageSummary | undefined;
  createdAt: string;
  updatedAt: string;
};

export type StreamCheckpoint = {
  chatId: string;
  offset: string;
  updatedAt: string;
};
