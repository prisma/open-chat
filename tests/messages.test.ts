import { describe, expect, test } from "bun:test";
import type {
  MessageEvent,
  MessageEventInput,
} from "../src/shared/contracts";
import {
  applyMessageEvent,
  materializeMessages,
  stalledMessages,
} from "../src/shared/messages";

function event(input: MessageEventInput): MessageEvent {
  return {
    ...input,
    id: crypto.randomUUID(),
    createdAt: new Date("2026-06-10T00:00:00.000Z").toISOString(),
  } as MessageEvent;
}

describe("message materialization", () => {
  test("turns durable events into user and assistant messages", () => {
    const messages = materializeMessages([
      event({
        type: "message.created",
        chatId: "chat_1",
        messageId: "msg_user",
        role: "user",
        text: "Hello",
        model: "openai/gpt-4.1-mini",
      }),
      event({
        type: "message.created",
        chatId: "chat_1",
        messageId: "msg_assistant",
        role: "assistant",
        text: "",
        model: "openai/gpt-4.1-mini",
      }),
      event({
        type: "message.delta",
        chatId: "chat_1",
        messageId: "msg_assistant",
        role: "assistant",
        text: "Hi",
        model: "openai/gpt-4.1-mini",
      }),
      event({
        type: "message.delta",
        chatId: "chat_1",
        messageId: "msg_assistant",
        role: "assistant",
        text: " there",
        model: "openai/gpt-4.1-mini",
      }),
      event({
        type: "message.completed",
        chatId: "chat_1",
        messageId: "msg_assistant",
        role: "assistant",
        model: "openai/gpt-4.1-mini",
        finishReason: "stop",
      }),
    ]);

    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({
      id: "msg_user",
      role: "user",
      text: "Hello",
      status: "completed",
    });
    expect(messages[1]).toMatchObject({
      id: "msg_assistant",
      role: "assistant",
      text: "Hi there",
      status: "completed",
    });
  });

  test("attaches normalized usage from completion events", () => {
    const messages = materializeMessages([
      event({
        type: "message.created",
        chatId: "chat_1",
        messageId: "msg_assistant",
        role: "assistant",
        text: "",
      }),
      event({
        type: "message.completed",
        chatId: "chat_1",
        messageId: "msg_assistant",
        role: "assistant",
        usage: { inputTokens: 120, outputTokens: 45, costMicroUsd: 87 },
      }),
    ]);

    expect(messages[0]?.usage).toEqual({
      inputTokens: 120,
      outputTokens: 45,
      costMicroUsd: 87,
    });
  });

  test("keeps usage when audio timings arrive after completion", () => {
    const messages = materializeMessages([
      event({
        type: "message.created",
        chatId: "chat_1",
        messageId: "msg_assistant",
        role: "assistant",
        text: "",
      }),
      event({
        type: "message.delta",
        chatId: "chat_1",
        messageId: "msg_assistant",
        role: "assistant",
        text: "Hello world",
      }),
      event({
        type: "message.completed",
        chatId: "chat_1",
        messageId: "msg_assistant",
        role: "assistant",
        usage: { inputTokens: 1, outputTokens: 2, costMicroUsd: 3 },
      }),
      event({
        type: "message.audio",
        chatId: "chat_1",
        messageId: "msg_assistant",
        role: "assistant",
        audio: {
          id: "00000000-0000-0000-0000-000000000000.wav",
          timings: [
            [0, 5, 0, 250],
            [6, 11, 250, 500],
          ],
          spans: [[0, 11, 0, 500]],
        },
      }),
    ]);

    expect(messages[0]).toMatchObject({
      status: "completed",
      usage: { inputTokens: 1, outputTokens: 2, costMicroUsd: 3 },
      spokenTimings: [
        [0, 5, 0, 250],
        [6, 11, 250, 500],
      ],
      spokenSpans: [[0, 11, 0, 500]],
    });
  });

  test("merges incremental audio timing events into the spoken reply", () => {
    const messages = materializeMessages([
      event({
        type: "message.created",
        chatId: "chat_1",
        messageId: "msg_assistant",
        role: "assistant",
        text: "",
      }),
      event({
        type: "message.delta",
        chatId: "chat_1",
        messageId: "msg_assistant",
        role: "assistant",
        text: "Hello ",
      }),
      event({
        type: "message.audio.timing",
        chatId: "chat_1",
        messageId: "msg_assistant",
        role: "assistant",
        timings: [[0, 5, 0, 300]],
        spans: [[0, 5, 0, 300]],
      }),
      event({
        type: "message.delta",
        chatId: "chat_1",
        messageId: "msg_assistant",
        role: "assistant",
        text: "world",
      }),
      event({
        type: "message.audio.timing",
        chatId: "chat_1",
        messageId: "msg_assistant",
        role: "assistant",
        timings: [[6, 11, 300, 650]],
        spans: [[6, 11, 300, 650]],
      }),
      event({
        type: "message.audio",
        chatId: "chat_1",
        messageId: "msg_assistant",
        role: "assistant",
        audio: { id: "00000000-0000-0000-0000-000000000000.wav" },
      }),
    ]);

    expect(messages[0]).toMatchObject({
      text: "Hello world",
      audio: {
        id: "00000000-0000-0000-0000-000000000000.wav",
        timings: [
          [0, 5, 0, 300],
          [6, 11, 300, 650],
        ],
        spans: [
          [0, 5, 0, 300],
          [6, 11, 300, 650],
        ],
      },
      spokenTimings: [
        [0, 5, 0, 300],
        [6, 11, 300, 650],
      ],
      spokenSpans: [
        [0, 5, 0, 300],
        [6, 11, 300, 650],
      ],
    });
  });

  test("does not treat replayed durable audio chunks as live playback", () => {
    const messages = materializeMessages([
      event({
        type: "message.created",
        chatId: "chat_1",
        messageId: "msg_assistant",
        role: "assistant",
        text: "",
      }),
      event({
        type: "message.delta",
        chatId: "chat_1",
        messageId: "msg_assistant",
        role: "assistant",
        text: "Hello",
      }),
      event({
        type: "message.audio.delta",
        chatId: "chat_1",
        messageId: "msg_assistant",
        role: "assistant",
        audio: "AAAA",
      }),
      event({
        type: "message.audio",
        chatId: "chat_1",
        messageId: "msg_assistant",
        role: "assistant",
        audio: { id: "00000000-0000-0000-0000-000000000000.wav" },
      }),
      event({
        type: "message.completed",
        chatId: "chat_1",
        messageId: "msg_assistant",
        role: "assistant",
      }),
    ]);

    expect(messages[0]).toMatchObject({
      status: "completed",
      audioLive: undefined,
      audioCursorMs: undefined,
    });
  });

  test("preserves live playback state while applying stored audio events", () => {
    const created = event({
      type: "message.created",
      chatId: "chat_1",
      messageId: "msg_assistant",
      role: "assistant",
      text: "Hello",
    });
    const audio = event({
      type: "message.audio",
      chatId: "chat_1",
      messageId: "msg_assistant",
      role: "assistant",
      audio: { id: "00000000-0000-0000-0000-000000000000.wav" },
    });

    const messages = new Map();
    applyMessageEvent(messages, created);
    messages.get("msg_assistant")!.audioLive = true;
    messages.get("msg_assistant")!.audioCursorMs = 320;
    applyMessageEvent(messages, audio);

    expect(messages.get("msg_assistant")).toMatchObject({
      audioLive: true,
      audioCursorMs: 320,
      audio: { id: "00000000-0000-0000-0000-000000000000.wav" },
    });
  });

  test("ignores legacy raw usage payloads on completion events", () => {
    const messages = materializeMessages([
      event({
        type: "message.created",
        chatId: "chat_1",
        messageId: "msg_assistant",
        role: "assistant",
        text: "",
      }),
      event({
        type: "message.completed",
        chatId: "chat_1",
        messageId: "msg_assistant",
        role: "assistant",
        usage: { inputTokens: 120, outputTokens: 45, totalTokens: 165 },
      }),
    ]);

    expect(messages[0]?.status).toBe("completed");
    expect(messages[0]?.usage).toBeUndefined();
  });

  test("marks assistant errors durably", () => {
    const messages = materializeMessages([
      event({
        type: "message.created",
        chatId: "chat_1",
        messageId: "msg_assistant",
        role: "assistant",
        text: "",
      }),
      event({
        type: "message.error",
        chatId: "chat_1",
        messageId: "msg_assistant",
        role: "assistant",
        error: "Model failed",
      }),
    ]);

    expect(messages[0]).toMatchObject({
      id: "msg_assistant",
      status: "error",
      error: "Model failed",
    });
  });
  test("carries images through the event log", () => {
    const messages = materializeMessages([
      event({
        type: "message.created",
        chatId: "chat_1",
        messageId: "msg_user",
        role: "user",
        text: "What is this?",
        images: ["data:image/png;base64,AAA"],
      }),
      event({
        type: "message.created",
        chatId: "chat_1",
        messageId: "msg_assistant",
        role: "assistant",
        text: "",
      }),
      event({
        type: "message.image",
        chatId: "chat_1",
        messageId: "msg_assistant",
        role: "assistant",
        image: "data:image/png;base64,BBB",
      }),
      event({
        type: "message.delta",
        chatId: "chat_1",
        messageId: "msg_assistant",
        role: "assistant",
        text: "Here you go.",
      }),
      event({
        type: "message.completed",
        chatId: "chat_1",
        messageId: "msg_assistant",
        role: "assistant",
      }),
    ]);

    expect(messages[0]?.images).toEqual(["data:image/png;base64,AAA"]);
    expect(messages[1]).toMatchObject({
      status: "completed",
      text: "Here you go.",
      images: ["data:image/png;base64,BBB"],
    });
  });
  test("flags assistant messages whose stream died without a terminal event", () => {
    const base = Date.parse("2026-06-10T00:00:00.000Z");
    const messages = materializeMessages([
      event({
        type: "message.created",
        chatId: "chat_1",
        messageId: "msg_assistant",
        role: "assistant",
        text: "",
      }),
    ]);

    expect(stalledMessages(messages, base + 60_000)).toHaveLength(0);
    expect(stalledMessages(messages, base + 11 * 60_000)).toHaveLength(1);
  });
});
