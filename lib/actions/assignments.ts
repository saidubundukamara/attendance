"use server";

import { and, eq, ne, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { z } from "zod";
import { requireLecturer } from "@/lib/auth";
import { hasSubmissions } from "@/lib/data/assignments";
import { db, type Db } from "@/lib/db";
import { assignments, classes, submissions } from "@/lib/db/schema";
import { googleDrive } from "@/lib/google/drive";
import { scheduleSubmissionsSync, syncSubmissionsTab } from "@/lib/sheets/sync";
import { ensureAssignmentFolder, rejudgeLateness } from "@/lib/submissions";
import { appTimeZone, localInputToMs } from "@/lib/timezone";

export type AssignmentState =
  { ok: boolean; message: string; id?: number } | undefined;

const fieldsSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, "Enter a title.")
    .max(100, "Keep the title under 100 characters."),
  kind: z.enum(["ASSIGNMENT", "CLASSWORK", "PROJECT"]),
  dueAt: z.string().trim().min(1, "Enter a deadline."),
  instructions: z
    .string()
    .trim()
    .max(2000, "Keep the instructions under 2000 characters."),
  groupWork: z.boolean(),
  maxGroupSize: z.coerce
    .number()
    .int("Enter a whole number for the group size.")
    .min(2, "A group needs at least 2 people.")
    .max(10, "Keep groups to 10 people or fewer."),
});

function readFields(formData: FormData) {
  const groupWork = formData.get("groupWork") === "on";
  return fieldsSchema.safeParse({
    title: formData.get("title") ?? "",
    kind: formData.get("kind") ?? "ASSIGNMENT",
    dueAt: formData.get("dueAt") ?? "",
    instructions: formData.get("instructions") ?? "",
    groupWork,
    // Only checked when the item is group work.
    maxGroupSize: groupWork ? (formData.get("maxGroupSize") ?? "") : 2,
  });
}

function groupFields(data: { groupWork: boolean; maxGroupSize: number }) {
  return {
    groupWork: data.groupWork,
    maxGroupSize: data.groupWork ? data.maxGroupSize : null,
  };
}

const id = z.coerce.number().int().positive();

async function titleTaken(
  db: Pick<Db, "select">,
  classId: number,
  title: string,
  exceptId?: number,
) {
  const row = await db
    .select({ id: assignments.id })
    .from(assignments)
    .where(
      and(
        eq(assignments.classId, classId),
        eq(assignments.title, title),
        exceptId ? ne(assignments.id, exceptId) : undefined,
      ),
    )
    .get();
  return Boolean(row);
}

// The Drive folder and the sheet column are made in the background; a
// failure there must not lose the item itself.
function afterChange(classId: number, assignmentId: number) {
  after(async () => {
    try {
      await ensureAssignmentFolder(db, googleDrive, assignmentId);
    } catch (error) {
      console.error("Could not create the Drive folder", error);
    }
    await scheduleSubmissionsSync(classId);
  });
}

export async function createAssignment(
  _prev: AssignmentState,
  formData: FormData,
): Promise<AssignmentState> {
  await requireLecturer();
  const classId = id.safeParse(formData.get("classId"));
  const parsed = readFields(formData);
  if (!classId.success) return { ok: false, message: "Class not found." };
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0].message };
  }
  const { title, kind, instructions } = parsed.data;
  const dueAt = localInputToMs(parsed.data.dueAt, appTimeZone());
  if (dueAt === null) return { ok: false, message: "Enter a valid deadline." };

  const cls = await db
    .select({ id: classes.id })
    .from(classes)
    .where(eq(classes.id, classId.data))
    .get();
  if (!cls) return { ok: false, message: "Class not found." };

  // One statement, so two saves of the same title can't both get through.
  const row = await db
    .insert(assignments)
    .values({
      classId: cls.id,
      title,
      kind,
      dueAt,
      instructions: instructions || null,
      ...groupFields(parsed.data),
      createdAt: Date.now(),
    })
    .onConflictDoNothing({ target: [assignments.classId, assignments.title] })
    .returning({ id: assignments.id })
    .get();
  if (!row) {
    return { ok: false, message: `This class already has “${title}”.` };
  }

  afterChange(cls.id, row.id);
  revalidatePath(`/classes/${cls.id}`);
  return { ok: true, message: `Added “${title}”.`, id: row.id };
}

export async function updateAssignment(
  _prev: AssignmentState,
  formData: FormData,
): Promise<AssignmentState> {
  await requireLecturer();
  const assignmentId = id.safeParse(formData.get("assignmentId"));
  const parsed = readFields(formData);
  if (!assignmentId.success) return { ok: false, message: "Item not found." };
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0].message };
  }
  const { title, kind, instructions } = parsed.data;
  const dueAt = localInputToMs(parsed.data.dueAt, appTimeZone());
  if (dueAt === null) return { ok: false, message: "Enter a valid deadline." };

  // In one transaction, which holds the write lock: no submission can start
  // and no other save can land between these checks and the update.
  type Saved =
    | { ok: false; message: string }
    | { ok: true; current: typeof assignments.$inferSelect };
  const result = await db.transaction(async (tx): Promise<Saved> => {
    const current = await tx
      .select()
      .from(assignments)
      .where(eq(assignments.id, assignmentId.data))
      .get();
    if (!current) return { ok: false, message: "Item not found." };
    if (await titleTaken(tx, current.classId, title, current.id)) {
      return { ok: false, message: `This class already has “${title}”.` };
    }

    // Group settings are fixed once anyone has started handing in, so no
    // existing group falls outside them.
    const group = (await hasSubmissions(tx, current.id))
      ? { groupWork: current.groupWork, maxGroupSize: current.maxGroupSize }
      : groupFields(parsed.data);
    await tx
      .update(assignments)
      .set({ title, kind, dueAt, instructions: instructions || null, ...group })
      .where(eq(assignments.id, current.id))
      .run();
    if (dueAt !== current.dueAt) await rejudgeLateness(tx, current.id);
    return { ok: true, current };
  });
  if (!result.ok) return result;
  const { current } = result;

  const folderId = current.driveFolderId;
  if (folderId && title !== current.title) {
    after(async () => {
      try {
        await googleDrive.renameFolder(folderId, title);
      } catch (error) {
        console.error("Could not rename the Drive folder", error);
      }
    });
  }
  afterChange(current.classId, current.id);
  revalidatePath(`/classes/${current.classId}`);
  revalidatePath(`/classes/${current.classId}/assignments/${current.id}`);
  return { ok: true, message: "Saved." };
}

export type DeadlineState = { ok: boolean; message: string } | undefined;

// Just the deadline, from the control at the top of an item's page. A
// quick-pick button sends `quick` (Unix ms); otherwise the typed `dueAt`.
export async function updateDeadline(
  _prev: DeadlineState,
  formData: FormData,
): Promise<DeadlineState> {
  await requireLecturer();
  const assignmentId = id.safeParse(formData.get("assignmentId"));
  if (!assignmentId.success) return { ok: false, message: "Item not found." };
  const quick = formData.get("quick");
  const dueAt =
    typeof quick === "string" && /^\d+$/.test(quick)
      ? Number(quick)
      : localInputToMs(String(formData.get("dueAt") ?? ""), appTimeZone());
  if (dueAt === null) return { ok: false, message: "Enter a valid deadline." };

  // The update and the re-judge commit together; the re-judge reads the
  // stored deadline, so overlapping saves agree with whichever lands last.
  const current = await db.transaction(async (tx) => {
    const row = await tx
      .update(assignments)
      .set({ dueAt })
      .where(
        and(eq(assignments.id, assignmentId.data), ne(assignments.dueAt, dueAt)),
      )
      .returning({ classId: assignments.classId })
      .get();
    if (row) await rejudgeLateness(tx, assignmentId.data);
    return row;
  });
  if (!current) {
    const exists = await db
      .select({ id: assignments.id })
      .from(assignments)
      .where(eq(assignments.id, assignmentId.data))
      .get();
    return exists
      ? { ok: true, message: "No change." }
      : { ok: false, message: "Item not found." };
  }
  // Late marks in the sheet follow the new deadline.
  after(() => scheduleSubmissionsSync(current.classId));
  revalidatePath(`/classes/${current.classId}`);
  revalidatePath(`/classes/${current.classId}/assignments/${assignmentId.data}`);
  return { ok: true, message: "Deadline saved." };
}

export async function setAssignmentOpen(
  assignmentId: number,
  open: boolean,
): Promise<void> {
  await requireLecturer();
  const row = await db
    .update(assignments)
    .set({ open })
    .where(eq(assignments.id, assignmentId))
    .returning({ classId: assignments.classId })
    .get();
  if (!row) return;
  revalidatePath(`/classes/${row.classId}`);
  revalidatePath(`/classes/${row.classId}/assignments/${assignmentId}`);
}

// Only while nobody has started submitting, so no student's work is orphaned.
export async function deleteAssignment(
  assignmentId: number,
): Promise<{ error: string } | undefined> {
  await requireLecturer();
  // One statement, so a submission can't start between the check and the
  // delete.
  const row = await db
    .delete(assignments)
    .where(
      and(
        eq(assignments.id, assignmentId),
        sql`NOT EXISTS (SELECT 1 FROM ${submissions} WHERE ${submissions.assignmentId} = ${assignments.id})`,
      ),
    )
    .returning({ classId: assignments.classId })
    .get();
  if (!row) {
    const exists = await db
      .select({ id: assignments.id })
      .from(assignments)
      .where(eq(assignments.id, assignmentId))
      .get();
    return exists
      ? { error: "Students have already submitted to this item. Close it instead." }
      : { error: "Item not found." };
  }
  after(() => scheduleSubmissionsSync(row.classId));
  revalidatePath(`/classes/${row.classId}`);
  redirect(`/classes/${row.classId}`);
}

export type SheetSyncState = { ok: boolean; message: string } | undefined;

export async function resyncSubmissionsSheet(
  classId: number,
): Promise<SheetSyncState> {
  await requireLecturer();
  try {
    await syncSubmissionsTab(classId);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, message };
  }
  revalidatePath(`/classes/${classId}`, "layout");
  return { ok: true, message: "Sheet updated." };
}
