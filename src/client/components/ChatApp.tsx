// The signed-in chat surface: sidebar + topbar + transcript + composer.
// Owns the app-level effects — initial chat selection from the URL hash,
// Stripe checkout return handling, the ⌘K search shortcut, and boot
// overlay dismissal once the chat list has synced.
import { AlertCircle, Menu } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useLiveQuery } from "@tanstack/react-db";
import type { ChatMessage } from "../../shared/contracts";
import { loadChat, parseHashLocation, reportClientError } from "../actions";
import { api } from "../api";
import { dismissBootScreen } from "../boot";
import {
  appState,
  chatsCollection,
  messagesCollection,
  modelsCollection,
  type UiState,
  uiCollection,
  updateUi,
  usageCollection,
} from "../db";
import {
  cx,
  formatCost,
  formatTokens,
  formatUsd,
  modelShortName,
} from "../format";
import { stopChatStream } from "../stream";
import { Composer } from "./Composer";
import { Sidebar } from "./Sidebar";
import { Transcript } from "./Transcript";
import { attachFiles } from "../attachments";

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

export function AuthenticatedChatApp({
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

  // Reveal the app only once the chat list has synced, so the boot overlay
  // lifts onto a populated screen instead of one that's still filling in.
  // The timeout cap keeps a slow request from holding the screen hostage;
  // the post-ready delay lets React paint the synced data first.
  useEffect(() => {
    const cap = setTimeout(dismissBootScreen, 2500);
    chatsCollection.onFirstReady(() => {
      clearTimeout(cap);
      setTimeout(dismissBootScreen, 50);
    });
    return () => clearTimeout(cap);
  }, []);
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

  // Returning from Stripe Checkout: confirm the session server-side, then
  // refresh the balance. The query parameters are stripped immediately so
  // a reload cannot replay the confirmation.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const billing = params.get("billing");
    if (!billing) return;

    const sessionId = params.get("session_id");
    window.history.replaceState(
      null,
      "",
      window.location.pathname + window.location.hash,
    );

    if (billing === "success" && sessionId) {
      void api.billing
        .confirm(sessionId)
        .then((result) => {
          updateUi((state) => {
            state.billingNotice = `Added ${formatUsd(result.creditMicroUsd)} in credit.`;
          });
          void usageCollection.utils.refetch().catch(() => undefined);
        })
        .catch(reportClientError);
    } else if (billing === "cancelled") {
      updateUi((state) => {
        state.billingNotice = "Top-up cancelled — nothing was charged.";
      });
    }

    const timer = window.setTimeout(() => {
      updateUi((state) => {
        state.billingNotice = undefined;
      });
    }, 8000);
    return () => window.clearTimeout(timer);
  }, []);

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

  const [dropping, setDropping] = useState(false);

  return (
    <main
      className="app-shell"
      onDragOver={(event) => {
        if (![...event.dataTransfer.items].some((i) => i.kind === "file")) {
          return;
        }
        event.preventDefault();
        setDropping(true);
      }}
      onDragLeave={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node)) return;
        setDropping(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        setDropping(false);
        void attachFiles(event.dataTransfer.files);
      }}
    >
      {dropping ? (
        <div className="drop-overlay" aria-hidden>
          Drop images or audio to attach
        </div>
      ) : null}
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
          models={modelsData}
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
