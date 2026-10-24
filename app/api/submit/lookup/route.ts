// Public: a student's name and the class's items, from the last four digits.
import { z } from "zod";
import { db } from "@/lib/db";
import { getClientIp } from "@/lib/request";
import { lookupStudent } from "@/lib/submissions";
import { json, readJson } from "@/lib/submit-request";

const schema = z.object({
  classId: z.number().int().positive(),
  studentId: z.string().max(32),
});

export async function POST(request: Request) {
  const body = await readJson(request, schema);
  if (!body) return json({ code: "BAD_REQUEST" }, 400);
  const result = await lookupStudent(db, {
    classId: body.classId,
    studentIdRaw: body.studentId,
    ip: await getClientIp(),
  });
  return json(result, result.code === "RATE_LIMITED" ? 429 : 200);
}
