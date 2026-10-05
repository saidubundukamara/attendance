"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { z } from "zod";
import { requireLecturer } from "@/lib/auth";
import { db } from "@/lib/db";
import { closeSession, openSession, recordPastWeek } from "@/lib/sessions";
import { scheduleSheetSync, syncRoster } from "@/lib/sheets/sync";

export type StartState =
  | { error: string; activeSessionId?: string }
  | undefined;

const startSchema = z.object({
  classId: z.coerce.number().int().positive(),
  week: z.coerce.number().int().positive(),
});

export async function startSession(
  _prev: StartState,
  formData: FormData,
): Promise<StartState> {
  await requireLecturer();
  const parsed = startSchema.safeParse({
    classId: formData.get("classId"),
    week: formData.get("week"),
  });
  if (!parsed.success) return { error: "Choose a class and week." };
  const { classId, week } = parsed.data;

  // Pick up students added to the sheet since the last sync. If the sheet
  // cannot be reached, carry on with the roster already stored.
  let rosterStale = false;
  try {
    await syncRoster();
  } catch {
    rosterStale = true;
  }

  const result = openSession(db, classId, week);
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
  await requireLecturer();
  const sessionId = formData.get("sessionId");
  if (typeof sessionId !== "string" || !sessionId) return;
  closeSession(db, sessionId);
  // Flush anything still queued for the sheet.
  after(scheduleSheetSync);
  revalidatePath("/dashboard");
  revalidatePath(`/sessions/${sessionId}`);
}

export async function recordPastWeekAction(
  classId: number,
  week: number,
): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireLecturer();
  const parsed = startSchema.safeParse({ classId, week });
  if (!parsed.success) return { ok: false, error: "Invalid request." };
  const result = recordPastWeek(db, parsed.data.classId, parsed.data.week);
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
