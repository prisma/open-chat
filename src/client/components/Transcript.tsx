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

function wordAt(timings: Array<WordTiming>, currentMs: number) {
  const ms = currentMs + 80;
  let lo = 0;
  let hi = timings.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (timings[mid]![2] <= ms) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}

// A spoken reply with word timings: live speech follows the AudioContext
// cursor stored in TanStack DB, while replay follows the <audio> element.
// Clicking a word seeks the stored WAV once it exists.
function SpokenText({
  text,
  audio,
  timings,
  liveMs,
}: {
  text: string;
  audio: MessageAudio | undefined;
  timings: Array<WordTiming>;
  liveMs: number | undefined;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [wordIndex, setWordIndex] = useState(-1);
  const activeWord = liveMs !== undefined ? wordAt(timings, liveMs) : wordIndex;

  const segments = useMemo(() => {
    const out: Array<{ text: string; word?: number }> = [];
    let cursor = 0;
    timings.forEach(([start, end], i) => {
      if (start > cursor) out.push({ text: text.slice(cursor, start) });
      out.push({ text: text.slice(start, end), word: i });
      cursor = end;
    });
    if (cursor < text.length) out.push({ text: text.slice(cursor) });
    return out;
  }, [text, timings]);

  useEffect(() => {
    const element = audioRef.current;
    if (!element || !timings.length || liveMs !== undefined) return;
    let raf = 0;

    const currentWord = () => wordAt(timings, element.currentTime * 1000);

    const tick = () => {
      setWordIndex(currentWord());
      raf = requestAnimationFrame(tick);
    };
    const start = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(tick);
    };
    const stop = () => cancelAnimationFrame(raf);
    const seeked = () => {
      if (element.paused) setWordIndex(currentWord());
    };
    const ended = () => {
      stop();
      setWordIndex(-1);
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
  }, [timings, liveMs]);

  function seekTo(word: number) {
    const element = audioRef.current;
    const timing = timings[word];
    if (!element || !timing) return;
    element.currentTime = timing[2] / 1000;
    void element.play();
  }

  return (
    <>
      <div className="msg-text msg-spoken">
        {segments.map((segment, key) =>
          segment.word === undefined ? (
            segment.text
          ) : (
            <span
              key={key}
              role="presentation"
              className={cx(
                "spoken-word",
                segment.word === activeWord && "now",
                activeWord >= 0 && segment.word > activeWord && "upcoming",
                audio && "seekable",
              )}
              onClick={audio ? () => seekTo(segment.word!) : undefined}
            >
              {segment.text}
            </span>
          ),
        )}
      </div>
      {audio ? (
        <div className="msg-audio-block">
          <audio
            ref={audioRef}
            className="msg-audio"
            controls
            preload="none"
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
  const readAlongTimings =
    message.spokenTimings?.length
      ? message.spokenTimings
      : message.audio?.timings;
  // Spoken replies with word timings read along with playback; the plain
  // transcript is literal speech, so word spans replace the markdown pass.
  const readAlong =
    readAlongTimings?.length && message.text && (message.audio || message.audioLive)
      ? readAlongTimings
      : undefined;
  const liveReadAlong = Boolean(streaming && message.audioLive);

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
            audio={liveReadAlong ? undefined : message.audio}
            timings={readAlong}
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
        {streaming && message.audioLive && !message.audio ? (
          <div className="audio-live" role="status">
            <AudioLines size={14} aria-hidden />
            <span>Speaking…</span>
          </div>
        ) : null}
        <MessageImages images={message.images} onZoom={onZoom} />
        {readAlong ? null : <MessageAudioPlayer audio={message.audio} />}
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
