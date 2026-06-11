// The app's imperative actions over the TanStack DB collections: opening
// and creating chats, hash permalinks, and the sign-out path that pauses
// protected loads so an auth transition can't race in-flight requests.
import { api } from "./api";
import { authClient } from "./auth-client";
import {
  appState,
  chatsCollection,
  resetClientState,
  updateUi,
  upsertMessage,
} from "./db";
import { startChatStream, stopChatStream } from "./stream";

function chatPermalink(chatId: string) {
  return `#/chat/${chatId}`;
}

export function messagePermalink(chatId: string, messageId: string) {
  return `#/chat/${chatId}/message/${messageId}`;
}

export function parseHashLocation():
  | { chatId: string; messageId: string | undefined }
  | undefined {
  const match = /^#\/chat\/([^/]+)(?:\/message\/([^/]+))?$/.exec(
    window.location.hash,
  );
  if (!match?.[1]) return undefined;
  return { chatId: match[1], messageId: match[2] };
}

let protectedLoadsPaused = false;

function pauseProtectedLoads() {
  protectedLoadsPaused = true;
  updateUi((state) => {
    state.isSigningOut = true;
  });
}

export function resetAfterAuthTransition() {
  protectedLoadsPaused = false;
  resetClientState();
}

function shouldSkipProtectedLoad() {
  return protectedLoadsPaused || appState().isSigningOut;
}

export function reportClientError(error: unknown) {
  if (protectedLoadsPaused) return;

  updateUi((state) => {
    state.streamStatus = "error";
    state.streamError =
      error instanceof Error ? error.message : "Action failed";
  });
}

export async function loadChat(chatId: string) {
  if (shouldSkipProtectedLoad()) return;

  const chat = chatsCollection.get(chatId);
  updateUi((state) => {
    state.selectedChatId = chatId;
    state.selectedModel = chat?.model ?? state.selectedModel;
    state.streamStatus = "connecting";
    state.streamError = undefined;
  });

  // Keep the URL addressing the open chat, but never clobber a message
  // permalink that points into it.
  if (parseHashLocation()?.chatId !== chatId) {
    window.history.replaceState(null, "", chatPermalink(chatId));
  }

  if (shouldSkipProtectedLoad()) return;
  const history = await api.chats.history(chatId);
  const state = appState();
  if (
    protectedLoadsPaused ||
    state.isSigningOut ||
    state.selectedChatId !== chatId
  ) {
    return;
  }

  for (const message of history.messages) upsertMessage(message);
  startChatStream(chatId, history.offset);
}

export async function createChat(model?: string) {
  const chat = await api.chats.create(model ? { model } : {});
  chatsCollection.utils.writeUpsert(chat);
  updateUi((state) => {
    state.selectedModel = chat.model;
    state.sidebarOpen = false;
  });
  await loadChat(chat.id);
  return chat;
}

export function signOut() {
  pauseProtectedLoads();
  stopChatStream();
  void authClient.signOut().catch((error) => {
    protectedLoadsPaused = false;
    reportClientError(error);
  });
}
