import { and, eq } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import { classes, enrollments, students } from "@/lib/db/schema";
import { classCodeFromTab, type ParsedTab } from "./parse";

export type ClassSyncReport = {
  code: string;
  sheetTab: string;
  // Students with a valid ID in the tab.
  found: number;
  // New or re-activated enrollments.
  added: number;
  // Enrollments switched off because the ID left the tab.
  deactivated: number;
  warnings: string[];
};

export type RosterSyncReport = {
  syncedAt: number;
  classes: ClassSyncReport[];
};

// Writes parsed tabs into the database. The sheet is the roster: students in
// a tab become active enrollments, students missing from it become inactive.
export function applyRoster(
  db: Db,
  tabs: { title: string; parsed: ParsedTab }[],
  now: number = Date.now(),
): RosterSyncReport {
  const reports: ClassSyncReport[] = [];
  const seenCodes = new Set<string>();

  db.transaction((tx) => {
    for (const { title, parsed } of tabs) {
      const code = classCodeFromTab(title);
      const report: ClassSyncReport = {
        code,
        sheetTab: title,
        found: parsed.students.length,
        added: 0,
        deactivated: 0,
        warnings: [...parsed.warnings],
      };
      reports.push(report);

      // An unreadable tab must not wipe an existing roster.
      if (parsed.headerRow === null) continue;
      if (!code) {
        report.warnings.push("Tab name has no class code; tab skipped.");
        continue;
      }
      if (seenCodes.has(code.toLowerCase())) {
        report.warnings.push(
          `Another tab already uses class code ${code}; tab skipped.`,
        );
        continue;
      }
      seenCodes.add(code.toLowerCase());

      const classRow = tx
        .insert(classes)
        .values({
          code,
          sheetTab: title,
          moduleName: parsed.moduleName,
          moduleCode: parsed.moduleCode,
          // Only a starting value; the lecturer can change it in settings.
          totalWeeks: parsed.weekCols.size || 15,
          lastSyncedAt: now,
        })
        .onConflictDoUpdate({
          target: classes.code,
          set: {
            sheetTab: title,
            moduleName: parsed.moduleName,
            moduleCode: parsed.moduleCode,
            lastSyncedAt: now,
          },
        })
        .returning({ id: classes.id })
        .get();

      const existing = new Map(
        tx
          .select({
            id: enrollments.id,
            studentId: enrollments.studentId,
            active: enrollments.active,
          })
          .from(enrollments)
          .where(eq(enrollments.classId, classRow.id))
          .all()
          .map((row) => [row.studentId, row]),
      );
      const inSheet = new Set<number>();

      for (const student of parsed.students) {
        const studentRow = tx
          .insert(students)
          .values({ studentId: student.studentId, name: student.name })
          .onConflictDoUpdate({
            target: students.studentId,
            // A blank name in the sheet does not erase a known one.
            set: student.name
              ? { name: student.name }
              : { studentId: student.studentId },
          })
          .returning({ id: students.id })
          .get();
        inSheet.add(studentRow.id);

        const enrollment = existing.get(studentRow.id);
        if (!enrollment) {
          tx.insert(enrollments)
            .values({ classId: classRow.id, studentId: studentRow.id })
            .run();
          report.added++;
        } else if (!enrollment.active) {
          tx.update(enrollments)
            .set({ active: true })
            .where(eq(enrollments.id, enrollment.id))
            .run();
          report.added++;
        }
      }

      for (const enrollment of existing.values()) {
        if (!enrollment.active || inSheet.has(enrollment.studentId)) continue;
        tx.update(enrollments)
          .set({ active: false })
          .where(
            and(
              eq(enrollments.id, enrollment.id),
              eq(enrollments.classId, classRow.id),
            ),
          )
          .run();
        report.deactivated++;
      }
    }
  });

  return { syncedAt: now, classes: reports };
}
