import { describe, expect, test } from "bun:test";
import { AudioReadAlongBuilder } from "../src/server/audio-readalong";

const PCM_100MS_BYTES = 24_000 * 2 * 0.1;

describe("audio read-along pairing", () => {
  test("pairs an audio chunk with the next transcript before emitting audio", () => {
    const builder = new AudioReadAlongBuilder();

    expect(builder.addAudio("chunk-1", PCM_100MS_BYTES)).toEqual([]);
    const outputs = builder.addTranscript("Hello there");

    expect(outputs.map((output) => output.type)).toEqual([
      "text",
      "timing",
      "audio",
    ]);
    expect(outputs[0]).toEqual({ type: "text", text: "Hello there" });
    expect(outputs[1]).toMatchObject({
      type: "timing",
      spans: [[0, 11, 0, 100]],
    });
    expect(outputs[2]).toEqual({ type: "audio", audio: "chunk-1" });
  });

  test("pairs a transcript with the next audio chunk when transcript arrives first", () => {
    const builder = new AudioReadAlongBuilder();

    expect(builder.addTranscript("First phrase").map((output) => output.type)).toEqual([
      "text",
    ]);
    const outputs = builder.addAudio("chunk-1", PCM_100MS_BYTES);

    expect(outputs.map((output) => output.type)).toEqual(["timing", "audio"]);
    expect(outputs[0]).toMatchObject({
      type: "timing",
      spans: [[0, 12, 0, 100]],
    });
  });

  test("keeps same-delta transcript attached to the same audio chunk", () => {
    const builder = new AudioReadAlongBuilder();

    expect(builder.addAudio("padding", PCM_100MS_BYTES)).toEqual([]);
    const outputs = builder.addAudioTranscript(
      "spoken",
      PCM_100MS_BYTES,
      "Hello",
    );

    expect(outputs.map((output) => output.type)).toEqual([
      "audio",
      "text",
      "timing",
      "audio",
    ]);
    expect(outputs[0]).toEqual({ type: "audio", audio: "padding" });
    expect(outputs[2]).toMatchObject({
      type: "timing",
      spans: [[0, 5, 100, 200]],
    });
    expect(outputs[3]).toEqual({ type: "audio", audio: "spoken" });
  });

  test("does not drop audio if no transcript arrives", () => {
    const builder = new AudioReadAlongBuilder();

    builder.addAudio("chunk-1", PCM_100MS_BYTES);

    expect(builder.finish()).toEqual([{ type: "audio", audio: "chunk-1" }]);
  });
});
