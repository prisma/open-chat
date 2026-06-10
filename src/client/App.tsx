import {
  AlertCircle,
  ArrowUp,
  Check,
  ChevronDown,
  Copy,
  LogOut,
  Menu,
  Pencil,
  Plus,
  Search,
  Trash2,
  X,
  Zap,
} from "lucide-react";
import {
  type FormEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useLiveQuery } from "@tanstack/react-db";
import type { ChatDto, ChatMessage, ModelDto } from "../shared/contracts";
import { api } from "./api";
import { authClient } from "./auth-client";
import {
  appState,
  chatsCollection,
  checkpointsCollection,
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

const timeFormat = new Intl.DateTimeFormat(undefined, {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

function formatTime(iso: string) {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : timeFormat.format(date);
}

function modelShortName(modelId: string) {
  return modelId.split("/").pop() ?? modelId;
}

function initialsOf(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? "?";
  const second = parts[1]?.[0] ?? "";
  return (first + second).toUpperCase();
}

function groupChats(chats: Array<ChatDto>) {
  const groups: Array<{ label: string; chats: Array<ChatDto> }> = [];
  const now = new Date();
  const today = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
  ).getTime();
  const day = 86_400_000;

  for (const chat of chats) {
    const time = new Date(chat.updatedAt).getTime();
    const label =
      time >= today
        ? "Today"
        : time >= today - day
          ? "Yesterday"
          : time >= today - 6 * day
            ? "Previous 7 days"
            : "Older";
    const last = groups[groups.length - 1];
    if (last && last.label === label) {
      last.chats.push(chat);
    } else {
      groups.push({ label, chats: [chat] });
    }
  }

  return groups;
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
        <div className="wordmark-glyph">
          <Zap size={17} aria-hidden />
        </div>
        <h1 id="auth-title">Open Chat</h1>
        <p>Durable chats, streamed live and replayed on demand.</p>
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

function ChatRow({ chat, ui }: { chat: ChatDto; ui: UiState }) {
  const selected = chat.id === ui.selectedChatId;
  const editing = chat.id === ui.editingChatId;

  async function renameChat(title: string) {
    const updated = await api.chats.rename(chat.id, title);
    chatsCollection.utils.writeUpsert(updated);
    updateUi((state) => {
      state.editingChatId = undefined;
      state.editingTitle = "";
    });
  }

  async function deleteChat() {
    await api.chats.delete(chat.id);
    chatsCollection.utils.writeDelete(chat.id);
    if (ui.selectedChatId === chat.id) {
      stopChatStream();
      updateUi((state) => {
        state.selectedChatId = "";
      });
    }
  }

  if (editing) {
    return (
      <div className={cx("chat-row", selected && "selected")}>
        <form
          className="rename-form"
          onSubmit={(event) => {
            event.preventDefault();
            void renameChat(ui.editingTitle.trim() || chat.title).catch(
              reportClientError,
            );
          }}
        >
          <input
            value={ui.editingTitle}
            autoFocus
            onChange={(event) =>
              updateUi((state) => {
                state.editingTitle = event.target.value;
              })
            }
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                updateUi((state) => {
                  state.editingChatId = undefined;
                  state.editingTitle = "";
                });
              }
            }}
            aria-label="Chat title"
          />
          <button className="icon-button" type="submit" aria-label="Save title">
            <Check size={15} aria-hidden />
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className={cx("chat-row", selected && "selected")}>
      <button
        className="chat-select"
        type="button"
        onClick={() => {
          updateUi((state) => {
            state.sidebarOpen = false;
          });
          void loadChat(chat.id).catch(reportClientError);
        }}
      >
        {chat.title}
      </button>
      <div className="row-actions">
        <button
          className="icon-button"
          type="button"
          aria-label="Rename chat"
          onClick={() =>
            updateUi((state) => {
              state.editingChatId = chat.id;
              state.editingTitle = chat.title;
            })
          }
        >
          <Pencil size={14} aria-hidden />
        </button>
        <button
          className="icon-button danger"
          type="button"
          aria-label="Delete chat"
          onClick={() => {
            void deleteChat().catch(reportClientError);
          }}
        >
          <Trash2 size={14} aria-hidden />
        </button>
      </div>
    </div>
  );
}

function Sidebar({
  chats,
  ui,
  userName,
  searchRef,
}: {
  chats: Array<ChatDto>;
  ui: UiState;
  userName: string;
  searchRef: React.RefObject<HTMLInputElement | null>;
}) {
  const query = ui.chatSearch.trim().toLowerCase();
  const visible = query
    ? chats.filter((chat) => chat.title.toLowerCase().includes(query))
    : chats;
  const groups = groupChats(visible);

  function signOut() {
    pauseProtectedLoads();
    stopChatStream();
    void authClient.signOut().catch((error) => {
      protectedLoadsPaused = false;
      reportClientError(error);
    });
  }

  return (
    <aside className={cx("sidebar", ui.sidebarOpen && "open")}>
      <div className="sidebar-head">
        <div className="wordmark">
          <span className="wordmark-glyph">
            <Zap size={13} aria-hidden />
          </span>
          Open Chat
        </div>
        <button
          className="icon-button"
          type="button"
          aria-label="New chat"
          onClick={() => {
            void createChat(ui.selectedModel).catch(reportClientError);
          }}
        >
          <Plus size={17} aria-hidden />
        </button>
      </div>
      <div className="sidebar-search">
        <Search size={14} aria-hidden />
        <input
          ref={searchRef}
          value={ui.chatSearch}
          placeholder="Search"
          aria-label="Search chats"
          onChange={(event) =>
            updateUi((state) => {
              state.chatSearch = event.target.value;
            })
          }
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              updateUi((state) => {
                state.chatSearch = "";
              });
              event.currentTarget.blur();
            }
          }}
        />
        <span className="kbd" aria-hidden>
          ⌘K
        </span>
      </div>
      <nav className="chat-list" aria-label="Chats">
        {groups.length ? (
          groups.map((group) => (
            <div key={group.label}>
              <div className="chat-group-label">{group.label}</div>
              {group.chats.map((chat) => (
                <ChatRow chat={chat} ui={ui} key={chat.id} />
              ))}
            </div>
          ))
        ) : (
          <div className="empty-sidebar">
            {query ? "No chats match your search." : "No chats yet."}
          </div>
        )}
      </nav>
      <div className="account-row">
        <span className="avatar" aria-hidden>
          {initialsOf(userName)}
        </span>
        <span className="account-name">{userName}</span>
        <div className="row-actions">
          <button
            className="icon-button"
            type="button"
            aria-label="Sign out"
            onClick={signOut}
          >
            <LogOut size={15} aria-hidden />
          </button>
        </div>
      </div>
    </aside>
  );
}

function MessageView({
  message,
  offsetLabel,
}: {
  message: ChatMessage;
  offsetLabel: string | undefined;
}) {
  const [copied, setCopied] = useState(false);

  function copyText() {
    void navigator.clipboard
      .writeText(message.text)
      .then(() => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => undefined);
  }

  if (message.role === "user") {
    return (
      <article className="msg user">
        <div className="msg-col">
          <div className="bubble">{message.text}</div>
          <div className="msg-meta mono">{formatTime(message.createdAt)}</div>
        </div>
      </article>
    );
  }

  const streaming = message.status === "streaming";

  return (
    <article className="msg assistant">
      <span
        className={cx("msg-dot", streaming && "streaming")}
        aria-hidden
      />
      <div className="msg-col">
        {message.text || streaming ? (
          <div className="msg-text">
            {message.text}
            {streaming ? <span className="caret" aria-hidden /> : null}
          </div>
        ) : null}
        {message.status === "error" ? (
          <div className="msg-error" role="alert">
            <AlertCircle size={14} aria-hidden />
            {message.error ?? "The model call failed."}
          </div>
        ) : null}
        {message.status === "completed" ? (
          <div className="msg-meta">
            <span
              className="mono"
              title={offsetLabel ? `Durable · offset ${offsetLabel}` : "Durable"}
            >
              {formatTime(message.createdAt)} · ✓
            </span>
            <button
              className="icon-button"
              type="button"
              aria-label="Copy message"
              onClick={copyText}
            >
              {copied ? (
                <Check size={13} aria-hidden />
              ) : (
                <Copy size={13} aria-hidden />
              )}
            </button>
          </div>
        ) : null}
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
  const { data: checkpoints } = useLiveQuery(checkpointsCollection);
  const listRef = useRef<HTMLElement | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);
  const shouldStickRef = useRef(true);

  const offsetLabel = selectedChat
    ? checkpoints.find((checkpoint) => checkpoint.chatId === selectedChat.id)
        ?.offset
    : undefined;

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
        <span className="wordmark-glyph">
          <Zap size={17} aria-hidden />
        </span>
        <h2>Start a conversation</h2>
        <p>
          Every message becomes a durable event — close the tab, come back,
          and the chat replays exactly where it left off.
        </p>
      </section>
    );
  }

  if (!messages.length) {
    return (
      <section className="empty-main">
        <h2>{selectedChat.title}</h2>
        <p>Send the first message to start this chat's event log.</p>
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
      <div className="transcript-inner">
        {messages.map((message) => (
          <MessageView
            message={message}
            offsetLabel={offsetLabel}
            key={message.id}
          />
        ))}
        <div ref={endRef} />
      </div>
    </section>
  );
}

function ModelPopover({
  models,
  ui,
}: {
  models: Array<ModelDto>;
  ui: UiState;
}) {
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);

  const filtered = useMemo(() => {
    const query = ui.modelSearch.trim().toLowerCase();
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
  }, [models, ui.modelSearch]);

  useEffect(() => {
    searchRef.current?.focus();

    function onPointerDown(event: PointerEvent) {
      if (!popoverRef.current?.contains(event.target as Node)) {
        updateUi((state) => {
          state.modelPickerOpen = false;
        });
      }
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        updateUi((state) => {
          state.modelPickerOpen = false;
        });
      }
    }

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  return (
    <div className="model-popover" ref={popoverRef} role="dialog" aria-label="Choose a model">
      <div className="popover-search">
        <Search size={13} aria-hidden />
        <input
          ref={searchRef}
          value={ui.modelSearch}
          placeholder="Search models"
          onChange={(event) =>
            updateUi((state) => {
              state.modelSearch = event.target.value;
            })
          }
        />
      </div>
      <div className="model-list">
        {filtered.length ? (
          filtered.map((model) => (
            <button
              className="model-option"
              type="button"
              key={model.id}
              onClick={() =>
                updateUi((state) => {
                  state.selectedModel = model.id;
                  state.modelPickerOpen = false;
                })
              }
            >
              <span className="model-name">{model.name}</span>
              {model.id === ui.selectedModel ? (
                <Check className="selected-check" size={14} aria-hidden />
              ) : (
                <span className="model-id">{modelShortName(model.id)}</span>
              )}
            </button>
          ))
        ) : (
          <div className="model-empty">No models match your search.</div>
        )}
      </div>
    </div>
  );
}

function Composer({
  selectedChat,
  models,
  ui,
}: {
  selectedChat: ChatDto | undefined;
  models: Array<ModelDto>;
  ui: UiState;
}) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;
  }, [ui.composerText]);

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
    <div className="composer-area">
      <form className="composer" onSubmit={submit}>
        {ui.modelPickerOpen ? <ModelPopover models={models} ui={ui} /> : null}
        <textarea
          ref={textareaRef}
          value={ui.composerText}
          rows={1}
          placeholder="Ask anything"
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
        <div className="composer-foot">
          <button
            className="model-chip"
            type="button"
            aria-haspopup="dialog"
            aria-expanded={ui.modelPickerOpen}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() =>
              updateUi((state) => {
                state.modelPickerOpen = !state.modelPickerOpen;
              })
            }
          >
            <span>{modelShortName(ui.selectedModel)}</span>
            <ChevronDown size={12} aria-hidden />
          </button>
          <button
            className="send-button"
            type="submit"
            aria-label="Send message"
            disabled={!ui.composerText.trim()}
          >
            <ArrowUp size={16} aria-hidden />
          </button>
        </div>
      </form>
    </div>
  );
}

function AuthenticatedChatApp({ userName }: { userName: string }) {
  const { data: chatsData } = useLiveQuery(chatsCollection);
  const { data: modelsData } = useLiveQuery(modelsCollection);
  const { data: uiData } = useLiveQuery(uiCollection);
  const { data: messageData } = useLiveQuery(messagesCollection);
  const ui: UiState = uiData[0] ?? appState();
  const searchRef = useRef<HTMLInputElement | null>(null);
  const chats = [...chatsData].sort((a, b) =>
    b.updatedAt.localeCompare(a.updatedAt),
  );
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

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        updateUi((state) => {
          state.sidebarOpen = true;
        });
        window.requestAnimationFrame(() => searchRef.current?.focus());
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const showStreamPill =
    ui.streamStatus === "error" || ui.streamStatus === "connecting";

  return (
    <main className="app-shell">
      <Sidebar chats={chats} ui={ui} userName={userName} searchRef={searchRef} />
      <div
        className={cx("sidebar-backdrop", ui.sidebarOpen && "open")}
        onClick={() =>
          updateUi((state) => {
            state.sidebarOpen = false;
          })
        }
        aria-hidden
      />
      <section className="workspace">
        <header className="topbar">
          <button
            className="icon-button menu-button"
            type="button"
            aria-label="Open sidebar"
            onClick={() =>
              updateUi((state) => {
                state.sidebarOpen = true;
              })
            }
          >
            <Menu size={18} aria-hidden />
          </button>
          <div className="chat-heading">
            {selectedChat?.title ?? "Open Chat"}
          </div>
          {showStreamPill ? (
            <div
              className={cx(
                "stream-pill",
                ui.streamStatus === "error" && "error",
              )}
              title={ui.streamError}
            >
              {ui.streamStatus === "error" ? (
                <>
                  <AlertCircle size={13} aria-hidden />
                  {ui.streamError ?? "Stream error"}
                </>
              ) : (
                "Reconnecting…"
              )}
            </div>
          ) : null}
        </header>
        <Transcript messages={messages} selectedChat={selectedChat} />
        <Composer selectedChat={selectedChat} models={modelsData} ui={ui} />
      </section>
    </main>
  );
}

export function App() {
  const session = authClient.useSession();
  const userId = session.data?.user.id ?? "";
  const userName = session.data?.user.name || "Account";

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

  return <AuthenticatedChatApp userName={userName} />;
}
