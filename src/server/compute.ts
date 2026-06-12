// Prisma Compute snapshots and sleeps an instance shortly after the last
// request settles. That's perfect for request-driven code — and freezing
// for background work: the model generation loop runs detached from the
// request, so a sleeping instance stops reading mid-stream and the
// upstream connection times out (resuming the page wakes the instance and
// the stream picks up exactly where it froze).
//
// Holding the instance awake means writing "+" (acquire) / "-" (release)
// to the runtime's scale-to-zero control file. This mirrors `waitUntil`
// from @prisma/compute (prisma-cli#81); swap to the package once it's
// published. Outside Compute the control file doesn't exist and all of
// this is a no-op.
import { constants, openSync, writeSync } from "node:fs";

const CONTROL_FILE = "/uk/libukp/scale_to_zero_disable";

let controlFd: number | null | undefined;

function signal(kind: "+" | "-") {
  if (controlFd === null) return false;
  try {
    controlFd ??= openSync(CONTROL_FILE, constants.O_WRONLY);
    writeSync(controlFd, kind);
    return true;
  } catch {
    controlFd = null;
    return false;
  }
}

/**
 * Keeps the instance awake until the promise settles, with a hard time cap
 * as the safety bound for work that never settles.
 */
export function waitUntil(work: Promise<unknown>, capMs = 15 * 60_000) {
  if (!signal("+")) return;

  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    clearTimeout(cap);
    signal("-");
  };
  const cap = setTimeout(release, capMs);
  work.then(release, release);
}
