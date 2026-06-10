// Thin client for the Prisma Streams durable-streams HTTP API.
//
// Each user gets one append-only JSON stream (streamNameForUser); each chat
// is a routing key inside it (chatRoutingKey). Every append is durable
// before the UI ever sees it, and reads can resume from any offset — that
// is what lets a chat survive refreshes, reconnects, and server restarts.
import { createHash } from "node:crypto";
import { startLocalDurableStreamsServer } from "@prisma/streams-local";
import { env } from "./env";
import { HttpError } from "./http";
import { messageEventSchema, type MessageEvent } from "../shared/contracts";

let streamsUrlPromise: Promise<string> | undefined;
const createdStreams = new Set<string>();

async function resolveStreamsUrl() {
  if (env.STREAMS_URL) return env.STREAMS_URL.replace(/\/$/, "");

  const server = await startLocalDurableStreamsServer({
    name: "open-chat",
    hostname: "127.0.0.1",
    port: env.STREAMS_PORT,
  });

  console.log(
    `Prisma Streams local server running at ${server.exports.http.url}`,
  );
  return server.exports.http.url.replace(/\/$/, "");
}

export function getStreamsUrl() {
  streamsUrlPromise ??= resolveStreamsUrl();
  return streamsUrlPromise;
}

export function streamNameForUser(userId: string) {
  const hash = createHash("sha256").update(userId).digest("hex").slice(0, 24);
  return `u_${hash}_messages`;
}

export function chatRoutingKey(chatId: string) {
  return `chat:${chatId}`;
}

async function streamsFetch(path: string, init?: RequestInit) {
  const baseUrl = await getStreamsUrl();
  const response = await fetch(`${baseUrl}${path}`, init);

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new HttpError(
      response.status,
      body || `Prisma Streams request failed: ${response.status}`,
    );
  }

  return response;
}

async function ensureUserStream(userId: string) {
  const streamName = streamNameForUser(userId);
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

export async function appendMessageEvent(
  userId: string,
  chatId: string,
  event: MessageEvent,
) {
  const streamName = await ensureUserStream(userId);
  const response = await streamsFetch(
    `/v1/stream/${encodeURIComponent(streamName)}`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "stream-key": chatRoutingKey(chatId),
      },
      body: JSON.stringify([event]),
    },
  );

  return response.headers.get("stream-next-offset") ?? "-1";
}

export async function readMessageEvents(
  userId: string,
  chatId: string,
  offset: string,
  options?: { live?: boolean; signal?: AbortSignal },
) {
  const streamName = await ensureUserStream(userId);
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
