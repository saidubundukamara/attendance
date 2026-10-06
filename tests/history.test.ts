import { beforeEach, describe, expect, it } from "vitest";
import { setAttendance } from "@/lib/attendance";
import {
  getClassHistory,
  getStudentSummary,
  percentOf,
} from "@/lib/data/history";
import type { Db } from "@/lib/db/client";
import {
  attendance,
  classes,
  enrollments,
  students,
  syncJobs,
} from "@/lib/db/schema";
import { closeSession, openSession, recordPastWeek } from "@/lib/sessions";
import { createTestDb } from "./helpers/db";

let db: Db;
let classA: number;
let classB: number;
let ids: Record<string, number>;

beforeEach(async () => {
  db = await createTestDb();
  [classA, classB] = await Promise.all(
    ["TEST101", "TEST202"].map(
      async (code) =>
        (
          await db
            .insert(classes)
            .values({ code, sheetTab: `Attn of ${code}`, totalWeeks: 4 })
            .returning()
            .get()
        ).id,
    ),
  );
  ids = {};
  for (const [studentId, name] of [
    ["900000001", "Ama"],
    ["900000002", "Bola"],
    ["900000003", "Chidi"],
  ]) {
    ids[studentId] = (
      await db.insert(students).values({ studentId, name }).returning().get()
    ).id;
    await db
      .insert(enrollments)
      .values({ classId: classA, studentId: ids[studentId] })
      .run();
  }
  await db
    .insert(enrollments)
    .values({ classId: classB, studentId: ids["900000001"] })
    .run();
});

// Runs a week: the listed students are present, everyone else absent.
async function takeWeek(
  classId: number,
  week: number,
  present: string[],
  at = week * 1000,
) {
  const opened = await openSession(db, classId, week, at);
  if (!opened.ok) throw new Error(opened.reason);
  for (const studentId of present) {
    await setAttendance(db, {
      sessionId: opened.sessionId,
      studentId: ids[studentId],
      status: "PRESENT",
    });
  }
  await closeSession(db, opened.sessionId, at + 500);
  return opened.sessionId;
}

describe("percentOf", () => {
  it("rounds and handles no records", async () => {
    expect(percentOf(6, 2)).toBe(75);
    expect(percentOf(1, 2)).toBe(33);
    expect(percentOf(0, 0)).toBeNull();
  });
});

describe("getClassHistory", () => {
  it("builds the grid and per-week totals", async () => {
    const week1 = await takeWeek(classA, 1, ["900000001", "900000002"]);
    await takeWeek(classA, 2, ["900000001"]);
    const history = (await getClassHistory(db, classA))!;

    expect(history.activeCount).toBe(3);
    expect(
      history.weeks.map((w) => [w.week, w.present, w.absent, w.percent]),
    ).toEqual([
      [1, 2, 1, 67],
      [2, 1, 2, 33],
      [3, 0, 0, null],
      [4, 0, 0, null],
    ]);
    expect(history.weeks[0].session).toEqual({
      id: week1,
      status: "CLOSED",
      startedAt: 1000,
      endedAt: 1500,
    });
    expect(history.weeks[2].session).toBeNull();
    expect(
      history.students.map((s) => [
        s.name,
        s.cells,
        s.present,
        s.absent,
        s.percent,
      ]),
    ).toEqual([
      ["Ama", { 1: "PRESENT", 2: "PRESENT" }, 2, 0, 100],
      ["Bola", { 1: "PRESENT", 2: "ABSENT" }, 1, 1, 50],
      ["Chidi", { 1: "ABSENT", 2: "ABSENT" }, 0, 2, 0],
    ]);
  });

  it("keeps students who left the sheet only if they have records", async () => {
    await takeWeek(classA, 1, ["900000002"]);
    await db.update(enrollments).set({ active: false }).run();
    await db
      .insert(students)
      .values({ studentId: "900000004", name: "Dayo" })
      .run();
    const history = (await getClassHistory(db, classA))!;
    expect(history.activeCount).toBe(0);
    expect(history.students.map((s) => [s.name, s.active])).toEqual([
      ["Ama", false],
      ["Bola", false],
      ["Chidi", false],
    ]);

    // Class B has no sessions, so its inactive student is not listed.
    expect((await getClassHistory(db, classB))!.students).toEqual([]);
  });

  it("does not mix in another class's records", async () => {
    await takeWeek(classB, 1, ["900000001"]);
    const history = (await getClassHistory(db, classA))!;
    expect(history.weeks.every((w) => w.session === null)).toBe(true);
    expect(
      history.students.every((s) => s.present === 0 && s.absent === 0),
    ).toBe(true);
  });

  it("returns null for an unknown class", async () => {
    expect(await getClassHistory(db, 999)).toBeNull();
  });
});

describe("recordPastWeek", () => {
  it("adds a closed week with nobody marked and nothing queued for the sheet", async () => {
    const result = await recordPastWeek(db, classA, 2, 5000);
    expect(result).toMatchObject({ ok: true, created: true });
    expect(await db.select().from(attendance).all()).toEqual([]);
    expect(await db.select().from(syncJobs).all()).toEqual([]);

    const week = (await getClassHistory(db, classA))!.weeks[1];
    expect(week.session).toMatchObject({
      status: "CLOSED",
      startedAt: 5000,
      endedAt: 5000,
    });
    expect(week.percent).toBeNull();
  });

  it("only writes for students the lecturer then marks", async () => {
    const result = await recordPastWeek(db, classA, 2);
    if (!result.ok) throw new Error(result.reason);
    await setAttendance(db, {
      sessionId: result.sessionId,
      studentId: ids["900000002"],
      status: "PRESENT",
    });
    expect(
      (await db.select().from(syncJobs).all()).map((j) => [
        j.studentId,
        j.week,
        j.value,
      ]),
    ).toEqual([["900000002", 2, 1]]);
  });

  it("returns the existing session instead of duplicating, and validates input", async () => {
    const sessionId = await takeWeek(classA, 1, []);
    expect(await recordPastWeek(db, classA, 1)).toEqual({
      ok: true,
      sessionId,
      created: false,
    });
    expect(await recordPastWeek(db, classA, 5)).toEqual({
      ok: false,
      reason: "BAD_WEEK",
    });
    expect(await recordPastWeek(db, 999, 1)).toEqual({
      ok: false,
      reason: "CLASS_NOT_FOUND",
    });
  });

  it("does not block starting live attendance for another week", async () => {
    await recordPastWeek(db, classA, 1);
    expect((await openSession(db, classA, 2)).ok).toBe(true);
  });
});

describe("getStudentSummary", () => {
  it("summarises each class, counting only weeks with a record", async () => {
    await takeWeek(classA, 1, ["900000002"]);
    await takeWeek(classA, 2, ["900000002"]);
    await takeWeek(classA, 3, []);
    await recordPastWeek(db, classA, 4);
    await takeWeek(classB, 1, ["900000001"]);

    const bola = (await getStudentSummary(db, "900000002"))!;
    expect(bola).toMatchObject({ studentId: "900000002", name: "Bola" });
    expect(bola.classes).toEqual([
      {
        classId: classA,
        code: "TEST101",
        moduleName: null,
        active: true,
        present: 2,
        absent: 1,
        percent: 67,
        weeks: [
          { week: 1, status: "PRESENT" },
          { week: 2, status: "PRESENT" },
          { week: 3, status: "ABSENT" },
          { week: 4, status: null },
        ],
      },
    ]);

    const ama = (await getStudentSummary(db, "900000001"))!;
    expect(
      ama.classes.map((c) => [c.code, c.present, c.absent, c.percent]),
    ).toEqual([
      ["TEST101", 0, 3, 0],
      ["TEST202", 1, 0, 100],
    ]);
  });

  it("returns null for an unknown ID", async () => {
    expect(await getStudentSummary(db, "123456")).toBeNull();
  });
});
