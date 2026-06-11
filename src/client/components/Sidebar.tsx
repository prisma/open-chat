// The sidebar: wordmark, chat search, the date-grouped chat list with
// rename/delete, the credit meter with Stripe top-ups, and the account
// row (guest or signed-in).
import {
  Check,
  LogOut,
  Pencil,
  Plus,
  Search,
  Trash2,
  UserRound,
} from "lucide-react";
import { useState } from "react";
import { useLiveQuery } from "@tanstack/react-db";
import type { ChatDto } from "../../shared/contracts";
import { createChat, loadChat, reportClientError, signOut } from "../actions";
import { api } from "../api";
import {
  chatsCollection,
  configCollection,
  type UiState,
  updateUi,
  usageCollection,
} from "../db";
import {
  TOPUP_FEE_PERCENT,
  TOPUP_OPTIONS_USD,
  quoteTopup,
} from "../../shared/billing";
import {
  cx,
  formatCost,
  formatDay,
  formatUsd,
  groupChats,
  initialsOf,
} from "../format";
import { stopChatStream } from "../stream";
import { LogoMark } from "./LogoMark";

function TopupPanel() {
  const [busy, setBusy] = useState(false);

  async function buy(amountUsd: (typeof TOPUP_OPTIONS_USD)[number]) {
    setBusy(true);
    try {
      const { url } = await api.billing.checkout(amountUsd);
      window.location.href = url;
    } catch (error) {
      setBusy(false);
      reportClientError(error);
    }
  }

  return (
    <div className="topup-panel" role="dialog" aria-label="Top up credits">
      {TOPUP_OPTIONS_USD.map((amountUsd) => {
        const quote = quoteTopup(amountUsd);
        return (
          <button
            className="topup-option"
            type="button"
            key={amountUsd}
            disabled={busy}
            onClick={() => void buy(amountUsd)}
          >
            <span className="topup-credit">
              +{formatUsd(quote.creditMicroUsd)} credit
            </span>
            <span className="topup-price mono">
              pay {formatUsd(quote.totalMicroUsd)}
            </span>
          </button>
        );
      })}
      <p className="topup-note">
        Prices include a {TOPUP_FEE_PERCENT}% fee that covers Stripe and
        OpenRouter costs.
      </p>
    </div>
  );
}

function UsageMeter({ ui }: { ui: UiState }) {
  const { data } = useLiveQuery(usageCollection);
  const { data: configData } = useLiveQuery(configCollection);
  const usage = data[0];
  if (!usage) return null;

  if (usage.isAnonymous) {
    const ratio = usage.limitMicroUsd
      ? usage.spentMicroUsd / usage.limitMicroUsd
      : 0;
    const percent = Math.min(100, Math.round(ratio * 100));

    return (
      <div
        className="usage-meter"
        title={`${formatCost(usage.spentMicroUsd)} of ${formatUsd(usage.limitMicroUsd)} used (guest budget)`}
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
          <span className="usage-scope"> · guest budget</span>
        </div>
      </div>
    );
  }

  const billingEnabled = configData[0]?.billingEnabled ?? false;
  const empty = usage.balanceMicroUsd <= 0;

  return (
    <div className="usage-meter">
      {ui.billingNotice ? (
        <div className="billing-notice">{ui.billingNotice}</div>
      ) : null}
      {ui.topupOpen ? <TopupPanel /> : null}
      <div className="usage-row">
        <div
          className={cx("usage-text mono", empty && "empty")}
          title={`${formatCost(usage.spentMicroUsd)} spent of ${formatUsd(usage.grantedMicroUsd)} total credit`}
        >
          {formatCost(Math.max(0, usage.balanceMicroUsd))}
          <span className="usage-scope"> credit</span>
        </div>
        {billingEnabled ? (
          <button
            className="topup-button"
            type="button"
            aria-expanded={ui.topupOpen}
            onClick={() =>
              updateUi((state) => {
                state.topupOpen = !state.topupOpen;
              })
            }
          >
            Top up
          </button>
        ) : null}
      </div>
      {empty && usage.freeTopupAt ? (
        <div className="usage-scope free-topup-note">
          Free $0.50 credit on {formatDay(usage.freeTopupAt)}
        </div>
      ) : null}
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

export function Sidebar({
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

  return (
    <aside className={cx("sidebar", ui.sidebarOpen && "open")}>
      <div className="sidebar-head">
        <div className="wordmark">
          <span className="wordmark-glyph">
            <LogoMark size={13} />
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
      <UsageMeter ui={ui} />
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
