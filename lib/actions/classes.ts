"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireLecturer } from "@/lib/auth";
import { db } from "@/lib/db";
import { classes } from "@/lib/db/schema";
import type { RosterSyncReport } from "@/lib/sheets/roster";
import { retrySheetSync, syncRoster } from "@/lib/sheets/sync";
import { getSyncStatus } from "@/lib/sheets/write";
import { isIsoDate } from "@/lib/week";

export type SyncState =
  | { ok: true; report: RosterSyncReport }
  | { ok: false; error: string }
  | undefined;

export async function syncRosterAction(): Promise<SyncState> {
  await requireLecturer();
  try {
    const report = await syncRoster();
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
});

export async function updateClassSettings(
  _prev: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  await requireLecturer();
  const parsed = settingsSchema.safeParse({
    classId: formData.get("classId"),
    startDate: formData.get("startDate") ?? "",
    totalWeeks: formData.get("totalWeeks"),
  });
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0].message };
  }

  const { classId, startDate, totalWeeks } = parsed.data;
  const result = db
    .update(classes)
    .set({ startDate: startDate || null, totalWeeks })
    .where(eq(classes.id, classId))
    .run();
  if (result.changes === 0) return { ok: false, message: "Class not found." };

  revalidatePath("/dashboard");
  revalidatePath(`/classes/${classId}`);
  return { ok: true, message: "Saved." };
}

export type RetryState =
  | { done: number; pending: number; error: string | null }
  | undefined;

export async function retrySheetSyncAction(): Promise<RetryState> {
  await requireLecturer();
  let done = 0;
  try {
    done = (await retrySheetSync()).done;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { done, pending: getSyncStatus(db).pending, error: message };
  }
  const status = getSyncStatus(db);
  revalidatePath("/dashboard");
  return { done, pending: status.pending, error: status.lastError };
}
