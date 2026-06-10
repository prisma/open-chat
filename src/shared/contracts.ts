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

export const sendMessageSchema = z.object({
  text: z.string().trim().min(1).max(24_000),
  model: z.string().trim().min(1).optional(),
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
  }),
  eventBaseSchema.extend({
    type: z.literal("message.delta"),
    role: z.literal("assistant"),
    text: z.string(),
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

export type ChatMessage = {
  id: string;
  chatId: string;
  role: "user" | "assistant";
  text: string;
  status: "streaming" | "completed" | "error";
  model?: string | undefined;
  error?: string | undefined;
  createdAt: string;
  updatedAt: string;
};

export type StreamCheckpoint = {
  chatId: string;
  offset: string;
  updatedAt: string;
};
