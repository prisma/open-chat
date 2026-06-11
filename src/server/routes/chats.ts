// Chat CRUD: list, create, rename, and delete chats.
//
// Chat metadata lives in Postgres via Prisma Next; the messages inside a
// chat live in the Streams event log (see routes/messages.ts).
import { createChatSchema, renameChatSchema } from "../../shared/contracts";
import { db } from "../../prisma/db";
import {
  HttpError,
  assertMethod,
  json,
  noContent,
  parseJson,
  requireUser,
} from "../http";

const defaultModel = "openai/gpt-4.1-mini";

function chatDto(chat: {
  id: string;
  title: string;
  model: string;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: chat.id,
    title: chat.title,
    model: chat.model,
    createdAt: chat.createdAt.toISOString(),
    updatedAt: chat.updatedAt.toISOString(),
  };
}

export async function requireOwnedChat(userId: string, chatId: string) {
  const chat = await db.orm.Chat.where({ id: chatId, userId }).first();

  if (!chat) {
    throw new HttpError(404, "Chat not found");
  }

  return chat;
}

export async function listChats(request: Request) {
  assertMethod(request, ["GET", "POST"]);
  const user = await requireUser(request);

  if (request.method === "POST") {
    const input = createChatSchema.parse(await parseJson(request));
    const now = new Date();
    const chat = await db.orm.Chat.create({
      id: `chat_${crypto.randomUUID()}`,
      userId: user.id,
      title: input.title ?? "New chat",
      model: input.model ?? defaultModel,
      createdAt: now,
      updatedAt: now,
    });

    return json(chatDto(chat), 201);
  }

  const chats = await db.orm.Chat.where({ userId: user.id })
    .orderBy((chat) => chat.updatedAt.desc())
    .all();

  return json(chats.map(chatDto));
}

export async function updateChat(request: Request, chatId: string) {
  const user = await requireUser(request);
  await requireOwnedChat(user.id, chatId);

  if (request.method === "PATCH") {
    const input = renameChatSchema.parse(await parseJson(request));
    const chat = await db.orm.Chat.where({ id: chatId }).update({
      title: input.title,
      updatedAt: new Date(),
    });
    if (!chat) {
      throw new HttpError(404, "Chat not found");
    }
    return json(chatDto(chat));
  }

  if (request.method === "DELETE") {
    await db.orm.Chat.where({ id: chatId }).delete();
    return noContent();
  }

  throw new HttpError(405, "Method not allowed");
}
