import { and, asc, count, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { classes, enrollments, sessions, students } from "@/lib/db/schema";

async function activeStudentCount(classId: number): Promise<number> {
  const row = await db
    .select({ value: count() })
    .from(enrollments)
    .where(and(eq(enrollments.classId, classId), eq(enrollments.active, true)))
    .get();
  return row?.value ?? 0;
}

async function lastSession(classId: number) {
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

export async function getDashboardClasses() {
  const rows = await db.select().from(classes).orderBy(asc(classes.code)).all();
  // The per-class lookups run together rather than one after another.
  return Promise.all(
    rows.map(async (row) => {
      const [studentCount, last, classSessions] = await Promise.all([
        activeStudentCount(row.id),
        lastSession(row.id),
        db
          .select({
            id: sessions.id,
            week: sessions.week,
            status: sessions.status,
          })
          .from(sessions)
          .where(eq(sessions.classId, row.id))
          .all(),
      ]);
      return {
        ...row,
        studentCount,
        lastSession: last ?? null,
        sessions: classSessions,
      };
    }),
  );
}

export async function getClass(classId: number) {
  const row = await db
    .select()
    .from(classes)
    .where(eq(classes.id, classId))
    .get();
  if (!row) return null;
  const roster = await db
    .select({ studentId: students.studentId, name: students.name })
    .from(enrollments)
    .innerJoin(students, eq(students.id, enrollments.studentId))
    .where(and(eq(enrollments.classId, classId), eq(enrollments.active, true)))
    .orderBy(asc(students.name))
    .all();
  return { ...row, roster };
}
