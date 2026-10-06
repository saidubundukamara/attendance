import { isLecturer } from "@/lib/auth";
import { getSessionStatus } from "@/lib/data/sessions";
import { buildSessionQr } from "@/lib/qr";

// Current QR for an active session. Polled by the projector view.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  if (!(await isLecturer())) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { sessionId } = await params;
  const session = await getSessionStatus(sessionId);
  if (!session) {
    return Response.json({ error: "Session not found" }, { status: 404 });
  }
  if (session.status !== "ACTIVE") {
    return Response.json({ error: "Session closed" }, { status: 409 });
  }
  return Response.json(await buildSessionQr(sessionId), {
    headers: { "Cache-Control": "no-store" },
  });
}
