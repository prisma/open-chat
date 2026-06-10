import type { MessageEvent, StreamCheckpoint } from "../shared/contracts";
import { applyMessageEvent } from "../shared/messages";
import {
  messagesCollection,
  updateUi,
  upsertCheckpoint,
  upsertMessage,
} from "./db";

let source: EventSource | undefined;
let activeChatId = "";

function materializeEvent(event: MessageEvent) {
  const current = messagesCollection.get(event.messageId);
  const map = new Map(current ? [[current.id, current]] : []);
  applyMessageEvent(map, event);

  const next = map.get(event.messageId);
  if (next) upsertMessage(next);
}

export function stopChatStream() {
  source?.close();
  source = undefined;
  activeChatId = "";
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

  source = new EventSource(url);
  source.addEventListener("ready", () => {
    updateUi((state) => {
      state.streamStatus = "live";
    });
  });
  source.addEventListener("message", (event) => {
    materializeEvent(JSON.parse(event.data) as MessageEvent);
  });
  source.addEventListener("checkpoint", (event) => {
    const checkpoint = JSON.parse(event.data) as StreamCheckpoint;
    upsertCheckpoint(checkpoint);
    updateUi((state) => {
      state.streamStatus = "complete";
    });
  });
  source.addEventListener("error", (event) => {
    updateUi((state) => {
      state.streamStatus = "error";
      state.streamError = "Stream disconnected";
    });
  });
}
