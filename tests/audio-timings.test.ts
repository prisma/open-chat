import { describe, expect, test } from "bun:test";
import {
  alignWordsToTranscript,
  tokenizeWords,
} from "../src/server/audio-timings";

const recognized = (
  ...words: Array<[string, number, number]>
): Array<{ word: string; start: number; end: number }> =>
  words.map(([word, start, end]) => ({ word, start, end }));

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

describe("alignWordsToTranscript", () => {
  test("aligns a clean one-to-one transcript", () => {
    const timings = alignWordsToTranscript(
      "Once upon a time",
      recognized(["once", 0, 0.3], ["upon", 0.3, 0.6], ["a", 0.6, 0.7], ["time", 0.7, 1.1]),
    );
    expect(timings).toEqual([
      [0, 4, 0, 300],
      [5, 9, 300, 600],
      [10, 11, 600, 700],
      [12, 16, 700, 1100],
    ]);
  });

  test("ignores punctuation and casing differences", () => {
    const timings = alignWordsToTranscript(
      "“Hello,” she said.",
      recognized(["hello", 0, 0.4], ["she", 0.5, 0.7], ["said", 0.7, 1.0]),
    );
    expect(timings.map(([s, e]) => "“Hello,” she said.".slice(s, e))).toEqual([
      "Hello",
      "she",
      "said",
    ]);
    expect(timings[0]![2]).toBe(0);
    expect(timings[2]![3]).toBe(1000);
  });

  test("interpolates words whisper missed", () => {
    const timings = alignWordsToTranscript(
      "one two three four five six",
      recognized(["one", 0, 0.5], ["two", 0.5, 1], ["five", 3, 3.5], ["six", 3.5, 4]),
    );
    expect(timings).toHaveLength(6);
    // three/four glide across the 1s..3s gap, in order
    expect(timings[2]![2]).toBe(1000);
    expect(timings[2]![3]).toBe(2000);
    expect(timings[3]![2]).toBe(2000);
    expect(timings[3]![3]).toBe(3000);
    expect(timings[4]![2]).toBe(3000);
  });

  test("survives an extra recognized word", () => {
    const timings = alignWordsToTranscript(
      "the little mermaid",
      recognized(["the", 0, 0.2], ["uh", 0.2, 0.3], ["little", 0.3, 0.6], ["mermaid", 0.6, 1.2]),
    );
    expect(timings).toEqual([
      [0, 3, 0, 200],
      [4, 10, 300, 600],
      [11, 18, 600, 1200],
    ]);
  });

  test("rejects an alignment that mostly disagrees", () => {
    const timings = alignWordsToTranscript(
      "completely different words here now",
      recognized(["nothing", 0, 1], ["matches", 1, 2], ["at", 2, 3], ["all", 3, 4], ["ever", 4, 5]),
    );
    expect(timings).toEqual([]);
  });

  test("returns empty for empty inputs", () => {
    expect(alignWordsToTranscript("", recognized(["word", 0, 1]))).toEqual([]);
    expect(alignWordsToTranscript("words here", recognized())).toEqual([]);
  });
});
