// The "Subs of <CODE>" tab: one row per student, one column per assignment,
// each cell the time it was handed in. The database is the record; the tab is
// rebuilt from it in full on every change, so it heals itself after a failed
// write. It belongs to the app: edits made in it by hand are overwritten.
import { and, asc, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import {
  assignments,
  classes,
  enrollments,
  students,
  submissionMembers,
  submissions,
} from "@/lib/db/schema";
import { formatStamp } from "@/lib/timezone";
import { LEASE_MS } from "./write";

export const SUBMISSIONS_TAB_PREFIX = "Subs of ";

export function submissionsTabTitle(classCode: string): string {
  return `${SUBMISSIONS_TAB_PREFIX}${classCode}`;
}

export type GridInput = {
  columns: { id: number; title: string }[];
  // Active roster, plus anyone who has since left but did submit something.
  rows: { id: number; studentId: string; name: string }[];
  // Keyed `${studentRowId}:${assignmentId}`.
  cells: Map<string, { late: boolean; submittedAt: number }>;
};

export function buildSubmissionsGrid(
  input: GridInput,
  timeZone: string,
): string[][] {
  const header = ["ID Number", "Name", ...input.columns.map((c) => c.title)];
  const body = input.rows.map((row) => [
    row.studentId,
    row.name,
    ...input.columns.map((col) => {
      const cell = input.cells.get(`${row.id}:${col.id}`);
      if (!cell) return "";
      const stamp = formatStamp(cell.submittedAt, timeZone);
      return cell.late ? `LATE ${stamp}` : stamp;
    }),
  ]);
  return [header, ...body];
}

export async function loadSubmissionsGrid(
  db: Db,
  classId: number,
): Promise<GridInput> {
  const columns = await db
    .select({ id: assignments.id, title: assignments.title })
    .from(assignments)
    .where(eq(assignments.classId, classId))
    .orderBy(asc(assignments.dueAt), asc(assignments.id))
    .all();
  const done = columns.length
    ? await db
        // Every student a submission covers, so a group's members all
        // get the cell filled.
        .select({
          studentId: submissionMembers.studentId,
          assignmentId: submissionMembers.assignmentId,
          late: submissions.late,
          submittedAt: submissions.submittedAt,
        })
        .from(submissionMembers)
        .innerJoin(
          submissions,
          eq(submissions.id, submissionMembers.submissionId),
        )
        .where(
          and(
            eq(submissions.status, "COMPLETE"),
            inArray(
              submissionMembers.assignmentId,
              columns.map((c) => c.id),
            ),
          ),
        )
        .all()
    : [];

  const roster = await db
    .select({
      id: students.id,
      studentId: students.studentId,
      name: students.name,
      active: enrollments.active,
    })
    .from(enrollments)
    .innerJoin(students, eq(students.id, enrollments.studentId))
    .where(eq(enrollments.classId, classId))
    .orderBy(asc(students.name))
    .all();
  const submitted = new Set(done.map((d) => d.studentId));
  const rows = roster
    .filter((s) => s.active || submitted.has(s.id))
    .map(({ id, studentId, name }) => ({ id, studentId, name }));

  const cells = new Map<string, { late: boolean; submittedAt: number }>();
  for (const d of done) {
    cells.set(`${d.studentId}:${d.assignmentId}`, {
      late: d.late,
      submittedAt: d.submittedAt ?? 0,
    });
  }
  return { columns, rows, cells };
}

export type SubmissionsSheetIo = {
  ensureTab(title: string): Promise<void>;
  replaceTabValues(title: string, values: string[][]): Promise<void>;
};

// Rewrites the class's tab and records the outcome on the class, so the
// lecturer pages can show a failure and offer to retry. Only one run writes
// a class's tab at a time, or an older snapshot could land after a newer
// one. A call that finds another run writing leaves it to that run, which
// sees the request and goes round again.
export async function writeSubmissionsTab(
  db: Db,
  io: SubmissionsSheetIo,
  classId: number,
  timeZone: string,
  now: () => number = Date.now,
): Promise<void> {
  const asked = await db
    .update(classes)
    .set({ submissionsSyncRequested: sql`${classes.submissionsSyncRequested} + 1` })
    .where(eq(classes.id, classId))
    .returning({ id: classes.id })
    .get();
  if (!asked) return;
  const taken = await db
    .update(classes)
    .set({ submissionsSyncUntil: now() + LEASE_MS })
    .where(
      and(
        eq(classes.id, classId),
        or(
          isNull(classes.submissionsSyncUntil),
          lt(classes.submissionsSyncUntil, now()),
        ),
      ),
    )
    .run();
  if (taken.rowsAffected === 0) return;

  for (;;) {
    const cls = await db
      .select({
        code: classes.code,
        requested: classes.submissionsSyncRequested,
      })
      .from(classes)
      .where(eq(classes.id, classId))
      .get();
    if (!cls) return;
    const title = submissionsTabTitle(cls.code);
    try {
      const grid = buildSubmissionsGrid(
        await loadSubmissionsGrid(db, classId),
        timeZone,
      );
      await io.ensureTab(title);
      await io.replaceTabValues(title, grid);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await db
        .update(classes)
        .set({
          submissionsSheetError: `Could not update "${title}": ${message}`,
          submissionsSyncUntil: null,
        })
        .where(eq(classes.id, classId))
        .run();
      throw error;
    }
    // Freed only if nobody asked again while this snapshot was written;
    // otherwise go round with a fresh one.
    const released = await db
      .update(classes)
      .set({ submissionsSheetError: null, submissionsSyncUntil: null })
      .where(
        and(
          eq(classes.id, classId),
          eq(classes.submissionsSyncRequested, cls.requested),
        ),
      )
      .run();
    if (released.rowsAffected > 0) return;
    await db
      .update(classes)
      .set({ submissionsSyncUntil: now() + LEASE_MS })
      .where(eq(classes.id, classId))
      .run();
  }
}
