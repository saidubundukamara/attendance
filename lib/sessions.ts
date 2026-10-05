// Session lifecycle rules. Takes the database as an argument so it can be
// tested without Next.js.
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import {
  attendance,
  classes,
  enrollments,
  sessions,
  students,
  syncJobs,
} from "@/lib/db/schema";

export type OpenSessionResult =
  | { ok: true; sessionId: string; reopened: boolean }
  | { ok: false; reason: "CLASS_NOT_FOUND" | "BAD_WEEK" }
  | { ok: false; reason: "ACTIVE_EXISTS"; sessionId: string; week: number };

// Starts attendance for a class and week. A week that already has a session
// is reopened rather than duplicated. One active session per class.
export function openSession(
  db: Db,
  classId: number,
  week: number,
  now: number = Date.now(),
): OpenSessionResult {
  return db.transaction((tx): OpenSessionResult => {
    const cls = tx.select().from(classes).where(eq(classes.id, classId)).get();
    if (!cls) return { ok: false, reason: "CLASS_NOT_FOUND" };
    if (!Number.isInteger(week) || week < 1 || week > cls.totalWeeks) {
      return { ok: false, reason: "BAD_WEEK" };
    }

    const active = tx
      .select()
      .from(sessions)
      .where(and(eq(sessions.classId, classId), eq(sessions.status, "ACTIVE")))
      .get();
    if (active) {
      if (active.week === week) {
        return { ok: true, sessionId: active.id, reopened: false };
      }
      return {
        ok: false,
        reason: "ACTIVE_EXISTS",
        sessionId: active.id,
        week: active.week,
      };
    }

    const existing = tx
      .select()
      .from(sessions)
      .where(and(eq(sessions.classId, classId), eq(sessions.week, week)))
      .get();
    if (existing) {
      tx.update(sessions)
        .set({ status: "ACTIVE", endedAt: null })
        .where(eq(sessions.id, existing.id))
        .run();
      return { ok: true, sessionId: existing.id, reopened: true };
    }

    const sessionId = randomUUID();
    tx.insert(sessions)
      .values({ id: sessionId, classId, week, status: "ACTIVE", startedAt: now })
      .run();
    return { ok: true, sessionId, reopened: false };
  });
}

// Ends a session: no more QR check-ins, and every enrolled student without
// a record is marked absent (0 in the sheet). Returns false when the session
// does not exist or is already closed.
export function closeSession(
  db: Db,
  sessionId: string,
  now: number = Date.now(),
): boolean {
  return db.transaction((tx) => {
    const session = tx
      .select()
      .from(sessions)
      .where(and(eq(sessions.id, sessionId), eq(sessions.status, "ACTIVE")))
      .get();
    if (!session) return false;

    tx.update(sessions)
      .set({ status: "CLOSED", endedAt: now })
      .where(eq(sessions.id, sessionId))
      .run();

    const recorded = new Set(
      tx
        .select({ studentId: attendance.studentId })
        .from(attendance)
        .where(eq(attendance.sessionId, sessionId))
        .all()
        .map((row) => row.studentId),
    );
    const roster = tx
      .select({ id: students.id, studentId: students.studentId })
      .from(enrollments)
      .innerJoin(students, eq(students.id, enrollments.studentId))
      .where(
        and(
          eq(enrollments.classId, session.classId),
          eq(enrollments.active, true),
        ),
      )
      .all();

    for (const student of roster) {
      if (recorded.has(student.id)) continue;
      tx.insert(attendance)
        .values({
          sessionId,
          studentId: student.id,
          status: "ABSENT",
          source: "MANUAL",
        })
        .run();
      tx.insert(syncJobs)
        .values({
          classId: session.classId,
          studentId: student.studentId,
          week: session.week,
          value: 0,
          createdAt: now,
        })
        .run();
    }
    return true;
  });
}

export type RecordPastWeekResult =
  | { ok: true; sessionId: string; created: boolean }
  | { ok: false; reason: "CLASS_NOT_FOUND" | "BAD_WEEK" };

// Creates an already-closed session for a week that was never taken in the
// app, so the lecturer can fill it in by hand. Nobody is marked absent and
// nothing is sent to the sheet until a student is marked: the sheet may
// already hold values typed in for that week.
export function recordPastWeek(
  db: Db,
  classId: number,
  week: number,
  now: number = Date.now(),
): RecordPastWeekResult {
  return db.transaction((tx): RecordPastWeekResult => {
    const cls = tx.select().from(classes).where(eq(classes.id, classId)).get();
    if (!cls) return { ok: false, reason: "CLASS_NOT_FOUND" };
    if (!Number.isInteger(week) || week < 1 || week > cls.totalWeeks) {
      return { ok: false, reason: "BAD_WEEK" };
    }
    const existing = tx
      .select({ id: sessions.id })
      .from(sessions)
      .where(and(eq(sessions.classId, classId), eq(sessions.week, week)))
      .get();
    if (existing) return { ok: true, sessionId: existing.id, created: false };

    const sessionId = randomUUID();
    tx.insert(sessions)
      .values({
        id: sessionId,
        classId,
        week,
        status: "CLOSED",
        startedAt: now,
        endedAt: now,
      })
      .run();
    return { ok: true, sessionId, created: true };
  });
}
