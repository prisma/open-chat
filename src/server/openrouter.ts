import { OpenRouter } from "@openrouter/sdk";
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

type ModelMeta = {
  pricing: { prompt: number; completion: number };
  seesImages: boolean;
  hearsAudio: boolean;
  outputsImages: boolean;
  outputsAudio: boolean;
};

let metaCache:
  | { fetchedAt: number; byModel: Map<string, ModelMeta> }
  | undefined;

async function getModelMeta(modelId: string) {
  const maxAgeMs = 60 * 60 * 1000;
  if (!metaCache || Date.now() - metaCache.fetchedAt > maxAgeMs) {
    const models = await listOpenRouterModels();
    metaCache = {
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
              pricing: {
                prompt: Number(pricing.prompt ?? 0) || 0,
                completion: Number(pricing.completion ?? 0) || 0,
              },
              seesImages: model.inputModalities.includes("image"),
              hearsAudio: model.inputModalities.includes("audio"),
              outputsImages: model.outputModalities.includes("image"),
              outputsAudio: model.outputModalities.includes("audio"),
            },
          ];
        }),
      ),
    };
  }

  return metaCache.byModel.get(modelId);
}

export async function getModelPricing(modelId: string) {
  return (await getModelMeta(modelId))?.pricing;
}

// What a model accepts and produces — the request must never include
// parts the target model's endpoints can't take, or OpenRouter rejects
// the whole call ("No endpoints found that support image input").
export async function modelCapabilities(modelId: string) {
  const meta = await getModelMeta(modelId).catch(() => undefined);
  return {
    seesImages: meta?.seesImages ?? false,
    hearsAudio: meta?.hearsAudio ?? false,
    outputsImages: meta?.outputsImages ?? false,
    outputsAudio: meta?.outputsAudio ?? false,
  };
}

// Wire-shaped chat messages: content is either plain text or a list of
// text / image_url parts (data: URLs supported).
export type WireContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } }
  | { type: "input_audio"; input_audio: { data: string; format: "wav" | "mp3" } };

export type WireMessage = {
  role: "user" | "assistant";
  content: string | Array<WireContentPart>;
};

export type StreamDelta = {
  text?: string;
  images?: Array<string>;
  /** Base64 PCM16 chunk of spoken audio. */
  audioChunk?: string;
  /** Transcript fragment of the spoken audio. */
  audioTranscript?: string;
  finishReason?: string | null;
  usage?: {
    promptTokens?: number | undefined;
    completionTokens?: number | undefined;
    cost?: number | null | undefined;
  };
};

// A dead socket stops producing bytes; a wedged generation keeps the
// connection alive with keep-alive comments forever. Guard against both —
// without these, a hung upstream leaves the assistant message "streaming"
// in the durable log indefinitely.
const IDLE_TIMEOUT_MS = 90_000;
const TOTAL_TIMEOUT_MS = 10 * 60_000;

// Streams a chat completion straight off OpenRouter's wire API. The
// official SDK validates streaming chunks against a schema that drops the
// `images` field image-generation models return, so this parses the SSE
// feed itself — it's ~40 lines and shows the actual protocol.
export async function* streamChatCompletion(input: {
  model: string;
  messages: Array<WireMessage>;
  userId: string;
  imageOutput?: boolean;
  audioOutput?: boolean;
}): AsyncGenerator<StreamDelta> {
  const watchdog = new AbortController();
  const totalTimer = setTimeout(
    () => watchdog.abort(new Error("The model took too long to finish")),
    TOTAL_TIMEOUT_MS,
  );
  let idleTimer = setTimeout(
    () => watchdog.abort(new Error("The model stream stalled")),
    IDLE_TIMEOUT_MS,
  );

  try {
    const response = await fetch(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${requireOpenRouterApiKey()}`,
          "Content-Type": "application/json",
          "HTTP-Referer": env.OPENROUTER_SITE_URL,
          "X-Title": env.OPENROUTER_APP_NAME,
        },
        body: JSON.stringify({
          model: input.model,
          messages: input.messages,
          stream: true,
          stream_options: { include_usage: true },
          user: input.userId,
          // Image/audio models only produce those modalities when asked.
          ...(input.imageOutput ? { modalities: ["image", "text"] } : {}),
          // Streamed speech arrives as raw PCM16 chunks.
          ...(input.audioOutput
            ? {
                modalities: ["text", "audio"],
                audio: { voice: "alloy", format: "pcm16" },
              }
            : {}),
        }),
        signal: watchdog.signal,
      },
    );

    if (!response.ok || !response.body) {
      const text = await response.text().catch(() => "");
      let message = `OpenRouter request failed: ${response.status}`;
      try {
        message = JSON.parse(text).error.message ?? message;
      } catch {
        // keep the status-code message
      }
      throw new Error(message);
    }

    const decoder = new TextDecoder();
    let buffer = "";
    for await (const chunk of response.body) {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(
        () => watchdog.abort(new Error("The model stream stalled")),
        IDLE_TIMEOUT_MS,
      );
      buffer += decoder.decode(chunk, { stream: true });

    let newline: number;
    while ((newline = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line.startsWith("data: ")) continue; // SSE comments, blank lines
      const payload = line.slice(6);
      if (payload === "[DONE]") return;

      const parsed = JSON.parse(payload) as {
        error?: { message?: string };
        usage?: {
          prompt_tokens?: number;
          completion_tokens?: number;
          cost?: number | null;
        };
        choices?: Array<{
          finish_reason?: string | null;
          delta?: {
            content?: string | null;
            images?: Array<{ image_url?: { url?: string } }>;
            audio?: { data?: string; transcript?: string };
          };
        }>;
      };
      if (parsed.error) {
        throw new Error(parsed.error.message ?? "Model call failed");
      }

      const choice = parsed.choices?.[0];
      const images = (choice?.delta?.images ?? [])
        .map((image) => image.image_url?.url ?? "")
        .filter(Boolean);
      yield {
        ...(choice?.delta?.content ? { text: choice.delta.content } : {}),
        ...(images.length ? { images } : {}),
        ...(choice?.delta?.audio?.data
          ? { audioChunk: choice.delta.audio.data }
          : {}),
        ...(choice?.delta?.audio?.transcript
          ? { audioTranscript: choice.delta.audio.transcript }
          : {}),
        ...(choice?.finish_reason != null
          ? { finishReason: choice.finish_reason }
          : {}),
        ...(parsed.usage
          ? {
              usage: {
                promptTokens: parsed.usage.prompt_tokens,
                completionTokens: parsed.usage.completion_tokens,
                cost: parsed.usage.cost,
              },
            }
          : {}),
      };
    }
    }
  } catch (error) {
    // Surface the watchdog's reason instead of a generic AbortError.
    if (watchdog.signal.aborted && watchdog.signal.reason instanceof Error) {
      throw watchdog.signal.reason;
    }
    throw error;
  } finally {
    clearTimeout(totalTimer);
    clearTimeout(idleTimer);
  }
}

