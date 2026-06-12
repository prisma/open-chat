// TanStack DB is the only state layer in the browser. Server-backed data
// (chats, models, usage) lives in query collections; messages and stream
// checkpoints are local-only collections fed by the durable event stream;
// all remaining UI state is a single local row in uiCollection.
import { createCollection, localOnlyCollectionOptions } from "@tanstack/db";
import { QueryClient } from "@tanstack/query-core";
import { queryCollectionOptions } from "@tanstack/query-db-collection";
import type {
  ChatDto,
  ChatMessage,
  ConfigDto,
  ModelDto,
  StreamCheckpoint,
  UsageDto,
} from "../shared/contracts";
import { api } from "./api";

export type UiState = {
  id: "app";
  selectedChatId: string;
  composerText: string;
  chatSearch: string;
  modelSearch: string;
  /** Capability filter in the model picker. */
  modelFilter: "all" | "vision" | "image-out";
  selectedModel: string;
  modelPickerOpen: boolean;
  /** Pending attachments (data URLs) for the next message. */
  composerImages: Array<string>;
  sidebarOpen: boolean;
  authMode: "sign-in" | "sign-up";
  showAuthScreen: boolean;
  topupOpen: boolean;
  billingNotice?: string | undefined;
  isSigningOut: boolean;
  streamStatus: "idle" | "connecting" | "live" | "complete" | "error";
  streamError?: string | undefined;
  sendError?: string | undefined;
  editingChatId?: string | undefined;
  editingTitle: string;
  targetMessageId?: string | undefined;
};

export const queryClient = new QueryClient();

export const chatsCollection = createCollection(
  queryCollectionOptions<ChatDto>({
    id: "chats",
    queryClient,
    queryKey: ["chats"],
    queryFn: api.chats.list,
    staleTime: 5_000,
    getKey: (chat): string => chat.id,
  }),
);

export const modelsCollection = createCollection(
  queryCollectionOptions<ModelDto>({
    id: "models",
    queryClient,
    queryKey: ["models"],
    queryFn: api.models.list,
    staleTime: 60_000,
    retry: 1,
    getKey: (model): string => model.id,
  }),
);

export const usageCollection = createCollection(
  queryCollectionOptions<UsageDto & { id: "usage" }>({
    id: "usage",
    queryClient,
    queryKey: ["usage"],
    queryFn: async () => [{ id: "usage" as const, ...(await api.usage.get()) }],
    staleTime: 5_000,
    retry: 1,
    getKey: (usage): string => usage.id,
  }),
);

export const configCollection = createCollection(
  queryCollectionOptions<ConfigDto & { id: "config" }>({
    id: "config",
    queryClient,
    queryKey: ["config"],
    queryFn: async () => [
      { id: "config" as const, ...(await api.config.get()) },
    ],
    staleTime: Infinity,
    retry: 1,
    getKey: (config): string => config.id,
  }),
);

export const messagesCollection = createCollection(
  localOnlyCollectionOptions<ChatMessage, string>({
    id: "messages",
    getKey: (message): string => message.id,
  }),
);

export const checkpointsCollection = createCollection(
  localOnlyCollectionOptions<StreamCheckpoint, string>({
    id: "checkpoints",
    getKey: (checkpoint): string => checkpoint.chatId,
  }),
);

const initialUiState: UiState = {
  id: "app",
  selectedChatId: "",
  composerText: "",
  chatSearch: "",
  modelSearch: "",
  modelFilter: "all",
  selectedModel: "openai/gpt-4.1-mini",
  modelPickerOpen: false,
  composerImages: [],
  sidebarOpen: false,
  authMode: "sign-in",
  showAuthScreen: false,
  topupOpen: false,
  isSigningOut: false,
  streamStatus: "idle",
  editingTitle: "",
};

export const uiCollection = createCollection(
  localOnlyCollectionOptions<UiState, "app">({
    id: "ui",
    getKey: (state): "app" => state.id,
    initialData: [initialUiState],
  }),
);

export function appState() {
  const state = uiCollection.get("app");
  if (!state) throw new Error("UI state is not ready");
  return state;
}

export function updateUi(mutator: (state: UiState) => void) {
  uiCollection.update("app", mutator);
}

export function upsertMessage(message: ChatMessage) {
  if (messagesCollection.has(message.id)) {
    messagesCollection.update(message.id, (draft) => {
      Object.assign(draft, message);
    });
  } else {
    messagesCollection.insert(message);
  }
}

export function upsertCheckpoint(checkpoint: StreamCheckpoint) {
  if (checkpointsCollection.has(checkpoint.chatId)) {
    checkpointsCollection.update(checkpoint.chatId, (draft) => {
      Object.assign(draft, checkpoint);
    });
  } else {
    checkpointsCollection.insert(checkpoint);
  }
}

export function resetClientState() {
  for (const key of messagesCollection.keys()) messagesCollection.delete(key);
  for (const key of checkpointsCollection.keys()) {
    checkpointsCollection.delete(key);
  }

  // The chats/usage caches belong to the previous identity; drop them so a
  // stale chat is never auto-loaded across an auth transition, and clear any
  // permalink pointing into the previous user's data.
  for (const key of [...chatsCollection.keys()]) {
    chatsCollection.utils.writeDelete(key);
  }
  void chatsCollection.utils.refetch().catch(() => undefined);
  void usageCollection.utils.refetch().catch(() => undefined);
  if (window.location.hash) {
    window.history.replaceState(null, "", window.location.pathname);
  }
  updateUi((state) => {
    state.selectedChatId = "";
    state.composerText = "";
    state.chatSearch = "";
    state.modelSearch = "";
    state.selectedModel = "openai/gpt-4.1-mini";
    state.modelPickerOpen = false;
    state.sidebarOpen = false;
    state.authMode = "sign-in";
    state.showAuthScreen = false;
    state.topupOpen = false;
    state.billingNotice = undefined;
    state.isSigningOut = false;
    state.streamStatus = "idle";
    state.streamError = undefined;
    state.sendError = undefined;
    state.editingChatId = undefined;
    state.editingTitle = "";
    state.targetMessageId = undefined;
  });
}
