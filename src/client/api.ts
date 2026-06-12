import type {
  ChatDto,
  ChatMessage,
  ConfigDto,
  ModelDto,
  UsageDto,
} from "../shared/contracts";
import type { TopupQuote } from "../shared/billing";

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...init?.headers,
    },
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as
      | { error?: string }
      | null;
    throw new Error(payload?.error ?? `Request failed: ${response.status}`);
  }

  return (await response.json()) as T;
}

export const api = {
  chats: {
    list: () => requestJson<Array<ChatDto>>("/api/chats"),
    create: (input: { title?: string; model?: string }) =>
      requestJson<ChatDto>("/api/chats", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    rename: (chatId: string, title: string) =>
      requestJson<ChatDto>(`/api/chats/${encodeURIComponent(chatId)}`, {
        method: "PATCH",
        body: JSON.stringify({ title }),
      }),
    delete: async (chatId: string) => {
      const response = await fetch(`/api/chats/${encodeURIComponent(chatId)}`, {
        method: "DELETE",
      });
      if (!response.ok) throw new Error("Could not delete chat");
    },
    history: (chatId: string) =>
      requestJson<{ messages: Array<ChatMessage>; offset: string }>(
        `/api/chats/${encodeURIComponent(chatId)}/history`,
      ),
    send: (chatId: string, input: { text: string; model?: string; images?: Array<string> }) =>
      requestJson<{ userMessageId: string; assistantMessageId: string }>(
        `/api/chats/${encodeURIComponent(chatId)}/messages`,
        {
          method: "POST",
          body: JSON.stringify(input),
        },
      ),
  },
  models: {
    list: () => requestJson<Array<ModelDto>>("/api/models"),
  },
  usage: {
    get: () => requestJson<UsageDto>("/api/usage"),
  },
  config: {
    get: () => requestJson<ConfigDto>("/api/config"),
  },
  billing: {
    checkout: (amountUsd: number) =>
      requestJson<{ url: string; quote: TopupQuote }>(
        "/api/billing/checkout",
        {
          method: "POST",
          body: JSON.stringify({ amountUsd }),
        },
      ),
    confirm: (sessionId: string) =>
      requestJson<{ creditMicroUsd: number }>(
        `/api/billing/confirm?session_id=${encodeURIComponent(sessionId)}`,
      ),
  },
};

