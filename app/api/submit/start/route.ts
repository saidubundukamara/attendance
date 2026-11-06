// Public: checks a submission and opens one Drive upload per file.
import { z } from "zod";
import { db } from "@/lib/db";
import { lecturerOfClass } from "@/lib/data/ownership";
import { driveFor } from "@/lib/google/drive";
import { getClientIp } from "@/lib/request";
import { MAX_FILES } from "@/lib/submission-files";
import { startSubmission } from "@/lib/submissions";
import { json, pageOrigin, readJson } from "@/lib/submit-request";

const schema = z.object({
  classId: z.number().int().positive(),
  studentId: z.string().max(32),
  assignmentId: z.number().int().positive(),
  // Group mates' IDs; empty for individual work.
  members: z.array(z.string().max(32)).max(20).default([]),
  files: z
    .array(
      z.object({
        name: z.string().max(500),
        size: z.number().int().nonnegative(),
        type: z.string().max(200),
      }),
    )
    // One over the limit so the student gets the friendly message.
    .max(MAX_FILES + 1),
});

export async function POST(request: Request) {
  const body = await readJson(request, schema);
  if (!body) return json({ code: "BAD_REQUEST" }, 400);
  // Files go to the Drive of the lecturer who owns the class.
  const lecturer = await lecturerOfClass(db, body.classId);
  if (!lecturer) return json({ code: "NOT_FOUND" });
  if (!lecturer.refreshTokenEnc) return json({ code: "UPLOAD_FAILED" });
  const result = await startSubmission(db, driveFor(lecturer), {
    classId: body.classId,
    studentIdRaw: body.studentId,
    assignmentId: body.assignmentId,
    memberIdsRaw: body.members,
    files: body.files,
    origin: pageOrigin(request),
    ip: await getClientIp(),
    userAgent: request.headers.get("user-agent") ?? "",
  });
  return json(result, result.code === "RATE_LIMITED" ? 429 : 200);
}
