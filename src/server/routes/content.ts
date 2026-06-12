// Serves full-resolution images out of the content store (R2 in
// production) — the browser only ever talks to this proxy, never to the
// bucket. Each object is restricted to the user who owns it; a miss is a
// 404 either way, so ids leak nothing.
import { contentIdSchema } from "../../shared/contracts";
import { HttpError, assertMethod, requireUser } from "../http";
import { contentReadableBy, readContent } from "../content";

export async function getContent(request: Request, id: string) {
  assertMethod(request, ["GET"]);
  const user = await requireUser(request);
  if (!contentIdSchema.safeParse(id).success) {
    throw new HttpError(400, "Invalid content id");
  }
  if (!(await contentReadableBy(id, user.id))) {
    throw new HttpError(404, "Not found");
  }

  const response = await readContent(id, request.headers.get("range"));
  if (!response) throw new HttpError(404, "Not found");
  return response;
}
