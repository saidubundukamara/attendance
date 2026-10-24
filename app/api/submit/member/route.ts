// Public: a group mate's name from the last four digits of their ID, so the
// student adding them can see they typed the right one.
import { z } from "zod";
import { db } from "@/lib/db";
import { getClientIp } from "@/lib/request";
import { lookupMember } from "@/lib/submissions";
import { json, readJson } from "@/lib/submit-request";

const schema = z.object({
  classId: z.number().int().positive(),
  assignmentId: z.number().int().positive(),
  studentId: z.string().max(32),
  memberId: z.string().max(32),
});

export async function POST(request: Request) {
  const body = await readJson(request, schema);
  if (!body) return json({ code: "BAD_REQUEST" }, 400);
  const result = await lookupMember(db, {
    classId: body.classId,
    assignmentId: body.assignmentId,
    submitterRaw: body.studentId,
    memberRaw: body.memberId,
    ip: await getClientIp(),
  });
  return json(result, result.code === "RATE_LIMITED" ? 429 : 200);
}
