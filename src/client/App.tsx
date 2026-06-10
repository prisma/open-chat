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
  UserRound,
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
  usageCollection,
} from "./db";
import { MessageMarkdown } from "./markdown";
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

function formatUsd(microUsd: number, decimals = 2) {
  return `$${(microUsd / 1_000_000).toFixed(decimals)}`;
}

function formatCost(microUsd: number) {
  const usd = microUsd / 1_000_000;
  if (usd >= 0.1) return `$${usd.toFixed(2)}`;
  return `$${usd.toFixed(4)}`;
}

function formatTokens(count: number) {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}k`;
  return String(count);
}

function fallbackCopy(text: string) {
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.appendChild(area);
  area.focus();
  area.select();
  let copied = false;
  try {
    copied = document.execCommand("copy");
  } catch {
    copied = false;
  }
  area.remove();
  return copied;
}

async function copyToClipboard(text: string) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Clipboard API unavailable or denied; try the legacy path.
  }
  return fallbackCopy(text);
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

function chatPermalink(chatId: string) {
  return `#/chat/${chatId}`;
}

function messagePermalink(chatId: string, messageId: string) {
  return `#/chat/${chatId}/message/${messageId}`;
}

function parseHashLocation():
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

function AuthView({ onCancel }: { onCancel?: (() => void) | undefined }) {
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") ?? "");
    const password = String(form.get("password") ?? "");
    await authClient.signIn.email({ email, password });
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
          <label>
            Email
            <input name="email" type="email" autoComplete="email" required />
          </label>
          <label>
            Password
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              minLength={8}
              required
            />
          </label>
          <button className="button primary" type="submit">
            Sign in
          </button>
        </form>
        {onCancel ? (
          <button className="text-button" type="button" onClick={onCancel}>
            Continue as guest
          </button>
        ) : null}
      </section>
    </main>
  );
}

function UsageMeter() {
  const { data } = useLiveQuery(usageCollection);
  const usage = data[0];
  if (!usage) return null;

  const ratio = usage.limitMicroUsd
    ? usage.spentMicroUsd / usage.limitMicroUsd
    : 0;
  const percent = Math.min(100, Math.round(ratio * 100));
  const scope = usage.isAnonymous ? "guest budget" : "this month";

  return (
    <div
      className="usage-meter"
      title={`${formatCost(usage.spentMicroUsd)} of ${formatUsd(usage.limitMicroUsd)} used (${scope})`}
    >
      <div className="usage-bar" role="presentation">
        <span
          className={cx(
            "usage-fill",
            ratio >= 1 ? "full" : ratio >= 0.8 && "warn",
          )}
          style={{ width: `${percent}%` }}
        />
      </div>
      <div className="usage-text mono">
        {formatCost(usage.spentMicroUsd)} / {formatUsd(usage.limitMicroUsd)}
        <span className="usage-scope"> · {scope}</span>
      </div>
    </div>
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
  isAnonymous,
  searchRef,
}: {
  chats: Array<ChatDto>;
  ui: UiState;
  userName: string;
  isAnonymous: boolean;
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
      <UsageMeter />
      {isAnonymous ? (
        <div className="account-row">
          <span className="avatar" aria-hidden>
            <UserRound size={14} aria-hidden />
          </span>
          <span className="account-name">Guest</span>
          <button
            className="sign-in-button"
            type="button"
            onClick={() =>
              updateUi((state) => {
                state.showAuthScreen = true;
              })
            }
          >
            Sign in
          </button>
        </div>
      ) : (
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
      )}
    </aside>
  );
}

function MessageView({
  message,
  offsetLabel,
  highlighted,
}: {
  message: ChatMessage;
  offsetLabel: string | undefined;
  highlighted: boolean;
}) {
  const [copied, setCopied] = useState(false);

  async function copyText() {
    const copiedOk = await copyToClipboard(message.text);
    if (copiedOk) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    }
  }

  const timeLink = (
    <a
      className="mono time-link"
      href={messagePermalink(message.chatId, message.id)}
      title="Link to this message"
    >
      {formatTime(message.createdAt)}
    </a>
  );

  if (message.role === "user") {
    return (
      <article className={cx("msg user", highlighted && "flash")} id={message.id}>
        <div className="msg-col">
          <div className="bubble">{message.text}</div>
          <div className="msg-meta">{timeLink}</div>
        </div>
      </article>
    );
  }

  const streaming = message.status === "streaming";

  return (
    <article
      className={cx("msg assistant", highlighted && "flash")}
      id={message.id}
    >
      <span
        className={cx("msg-dot", streaming && "streaming")}
        aria-hidden
      />
      <div className="msg-col">
        {message.text || streaming ? (
          <div className="msg-text">
            <MessageMarkdown text={message.text} streaming={streaming} />
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
            {timeLink}
            {message.model ? (
              <span className="mono msg-model" title={message.model}>
                {modelShortName(message.model)}
              </span>
            ) : null}
            <span
              className="mono"
              title={offsetLabel ? `Durable · offset ${offsetLabel}` : "Durable"}
            >
              ✓
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

function ChatCost({ messages }: { messages: Array<ChatMessage> }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  const rows = useMemo(() => {
    const byModel = new Map<
      string,
      {
        model: string;
        inputTokens: number;
        outputTokens: number;
        costMicroUsd: number;
      }
    >();
    for (const message of messages) {
      if (message.role !== "assistant" || !message.usage) continue;
      const model = message.model ?? "unknown";
      const row = byModel.get(model) ?? {
        model,
        inputTokens: 0,
        outputTokens: 0,
        costMicroUsd: 0,
      };
      row.inputTokens += message.usage.inputTokens;
      row.outputTokens += message.usage.outputTokens;
      row.costMicroUsd += message.usage.costMicroUsd;
      byModel.set(model, row);
    }
    return [...byModel.values()].sort(
      (a, b) => b.costMicroUsd - a.costMicroUsd,
    );
  }, [messages]);

  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  if (!rows.length) return null;
  const total = rows.reduce((sum, row) => sum + row.costMicroUsd, 0);

  return (
    <div className="cost-root" ref={rootRef}>
      <button
        className="cost-chip mono"
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        title="Chat cost — click for the per-model breakdown"
        onClick={() => setOpen((value) => !value)}
      >
        {formatCost(total)}
      </button>
      {open ? (
        <div className="cost-popover" role="dialog" aria-label="Chat cost breakdown">
          {rows.map((row) => (
            <div className="cost-row" key={row.model}>
              <span className="cost-model">{modelShortName(row.model)}</span>
              <span className="cost-tokens mono">
                {formatTokens(row.inputTokens)} in ·{" "}
                {formatTokens(row.outputTokens)} out
              </span>
              <span className="cost-amount mono">
                {formatCost(row.costMicroUsd)}
              </span>
            </div>
          ))}
          <div className="cost-row total">
            <span className="cost-model">Total</span>
            <span className="cost-tokens mono">
              {formatTokens(rows.reduce((sum, row) => sum + row.inputTokens, 0))}{" "}
              in ·{" "}
              {formatTokens(
                rows.reduce((sum, row) => sum + row.outputTokens, 0),
              )}{" "}
              out
            </span>
            <span className="cost-amount mono">{formatCost(total)}</span>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Transcript({
  messages,
  selectedChat,
  targetMessageId,
}: {
  messages: Array<ChatMessage>;
  selectedChat: ChatDto | undefined;
  targetMessageId: string | undefined;
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
    shouldStickRef.current = !targetMessageId;
  }, [selectedChat?.id]);

  useEffect(() => {
    if (shouldStickRef.current && !targetMessageId) {
      endRef.current?.scrollIntoView({ block: "end" });
    }
  }, [messages, targetMessageId]);

  useEffect(() => {
    if (!targetMessageId) return;
    const element = document.getElementById(targetMessageId);
    if (!element) return;

    shouldStickRef.current = false;
    element.scrollIntoView({ block: "center" });
    const timer = window.setTimeout(() => {
      updateUi((state) => {
        state.targetMessageId = undefined;
      });
    }, 1800);
    return () => window.clearTimeout(timer);
  }, [targetMessageId, messages.length]);

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
            highlighted={message.id === targetMessageId}
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
  isAnonymous,
}: {
  selectedChat: ChatDto | undefined;
  models: Array<ModelDto>;
  ui: UiState;
  isAnonymous: boolean;
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
        state.sendError = undefined;
      });
      await api.chats.send(chat.id, {
        text,
        model: ui.selectedModel,
      });
      void chatsCollection.utils.refetch();
    } catch (error) {
      updateUi((state) => {
        state.sendError =
          error instanceof Error ? error.message : "Could not send message";
      });
      void usageCollection.utils.refetch().catch(() => undefined);
    }
  }

  return (
    <div className="composer-area">
      {ui.sendError ? (
        <div className="send-error" role="alert">
          <AlertCircle size={14} aria-hidden />
          <span>{ui.sendError}</span>
          {isAnonymous ? (
            <button
              className="sign-in-button"
              type="button"
              onClick={() =>
                updateUi((state) => {
                  state.showAuthScreen = true;
                })
              }
            >
              Sign in
            </button>
          ) : null}
        </div>
      ) : null}
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

function AuthenticatedChatApp({
  userName,
  isAnonymous,
}: {
  userName: string;
  isAnonymous: boolean;
}) {
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
    if (ui.isSigningOut || ui.selectedChatId || !chats.length) return;

    const target = parseHashLocation();
    const initial =
      (target && chats.find((chat) => chat.id === target.chatId)) ?? chats[0];
    if (!initial) return;

    if (target?.messageId && target.chatId === initial.id) {
      updateUi((state) => {
        state.targetMessageId = target.messageId;
      });
    }
    void loadChat(initial.id).catch(reportClientError);
  }, [chats, ui.isSigningOut, ui.selectedChatId]);

  useEffect(() => {
    function onHashChange() {
      const target = parseHashLocation();
      if (!target || !chatsCollection.get(target.chatId)) return;

      updateUi((state) => {
        state.targetMessageId = target.messageId;
      });
      if (appState().selectedChatId !== target.chatId) {
        void loadChat(target.chatId).catch(reportClientError);
      }
    }

    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

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
      <Sidebar
        chats={chats}
        ui={ui}
        userName={userName}
        isAnonymous={isAnonymous}
        searchRef={searchRef}
      />
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
          <ChatCost messages={messages} />
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
        <Transcript
          messages={messages}
          selectedChat={selectedChat}
          targetMessageId={ui.targetMessageId}
        />
        <Composer
          selectedChat={selectedChat}
          models={modelsData}
          ui={ui}
          isAnonymous={isAnonymous}
        />
      </section>
    </main>
  );
}

export function App() {
  const session = authClient.useSession();
  const { data: uiData } = useLiveQuery(uiCollection);
  const showAuthScreen = uiData[0]?.showAuthScreen ?? false;
  const [guestSignInFailed, setGuestSignInFailed] = useState(false);
  const guestSignInPending = useRef(false);
  const userId = session.data?.user.id ?? "";
  const userName = session.data?.user.name || "Account";
  const isAnonymous = Boolean(
    (session.data?.user as { isAnonymous?: boolean | null } | undefined)
      ?.isAnonymous,
  );

  useEffect(() => {
    stopChatStream();
    resetAfterAuthTransition();
  }, [userId]);

  // Signed-out visitors get an anonymous session automatically; the auth
  // screen is opt-in via the sidebar's sign-in button.
  useEffect(() => {
    if (session.isPending || session.data || guestSignInPending.current) {
      return;
    }
    guestSignInPending.current = true;
    void authClient.signIn
      .anonymous()
      .catch(() => setGuestSignInFailed(true))
      .finally(() => {
        guestSignInPending.current = false;
      });
  }, [session.isPending, session.data]);

  if (session.isPending) {
    return <main className="loading-screen">Loading session</main>;
  }

  if (!session.data) {
    return guestSignInFailed ? (
      <AuthView />
    ) : (
      <main className="loading-screen">Starting guest session</main>
    );
  }

  if (showAuthScreen && isAnonymous) {
    return (
      <AuthView
        onCancel={() =>
          updateUi((state) => {
            state.showAuthScreen = false;
          })
        }
      />
    );
  }

  return (
    <AuthenticatedChatApp userName={userName} isAnonymous={isAnonymous} />
  );
}
