import { and, asc, count, eq, inArray, or, sql } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import {
  assignments,
  classes,
  enrollments,
  students,
  submissionFiles,
  submissions,
} from "@/lib/db/schema";

// Every item set for a class, with how many have been handed in.
export async function getClassAssignments(db: Db, classId: number) {
  const rows = await db
    .select()
    .from(assignments)
    .where(eq(assignments.classId, classId))
    .orderBy(asc(assignments.dueAt), asc(assignments.id))
    .all();
  const counts = rows.length
    ? await db
        .select({
          assignmentId: submissions.assignmentId,
          submitted: count(),
          late: sql<number>`sum(${submissions.late})`,
        })
        .from(submissions)
        .where(
          and(
            eq(submissions.status, "COMPLETE"),
            inArray(
              submissions.assignmentId,
              rows.map((r) => r.id),
            ),
          ),
        )
        .groupBy(submissions.assignmentId)
        .all()
    : [];
  return rows.map((row) => {
    const c = counts.find((x) => x.assignmentId === row.id);
    return { ...row, submitted: c?.submitted ?? 0, late: Number(c?.late ?? 0) };
  });
}

export type RosterEntry = {
  id: number;
  studentId: string;
  name: string;
  active: boolean;
  submission: {
    late: boolean;
    submittedAt: number;
    files: { name: string; driveFileId: string; size: number }[];
  } | null;
};

// One assignment and every student's status for it.
export async function getAssignmentDetail(db: Db, assignmentId: number) {
  const row = await db
    .select({
      assignment: assignments,
      classCode: classes.code,
      moduleName: classes.moduleName,
      sheetError: classes.submissionsSheetError,
    })
    .from(assignments)
    .innerJoin(classes, eq(classes.id, assignments.classId))
    .where(eq(assignments.id, assignmentId))
    .get();
  if (!row) return null;

  const done = await db
    .select({
      id: submissions.id,
      studentId: submissions.studentId,
      late: submissions.late,
      submittedAt: submissions.submittedAt,
    })
    .from(submissions)
    .where(
      and(
        eq(submissions.assignmentId, assignmentId),
        eq(submissions.status, "COMPLETE"),
      ),
    )
    .all();
  const files = done.length
    ? await db
        .select({
          submissionId: submissionFiles.submissionId,
          name: submissionFiles.originalName,
          driveFileId: submissionFiles.driveFileId,
          size: submissionFiles.size,
        })
        .from(submissionFiles)
        .where(
          inArray(
            submissionFiles.submissionId,
            done.map((d) => d.id),
          ),
        )
        .orderBy(asc(submissionFiles.id))
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
    .where(
      and(
        eq(enrollments.classId, row.assignment.classId),
        done.length
          ? or(
              eq(enrollments.active, true),
              inArray(
                students.id,
                done.map((d) => d.studentId),
              ),
            )
          : eq(enrollments.active, true),
      ),
    )
    .orderBy(asc(students.name))
    .all();

  const entries: RosterEntry[] = roster.map((s) => {
    const sub = done.find((d) => d.studentId === s.id);
    return {
      ...s,
      submission: sub
        ? {
            late: sub.late,
            submittedAt: sub.submittedAt ?? 0,
            files: files
              .filter((f) => f.submissionId === sub.id && f.driveFileId)
              .map((f) => ({
                name: f.name,
                driveFileId: f.driveFileId as string,
                size: f.size,
              })),
          }
        : null,
    };
  });

  return { ...row, roster: entries };
}

// Submissions of any status, so an item that has been started on is kept.
export async function hasSubmissions(db: Db, assignmentId: number) {
  const row = await db
    .select({ value: count() })
    .from(submissions)
    .where(eq(submissions.assignmentId, assignmentId))
    .get();
  return (row?.value ?? 0) > 0;
}

export type MatrixCell = { late: boolean; submittedAt: number } | null;

// Every student against every item in a class: who handed in what, so the
// missing work can be listed per item and per student.
export async function getClassSubmissionMatrix(db: Db, classId: number) {
  const items = await db
    .select({
      id: assignments.id,
      title: assignments.title,
      kind: assignments.kind,
      dueAt: assignments.dueAt,
      open: assignments.open,
    })
    .from(assignments)
    .where(eq(assignments.classId, classId))
    .orderBy(asc(assignments.dueAt), asc(assignments.id))
    .all();

  const done = items.length
    ? await db
        .select({
          studentId: submissions.studentId,
          assignmentId: submissions.assignmentId,
          late: submissions.late,
          submittedAt: submissions.submittedAt,
        })
        .from(submissions)
        .where(
          and(
            eq(submissions.status, "COMPLETE"),
            inArray(
              submissions.assignmentId,
              items.map((i) => i.id),
            ),
          ),
        )
        .all()
    : [];

  // Students who have left the sheet are no longer chased for work.
  const roster = await db
    .select({
      id: students.id,
      studentId: students.studentId,
      name: students.name,
    })
    .from(enrollments)
    .innerJoin(students, eq(students.id, enrollments.studentId))
    .where(and(eq(enrollments.classId, classId), eq(enrollments.active, true)))
    .orderBy(asc(students.name))
    .all();

  const cells = new Map<string, MatrixCell>();
  for (const d of done) {
    cells.set(`${d.studentId}:${d.assignmentId}`, {
      late: d.late,
      submittedAt: d.submittedAt ?? 0,
    });
  }
  const cell = (studentRowId: number, assignmentId: number): MatrixCell =>
    cells.get(`${studentRowId}:${assignmentId}`) ?? null;

  return {
    items: items.map((item) => ({
      ...item,
      missing: roster.filter((s) => !cell(s.id, item.id)),
    })),
    students: roster.map((s) => ({
      ...s,
      cells: Object.fromEntries(items.map((i) => [i.id, cell(s.id, i.id)])) as Record<
        number,
        MatrixCell
      >,
      missing: items.filter((i) => !cell(s.id, i.id)).length,
    })),
  };
}
