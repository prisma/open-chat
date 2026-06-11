import { ZodError } from "zod";
import { getSession } from "./auth";

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export function json(data: unknown, status = 200, headers?: HeadersInit) {
  return Response.json(data, headers ? { status, headers } : { status });
}

export function noContent() {
  return new Response(null, { status: 204 });
}

// For bulky JSON payloads (the model catalog is ~165 KB): gzip when the
// client supports it. Small responses aren't worth the negotiation.
export function gzipJson(
  request: Request,
  data: unknown,
  headers: Record<string, string> = {},
) {
  if (!request.headers.get("Accept-Encoding")?.includes("gzip")) {
    return json(data, 200, headers);
  }
  return new Response(Bun.gzipSync(Buffer.from(JSON.stringify(data))), {
    headers: {
      "Content-Type": "application/json;charset=utf-8",
      "Content-Encoding": "gzip",
      Vary: "Accept-Encoding",
      ...headers,
    },
  });
}

export async function parseJson(request: Request) {
  try {
    return await request.json();
  } catch {
    throw new HttpError(400, "Expected a JSON request body");
  }
}

export async function requireUser(request: Request) {
  const session = await getSession(request);

  if (!session) {
    throw new HttpError(401, "Authentication required");
  }

  return session.user;
}

export function handleError(error: unknown) {
  if (error instanceof HttpError) {
    return json({ error: error.message }, error.status);
  }

  if (error instanceof ZodError) {
    return json({ error: "Validation failed", issues: error.issues }, 400);
  }

  console.error(error);
  return json({ error: "Internal server error" }, 500);
}

export function getPathId(pathname: string, prefix: string, suffix = "") {
  if (!pathname.startsWith(prefix)) return null;
  if (suffix && !pathname.endsWith(suffix)) return null;

  const start = prefix.length;
  const end = suffix ? pathname.length - suffix.length : pathname.length;
  const value = pathname.slice(start, end);

  if (!value || value.includes("/")) return null;
  return decodeURIComponent(value);
}

export function assertMethod(request: Request, methods: Array<string>) {
  if (!methods.includes(request.method)) {
    throw new HttpError(405, "Method not allowed");
  }
}

export function sseEncode(event: string, data: unknown, id?: string) {
  const lines = [`event: ${event}`];
  if (id) lines.push(`id: ${id}`);
  lines.push(`data: ${JSON.stringify(data)}`);
  lines.push("");
  return `${lines.join("\n")}\n`;
}
