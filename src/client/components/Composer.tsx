// The message composer: auto-growing textarea, the model picker popover,
// and send handling — creating a chat on the fly when none is selected
// yet.
import {
  AlertCircle,
  ArrowUp,
  Check,
  ChevronDown,
  Search,
} from "lucide-react";
import { type FormEvent, useEffect, useMemo, useRef } from "react";
import type { ChatDto, ModelDto } from "../../shared/contracts";
import { createChat } from "../actions";
import { api } from "../api";
import {
  chatsCollection,
  type UiState,
  updateUi,
  usageCollection,
} from "../db";
import { modelShortName } from "../format";

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

export function Composer({
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
                  state.authMode = "sign-up";
                  state.showAuthScreen = true;
                })
              }
            >
              Create account
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
