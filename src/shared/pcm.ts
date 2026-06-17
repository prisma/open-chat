export function splitCompletePcmFrames(
  remainder: Uint8Array,
  next: Uint8Array,
  frameBytes: number,
) {
  if (!Number.isInteger(frameBytes) || frameBytes <= 0) {
    throw new Error("PCM frame size must be a positive integer");
  }

  const merged = new Uint8Array(remainder.length + next.length);
  merged.set(remainder);
  merged.set(next, remainder.length);

  const completeLength = merged.length - (merged.length % frameBytes);
  return {
    complete: merged.slice(0, completeLength),
    remainder: merged.slice(completeLength),
  };
}
