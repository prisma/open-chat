import { describe, expect, test } from "bun:test";
import {
  estimateTimingSpan,
  estimateWordTimings,
  tokenizeWords,
} from "../src/server/audio-timings";

describe("tokenizeWords", () => {
  test("finds words with char offsets, skipping punctuation", () => {
    const words = tokenizeWords("Once upon a time, deep beneath the sea.");
    expect(words[0]).toEqual({ text: "Once", start: 0, end: 4 });
    expect(words[3]).toEqual({ text: "time", start: 12, end: 16 });
    expect(words.at(-1)).toEqual({ text: "sea", start: 35, end: 38 });
  });

  test("keeps contractions and unicode letters whole", () => {
    const words = tokenizeWords("Denmark’s æventyr isn't small");
    expect(words.map((word) => word.text)).toEqual([
      "Denmark’s",
      "æventyr",
      "isn't",
      "small",
    ]);
  });
});

describe("estimateWordTimings", () => {
  test("maps transcript words into an audio span with char offsets", () => {
    expect(
      estimateWordTimings("Hello brave world", {
        charOffset: 10,
        startMs: 100,
        endMs: 900,
      }),
    ).toEqual([
      [10, 15, 100, 367],
      [16, 21, 367, 633],
      [22, 27, 633, 900],
    ]);
  });

  test("uses a nominal duration when no audio span is available", () => {
    expect(
      estimateWordTimings("one two", {
        charOffset: 0,
        startMs: 500,
        endMs: 500,
      }),
    ).toEqual([
      [0, 3, 500, 680],
      [4, 7, 680, 860],
    ]);
  });
});

describe("estimateTimingSpan", () => {
  test("covers the spoken fragment from its first to last word", () => {
    expect(
      estimateTimingSpan("  around 23 to 25 centimeters ", {
        charOffset: 10,
        startMs: 1200,
        endMs: 2400,
      }),
    ).toEqual([12, 39, 1200, 2400]);
  });

  test("returns undefined for punctuation-only fragments", () => {
    expect(
      estimateTimingSpan(" ... ", {
        charOffset: 0,
        startMs: 0,
        endMs: 300,
      }),
    ).toBeUndefined();
  });
});
