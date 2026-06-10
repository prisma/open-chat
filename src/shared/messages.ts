import {
  type ChatMessage,
  type MessageEvent,
  usageSummarySchema,
} from "./contracts";

export function applyMessageEvent(
  messages: Map<string, ChatMessage>,
  event: MessageEvent,
) {
  const existing = messages.get(event.messageId);
  const createdAt = existing?.createdAt ?? event.createdAt;
  const base = {
    id: event.messageId,
    chatId: event.chatId,
    role: event.role,
    model: event.model ?? existing?.model,
    createdAt,
    updatedAt: event.createdAt,
  } as const;

  switch (event.type) {
    case "message.created": {
      messages.set(event.messageId, {
        ...base,
        text: event.text,
        status: event.role === "assistant" ? "streaming" : "completed",
      });
      return;
    }
    case "message.delta": {
      messages.set(event.messageId, {
        ...base,
        role: "assistant",
        text: `${existing?.text ?? ""}${event.text}`,
        status: "streaming",
      });
      return;
    }
    case "message.completed": {
      const usage = usageSummarySchema.safeParse(event.usage);
      messages.set(event.messageId, {
        ...base,
        role: "assistant",
        text: existing?.text ?? "",
        status: "completed",
        usage: usage.success ? usage.data : undefined,
      });
      return;
    }
    case "message.error": {
      messages.set(event.messageId, {
        ...base,
        role: "assistant",
        text: existing?.text ?? "",
        status: "error",
        error: event.error,
      });
      return;
    }
  }
}

export function materializeMessages(events: Array<MessageEvent>) {
  const messages = new Map<string, ChatMessage>();
  for (const event of events) {
    applyMessageEvent(messages, event);
  }

  return [...messages.values()].sort((a, b) =>
    a.createdAt.localeCompare(b.createdAt),
  );
}

