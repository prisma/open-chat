import { requireOpenRouterApiKey, env } from "./env";

type OpenRouterModelWire = {
  id: string;
  name: string;
  description?: string | undefined;
  contextLength?: number | null | undefined;
  context_length?: number | null | undefined;
  created: number;
  architecture?: {
    inputModalities?: Array<unknown> | undefined;
    outputModalities?: Array<unknown> | undefined;
    input_modalities?: Array<unknown> | undefined;
    output_modalities?: Array<unknown> | undefined;
  };
  pricing?: unknown;
};

function normalizeOpenRouterModel(model: OpenRouterModelWire) {
  const input =
    model.architecture?.inputModalities ??
    model.architecture?.input_modalities ??
    [];
  const output =
    model.architecture?.outputModalities ??
    model.architecture?.output_modalities ??
    [];
  return {
    id: model.id,
    name: model.name,
    description: model.description,
    contextLength: model.contextLength ?? model.context_length ?? null,
    created: model.created,
    inputModalities: input.map(String),
    outputModalities: output.map(String),
    pricing: model.pricing,
  };
}

type OpenRouterModel = ReturnType<typeof normalizeOpenRouterModel>;

function mergeOpenRouterModel(
  left: OpenRouterModel,
  right: OpenRouterModel,
): OpenRouterModel {
  return {
    ...left,
    ...right,
    description: right.description ?? left.description,
    contextLength: right.contextLength ?? left.contextLength,
    inputModalities: [
      ...new Set([...left.inputModalities, ...right.inputModalities]),
    ],
    outputModalities: [
      ...new Set([...left.outputModalities, ...right.outputModalities]),
    ],
    pricing: right.pricing ?? left.pricing,
  };
}

async function fetchOpenRouterModels(query = "") {
  const response = await fetch(`https://openrouter.ai/api/v1/models${query}`, {
    headers: {
      Authorization: `Bearer ${requireOpenRouterApiKey()}`,
      "HTTP-Referer": env.OPENROUTER_SITE_URL,
      "X-Title": env.OPENROUTER_APP_NAME,
    },
  });
  if (!response.ok) {
    throw new Error(`OpenRouter models request failed: ${response.status}`);
  }
  const body = (await response.json()) as { data?: Array<OpenRouterModelWire> };
  return (body.data ?? []).map(normalizeOpenRouterModel);
}

export async function listOpenRouterModels() {
  const pages = await Promise.all([
    fetchOpenRouterModels(),
    fetchOpenRouterModels("?output_modalities=speech"),
    fetchOpenRouterModels("?output_modalities=transcription"),
  ]);
  const byId = new Map<string, OpenRouterModel>();
  for (const model of pages.flat()) {
    const previous = byId.get(model.id);
    byId.set(model.id, previous ? mergeOpenRouterModel(previous, model) : model);
  }
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
}

type ModelMeta = {
  pricing: { prompt: number; completion: number };
  outputsText: boolean;
  seesImages: boolean;
  hearsAudio: boolean;
  outputsImages: boolean;
  outputsAudio: boolean;
  outputsSpeech: boolean;
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
              outputsText: model.outputModalities.includes("text"),
              seesImages: model.inputModalities.includes("image"),
              hearsAudio: model.inputModalities.includes("audio"),
              outputsImages: model.outputModalities.includes("image"),
              outputsAudio: model.outputModalities.includes("audio"),
              outputsSpeech: model.outputModalities.includes("speech"),
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
    outputsText: meta?.outputsText ?? true,
    seesImages: meta?.seesImages ?? false,
    hearsAudio: meta?.hearsAudio ?? false,
    outputsImages: meta?.outputsImages ?? false,
    outputsAudio: meta?.outputsAudio ?? false,
    outputsSpeech: meta?.outputsSpeech ?? false,
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
// in the durable log indefinitely. The progress timer is the middle tier:
// keep-alives reset the idle timer but not it, so a generation that stops
// producing content errors out in minutes, not at the total cap.
const IDLE_TIMEOUT_MS = 90_000;
const PROGRESS_TIMEOUT_MS = 3 * 60_000;
const TOTAL_TIMEOUT_MS = 10 * 60_000;

export type SpeechFormat = "pcm" | "mp3" | "wav";

type SpeechDefaults = { voice: string; format: "pcm" | "mp3" };

const SPEECH_DEFAULTS: Record<string, SpeechDefaults> = {
  "microsoft/mai-voice-2": {
    voice: "en-US-Harper:MAI-Voice-2",
    format: "pcm",
  },
  "x-ai/grok-voice-tts-1.0": { voice: "Eve", format: "pcm" },
  "google/gemini-3.1-flash-tts-preview": { voice: "Kore", format: "pcm" },
  "zyphra/zonos-v0.1-transformer": {
    voice: "american_female",
    format: "mp3",
  },
  "zyphra/zonos-v0.1-hybrid": { voice: "american_female", format: "mp3" },
  "sesame/csm-1b": { voice: "Maya", format: "pcm" },
  "canopylabs/orpheus-3b-0.1-ft": { voice: "tara", format: "pcm" },
  "hexgrad/kokoro-82m": { voice: "af_heart", format: "pcm" },
  // OpenRouter currently rejects PCM for this model and may require a
  // provider-specific voice id; keep it selectable and surface provider
  // errors directly until the model metadata exposes voices.
  "mistralai/voxtral-mini-tts-2603": {
    voice: "jane_confident",
    format: "mp3",
  },
};

export function speechDefaultsForModel(model: string): SpeechDefaults {
  return SPEECH_DEFAULTS[model] ?? { voice: "alloy", format: "pcm" };
}

export function parseSpeechContentType(contentType: string | null) {
  const lower = contentType?.toLowerCase() ?? "";
  const format: SpeechFormat = lower.includes("mpeg") || lower.includes("mp3")
    ? "mp3"
    : lower.includes("wav") || lower.includes("wave")
      ? "wav"
      : "pcm";
  const sampleRate = Number(/rate=(\d+)/i.exec(lower)?.[1] ?? 24_000);
  const channels = Number(/channels=(\d+)/i.exec(lower)?.[1] ?? 1);
  return {
    format,
    sampleRate:
      Number.isFinite(sampleRate) && sampleRate > 0 ? sampleRate : 24_000,
    channels:
      Number.isFinite(channels) && channels > 0 ? Math.min(2, channels) : 1,
  };
}

export type SpeechDelta =
  | {
      type: "metadata";
      format: SpeechFormat;
      sampleRate: number;
      channels: number;
      contentType: string;
    }
  | { type: "audio"; bytes: Uint8Array };

export async function* streamSpeech(input: {
  model: string;
  text: string;
}): AsyncGenerator<SpeechDelta> {
  const defaults = speechDefaultsForModel(input.model);
  const watchdog = new AbortController();
  const totalTimer = setTimeout(
    () => watchdog.abort(new Error("The speech model took too long to finish")),
    TOTAL_TIMEOUT_MS,
  );
  let idleTimer = setTimeout(
    () => watchdog.abort(new Error("The speech model stream stalled")),
    IDLE_TIMEOUT_MS,
  );

  try {
    const response = await fetch("https://openrouter.ai/api/v1/audio/speech", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${requireOpenRouterApiKey()}`,
        "Content-Type": "application/json",
        "HTTP-Referer": env.OPENROUTER_SITE_URL,
        "X-Title": env.OPENROUTER_APP_NAME,
      },
      body: JSON.stringify({
        model: input.model,
        input: input.text,
        voice: defaults.voice,
        response_format: defaults.format,
      }),
      signal: watchdog.signal,
    });

    if (!response.ok || !response.body) {
      const text = await response.text().catch(() => "");
      let message = `OpenRouter speech request failed: ${response.status}`;
      try {
        message = JSON.parse(text).error.message ?? message;
      } catch {
        // keep the status-code message
      }
      throw new Error(message);
    }

    const contentType = response.headers.get("content-type") ?? "";
    const metadata = parseSpeechContentType(contentType);
    yield { type: "metadata", contentType, ...metadata };

    const reader = response.body.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        clearTimeout(idleTimer);
        idleTimer = setTimeout(
          () => watchdog.abort(new Error("The speech model stream stalled")),
          IDLE_TIMEOUT_MS,
        );
        yield { type: "audio", bytes: value };
      }
    } finally {
      reader.releaseLock();
    }
  } catch (error) {
    if (watchdog.signal.aborted && watchdog.signal.reason instanceof Error) {
      throw watchdog.signal.reason;
    }
    throw error;
  } finally {
    clearTimeout(totalTimer);
    clearTimeout(idleTimer);
  }
}

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
  let progressTimer = setTimeout(
    () => watchdog.abort(new Error("The model stopped making progress")),
    PROGRESS_TIMEOUT_MS,
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
    const reader = response.body.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        clearTimeout(idleTimer);
        idleTimer = setTimeout(
          () => watchdog.abort(new Error("The model stream stalled")),
          IDLE_TIMEOUT_MS,
        );
        buffer += decoder.decode(value, { stream: true });

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
          if (choice?.delta?.content || images.length || choice?.delta?.audio) {
            clearTimeout(progressTimer);
            progressTimer = setTimeout(
              () => watchdog.abort(new Error("The model stopped making progress")),
              PROGRESS_TIMEOUT_MS,
            );
          }
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
    } finally {
      reader.releaseLock();
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
    clearTimeout(progressTimer);
  }
}
