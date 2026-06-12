// The message composer: auto-growing textarea, image attachments (button
// or paste, downscaled client-side), the model picker popover with
// capability filters, and send handling — creating a chat on the fly when
// none is selected yet.
import {
  AlertCircle,
  ArrowUp,
  Check,
  ChevronDown,
  Eye,
  Image,
  ImagePlus,
  Search,
  X,
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
import { prepareImage } from "../images";

const MAX_ATTACHMENTS = 4;

function modelSeesImages(model: ModelDto) {
  return model.inputModalities.includes("image");
}

function modelMakesImages(model: ModelDto) {
  return model.outputModalities.includes("image");
}

const CAPABILITY_FILTERS = [
  { key: "all", label: "All" },
  { key: "vision", label: "Vision" },
  { key: "image-out", label: "Image output" },
] as const;

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
        // Everything that can chat: text in, and text or images out.
        const usable =
          model.inputModalities.includes("text") &&
          (model.outputModalities.includes("text") ||
            model.outputModalities.includes("image"));
        const capability =
          ui.modelFilter === "vision"
            ? modelSeesImages(model)
            : ui.modelFilter === "image-out"
              ? modelMakesImages(model)
              : true;
        const matches =
          !query ||
          model.id.toLowerCase().includes(query) ||
          model.name.toLowerCase().includes(query);
        return usable && capability && matches;
      })
      .slice(0, 100);
  }, [models, ui.modelSearch, ui.modelFilter]);

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
      <div className="model-filters" role="radiogroup" aria-label="Filter by capability">
        {CAPABILITY_FILTERS.map((filter) => (
          <button
            key={filter.key}
            type="button"
            role="radio"
            aria-checked={ui.modelFilter === filter.key}
            className={
              ui.modelFilter === filter.key
                ? "filter-chip active"
                : "filter-chip"
            }
            onClick={() =>
              updateUi((state) => {
                state.modelFilter = filter.key;
              })
            }
          >
            {filter.label}
          </button>
        ))}
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
              <span className="model-badges" aria-hidden>
                {modelSeesImages(model) ? (
                  <span className="model-badge" title="Understands images">
                    <Eye size={12} />
                  </span>
                ) : null}
                {modelMakesImages(model) ? (
                  <span className="model-badge" title="Generates images">
                    <Image size={12} />
                  </span>
                ) : null}
              </span>
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
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;
  }, [ui.composerText]);

  const selectedModel = models.find((model) => model.id === ui.selectedModel);
  const blindModel = Boolean(
    ui.composerImages.length && selectedModel && !modelSeesImages(selectedModel),
  );

  async function attachFiles(files: Iterable<File>) {
    for (const file of files) {
      if (!file.type.startsWith("image/")) continue;
      const prepared = await prepareImage(file).catch(() => undefined);
      if (!prepared) continue;
      updateUi((state) => {
        if (state.composerImages.length >= MAX_ATTACHMENTS) return;
        state.composerImages = [...state.composerImages, prepared];
      });
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = ui.composerText.trim();
    const images = ui.composerImages;
    if (!text && !images.length) return;

    try {
      let chat = selectedChat;
      if (!chat) {
        chat = await createChat(ui.selectedModel);
      }

      updateUi((state) => {
        state.composerText = "";
        state.composerImages = [];
        state.streamStatus = "connecting";
        state.sendError = undefined;
      });
      await api.chats.send(chat.id, {
        text,
        model: ui.selectedModel,
        ...(images.length ? { images } : {}),
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
        {ui.composerImages.length ? (
          <div className="composer-attachments">
            {ui.composerImages.map((image, index) => (
              <span className="attachment" key={index}>
                <img src={image.thumb} alt={`Attachment ${index + 1}`} />
                <button
                  type="button"
                  aria-label="Remove attachment"
                  onClick={() =>
                    updateUi((state) => {
                      state.composerImages = state.composerImages.filter(
                        (_, i) => i !== index,
                      );
                    })
                  }
                >
                  <X size={11} aria-hidden />
                </button>
              </span>
            ))}
            {blindModel ? (
              <span className="attachment-warning">
                {modelShortName(ui.selectedModel)} can't see images — pick a
                vision model
              </span>
            ) : null}
          </div>
        ) : null}
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
          onPaste={(event) => {
            const files = [...event.clipboardData.files].filter((file) =>
              file.type.startsWith("image/"),
            );
            if (!files.length) return;
            event.preventDefault();
            void attachFiles(files);
          }}
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
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(event) => {
              void attachFiles(event.target.files ?? []);
              event.target.value = "";
            }}
          />
          <button
            className="icon-button attach-button"
            type="button"
            aria-label="Attach images"
            disabled={ui.composerImages.length >= MAX_ATTACHMENTS}
            onClick={() => fileInputRef.current?.click()}
          >
            <ImagePlus size={15} aria-hidden />
          </button>
          <button
            className="send-button"
            type="submit"
            aria-label="Send message"
            disabled={!ui.composerText.trim() && !ui.composerImages.length}
          >
            <ArrowUp size={16} aria-hidden />
          </button>
        </div>
      </form>
    </div>
  );
}
