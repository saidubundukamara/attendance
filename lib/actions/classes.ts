"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { z } from "zod";
import { requireLecturer } from "@/lib/auth";
import { db } from "@/lib/db";
import { classes, cohorts } from "@/lib/db/schema";
import type { RosterSyncReport } from "@/lib/sheets/roster";
import {
  retrySheetSync,
  scheduleSubmissionsSyncAfterRoster,
  syncRoster,
} from "@/lib/sheets/sync";
import { getSyncStatus } from "@/lib/sheets/write";
import { isIsoDate } from "@/lib/week";

export type SyncState =
  | { ok: true; report: RosterSyncReport }
  | { ok: false; error: string }
  | undefined;

export async function syncRosterAction(): Promise<SyncState> {
  const lecturer = await requireLecturer();
  try {
    const report = await syncRoster(lecturer);
    after(() => scheduleSubmissionsSyncAfterRoster(lecturer.id, report));
    revalidatePath("/dashboard");
    return { ok: true, report };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: message };
  }
}

export type SettingsState = { ok: boolean; message: string } | undefined;

const settingsSchema = z.object({
  classId: z.coerce.number().int().positive(),
  startDate: z
    .string()
    .trim()
    .refine((value) => value === "" || isIsoDate(value), "Enter a valid date."),
  totalWeeks: z.coerce
    .number("Enter the number of weeks.")
    .int("Weeks must be a whole number.")
    .min(1, "Weeks must be at least 1.")
    .max(52, "Weeks must be 52 or fewer."),
  // "" for none.
  cohortId: z.union([z.literal(""), z.coerce.number().int().positive()]),
});

export async function updateClassSettings(
  _prev: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  const lecturer = await requireLecturer();
  const parsed = settingsSchema.safeParse({
    classId: formData.get("classId"),
    startDate: formData.get("startDate") ?? "",
    totalWeeks: formData.get("totalWeeks"),
    cohortId: formData.get("cohortId") ?? "",
  });
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0].message };
  }

  const { classId, startDate, totalWeeks } = parsed.data;
  const cohortId = parsed.data.cohortId === "" ? null : parsed.data.cohortId;
  if (cohortId !== null) {
    const cohort = await db
      .select({ id: cohorts.id })
      .from(cohorts)
      .where(eq(cohorts.id, cohortId))
      .get();
    if (!cohort) return { ok: false, message: "That cohort no longer exists." };
  }
  const result = await db
    .update(classes)
    .set({ startDate: startDate || null, totalWeeks, cohortId })
    .where(and(eq(classes.id, classId), eq(classes.lecturerId, lecturer.id)))
    .run();
  if (result.rowsAffected === 0)
    return { ok: false, message: "Class not found." };

  revalidatePath("/dashboard");
  revalidatePath(`/classes/${classId}`);
  return { ok: true, message: "Saved." };
}

export type RetryState =
  { done: number; pending: number; error: string | null } | undefined;

export async function retrySheetSyncAction(): Promise<RetryState> {
  const lecturer = await requireLecturer();
  let done = 0;
  try {
    done = (await retrySheetSync(lecturer.id)).done;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      done,
      pending: (await getSyncStatus(db, lecturer.id)).pending,
      error: message,
    };
  }
  const status = await getSyncStatus(db, lecturer.id);
  revalidatePath("/dashboard");
  return { done, pending: status.pending, error: status.lastError };
}
