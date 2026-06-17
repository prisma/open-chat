import { describe, expect, test } from "bun:test";

process.env.APP_ORIGIN ??= "http://localhost:3000";
process.env.BETTER_AUTH_SECRET ??= "test-secret-test-secret-test-secret";
process.env.DATABASE_URL ??= "postgres://user:pass@localhost:5432/db";

const { parseSpeechContentType, speechDefaultsForModel } = await import(
  "../src/server/openrouter"
);

describe("OpenRouter speech helpers", () => {
  test("uses tested defaults for TTS models", () => {
    expect(speechDefaultsForModel("hexgrad/kokoro-82m")).toEqual({
      voice: "af_heart",
      format: "pcm",
    });
    expect(speechDefaultsForModel("zyphra/zonos-v0.1-hybrid")).toEqual({
      voice: "american_female",
      format: "mp3",
    });
  });

  test("parses speech response metadata", () => {
    expect(parseSpeechContentType("audio/pcm;rate=24000;channels=1")).toEqual({
      format: "pcm",
      sampleRate: 24_000,
      channels: 1,
    });
    expect(parseSpeechContentType("audio/mpeg")).toEqual({
      format: "mp3",
      sampleRate: 24_000,
      channels: 1,
    });
    expect(parseSpeechContentType("audio/wav")).toEqual({
      format: "wav",
      sampleRate: 24_000,
      channels: 1,
    });
  });
});
