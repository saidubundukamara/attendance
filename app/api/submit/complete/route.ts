// Public: confirms the files reached Drive and records the submission.
import { after } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { googleDrive } from "@/lib/google/drive";
import { getClientIp } from "@/lib/request";
import { scheduleSubmissionsSync } from "@/lib/sheets/sync";
import { MAX_FILES } from "@/lib/submission-files";
import { completeSubmission } from "@/lib/submissions";
import { json, readJson } from "@/lib/submit-request";

const schema = z.object({
  submissionId: z.number().int().positive(),
  token: z.string().uuid(),
  uploads: z
    .array(
      z.object({
        fileId: z.number().int().positive(),
        driveFileId: z.string().min(1).max(200),
      }),
    )
    .max(MAX_FILES),
});

export async function POST(request: Request) {
  const body = await readJson(request, schema);
  if (!body) return json({ code: "BAD_REQUEST" }, 400);
  const result = await completeSubmission(db, googleDrive, {
    ...body,
    ip: await getClientIp(),
  });
  // The student gets their answer first; the sheet is updated afterwards.
  if (result.code === "OK") {
    const classId = result.classId;
    after(() => scheduleSubmissionsSync(classId));
  }
  return json(result, result.code === "RATE_LIMITED" ? 429 : 200);
}
