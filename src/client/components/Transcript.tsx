// The message transcript: user bubbles and streaming assistant markdown,
// pinned to the bottom while tokens arrive, with message permalinks
// (scroll-to + highlight flash) and the durable-offset checkmark per
// completed message.
import { AlertCircle, AudioLines, Check, Copy, Image } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useLiveQuery } from "@tanstack/react-db";
import type {
  ChatDto,
  ChatMessage,
  MessageAudio,
  MessageImage,
  ModelDto,
  WordTiming,
} from "../../shared/contracts";
import { messagePermalink } from "../actions";
import { checkpointsCollection, updateUi } from "../db";
import { copyToClipboard, cx, formatTime, modelShortName } from "../format";
import { imageFullSrc, imageThumbSrc } from "../images";
import { MessageMarkdown } from "../markdown";
import {
  readAlongActiveRange,
  readAlongSegments,
  type ReadAlongRange,
} from "../readalong";
import { LogoMark } from "./LogoMark";

// A stored voice note or spoken reply, played through the content proxy.
function MessageAudioPlayer({
  audio,
}: {
  audio: { id: string; transcript?: string | undefined } | undefined;
}) {
  if (!audio) return null;
  return (
    <div className="msg-audio-block">
      <audio
        className="msg-audio"
        controls
        preload="none"
        src={`/api/content/${audio.id}`}
      />
      {audio.transcript ? (
        <p className="msg-transcript">“{audio.transcript}”</p>
      ) : null}
    </div>
  );
}

// A spoken reply with chunk timings: live speech follows the AudioContext
// cursor stored in TanStack DB, while replay follows the <audio> element.
// OpenRouter gives each audio chunk an associated transcript fragment; those
// chunk spans are the only reliable read-along unit we have.
function SpokenText({
  text,
  audio,
  timings,
  spans,
  liveMs,
}: {
  text: string;
  audio: MessageAudio | undefined;
  timings: Array<WordTiming>;
  spans: Array<WordTiming> | undefined;
  liveMs: number | undefined;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const pointerDownRef = useRef<{ x: number; y: number } | undefined>(
    undefined,
  );
  const [activeReplayRange, setActiveReplayRange] = useState<ReadAlongRange>({
    start: -1,
    end: -1,
  });
  const highlightTimings = spans?.length ? spans : timings;
  const activeRange =
    liveMs !== undefined
      ? readAlongActiveRange(text, highlightTimings, liveMs)
      : activeReplayRange;

  const segments = useMemo(
    () => readAlongSegments(text, highlightTimings),
    [text, highlightTimings],
  );

  useEffect(() => {
    const element = audioRef.current;
    if (!element || !highlightTimings.length || liveMs !== undefined) return;
    let raf = 0;

    const currentSegment = () =>
      readAlongActiveRange(text, highlightTimings, element.currentTime * 1000);

    const tick = () => {
      setActiveReplayRange(currentSegment());
      raf = requestAnimationFrame(tick);
    };
    const start = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(tick);
    };
    const stop = () => cancelAnimationFrame(raf);
    const seeked = () => {
      if (element.paused) setActiveReplayRange(currentSegment());
    };
    const ended = () => {
      stop();
      setActiveReplayRange({ start: -1, end: -1 });
    };

    element.addEventListener("play", start);
    element.addEventListener("pause", stop);
    element.addEventListener("seeked", seeked);
    element.addEventListener("ended", ended);
    return () => {
      stop();
      element.removeEventListener("play", start);
      element.removeEventListener("pause", stop);
      element.removeEventListener("seeked", seeked);
      element.removeEventListener("ended", ended);
    };
  }, [highlightTimings, liveMs, text]);

  function seekTo(index: number) {
    const element = audioRef.current;
    const timing = highlightTimings[index];
    if (!element || !timing) return;
    element.currentTime = timing[2] / 1000;
    void element.play();
  }

  function rememberPointerDown(event: React.PointerEvent<HTMLSpanElement>) {
    pointerDownRef.current = { x: event.clientX, y: event.clientY };
  }

  function maybeSeek(
    event: React.MouseEvent<HTMLSpanElement>,
    index: number,
  ) {
    const selection = window.getSelection();
    if (selection && !selection.isCollapsed && selection.toString().trim()) {
      return;
    }

    const origin = pointerDownRef.current;
    if (origin) {
      const movedX = Math.abs(event.clientX - origin.x);
      const movedY = Math.abs(event.clientY - origin.y);
      if (movedX > 4 || movedY > 4) return;
    }

    seekTo(index);
  }

  return (
    <>
      <div className="msg-text msg-spoken">
        {segments.map((segment, key) =>
          segment.index === undefined ? (
            segment.text
          ) : (() => {
            const active =
              activeRange.start >= 0 &&
              segment.index >= activeRange.start &&
              segment.index <= activeRange.end;
            return (
            <span
              key={key}
              role="presentation"
              draggable={false}
              className={cx(
                "spoken-word",
                active && "now",
                activeRange.end >= 0 &&
                  segment.index > activeRange.end &&
                  "upcoming",
                audio && "seekable",
              )}
              onPointerDown={audio ? rememberPointerDown : undefined}
              onClick={
                audio ? (event) => maybeSeek(event, segment.index!) : undefined
              }
            >
              {segment.text}
            </span>
            );
          })(),
        )}
      </div>
      {audio ? (
        <div className="msg-audio-block">
          <audio
            ref={audioRef}
            className="msg-audio"
            controls
            preload="metadata"
            src={`/api/content/${audio.id}`}
          />
        </div>
      ) : null}
    </>
  );
}

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
  makesImages,
  onZoom,
}: {
  message: ChatMessage;
  offsetLabel: string | undefined;
  highlighted: boolean;
  makesImages: boolean;
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
          <MessageAudioPlayer audio={message.audio} />
          {message.text ? <div className="bubble">{message.text}</div> : null}
          <div className="msg-meta">{timeLink}</div>
        </div>
      </article>
    );
  }

  const streaming = message.status === "streaming";
  // There is no explicit "image coming" signal on the wire — the image
  // simply arrives in a late delta. But generation is distinguishable by
  // silence: an image render produces no tokens, while a text answer
  // streams immediately. So the placeholder shows only while an
  // image-capable model has produced nothing at all.
  const generatingImage =
    streaming && makesImages && !message.text && !message.images?.length;
  const readAlongSpans =
    message.spokenSpans?.length ? message.spokenSpans : message.audio?.spans;
  const liveReadAlong = Boolean(message.audioLive);
  const replayAudio =
    message.status === "completed" && !liveReadAlong ? message.audio : undefined;
  // Spoken replies only read along when OpenRouter supplied chunk transcript
  // spans. Word timings are inferred and too imprecise for this UI.
  const readAlong =
    readAlongSpans?.length &&
    message.text &&
    (replayAudio || liveReadAlong)
      ? readAlongSpans
      : undefined;

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
        {readAlong ? (
          <SpokenText
            text={message.text}
            audio={liveReadAlong ? undefined : replayAudio}
            timings={readAlong}
            spans={readAlongSpans}
            liveMs={liveReadAlong ? message.audioCursorMs : undefined}
          />
        ) : message.text || (streaming && !generatingImage) ? (
          <div className="msg-text">
            <MessageMarkdown text={message.text} streaming={streaming} />
            {streaming ? <span className="caret" aria-hidden /> : null}
          </div>
        ) : null}
        {generatingImage ? (
          <div className="image-placeholder" role="status">
            <Image size={16} aria-hidden />
            <span>Generating image…</span>
          </div>
        ) : null}
        {liveReadAlong && !message.audio ? (
          <div className="audio-live" role="status">
            <AudioLines size={14} aria-hidden />
            <span>Speaking…</span>
          </div>
        ) : null}
        <MessageImages images={message.images} onZoom={onZoom} />
        {readAlong ? null : <MessageAudioPlayer audio={replayAudio} />}
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
  models,
}: {
  messages: Array<ChatMessage>;
  selectedChat: ChatDto | undefined;
  targetMessageId: string | undefined;
  models: Array<ModelDto>;
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
            makesImages={Boolean(
              models
                .find((model) => model.id === message.model)
                ?.outputModalities.includes("image"),
            )}
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
