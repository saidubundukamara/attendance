import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/lib/db/client";
import { classes, enrollments, students } from "@/lib/db/schema";
import { parseAttendanceTab } from "@/lib/sheets/parse";
import { applyRoster } from "@/lib/sheets/roster";
import { createTestDb } from "./helpers/db";
import { buildTab, type FixtureStudent } from "./helpers/sheet";

let db: Db;

beforeEach(async () => {
  db = await createTestDb();
});

function tab(title: string, rows: FixtureStudent[], weeks = 15) {
  return { title, parsed: parseAttendanceTab(buildTab(rows, { weeks })) };
}

async function activeIds(code: string): Promise<string[]> {
  return (
    await db
      .select({ studentId: students.studentId, active: enrollments.active })
      .from(enrollments)
      .innerJoin(students, eq(students.id, enrollments.studentId))
      .innerJoin(classes, eq(classes.id, enrollments.classId))
      .where(eq(classes.code, code))
      .all()
  )
    .filter((row) => row.active)
    .map((row) => row.studentId)
    .sort();
}

const ONE = { name: "Student One", id: 900000001 };
const TWO = { name: "Student Two", id: 900000002 };
const THREE = { name: "Student Three", id: 900000003 };

describe("applyRoster", () => {
  it("creates classes, students and enrollments from the tabs", async () => {
    const report = await applyRoster(db, [
      tab("Attn of TEST101", [ONE, TWO]),
      tab("Attn of TEST202", []),
    ]);

    expect(report.classes.map((c) => [c.code, c.found, c.added])).toEqual([
      ["TEST101", 2, 2],
      ["TEST202", 0, 0],
    ]);
    const row = await db
      .select()
      .from(classes)
      .where(eq(classes.code, "TEST101"))
      .get();
    expect(row).toMatchObject({
      sheetTab: "Attn of TEST101",
      moduleName: "Test Module",
      moduleCode: "TEST101",
      totalWeeks: 15,
      startDate: null,
    });
    expect(await activeIds("TEST101")).toEqual(["900000001", "900000002"]);
  });

  it("is idempotent", async () => {
    await applyRoster(db, [tab("Attn of TEST101", [ONE, TWO])]);
    const report = await applyRoster(db, [tab("Attn of TEST101", [ONE, TWO])]);
    expect(report.classes[0]).toMatchObject({
      found: 2,
      added: 0,
      deactivated: 0,
    });
    expect(await db.select().from(students).all()).toHaveLength(2);
    expect(await db.select().from(enrollments).all()).toHaveLength(2);
  });

  it("adds new students and deactivates removed ones, keeping the row", async () => {
    await applyRoster(db, [tab("Attn of TEST101", [ONE, TWO])]);
    const report = await applyRoster(db, [
      tab("Attn of TEST101", [ONE, THREE]),
    ]);

    expect(report.classes[0]).toMatchObject({ added: 1, deactivated: 1 });
    expect(await activeIds("TEST101")).toEqual(["900000001", "900000003"]);
    expect(await db.select().from(enrollments).all()).toHaveLength(3);
  });

  it("re-activates a student who returns to the sheet", async () => {
    await applyRoster(db, [tab("Attn of TEST101", [ONE, TWO])]);
    await applyRoster(db, [tab("Attn of TEST101", [ONE])]);
    const report = await applyRoster(db, [tab("Attn of TEST101", [ONE, TWO])]);
    expect(report.classes[0]).toMatchObject({ added: 1, deactivated: 0 });
    expect(await activeIds("TEST101")).toEqual(["900000001", "900000002"]);
  });

  it("updates a changed name but keeps a known name when the cell is blank", async () => {
    await applyRoster(db, [tab("Attn of TEST101", [ONE])]);
    await applyRoster(db, [
      tab("Attn of TEST101", [{ name: "Student Uno", id: 900000001 }]),
    ]);
    expect((await db.select().from(students).get())?.name).toBe("Student Uno");
    await applyRoster(db, [tab("Attn of TEST101", [{ id: 900000001 }])]);
    expect((await db.select().from(students).get())?.name).toBe("Student Uno");
  });

  it("shares one student row between two classes", async () => {
    await applyRoster(db, [
      tab("Attn of TEST101", [ONE]),
      tab("Attn of TEST202", [ONE]),
    ]);
    expect(await db.select().from(students).all()).toHaveLength(1);
    expect(await activeIds("TEST101")).toEqual(["900000001"]);
    expect(await activeIds("TEST202")).toEqual(["900000001"]);
  });

  it("does not touch the roster when a tab has no header", async () => {
    await applyRoster(db, [tab("Attn of TEST101", [ONE, TWO])]);
    const report = await applyRoster(db, [
      { title: "Attn of TEST101", parsed: parseAttendanceTab([["broken"]]) },
    ]);
    expect(report.classes[0].warnings).toHaveLength(1);
    expect(report.classes[0].deactivated).toBe(0);
    expect(await activeIds("TEST101")).toEqual(["900000001", "900000002"]);
  });

  it("keeps lecturer settings across syncs", async () => {
    await applyRoster(db, [tab("Attn of TEST101", [ONE])]);
    await db
      .update(classes)
      .set({ startDate: "2026-09-07", totalWeeks: 12 })
      .run();
    await applyRoster(db, [tab("Attn of TEST101", [ONE])]);
    expect(await db.select().from(classes).get()).toMatchObject({
      startDate: "2026-09-07",
      totalWeeks: 12,
    });
  });

  it("skips a second tab that resolves to the same class code", async () => {
    const report = await applyRoster(db, [
      tab("Attn of TEST101", [ONE]),
      tab("attn of  test101", [TWO]),
    ]);
    expect(report.classes[1].warnings).toHaveLength(1);
    expect(await db.select().from(classes).all()).toHaveLength(1);
    expect(await activeIds("TEST101")).toEqual(["900000001"]);
  });
});
