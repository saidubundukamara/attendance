// Lecturer corrections to attendance. Works on active and closed sessions.
import { and, eq } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import {
  attendance,
  classes,
  enrollments,
  manualChanges,
  sessions,
  students,
  syncJobs,
} from "@/lib/db/schema";

export type AttendanceStatus = "PRESENT" | "ABSENT";

export type SetAttendanceResult =
  | { ok: true; changed: boolean }
  | { ok: false; reason: "SESSION_NOT_FOUND" | "STUDENT_NOT_FOUND" | "NOT_ENROLLED" };

export function setAttendance(
  db: Db,
  input: {
    sessionId: string;
    // Internal students.id, not the ID printed in the sheet.
    studentId: number;
    status: AttendanceStatus;
    reason?: string | null;
  },
  now: number = Date.now(),
): SetAttendanceResult {
  return db.transaction((tx): SetAttendanceResult => {
    const session = tx
      .select({ id: sessions.id, week: sessions.week, classId: classes.id })
      .from(sessions)
      .innerJoin(classes, eq(classes.id, sessions.classId))
      .where(eq(sessions.id, input.sessionId))
      .get();
    if (!session) return { ok: false, reason: "SESSION_NOT_FOUND" };

    const student = tx
      .select()
      .from(students)
      .where(eq(students.id, input.studentId))
      .get();
    if (!student) return { ok: false, reason: "STUDENT_NOT_FOUND" };

    const existing = tx
      .select({ id: attendance.id, status: attendance.status })
      .from(attendance)
      .where(
        and(
          eq(attendance.sessionId, session.id),
          eq(attendance.studentId, student.id),
        ),
      )
      .get();

    if (!existing) {
      const enrolled = tx
        .select({ id: enrollments.id })
        .from(enrollments)
        .where(
          and(
            eq(enrollments.classId, session.classId),
            eq(enrollments.studentId, student.id),
            eq(enrollments.active, true),
          ),
        )
        .get();
      if (!enrolled) return { ok: false, reason: "NOT_ENROLLED" };
    }
    if (existing?.status === input.status) return { ok: true, changed: false };

    // Becoming a manual row releases the phone that made a QR check-in, so a
    // student who typed someone else's ID can be un-marked and scan again.
    const row = {
      status: input.status,
      source: "MANUAL" as const,
      checkInAt: input.status === "PRESENT" ? now : null,
      flagged: false,
    };
    if (existing) {
      tx.update(attendance).set(row).where(eq(attendance.id, existing.id)).run();
    } else {
      tx.insert(attendance)
        .values({ sessionId: session.id, studentId: student.id, ...row })
        .run();
    }

    tx.insert(manualChanges)
      .values({
        sessionId: session.id,
        studentId: student.id,
        previousStatus: existing?.status ?? null,
        newStatus: input.status,
        reason: input.reason?.trim() || null,
        createdAt: now,
      })
      .run();
    tx.insert(syncJobs)
      .values({
        classId: session.classId,
        studentId: student.studentId,
        week: session.week,
        value: input.status === "PRESENT" ? 1 : 0,
        createdAt: now,
      })
      .run();
    return { ok: true, changed: true };
  });
}
