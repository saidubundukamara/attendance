// Attendance history read from the database. Takes the database as an
// argument so the arithmetic can be tested.
import { asc, eq, inArray } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import {
  attendance,
  classes,
  enrollments,
  sessions,
  students,
} from "@/lib/db/schema";

export type Status = "PRESENT" | "ABSENT";

export type HistoryWeek = {
  week: number;
  session: {
    id: string;
    status: "ACTIVE" | "CLOSED";
    startedAt: number;
    endedAt: number | null;
  } | null;
  present: number;
  absent: number;
  // Present as a share of students with a record; null when there are none.
  percent: number | null;
};

export type HistoryStudent = {
  id: number;
  studentId: string;
  name: string;
  // False when the student has left the sheet but still has records.
  active: boolean;
  cells: Record<number, Status>;
  present: number;
  absent: number;
  percent: number | null;
};

export type ClassHistory = {
  weeks: HistoryWeek[];
  students: HistoryStudent[];
  activeCount: number;
};

export function percentOf(present: number, absent: number): number | null {
  const total = present + absent;
  return total === 0 ? null : Math.round((present / total) * 100);
}

export function getClassHistory(db: Db, classId: number): ClassHistory | null {
  const cls = db.select().from(classes).where(eq(classes.id, classId)).get();
  if (!cls) return null;

  const classSessions = db
    .select()
    .from(sessions)
    .where(eq(sessions.classId, classId))
    .all();
  const weekBySession = new Map(classSessions.map((s) => [s.id, s.week]));
  const records = classSessions.length
    ? db
        .select({
          sessionId: attendance.sessionId,
          studentId: attendance.studentId,
          status: attendance.status,
        })
        .from(attendance)
        .where(inArray(attendance.sessionId, [...weekBySession.keys()]))
        .all()
    : [];

  const cellsByStudent = new Map<number, Record<number, Status>>();
  for (const record of records) {
    const week = weekBySession.get(record.sessionId);
    if (week === undefined) continue;
    const cells = cellsByStudent.get(record.studentId) ?? {};
    cells[week] = record.status;
    cellsByStudent.set(record.studentId, cells);
  }

  const roster = db
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

  const historyStudents: HistoryStudent[] = roster
    .filter((student) => student.active || cellsByStudent.has(student.id))
    .map((student) => {
      const cells = cellsByStudent.get(student.id) ?? {};
      const statuses = Object.values(cells);
      const present = statuses.filter((s) => s === "PRESENT").length;
      const absent = statuses.length - present;
      return { ...student, cells, present, absent, percent: percentOf(present, absent) };
    });

  const weeks: HistoryWeek[] = Array.from(
    { length: cls.totalWeeks },
    (_, i) => {
      const week = i + 1;
      const session = classSessions.find((s) => s.week === week);
      const statuses = historyStudents
        .map((student) => student.cells[week])
        .filter(Boolean);
      const present = statuses.filter((s) => s === "PRESENT").length;
      const absent = statuses.length - present;
      return {
        week,
        session: session
          ? {
              id: session.id,
              status: session.status,
              startedAt: session.startedAt,
              endedAt: session.endedAt,
            }
          : null,
        present,
        absent,
        percent: percentOf(present, absent),
      };
    },
  );

  return {
    weeks,
    students: historyStudents,
    activeCount: roster.filter((student) => student.active).length,
  };
}

export type StudentClassSummary = {
  classId: number;
  code: string;
  moduleName: string | null;
  active: boolean;
  present: number;
  absent: number;
  percent: number | null;
  // One entry per week that has a session, in week order.
  weeks: { week: number; status: Status | null }[];
};

export type StudentSummary = {
  id: number;
  studentId: string;
  name: string;
  classes: StudentClassSummary[];
};

// `studentId` is the ID printed in the sheet.
export function getStudentSummary(
  db: Db,
  studentId: string,
): StudentSummary | null {
  const student = db
    .select()
    .from(students)
    .where(eq(students.studentId, studentId))
    .get();
  if (!student) return null;

  const records = new Map(
    db
      .select({ sessionId: attendance.sessionId, status: attendance.status })
      .from(attendance)
      .where(eq(attendance.studentId, student.id))
      .all()
      .map((record) => [record.sessionId, record.status]),
  );

  const enrolled = db
    .select({
      classId: classes.id,
      code: classes.code,
      moduleName: classes.moduleName,
      active: enrollments.active,
    })
    .from(enrollments)
    .innerJoin(classes, eq(classes.id, enrollments.classId))
    .where(eq(enrollments.studentId, student.id))
    .orderBy(asc(classes.code))
    .all();

  return {
    id: student.id,
    studentId: student.studentId,
    name: student.name,
    classes: enrolled.map((cls) => {
      const weeks = db
        .select({ id: sessions.id, week: sessions.week })
        .from(sessions)
        .where(eq(sessions.classId, cls.classId))
        .orderBy(asc(sessions.week))
        .all()
        .map((session) => ({
          week: session.week,
          status: records.get(session.id) ?? null,
        }));
      const present = weeks.filter((w) => w.status === "PRESENT").length;
      const absent = weeks.filter((w) => w.status === "ABSENT").length;
      return { ...cls, present, absent, percent: percentOf(present, absent), weeks };
    }),
  };
}
