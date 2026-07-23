// Thin client for the Prisma Streams durable-streams HTTP API.
//
// Each user gets one append-only JSON stream (streamNameForUser); each chat
// is a routing key inside it (chatRoutingKey). Every append is durable
// before the UI ever sees it, and reads can resume from any offset — that
// is what lets a chat survive refreshes, reconnects, and server restarts.
import { createHash } from "node:crypto";
import { configKey } from "@prisma/composer-prisma-cloud";
import { HttpError } from "./http";
import { messageEventSchema, type MessageEvent } from "../shared/contracts";

// The service's streams dependency hydrates to a `StreamsClient`
// (service.load().streams), but this app cannot use it: it multiplexes chats
// over one per-user stream with a routing key — a `stream-key` header on
// append and a `key` filter on read — and neither StreamsClient nor
// StreamHandle can express a routing key. The client's url/apiKey are
// private, so the raw connection params are read from the same COMPOSER_*
// stash run() populated; configKey() is the only public accessor for a
// dependency's raw values.
function rawStreamsParam(name: "url" | "apiKey"): string {
  const key = configKey("", { owner: { input: "streams" }, name });
  const value = process.env[key];
  if (!value) {
    throw new Error(
      `missing resolved streams dependency param "${name}" (env ${key})`,
    );
  }
  return value;
}

export function streamsOrigin() {
  return new URL(rawStreamsParam("url")).origin;
}

const createdStreams = new Set<string>();

export function streamNameForUser(userId: string) {
  const hash = createHash("sha256").update(userId).digest("hex").slice(0, 24);
  return `u_${hash}_messages`;
}

export function chatRoutingKey(chatId: string) {
  return `chat:${chatId}`;
}

async function streamsFetch(path: string, init?: RequestInit) {
  const baseUrl = rawStreamsParam("url").replace(/\/$/, "");
  const headers = new Headers(init?.headers);
  headers.set("authorization", `Bearer ${rawStreamsParam("apiKey")}`);
  const response = await fetch(`${baseUrl}${path}`, { ...init, headers });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new HttpError(
      response.status,
      body || `Prisma Streams request failed: ${response.status}`,
    );
  }

  return response;
}

async function ensureStream(streamName: string) {
  if (createdStreams.has(streamName)) return streamName;

  await streamsFetch(`/v1/stream/${encodeURIComponent(streamName)}`, {
    method: "PUT",
    headers: {
      "content-type": "application/json",
    },
  });
  createdStreams.add(streamName);
  return streamName;
}

/** Append arbitrary JSON events to a named stream under a routing key. */
export async function appendStreamEvents(
  streamName: string,
  routingKey: string,
  events: Array<unknown>,
) {
  await ensureStream(streamName);
  const response = await streamsFetch(
    `/v1/stream/${encodeURIComponent(streamName)}`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "stream-key": routingKey,
      },
      body: JSON.stringify(events),
    },
  );

  return response.headers.get("stream-next-offset") ?? "-1";
}

export async function appendMessageEvent(
  userId: string,
  chatId: string,
  event: MessageEvent,
) {
  return appendStreamEvents(
    streamNameForUser(userId),
    chatRoutingKey(chatId),
    [event],
  );
}

export async function readMessageEvents(
  userId: string,
  chatId: string,
  offset: string,
  options?: { live?: boolean; signal?: AbortSignal },
) {
  const streamName = await ensureStream(streamNameForUser(userId));
  const url = new URL(
    `/v1/stream/${encodeURIComponent(streamName)}`,
    "http://streams.local",
  );
  url.searchParams.set("offset", offset);
  url.searchParams.set("format", "json");
  url.searchParams.set("key", chatRoutingKey(chatId));
  if (options?.live) {
    url.searchParams.set("live", "true");
    url.searchParams.set("timeout", "4s");
  }

  try {
    const response = await streamsFetch(
      `${url.pathname}${url.search}`,
      options?.signal ? { signal: options.signal } : undefined,
    );
    const nextOffset = response.headers.get("stream-next-offset") ?? offset;
    const raw = (await response.json()) as unknown;
    const events = Array.isArray(raw)
      ? raw.map((value) => messageEventSchema.parse(value))
      : [];

    return { events, nextOffset };
  } catch (error) {
    if (error instanceof HttpError && error.status === 408) {
      return { events: [], nextOffset: offset };
    }
    throw error;
  }
}

export async function loadAllMessageEvents(userId: string, chatId: string) {
  const events: Array<MessageEvent> = [];
  let offset = "-1";

  for (;;) {
    const batch = await readMessageEvents(userId, chatId, offset);
    events.push(...batch.events);

    if (batch.nextOffset === offset || batch.events.length === 0) {
      return { events, offset: batch.nextOffset };
    }

    offset = batch.nextOffset;
  }
}
