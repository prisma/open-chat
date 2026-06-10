import { createCollection, localOnlyCollectionOptions } from "@tanstack/db";
import { QueryClient } from "@tanstack/query-core";
import { queryCollectionOptions } from "@tanstack/query-db-collection";
import type {
  ChatDto,
  ChatMessage,
  ModelDto,
  StreamCheckpoint,
} from "../shared/contracts";
import { api } from "./api";

export type UiState = {
  id: "app";
  selectedChatId: string;
  composerText: string;
  modelSearch: string;
  selectedModel: string;
  sidebarOpen: boolean;
  authMode: "sign-in" | "sign-up";
  streamStatus: "idle" | "connecting" | "live" | "complete" | "error";
  streamError?: string | undefined;
  editingChatId?: string | undefined;
  editingTitle: string;
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
  modelSearch: "",
  selectedModel: "openai/gpt-4.1-mini",
  sidebarOpen: true,
  authMode: "sign-in",
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
