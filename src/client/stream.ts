import type {
  MessageEvent as DurableMessageEvent,
  StreamCheckpoint,
} from "../shared/contracts";
import { applyMessageEvent } from "../shared/messages";
import {
  messagesCollection,
  updateUi,
  upsertCheckpoint,
  upsertMessage,
} from "./db";

let source: EventSource | undefined;
let activeChatId = "";

function materializeEvent(event: DurableMessageEvent) {
  const current = messagesCollection.get(event.messageId);
  const map = new Map(current ? [[current.id, current]] : []);
  applyMessageEvent(map, event);

  const next = map.get(event.messageId);
  if (next) upsertMessage(next);
}

export function stopChatStream() {
  const current = source;
  source = undefined;
  activeChatId = "";
  current?.close();
}

export function startChatStream(chatId: string, offset: string) {
  if (activeChatId === chatId && source) return;

  stopChatStream();
  activeChatId = chatId;
  updateUi((state) => {
    state.streamStatus = "connecting";
    state.streamError = undefined;
  });

  const url = new URL(
    `/api/chats/${encodeURIComponent(chatId)}/events`,
    window.location.origin,
  );
  url.searchParams.set("offset", offset);

  const eventSource = new EventSource(url);
  source = eventSource;
  const isCurrent = () => source === eventSource && activeChatId === chatId;

  eventSource.addEventListener("ready", () => {
    if (!isCurrent()) return;
    updateUi((state) => {
      state.streamStatus = "live";
      state.streamError = undefined;
    });
  });
  eventSource.addEventListener("heartbeat", () => {
    if (!isCurrent()) return;
    updateUi((state) => {
      state.streamStatus = "live";
      state.streamError = undefined;
    });
  });
  eventSource.addEventListener("message", (event) => {
    if (!isCurrent()) return;
    materializeEvent(JSON.parse(event.data) as DurableMessageEvent);
  });
  eventSource.addEventListener("checkpoint", (event) => {
    if (!isCurrent()) return;
    const checkpoint = JSON.parse(event.data) as StreamCheckpoint;
    upsertCheckpoint(checkpoint);
    updateUi((state) => {
      state.streamStatus = "complete";
      state.streamError = undefined;
    });
  });
  eventSource.addEventListener("stream-error", (event) => {
    if (!isCurrent()) return;
    const payload = JSON.parse((event as globalThis.MessageEvent).data) as {
      message?: string;
    };
    updateUi((state) => {
      state.streamStatus = "error";
      state.streamError = payload.message ?? "Stream proxy failed";
    });
  });
  eventSource.addEventListener("error", () => {
    if (!isCurrent()) return;
    updateUi((state) => {
      state.streamStatus =
        eventSource.readyState === EventSource.CLOSED ? "error" : "connecting";
      state.streamError =
        eventSource.readyState === EventSource.CLOSED
          ? "Stream disconnected"
          : undefined;
    });
  });
}
