import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/lib/db/client";
import { classes, enrollments, students } from "@/lib/db/schema";
import { parseAttendanceTab } from "@/lib/sheets/parse";
import { applyRoster } from "@/lib/sheets/roster";
import { createTestDb } from "./helpers/db";
import { buildTab, type FixtureStudent } from "./helpers/sheet";

let db: Db;

beforeEach(() => {
  db = createTestDb();
});

function tab(title: string, rows: FixtureStudent[], weeks = 15) {
  return { title, parsed: parseAttendanceTab(buildTab(rows, { weeks })) };
}

function activeIds(code: string): string[] {
  return db
    .select({ studentId: students.studentId, active: enrollments.active })
    .from(enrollments)
    .innerJoin(students, eq(students.id, enrollments.studentId))
    .innerJoin(classes, eq(classes.id, enrollments.classId))
    .where(eq(classes.code, code))
    .all()
    .filter((row) => row.active)
    .map((row) => row.studentId)
    .sort();
}

const ONE = { name: "Student One", id: 900000001 };
const TWO = { name: "Student Two", id: 900000002 };
const THREE = { name: "Student Three", id: 900000003 };

describe("applyRoster", () => {
  it("creates classes, students and enrollments from the tabs", () => {
    const report = applyRoster(db, [
      tab("Attn of TEST101", [ONE, TWO]),
      tab("Attn of TEST202", []),
    ]);

    expect(report.classes.map((c) => [c.code, c.found, c.added])).toEqual([
      ["TEST101", 2, 2],
      ["TEST202", 0, 0],
    ]);
    const row = db.select().from(classes).where(eq(classes.code, "TEST101")).get();
    expect(row).toMatchObject({
      sheetTab: "Attn of TEST101",
      moduleName: "Test Module",
      moduleCode: "TEST101",
      totalWeeks: 15,
      startDate: null,
    });
    expect(activeIds("TEST101")).toEqual(["900000001", "900000002"]);
  });

  it("is idempotent", () => {
    applyRoster(db, [tab("Attn of TEST101", [ONE, TWO])]);
    const report = applyRoster(db, [tab("Attn of TEST101", [ONE, TWO])]);
    expect(report.classes[0]).toMatchObject({ found: 2, added: 0, deactivated: 0 });
    expect(db.select().from(students).all()).toHaveLength(2);
    expect(db.select().from(enrollments).all()).toHaveLength(2);
  });

  it("adds new students and deactivates removed ones, keeping the row", () => {
    applyRoster(db, [tab("Attn of TEST101", [ONE, TWO])]);
    const report = applyRoster(db, [tab("Attn of TEST101", [ONE, THREE])]);

    expect(report.classes[0]).toMatchObject({ added: 1, deactivated: 1 });
    expect(activeIds("TEST101")).toEqual(["900000001", "900000003"]);
    expect(db.select().from(enrollments).all()).toHaveLength(3);
  });

  it("re-activates a student who returns to the sheet", () => {
    applyRoster(db, [tab("Attn of TEST101", [ONE, TWO])]);
    applyRoster(db, [tab("Attn of TEST101", [ONE])]);
    const report = applyRoster(db, [tab("Attn of TEST101", [ONE, TWO])]);
    expect(report.classes[0]).toMatchObject({ added: 1, deactivated: 0 });
    expect(activeIds("TEST101")).toEqual(["900000001", "900000002"]);
  });

  it("updates a changed name but keeps a known name when the cell is blank", () => {
    applyRoster(db, [tab("Attn of TEST101", [ONE])]);
    applyRoster(db, [tab("Attn of TEST101", [{ name: "Student Uno", id: 900000001 }])]);
    expect(db.select().from(students).get()?.name).toBe("Student Uno");
    applyRoster(db, [tab("Attn of TEST101", [{ id: 900000001 }])]);
    expect(db.select().from(students).get()?.name).toBe("Student Uno");
  });

  it("shares one student row between two classes", () => {
    applyRoster(db, [
      tab("Attn of TEST101", [ONE]),
      tab("Attn of TEST202", [ONE]),
    ]);
    expect(db.select().from(students).all()).toHaveLength(1);
    expect(activeIds("TEST101")).toEqual(["900000001"]);
    expect(activeIds("TEST202")).toEqual(["900000001"]);
  });

  it("does not touch the roster when a tab has no header", () => {
    applyRoster(db, [tab("Attn of TEST101", [ONE, TWO])]);
    const report = applyRoster(db, [
      { title: "Attn of TEST101", parsed: parseAttendanceTab([["broken"]]) },
    ]);
    expect(report.classes[0].warnings).toHaveLength(1);
    expect(report.classes[0].deactivated).toBe(0);
    expect(activeIds("TEST101")).toEqual(["900000001", "900000002"]);
  });

  it("keeps lecturer settings across syncs", () => {
    applyRoster(db, [tab("Attn of TEST101", [ONE])]);
    db.update(classes).set({ startDate: "2026-09-07", totalWeeks: 12 }).run();
    applyRoster(db, [tab("Attn of TEST101", [ONE])]);
    expect(db.select().from(classes).get()).toMatchObject({
      startDate: "2026-09-07",
      totalWeeks: 12,
    });
  });

  it("skips a second tab that resolves to the same class code", () => {
    const report = applyRoster(db, [
      tab("Attn of TEST101", [ONE]),
      tab("attn of  test101", [TWO]),
    ]);
    expect(report.classes[1].warnings).toHaveLength(1);
    expect(db.select().from(classes).all()).toHaveLength(1);
    expect(activeIds("TEST101")).toEqual(["900000001"]);
  });
});
