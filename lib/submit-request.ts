// Shared plumbing for the /api/submit route handlers.
import type { z } from "zod";

export function json(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

// The request body checked against `schema`, or null when it does not fit.
export async function readJson<T extends z.ZodType>(
  request: Request,
  schema: T,
): Promise<z.infer<T> | null> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return null;
  }
  const parsed = schema.safeParse(body);
  return parsed.success ? parsed.data : null;
}

// The page the student is on. Drive needs it to accept the browser's upload.
export function pageOrigin(request: Request): string {
  return request.headers.get("origin") ?? new URL(request.url).origin;
}
