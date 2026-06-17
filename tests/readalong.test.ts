import { describe, expect, test } from "bun:test";
import {
  readAlongActiveRange,
  readAlongSegments,
  readAlongTimingAt,
} from "../src/client/readalong";
import type { WordTiming } from "../src/shared/contracts";

describe("read-along span selection", () => {
  const text = "First phrase second phrase";
  const spans: Array<WordTiming> = [
    [0, 12, 0, 600],
    [13, 26, 600, 1200],
  ];

  test("selects the span currently covered by playback time", () => {
    expect(readAlongTimingAt(spans, 0)).toBe(0);
    expect(readAlongTimingAt(spans, 599)).toBe(0);
    expect(readAlongTimingAt(spans, 600)).toBe(1);
    expect(readAlongTimingAt(spans, 900)).toBe(1);
  });

  test("segments text by supplied spans without inventing word spans", () => {
    expect(readAlongSegments(text, spans)).toEqual([
      { text: "First phrase", index: 0 },
      { text: " " },
      { text: "second phrase", index: 1 },
    ]);
  });

  test("highlights a trailing range without including future spans", () => {
    const wordSpans: Array<WordTiming> = [
      [0, 5, 0, 350],
      [6, 10, 350, 700],
      [11, 16, 700, 1050],
      [17, 23, 1050, 1400],
    ];

    expect(readAlongActiveRange("alpha beta gamma future", wordSpans, 900)).toEqual({
      start: 0,
      end: 2,
    });
  });
});
