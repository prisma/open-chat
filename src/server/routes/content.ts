// Serves full-resolution images out of the content store (R2 in
// production) — the browser only ever talks to this proxy, never to the
// bucket. Any signed-in session may fetch: ids are unguessable UUIDs.
import { contentIdSchema } from "../../shared/contracts";
import { HttpError, assertMethod, requireUser } from "../http";
import { readContent } from "../content";

export async function getContent(request: Request, id: string) {
  assertMethod(request, ["GET"]);
  await requireUser(request);
  if (!contentIdSchema.safeParse(id).success) {
    throw new HttpError(400, "Invalid content id");
  }

  const response = await readContent(id);
  if (!response) throw new HttpError(404, "Not found");
  return response;
}
