"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { z } from "zod";
import { requireLecturer } from "@/lib/auth";
import { db } from "@/lib/db";
import { ownsClass, ownsSession } from "@/lib/data/ownership";
import { closeSession, openSession, recordPastWeek } from "@/lib/sessions";
import {
  scheduleSheetSync,
  scheduleSubmissionsSyncAfterRoster,
  syncRoster,
} from "@/lib/sheets/sync";

export type StartState =
  { error: string; activeSessionId?: string } | undefined;

const startSchema = z.object({
  classId: z.coerce.number().int().positive(),
  week: z.coerce.number().int().positive(),
});

export async function startSession(
  _prev: StartState,
  formData: FormData,
): Promise<StartState> {
  const lecturer = await requireLecturer();
  const parsed = startSchema.safeParse({
    classId: formData.get("classId"),
    week: formData.get("week"),
  });
  if (!parsed.success) return { error: "Choose a class and week." };
  const { classId, week } = parsed.data;
  if (!(await ownsClass(db, lecturer.id, classId))) {
    return { error: "Class not found. Sync the roster and try again." };
  }

  // Pick up students added to the sheet since the last sync. If the sheet
  // cannot be reached, carry on with the roster already stored.
  let rosterStale = false;
  try {
    const report = await syncRoster(lecturer);
    after(() => scheduleSubmissionsSyncAfterRoster(lecturer.id, report));
  } catch {
    rosterStale = true;
  }

  const result = await openSession(db, classId, week);
  if (!result.ok) {
    switch (result.reason) {
      case "CLASS_NOT_FOUND":
        return { error: "Class not found. Sync the roster and try again." };
      case "BAD_WEEK":
        return { error: "That week is outside this class's teaching weeks." };
      case "ACTIVE_EXISTS":
        return {
          error: `Week ${result.week} attendance is still open for this class. End it first.`,
          activeSessionId: result.sessionId,
        };
    }
  }

  revalidatePath("/dashboard");
  redirect(
    `/sessions/${result.sessionId}${rosterStale ? "?roster=stale" : ""}`,
  );
}

export async function endSession(formData: FormData): Promise<void> {
  const lecturer = await requireLecturer();
  const sessionId = formData.get("sessionId");
  if (typeof sessionId !== "string" || !sessionId) return;
  if (!(await ownsSession(db, lecturer.id, sessionId))) return;
  await closeSession(db, sessionId);
  // Flush anything still queued for the sheet.
  after(() => scheduleSheetSync(lecturer.id));
  revalidatePath("/dashboard");
  revalidatePath(`/sessions/${sessionId}`);
}

export async function recordPastWeekAction(
  classId: number,
  week: number,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const lecturer = await requireLecturer();
  const parsed = startSchema.safeParse({ classId, week });
  if (!parsed.success) return { ok: false, error: "Invalid request." };
  if (!(await ownsClass(db, lecturer.id, parsed.data.classId))) {
    return { ok: false, error: "Class not found." };
  }
  const result = await recordPastWeek(
    db,
    parsed.data.classId,
    parsed.data.week,
  );
  if (!result.ok) {
    return {
      ok: false,
      error:
        result.reason === "BAD_WEEK"
          ? "That week is outside this class's teaching weeks."
          : "Class not found.",
    };
  }
  revalidatePath("/dashboard");
  revalidatePath(`/classes/${parsed.data.classId}`);
  return { ok: true };
}
