// Folds the durable event log into per-message rows. The server (history
// endpoint) and the client (live SSE feed) share this logic, so a replayed
// chat and a live-streamed chat always materialize identically.
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
        images: event.images,
        audio: event.audio,
        status: event.role === "assistant" ? "streaming" : "completed",
      });
      return;
    }
    case "message.delta": {
      messages.set(event.messageId, {
        ...base,
        role: "assistant",
        text: `${existing?.text ?? ""}${event.text}`,
        images: existing?.images,
        audio: existing?.audio,
        audioLive: existing?.audioLive,
        status: "streaming",
      });
      return;
    }
    // Chunk payloads are not kept on the message — live playback consumes
    // them straight off the SSE feed; replay uses the stored WAV instead.
    case "message.audio.delta": {
      messages.set(event.messageId, {
        ...base,
        role: "assistant",
        text: existing?.text ?? "",
        images: existing?.images,
        audio: existing?.audio,
        audioLive: true,
        status: "streaming",
      });
      return;
    }
    case "message.audio": {
      messages.set(event.messageId, {
        ...base,
        role: "assistant",
        text: existing?.text ?? "",
        images: existing?.images,
        audio: event.audio,
        status: existing?.status ?? "streaming",
      });
      return;
    }
    case "message.image": {
      messages.set(event.messageId, {
        ...base,
        role: "assistant",
        text: existing?.text ?? "",
        images: [...(existing?.images ?? []), event.image],
        audio: existing?.audio,
        audioLive: existing?.audioLive,
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
        images: existing?.images,
        audio: existing?.audio,
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
        images: existing?.images,
        audio: existing?.audio,
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

export const STALLED_AFTER_MS = 10 * 60 * 1000;

// A generation that dies with its server (deploy, crash) never appends a
// completed/error event, leaving the message "streaming" in the log
// forever. These are detected on history load and repaired with an error
// event. updatedAt is the last event's time, so an actively streaming
// generation is never flagged.
export function stalledMessages(messages: Array<ChatMessage>, nowMs: number) {
  return messages.filter(
    (message) =>
      message.role === "assistant" &&
      message.status === "streaming" &&
      nowMs - Date.parse(message.updatedAt) > STALLED_AFTER_MS,
  );
}

