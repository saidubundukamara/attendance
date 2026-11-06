// Public: the modules in a cohort a student can hand work in for, from the
// last four digits of their ID.
import { z } from "zod";
import { db } from "@/lib/db";
import { getClientIp } from "@/lib/request";
import { lookupCohortModules } from "@/lib/submissions";
import { json, readJson } from "@/lib/submit-request";

const schema = z.object({
  cohortId: z.number().int().positive(),
  studentId: z.string().max(32),
});

export async function POST(request: Request) {
  const body = await readJson(request, schema);
  if (!body) return json({ code: "BAD_REQUEST" }, 400);
  const result = await lookupCohortModules(db, {
    cohortId: body.cohortId,
    studentIdRaw: body.studentId,
    ip: await getClientIp(),
  });
  return json(result, result.code === "RATE_LIMITED" ? 429 : 200);
}
