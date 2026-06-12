// The message transcript: user bubbles and streaming assistant markdown,
// pinned to the bottom while tokens arrive, with message permalinks
// (scroll-to + highlight flash) and the durable-offset checkmark per
// completed message.
import { AlertCircle, Check, Copy } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useLiveQuery } from "@tanstack/react-db";
import type {
  ChatDto,
  ChatMessage,
  MessageImage,
} from "../../shared/contracts";
import { messagePermalink } from "../actions";
import { checkpointsCollection, updateUi } from "../db";
import { copyToClipboard, cx, formatTime, modelShortName } from "../format";
import { imageFullSrc, imageThumbSrc } from "../images";
import { MessageMarkdown } from "../markdown";
import { LogoMark } from "./LogoMark";

// Images in a message (user attachments or model output); click to zoom.
function MessageImages({
  images,
  onZoom,
}: {
  images: Array<MessageImage> | undefined;
  onZoom: (image: string) => void;
}) {
  if (!images?.length) return null;
  return (
    <div className="msg-images">
      {images.map((image, index) => (
        <button
          type="button"
          key={index}
          aria-label="View image full size"
          onClick={() => onZoom(imageFullSrc(image))}
        >
          <img src={imageThumbSrc(image)} alt="" loading="lazy" />
        </button>
      ))}
    </div>
  );
}

function MessageView({
  message,
  offsetLabel,
  highlighted,
  onZoom,
}: {
  message: ChatMessage;
  offsetLabel: string | undefined;
  highlighted: boolean;
  onZoom: (image: string) => void;
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
          <MessageImages images={message.images} onZoom={onZoom} />
          {message.text ? <div className="bubble">{message.text}</div> : null}
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
        <MessageImages images={message.images} onZoom={onZoom} />
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

export function Transcript({
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
  const [zoomedImage, setZoomedImage] = useState<string | undefined>();

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
          <LogoMark size={17} />
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
            onZoom={setZoomedImage}
            key={message.id}
          />
        ))}
        <div ref={endRef} />
      </div>
      {zoomedImage ? (
        <button
          type="button"
          className="lightbox"
          aria-label="Close image"
          onClick={() => setZoomedImage(undefined)}
        >
          <img src={zoomedImage} alt="" />
        </button>
      ) : null}
    </section>
  );
}
