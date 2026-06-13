// Forced alignment between a spoken reply's transcript (the message text)
// and whisper's word-level timestamps for the same audio.
//
// The audio was generated *from* this text, so the two word sequences are
// nearly identical — differences are punctuation, casing, and the odd
// number-vs-word substitution. A monotonic two-pointer walk with a small
// resync window absorbs those; transcript words whisper missed get times
// interpolated from their neighbors. If fewer than half the words match,
// the alignment is judged untrustworthy and dropped entirely.
import type { WordTiming } from "../shared/contracts";

export type RecognizedWord = { word: string; start: number; end: number };

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

function normalize(word: string) {
  return word
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

/**
 * Pair transcript words with recognized words, monotonically. Returns
 * per-transcript-word timings ([charStart, charEnd, startMs, endMs]) or []
 * when the sequences disagree too much to trust.
 */
export function alignWordsToTranscript(
  text: string,
  recognized: Array<RecognizedWord>,
): Array<WordTiming> {
  const words = tokenizeWords(text);
  if (!words.length || !recognized.length) return [];

  const RESYNC_WINDOW = 4;
  const times: Array<{ start: number; end: number } | undefined> = new Array(
    words.length,
  );
  let matched = 0;
  let i = 0;
  let j = 0;

  while (i < words.length && j < recognized.length) {
    if (normalize(words[i]!.text) === normalize(recognized[j]!.word)) {
      times[i] = { start: recognized[j]!.start, end: recognized[j]!.end };
      matched++;
      i++;
      j++;
      continue;
    }

    // Out of sync: find the nearest upcoming pair that matches again.
    let advanceI = -1;
    let advanceJ = -1;
    outer: for (let span = 1; span <= RESYNC_WINDOW; span++) {
      for (let di = 0; di <= span; di++) {
        const dj = span - di;
        if (i + di >= words.length || j + dj >= recognized.length) continue;
        if (
          normalize(words[i + di]!.text) === normalize(recognized[j + dj]!.word)
        ) {
          advanceI = di;
          advanceJ = dj;
          break outer;
        }
      }
    }
    if (advanceI === -1) {
      // No resync point nearby — skip one of each and keep walking.
      i++;
      j++;
      continue;
    }
    i += advanceI;
    j += advanceJ;
  }

  if (matched / words.length < 0.5) return [];

  // Fill gaps: untimed words inherit a linear slice of the span between
  // their timed neighbors, so highlighting glides through them. Words
  // before the first match spread backwards from it; words after the last
  // match walk forward at a nominal per-word pace.
  const NOMINAL_WORD_SECONDS = 0.25;
  let lastTimed = -1;
  for (let k = 0; k <= words.length; k++) {
    const timed = k < words.length ? times[k] : undefined;
    if (!timed && k < words.length) continue;

    const gapStart = lastTimed + 1;
    const gapEnd = k - 1;
    if (gapEnd >= gapStart) {
      const slots = gapEnd - gapStart + 1;
      const from =
        lastTimed >= 0
          ? times[lastTimed]!.end
          : Math.max(0, (timed?.start ?? 0) - slots * NOMINAL_WORD_SECONDS);
      const to =
        timed?.start ??
        (times[lastTimed]?.end ?? 0) + slots * NOMINAL_WORD_SECONDS;
      const span = Math.max(0, to - from);
      for (let g = 0; g < slots; g++) {
        times[gapStart + g] = {
          start: from + (span * g) / slots,
          end: from + (span * (g + 1)) / slots,
        };
      }
    }
    lastTimed = k;
  }

  return words.map((word, k) => [
    word.start,
    word.end,
    Math.max(0, Math.round((times[k]?.start ?? 0) * 1000)),
    Math.max(0, Math.round((times[k]?.end ?? 0) * 1000)),
  ]);
}
