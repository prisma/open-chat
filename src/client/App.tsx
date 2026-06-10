import {
  AlertCircle,
  Check,
  LogOut,
  Menu,
  MessageSquare,
  Pencil,
  Plus,
  Search,
  Send,
  Sparkles,
  Trash2,
  Wifi,
  X,
} from "lucide-react";
import { type FormEvent, useEffect, useMemo, useRef } from "react";
import { useLiveQuery } from "@tanstack/react-db";
import type { ChatDto, ChatMessage, ModelDto } from "../shared/contracts";
import { api } from "./api";
import { authClient } from "./auth-client";
import {
  appState,
  chatsCollection,
  messagesCollection,
  modelsCollection,
  resetClientState,
  type UiState,
  uiCollection,
  updateUi,
  upsertMessage,
} from "./db";
import { startChatStream, stopChatStream } from "./stream";

function cx(...classes: Array<string | false | undefined>) {
  return classes.filter(Boolean).join(" ");
}

let protectedLoadsPaused = false;

function pauseProtectedLoads() {
  protectedLoadsPaused = true;
  updateUi((state) => {
    state.isSigningOut = true;
  });
}

function resetAfterAuthTransition() {
  protectedLoadsPaused = false;
  resetClientState();
}

function shouldSkipProtectedLoad() {
  return protectedLoadsPaused || appState().isSigningOut;
}

function reportClientError(error: unknown) {
  if (protectedLoadsPaused) return;

  updateUi((state) => {
    state.streamStatus = "error";
    state.streamError =
      error instanceof Error ? error.message : "Action failed";
  });
}

async function loadChat(chatId: string) {
  if (shouldSkipProtectedLoad()) return;

  const chat = chatsCollection.get(chatId);
  updateUi((state) => {
    state.selectedChatId = chatId;
    state.selectedModel = chat?.model ?? state.selectedModel;
    state.streamStatus = "connecting";
    state.streamError = undefined;
  });

  if (shouldSkipProtectedLoad()) return;
  const history = await api.chats.history(chatId);
  const state = appState();
  if (protectedLoadsPaused || state.isSigningOut || state.selectedChatId !== chatId) {
    return;
  }

  for (const message of history.messages) upsertMessage(message);
  startChatStream(chatId, history.offset);
}

async function createChat(model?: string) {
  const chat = await api.chats.create(model ? { model } : {});
  chatsCollection.utils.writeUpsert(chat);
  updateUi((state) => {
    state.selectedModel = chat.model;
    state.sidebarOpen = false;
  });
  await loadChat(chat.id);
  return chat;
}

function AuthView() {
  const { data } = useLiveQuery(uiCollection);
  const mode = data[0]?.authMode ?? "sign-in";
  const isSignUp = mode === "sign-up";

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") ?? "");
    const password = String(form.get("password") ?? "");
    const name = String(form.get("name") ?? "Open Chat User");

    if (isSignUp) {
      await authClient.signUp.email({ email, password, name });
    } else {
      await authClient.signIn.email({ email, password });
    }
  }

  return (
    <main className="auth-screen">
      <section className="auth-panel" aria-labelledby="auth-title">
        <div className="auth-mark">
          <Sparkles size={22} aria-hidden />
        </div>
        <h1 id="auth-title">Open Chat</h1>
        <p>
          A local durable-streaming chat client for OpenRouter and Prisma
          Streams.
        </p>
        <form className="auth-form" onSubmit={submit}>
          {isSignUp ? (
            <label>
              Name
              <input name="name" autoComplete="name" required />
            </label>
          ) : null}
          <label>
            Email
            <input name="email" type="email" autoComplete="email" required />
          </label>
          <label>
            Password
            <input
              name="password"
              type="password"
              autoComplete={isSignUp ? "new-password" : "current-password"}
              minLength={8}
              required
            />
          </label>
          <button className="button primary" type="submit">
            {isSignUp ? "Create account" : "Sign in"}
          </button>
        </form>
        <button
          className="text-button"
          type="button"
          onClick={() =>
            updateUi((state) => {
              state.authMode = isSignUp ? "sign-in" : "sign-up";
            })
          }
        >
          {isSignUp ? "Use an existing account" : "Create a local account"}
        </button>
      </section>
    </main>
  );
}

function Sidebar({
  chats,
  ui,
}: {
  chats: Array<ChatDto>;
  ui: UiState;
}) {
  async function renameChat(chatId: string, title: string) {
    const chat = await api.chats.rename(chatId, title);
    chatsCollection.utils.writeUpsert(chat);
    updateUi((state) => {
      state.editingChatId = undefined;
      state.editingTitle = "";
    });
  }

  async function deleteChat(chatId: string) {
    await api.chats.delete(chatId);
    chatsCollection.utils.writeDelete(chatId);
    if (ui.selectedChatId === chatId) {
      stopChatStream();
      updateUi((state) => {
        state.selectedChatId = "";
      });
    }
  }

  return (
    <aside className={cx("sidebar", ui.sidebarOpen && "open")}>
      <div className="sidebar-head">
        <div>
          <strong>Open Chat</strong>
          <span>Prisma Streams</span>
        </div>
        <button
          className="icon-button mobile-only"
          type="button"
          aria-label="Close sidebar"
          onClick={() =>
            updateUi((state) => {
              state.sidebarOpen = false;
            })
          }
        >
          <X size={18} aria-hidden />
        </button>
      </div>
      <button
        className="button primary new-chat"
        type="button"
        onClick={() => {
          void createChat(ui.selectedModel).catch(reportClientError);
        }}
      >
        <Plus size={17} aria-hidden />
        New chat
      </button>
      <nav className="chat-list" aria-label="Chats">
        {chats.length ? (
          chats.map((chat) => {
            const selected = chat.id === ui.selectedChatId;
            const editing = chat.id === ui.editingChatId;
            return (
              <div className={cx("chat-row", selected && "selected")} key={chat.id}>
                {editing ? (
                  <form
                    className="rename-form"
                    onSubmit={(event) => {
                      event.preventDefault();
                      renameChat(chat.id, ui.editingTitle.trim() || chat.title);
                    }}
                  >
                    <input
                      value={ui.editingTitle}
                      onChange={(event) =>
                        updateUi((state) => {
                          state.editingTitle = event.target.value;
                        })
                      }
                      aria-label="Chat title"
                    />
                    <button className="icon-button" type="submit" aria-label="Save title">
                      <Check size={16} aria-hidden />
                    </button>
                  </form>
                ) : (
                  <>
                    <button
                      className="chat-select"
                      type="button"
                      onClick={() => {
                        void loadChat(chat.id).catch(reportClientError);
                      }}
                    >
                      <MessageSquare size={16} aria-hidden />
                      <span>{chat.title}</span>
                    </button>
                    <button
                      className="icon-button ghost"
                      type="button"
                      aria-label="Rename chat"
                      onClick={() =>
                        updateUi((state) => {
                          state.editingChatId = chat.id;
                          state.editingTitle = chat.title;
                        })
                      }
                    >
                      <Pencil size={15} aria-hidden />
                    </button>
                    <button
                      className="icon-button ghost danger"
                      type="button"
                      aria-label="Delete chat"
                      onClick={() => deleteChat(chat.id)}
                    >
                      <Trash2 size={15} aria-hidden />
                    </button>
                  </>
                )}
              </div>
            );
          })
        ) : (
          <div className="empty-sidebar">Create a chat to start streaming.</div>
        )}
      </nav>
    </aside>
  );
}

function ModelPicker({
  models,
  selectedModel,
  search,
}: {
  models: Array<ModelDto>;
  selectedModel: string;
  search: string;
}) {
  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return models
      .filter((model) => {
        const textModel =
          model.inputModalities.includes("text") &&
          model.outputModalities.includes("text");
        const matches =
          !query ||
          model.id.toLowerCase().includes(query) ||
          model.name.toLowerCase().includes(query);
        return textModel && matches;
      })
      .slice(0, 80);
  }, [models, search]);

  return (
    <section className="model-panel" aria-labelledby="model-title">
      <div className="section-title" id="model-title">
        Model
      </div>
      <div className="search-box">
        <Search size={16} aria-hidden />
        <input
          value={search}
          placeholder="Search models"
          onChange={(event) =>
            updateUi((state) => {
              state.modelSearch = event.target.value;
            })
          }
        />
      </div>
      <div className="model-list">
        {filtered.map((model) => (
          <button
            className={cx("model-option", model.id === selectedModel && "selected")}
            type="button"
            key={model.id}
            onClick={() =>
              updateUi((state) => {
                state.selectedModel = model.id;
              })
            }
          >
            <span>{model.name}</span>
            <small>{model.id}</small>
          </button>
        ))}
      </div>
    </section>
  );
}

function MessageBubble({ message }: { message: ChatMessage }) {
  return (
    <article className={cx("message", message.role)}>
      <div className="message-meta">
        <span>{message.role === "user" ? "You" : "Assistant"}</span>
        {message.status === "streaming" ? <span>Streaming</span> : null}
        {message.status === "error" ? <span>Error</span> : null}
      </div>
      <div className="message-text">
        {message.text || message.error || "Waiting for model output"}
      </div>
    </article>
  );
}

function Transcript({
  messages,
  selectedChat,
}: {
  messages: Array<ChatMessage>;
  selectedChat: ChatDto | undefined;
}) {
  const listRef = useRef<HTMLElement | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);
  const shouldStickRef = useRef(true);

  useEffect(() => {
    shouldStickRef.current = true;
  }, [selectedChat?.id]);

  useEffect(() => {
    if (shouldStickRef.current) {
      endRef.current?.scrollIntoView({ block: "end" });
    }
  }, [messages]);

  function trackScroll() {
    const list = listRef.current;
    if (!list) return;
    shouldStickRef.current =
      list.scrollHeight - list.scrollTop - list.clientHeight < 96;
  }

  if (!selectedChat) {
    return (
      <section className="empty-main">
        <MessageSquare size={32} aria-hidden />
        <h2>Create or select a chat</h2>
        <p>Messages are replayed from Prisma Streams when a chat opens.</p>
      </section>
    );
  }

  if (!messages.length) {
    return (
      <section className="empty-main">
        <Sparkles size={32} aria-hidden />
        <h2>{selectedChat.title}</h2>
        <p>Send a message to append the first durable event.</p>
      </section>
    );
  }

  return (
    <section
      className="transcript"
      aria-label="Messages"
      ref={listRef}
      onScroll={trackScroll}
    >
      {messages.map((message) => (
        <MessageBubble message={message} key={message.id} />
      ))}
      <div ref={endRef} />
    </section>
  );
}

function StatusPill({
  status,
  error,
}: {
  status: UiState["streamStatus"];
  error: string | undefined;
}) {
  const label =
    status === "connecting"
      ? "Connecting"
      : status === "live"
        ? "Live"
        : status === "error"
          ? "Stream error"
          : status === "complete"
            ? "Synced"
            : "Idle";

  return (
    <div className={cx("status-pill", status)} title={error}>
      {status === "error" ? (
        <AlertCircle size={15} aria-hidden />
      ) : (
        <Wifi size={15} aria-hidden />
      )}
      {label}
    </div>
  );
}

function Composer({
  selectedChat,
  ui,
}: {
  selectedChat: ChatDto | undefined;
  ui: UiState;
}) {
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = ui.composerText.trim();
    if (!text) return;

    try {
      let chat = selectedChat;
      if (!chat) {
        chat = await createChat(ui.selectedModel);
      }

      updateUi((state) => {
        state.composerText = "";
        state.streamStatus = "connecting";
      });
      await api.chats.send(chat.id, {
        text,
        model: ui.selectedModel,
      });
      void chatsCollection.utils.refetch();
    } catch (error) {
      reportClientError(error);
    }
  }

  return (
    <form className="composer" onSubmit={submit}>
      <textarea
        value={ui.composerText}
        rows={2}
        placeholder={
          selectedChat
            ? "Ask this chat"
            : "Create a chat and ask the first question"
        }
        onChange={(event) =>
          updateUi((state) => {
            state.composerText = event.target.value;
          })
        }
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            event.currentTarget.form?.requestSubmit();
          }
        }}
      />
      <button
        className="button primary send-button"
        type="submit"
        disabled={!ui.composerText.trim()}
      >
        <Send size={17} aria-hidden />
        Send message
      </button>
    </form>
  );
}

function AuthenticatedChatApp() {
  const { data: chatsData } = useLiveQuery(chatsCollection);
  const { data: modelsData } = useLiveQuery(modelsCollection);
  const { data: uiData } = useLiveQuery(uiCollection);
  const { data: messageData } = useLiveQuery(messagesCollection);
  const ui: UiState = uiData[0] ?? appState();
  const chats = [...chatsData].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const selectedChat = chats.find((chat) => chat.id === ui.selectedChatId);
  const messages = [...messageData]
    .filter((message) => message.chatId === ui.selectedChatId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  useEffect(() => {
    if (!ui.isSigningOut && !ui.selectedChatId && chats[0]) {
      void loadChat(chats[0].id).catch(reportClientError);
    }
  }, [chats, ui.isSigningOut, ui.selectedChatId]);

  useEffect(() => stopChatStream, []);

  return (
    <main className="app-shell">
      <Sidebar chats={chats} ui={ui} />
      <section className="workspace">
        <header className="topbar">
          <button
            className="icon-button"
            type="button"
            aria-label="Open sidebar"
            onClick={() =>
              updateUi((state) => {
                state.sidebarOpen = true;
              })
            }
          >
            <Menu size={19} aria-hidden />
          </button>
          <div className="chat-heading">
            <strong>{selectedChat?.title ?? "No chat selected"}</strong>
            <span>{ui.selectedModel}</span>
          </div>
          <StatusPill status={ui.streamStatus} error={ui.streamError} />
          <button
            className="icon-button"
            type="button"
            aria-label="Sign out"
            onClick={() => {
              pauseProtectedLoads();
              stopChatStream();
              void authClient.signOut().catch((error) => {
                protectedLoadsPaused = false;
                reportClientError(error);
              });
            }}
          >
            <LogOut size={18} aria-hidden />
          </button>
        </header>
        <div className="content-grid">
          <div className="chat-surface">
            <Transcript messages={messages} selectedChat={selectedChat} />
            <Composer selectedChat={selectedChat} ui={ui} />
          </div>
          <ModelPicker
            models={modelsData}
            selectedModel={ui.selectedModel}
            search={ui.modelSearch}
          />
        </div>
      </section>
    </main>
  );
}

export function App() {
  const session = authClient.useSession();
  const userId = session.data?.user.id ?? "";

  useEffect(() => {
    stopChatStream();
    resetAfterAuthTransition();
  }, [userId]);

  if (session.isPending) {
    return <main className="loading-screen">Loading session</main>;
  }

  if (!session.data) {
    return <AuthView />;
  }

  return <AuthenticatedChatApp />;
}
