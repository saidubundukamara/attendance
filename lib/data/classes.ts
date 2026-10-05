import { and, asc, count, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { classes, enrollments, sessions, students } from "@/lib/db/schema";

function activeStudentCount(classId: number): number {
  return (
    db
      .select({ value: count() })
      .from(enrollments)
      .where(and(eq(enrollments.classId, classId), eq(enrollments.active, true)))
      .get()?.value ?? 0
  );
}

function lastSession(classId: number) {
  return db
    .select({
      id: sessions.id,
      week: sessions.week,
      status: sessions.status,
      startedAt: sessions.startedAt,
    })
    .from(sessions)
    .where(eq(sessions.classId, classId))
    .orderBy(desc(sessions.startedAt))
    .limit(1)
    .get();
}

export function getDashboardClasses() {
  return db
    .select()
    .from(classes)
    .orderBy(asc(classes.code))
    .all()
    .map((row) => ({
      ...row,
      studentCount: activeStudentCount(row.id),
      lastSession: lastSession(row.id) ?? null,
      sessions: db
        .select({
          id: sessions.id,
          week: sessions.week,
          status: sessions.status,
        })
        .from(sessions)
        .where(eq(sessions.classId, row.id))
        .all(),
    }));
}

export function getClass(classId: number) {
  const row = db.select().from(classes).where(eq(classes.id, classId)).get();
  if (!row) return null;
  const roster = db
    .select({ studentId: students.studentId, name: students.name })
    .from(enrollments)
    .innerJoin(students, eq(students.id, enrollments.studentId))
    .where(and(eq(enrollments.classId, classId), eq(enrollments.active, true)))
    .orderBy(asc(students.name))
    .all();
  return { ...row, roster };
}
