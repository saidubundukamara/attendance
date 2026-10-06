import { eq, inArray, sql } from "drizzle-orm";
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
export async function applyRoster(
  db: Db,
  tabs: { title: string; parsed: ParsedTab }[],
  now: number = Date.now(),
): Promise<RosterSyncReport> {
  const reports: ClassSyncReport[] = [];
  const seenCodes = new Set<string>();

  await db.transaction(async (tx) => {
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

      const classRow = await tx
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
        (
          await tx
            .select({
              id: enrollments.id,
              studentId: enrollments.studentId,
              active: enrollments.active,
            })
            .from(enrollments)
            .where(eq(enrollments.classId, classRow.id))
            .all()
        ).map((row) => [row.studentId, row]),
      );
      // Whole lists go in one statement each: the database is a network call
      // away, so a row-by-row loop would cost a round trip per student.
      const inSheet = new Set<number>();
      const toAdd: number[] = [];
      const toReactivate: number[] = [];
      if (parsed.students.length > 0) {
        const rows = await tx
          .insert(students)
          .values(
            parsed.students.map((student) => ({
              studentId: student.studentId,
              name: student.name,
            })),
          )
          .onConflictDoUpdate({
            target: students.studentId,
            // A blank name in the sheet does not erase a known one.
            set: {
              name: sql`CASE WHEN excluded.name <> '' THEN excluded.name ELSE students.name END`,
            },
          })
          .returning({ id: students.id })
          .all();
        for (const { id } of rows) {
          inSheet.add(id);
          const enrollment = existing.get(id);
          if (!enrollment) toAdd.push(id);
          else if (!enrollment.active) toReactivate.push(enrollment.id);
        }
      }
      if (toAdd.length > 0) {
        await tx
          .insert(enrollments)
          .values(
            toAdd.map((studentId) => ({ classId: classRow.id, studentId })),
          )
          .run();
      }
      if (toReactivate.length > 0) {
        await tx
          .update(enrollments)
          .set({ active: true })
          .where(inArray(enrollments.id, toReactivate))
          .run();
      }
      report.added += toAdd.length + toReactivate.length;

      const gone = [...existing.values()]
        .filter((e) => e.active && !inSheet.has(e.studentId))
        .map((e) => e.id);
      if (gone.length > 0) {
        await tx
          .update(enrollments)
          .set({ active: false })
          .where(inArray(enrollments.id, gone))
          .run();
      }
      report.deactivated += gone.length;
    }
  });

  return { syncedAt: now, classes: reports };
}
