import { OpenRouter } from "@openrouter/sdk";
import type { ChatMessages } from "@openrouter/sdk/models";
import { requireOpenRouterApiKey, env } from "./env";

let openRouter: OpenRouter | undefined;

function getOpenRouter() {
  openRouter ??= new OpenRouter({
    apiKey: requireOpenRouterApiKey(),
    httpReferer: env.OPENROUTER_SITE_URL,
    appTitle: env.OPENROUTER_APP_NAME,
  });

  return openRouter;
}

export async function listOpenRouterModels() {
  const response = await getOpenRouter().models.list();
  return response.data
    .map((model) => ({
      id: model.id,
      name: model.name,
      description: model.description,
      contextLength: model.contextLength,
      created: model.created,
      inputModalities: model.architecture.inputModalities.map(String),
      outputModalities: model.architecture.outputModalities.map(String),
      pricing: model.pricing,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function streamChatCompletion(input: {
  model: string;
  messages: Array<ChatMessages>;
  userId: string;
  chatId: string;
}) {
  return getOpenRouter().chat.send({
    chatRequest: {
      model: input.model,
      messages: input.messages,
      stream: true,
      streamOptions: {
        includeUsage: true,
      },
      user: input.userId,
      sessionId: input.chatId,
    },
  });
}

