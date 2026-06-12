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

// Images travel inside the event log as data URLs, so a replayed chat is
// fully self-contained. The client downscales before sending; this cap is
// the server-side backstop (~2 MB of binary per image).
export const imageDataUrlSchema = z
  .string()
  .regex(/^data:image\/(png|jpeg|webp|gif);base64,/)
  .max(2_800_000);

export const sendMessageSchema = z
  .object({
    text: z.string().trim().max(24_000),
    model: z.string().trim().min(1).optional(),
    images: z.array(imageDataUrlSchema).max(4).optional(),
  })
  .refine((input) => input.text.length > 0 || (input.images?.length ?? 0) > 0, {
    message: "A message needs text or at least one image",
  });

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
    images: z.array(z.string()).optional(),
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
    image: z.string(),
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
  images?: Array<string> | undefined;
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
