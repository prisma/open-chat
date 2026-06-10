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

type ModelPricing = { prompt: number; completion: number };

let pricingCache:
  | { fetchedAt: number; byModel: Map<string, ModelPricing> }
  | undefined;

export async function getModelPricing(modelId: string) {
  const maxAgeMs = 60 * 60 * 1000;
  if (!pricingCache || Date.now() - pricingCache.fetchedAt > maxAgeMs) {
    const models = await listOpenRouterModels();
    pricingCache = {
      fetchedAt: Date.now(),
      byModel: new Map(
        models.map((model) => {
          const pricing = (model.pricing ?? {}) as {
            prompt?: string | number;
            completion?: string | number;
          };
          return [
            model.id,
            {
              prompt: Number(pricing.prompt ?? 0) || 0,
              completion: Number(pricing.completion ?? 0) || 0,
            },
          ];
        }),
      ),
    };
  }

  return pricingCache.byModel.get(modelId);
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

