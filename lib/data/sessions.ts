import { and, count, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  attendance,
  classes,
  enrollments,
  sessions,
  students,
} from "@/lib/db/schema";
import { getSyncStatus, type SyncStatus } from "@/lib/sheets/write";

export function getSessionStatus(sessionId: string) {
  return db
    .select({ id: sessions.id, status: sessions.status })
    .from(sessions)
    .where(eq(sessions.id, sessionId))
    .get();
}

export function getSessionView(sessionId: string) {
  const row = db
    .select({
      id: sessions.id,
      week: sessions.week,
      status: sessions.status,
      startedAt: sessions.startedAt,
      endedAt: sessions.endedAt,
      classId: classes.id,
      classCode: classes.code,
      moduleName: classes.moduleName,
    })
    .from(sessions)
    .innerJoin(classes, eq(classes.id, sessions.classId))
    .where(eq(sessions.id, sessionId))
    .get();
  if (!row) return null;

  const total =
    db
      .select({ value: count() })
      .from(enrollments)
      .where(
        and(eq(enrollments.classId, row.classId), eq(enrollments.active, true)),
      )
      .get()?.value ?? 0;
  const present =
    db
      .select({ value: count() })
      .from(attendance)
      .where(
        and(
          eq(attendance.sessionId, sessionId),
          eq(attendance.status, "PRESENT"),
        ),
      )
      .get()?.value ?? 0;

  return { ...row, total, present };
}

export type LiveStudent = {
  id: number;
  studentId: string;
  name: string;
  status: "PRESENT" | "ABSENT" | null;
  time: number | null;
  source: "QR" | "MANUAL" | null;
  flagged: boolean;
};

export type LiveSession = {
  status: "ACTIVE" | "CLOSED";
  present: number;
  total: number;
  students: LiveStudent[];
  sync: SyncStatus;
};

// Everything the session page polls for. Lists the current roster plus
// anyone with a record who has since left the sheet.
export function getLiveSession(sessionId: string): LiveSession | null {
  const session = db
    .select({ status: sessions.status, classId: sessions.classId })
    .from(sessions)
    .where(eq(sessions.id, sessionId))
    .get();
  if (!session) return null;

  const records = new Map(
    db
      .select()
      .from(attendance)
      .where(eq(attendance.sessionId, sessionId))
      .all()
      .map((row) => [row.studentId, row]),
  );
  const roster = db
    .select({
      id: students.id,
      studentId: students.studentId,
      name: students.name,
      active: enrollments.active,
    })
    .from(enrollments)
    .innerJoin(students, eq(students.id, enrollments.studentId))
    .where(eq(enrollments.classId, session.classId))
    .all();

  const list: LiveStudent[] = roster
    .filter((student) => student.active || records.has(student.id))
    .map((student) => {
      const record = records.get(student.id);
      return {
        id: student.id,
        studentId: student.studentId,
        name: student.name,
        status: record?.status ?? null,
        time: record?.status === "PRESENT" ? record.checkInAt : null,
        source: record?.source ?? null,
        flagged: record?.flagged ?? false,
      };
    })
    // Present first, most recent at the top; everyone else by name.
    .sort((a, b) => {
      const aPresent = a.status === "PRESENT";
      const bPresent = b.status === "PRESENT";
      if (aPresent !== bPresent) return aPresent ? -1 : 1;
      if (aPresent) return (b.time ?? 0) - (a.time ?? 0);
      return a.name.localeCompare(b.name);
    });

  return {
    status: session.status,
    present: list.filter((student) => student.status === "PRESENT").length,
    total: roster.filter((student) => student.active).length,
    students: list,
    sync: getSyncStatus(db),
  };
}
