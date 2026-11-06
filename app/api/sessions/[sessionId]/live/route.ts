import { getSignedInLecturer } from "@/lib/auth";
import { after } from "next/server";
import { getLiveSession } from "@/lib/data/sessions";
import { retryStalledSync } from "@/lib/sheets/sync";

// Counts and student list for the session page. Polled every few seconds.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const lecturer = await getSignedInLecturer();
  if (!lecturer) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { sessionId } = await params;
  const live = await getLiveSession(lecturer.id, sessionId);
  if (!live) {
    return Response.json({ error: "Session not found" }, { status: 404 });
  }
  // The open session page doubles as the retry timer for a stuck sheet sync.
  if (live.sync.stalled) after(() => retryStalledSync(lecturer.id));
  return Response.json(live, { headers: { "Cache-Control": "no-store" } });
}
