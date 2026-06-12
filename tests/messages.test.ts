import { describe, expect, test } from "bun:test";
import type {
  MessageEvent,
  MessageEventInput,
} from "../src/shared/contracts";
import { materializeMessages } from "../src/shared/messages";

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
});
