import { describe, expect, test } from "bun:test";
import { splitCompletePcmFrames } from "../src/shared/pcm";

describe("PCM frame splitting", () => {
  test("carries incomplete mono sample bytes into the next chunk", () => {
    const first = splitCompletePcmFrames(
      new Uint8Array(),
      new Uint8Array([1, 2, 3]),
      2,
    );

    expect([...first.complete]).toEqual([1, 2]);
    expect([...first.remainder]).toEqual([3]);

    const second = splitCompletePcmFrames(
      first.remainder,
      new Uint8Array([4, 5, 6]),
      2,
    );

    expect([...second.complete]).toEqual([3, 4, 5, 6]);
    expect([...second.remainder]).toEqual([]);
  });

  test("carries incomplete stereo frames", () => {
    const split = splitCompletePcmFrames(
      new Uint8Array([1]),
      new Uint8Array([2, 3, 4, 5, 6]),
      4,
    );

    expect([...split.complete]).toEqual([1, 2, 3, 4]);
    expect([...split.remainder]).toEqual([5, 6]);
  });
});
