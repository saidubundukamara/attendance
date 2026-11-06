"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { z } from "zod";
import { setAttendance } from "@/lib/attendance";
import { requireLecturer } from "@/lib/auth";
import { ownsSession, ownsStudent } from "@/lib/data/ownership";
import { db } from "@/lib/db";
import { scheduleSheetSync } from "@/lib/sheets/sync";

const schema = z.object({
  sessionId: z.string().min(1).max(64),
  studentId: z.number().int().positive(),
  status: z.enum(["PRESENT", "ABSENT"]),
  reason: z.string().max(200).optional(),
});

export type SetAttendanceState = { ok: true } | { ok: false; error: string };

export async function setAttendanceAction(
  input: z.input<typeof schema>,
): Promise<SetAttendanceState> {
  const lecturer = await requireLecturer();
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid request." };
  if (
    !(await ownsSession(db, lecturer.id, parsed.data.sessionId)) ||
    !(await ownsStudent(db, lecturer.id, parsed.data.studentId))
  ) {
    return { ok: false, error: "Session not found." };
  }

  const result = await setAttendance(db, parsed.data);
  if (!result.ok) {
    const messages = {
      SESSION_NOT_FOUND: "Session not found.",
      STUDENT_NOT_FOUND: "Student not found.",
      NOT_ENROLLED: "This student is no longer on the class list in the sheet.",
    };
    return { ok: false, error: messages[result.reason] };
  }

  if (result.changed) {
    after(() => scheduleSheetSync(lecturer.id));
    revalidatePath("/dashboard");
    revalidatePath(`/sessions/${parsed.data.sessionId}`);
  }
  return { ok: true };
}
