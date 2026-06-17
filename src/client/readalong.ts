import type { WordTiming } from "../shared/contracts";

const NEXT_SPAN_SNAP_MS = 24;
const TRAILING_HIGHLIGHT_MS = 1100;
const MAX_ACTIVE_SPANS = 8;

export type ReadAlongRange = { start: number; end: number };

export function readAlongTimingAt(
  timings: Array<WordTiming>,
  currentMs: number,
) {
  const ms = Math.max(0, currentMs);
  let lo = 0;
  let hi = timings.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (timings[mid]![2] <= ms) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  if (found < 0) {
    return timings[0] && timings[0][2] - ms <= NEXT_SPAN_SNAP_MS ? 0 : -1;
  }
  if (ms <= timings[found]![3]) return found;
  const next = found + 1;
  return timings[next] && timings[next]![2] - ms <= NEXT_SPAN_SNAP_MS
    ? next
    : found;
}

export function readAlongActiveRange(
  text: string,
  timings: Array<WordTiming>,
  currentMs: number,
): ReadAlongRange {
  const active = readAlongTimingAt(timings, currentMs);
  if (active < 0) return { start: -1, end: -1 };

  const minMs = Math.max(0, currentMs - TRAILING_HIGHLIGHT_MS);
  let start = active;
  while (start > 0 && active - start < MAX_ACTIVE_SPANS - 1) {
    const previous = timings[start - 1]!;
    const current = timings[start]!;
    const gapMs = current[2] - previous[3];
    const boundaryText = text.slice(previous[1], current[0]);
    if (gapMs > 350 || /[.!?]/u.test(boundaryText)) break;
    if (previous[3] < minMs) break;
    start--;
  }

  return { start, end: active };
}

export function readAlongSegments(text: string, timings: Array<WordTiming>) {
  const out: Array<{ text: string; index?: number }> = [];
  let cursor = 0;
  timings.forEach(([start, end], index) => {
    if (start > cursor) out.push({ text: text.slice(cursor, start) });
    out.push({ text: text.slice(start, end), index });
    cursor = end;
  });
  if (cursor < text.length) out.push({ text: text.slice(cursor) });
  return out;
}
