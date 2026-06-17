// Word timing helpers for spoken replies. Audio-output models stream both
// transcript fragments and PCM chunks through OpenRouter; the app derives
// read-along timings from those chunks instead of making a second model
// call.
import type { WordTiming } from "../shared/contracts";

type TextWord = { text: string; start: number; end: number };

// Word = letters/digits plus inner apostrophes-ish; offsets into the text.
const WORD_PATTERN = /[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu;

export function tokenizeWords(text: string): Array<TextWord> {
  const words: Array<TextWord> = [];
  for (const match of text.matchAll(WORD_PATTERN)) {
    words.push({
      text: match[0],
      start: match.index,
      end: match.index + match[0].length,
    });
  }
  return words;
}

export function estimateWordTimings(
  text: string,
  {
    charOffset,
    startMs,
    endMs,
  }: { charOffset: number; startMs: number; endMs: number },
): Array<WordTiming> {
  const words = tokenizeWords(text);
  if (!words.length) return [];

  const start = Math.max(0, Math.round(startMs));
  const end =
    endMs > startMs
      ? Math.max(start + 1, Math.round(endMs))
      : start + words.length * 180;
  const span = end - start;
  const weights = words.map((word) => Math.max(1, word.text.length));
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  let elapsedWeight = 0;

  return words.map((word, index) => {
    const wordStart = start + Math.round((span * elapsedWeight) / totalWeight);
    elapsedWeight += weights[index]!;
    const wordEnd =
      index === words.length - 1
        ? end
        : start + Math.round((span * elapsedWeight) / totalWeight);
    return [
      charOffset + word.start,
      charOffset + word.end,
      wordStart,
      Math.max(wordStart + 1, wordEnd),
    ];
  });
}

export function estimateTimingSpan(
  text: string,
  {
    charOffset,
    startMs,
    endMs,
  }: { charOffset: number; startMs: number; endMs: number },
): WordTiming | undefined {
  const words = tokenizeWords(text);
  if (!words.length) return undefined;

  const start = Math.max(0, Math.round(startMs));
  const end =
    endMs > startMs
      ? Math.max(start + 1, Math.round(endMs))
      : start + words.length * 180;

  return [
    charOffset + words[0]!.start,
    charOffset + words.at(-1)!.end,
    start,
    end,
  ];
}
