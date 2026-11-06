// Which lecturer owns a class, session, item or submission. Lecturer pages,
// actions and route handlers check these before reading or changing
// anything addressed by id, so one lecturer can never reach another's data
// by editing a URL or a form.
import { and, eq } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import {
  assignments,
  classes,
  lecturers,
  sessions,
  students,
  submissions,
} from "@/lib/db/schema";

export async function ownsClass(
  db: Db,
  lecturerId: number,
  classId: number,
): Promise<boolean> {
  const row = await db
    .select({ id: classes.id })
    .from(classes)
    .where(and(eq(classes.id, classId), eq(classes.lecturerId, lecturerId)))
    .get();
  return Boolean(row);
}

export async function ownsSession(
  db: Db,
  lecturerId: number,
  sessionId: string,
): Promise<boolean> {
  const row = await db
    .select({ id: sessions.id })
    .from(sessions)
    .innerJoin(classes, eq(classes.id, sessions.classId))
    .where(and(eq(sessions.id, sessionId), eq(classes.lecturerId, lecturerId)))
    .get();
  return Boolean(row);
}

export async function ownsAssignment(
  db: Db,
  lecturerId: number,
  assignmentId: number,
): Promise<boolean> {
  const row = await db
    .select({ id: assignments.id })
    .from(assignments)
    .innerJoin(classes, eq(classes.id, assignments.classId))
    .where(
      and(eq(assignments.id, assignmentId), eq(classes.lecturerId, lecturerId)),
    )
    .get();
  return Boolean(row);
}

export async function ownsSubmission(
  db: Db,
  lecturerId: number,
  submissionId: number,
): Promise<boolean> {
  const row = await db
    .select({ id: submissions.id })
    .from(submissions)
    .innerJoin(assignments, eq(assignments.id, submissions.assignmentId))
    .innerJoin(classes, eq(classes.id, assignments.classId))
    .where(
      and(eq(submissions.id, submissionId), eq(classes.lecturerId, lecturerId)),
    )
    .get();
  return Boolean(row);
}

export async function ownsStudent(
  db: Db,
  lecturerId: number,
  studentRowId: number,
): Promise<boolean> {
  const row = await db
    .select({ id: students.id })
    .from(students)
    .where(
      and(eq(students.id, studentRowId), eq(students.lecturerId, lecturerId)),
    )
    .get();
  return Boolean(row);
}

// The lecturer whose sheet and Drive a class's data goes to.
export async function lecturerOfClass(db: Db, classId: number) {
  const row = await db
    .select({ lecturer: lecturers })
    .from(classes)
    .innerJoin(lecturers, eq(lecturers.id, classes.lecturerId))
    .where(eq(classes.id, classId))
    .get();
  return row?.lecturer ?? null;
}

// The lecturer whose Drive a submission's files are in.
export async function lecturerOfSubmission(db: Db, submissionId: number) {
  const row = await db
    .select({ lecturer: lecturers })
    .from(submissions)
    .innerJoin(assignments, eq(assignments.id, submissions.assignmentId))
    .innerJoin(classes, eq(classes.id, assignments.classId))
    .innerJoin(lecturers, eq(lecturers.id, classes.lecturerId))
    .where(eq(submissions.id, submissionId))
    .get();
  return row?.lecturer ?? null;
}
