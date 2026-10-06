"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { z } from "zod";
import { setAttendance } from "@/lib/attendance";
import { requireLecturer } from "@/lib/auth";
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
  await requireLecturer();
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid request." };

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
    after(scheduleSheetSync);
    revalidatePath("/dashboard");
    revalidatePath(`/sessions/${parsed.data.sessionId}`);
  }
  return { ok: true };
}
