// Several lecturers on one database: nothing of one lecturer's leaks into
// another's, and students find modules across lecturers through cohorts.
import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  approveEmail,
  createCohort,
  deleteCohort,
  listAccess,
  listCohorts,
  revokeEmail,
} from "@/lib/admin";
import {
  ownsAssignment,
  ownsClass,
  ownsSession,
  ownsStudent,
  ownsSubmission,
} from "@/lib/data/ownership";
import type { Db } from "@/lib/db/client";
import {
  assignments,
  classes,
  cohorts,
  enrollments,
  lecturers,
  sessions,
  students,
  submissions,
  syncJobs,
} from "@/lib/db/schema";
import { isApproved, recordSignIn } from "@/lib/lecturers";
import { clearHits } from "@/lib/ratelimit";
import { parseAttendanceTab } from "@/lib/sheets/parse";
import { applyRoster } from "@/lib/sheets/roster";
import { getSyncStatus, processSyncJobs, type SheetIo } from "@/lib/sheets/write";
import { lookupCohortModules, lookupStudent } from "@/lib/submissions";
import { LECTURER, createTestDb } from "./helpers/db";
import { buildTab, type FixtureStudent } from "./helpers/sheet";

const OTHER = 2;
let db: Db;

beforeEach(async () => {
  db = await createTestDb();
  await db
    .insert(lecturers)
    .values({ id: OTHER, email: "other@example.com", name: "Dr Other", createdAt: 0 })
    .run();
  clearHits("submit:ip:test");
});

afterEach(() => {
  delete process.env.ADMIN_EMAILS;
});

function tab(title: string, rows: FixtureStudent[]) {
  return { title, parsed: parseAttendanceTab(buildTab(rows, { weeks: 4 })) };
}

async function classOf(lecturerId: number, code: string) {
  return (await db
    .select()
    .from(classes)
    .where(and(eq(classes.lecturerId, lecturerId), eq(classes.code, code)))
    .get())!;
}

describe("rosters per lecturer", () => {
  it("keeps the same class code and student ID apart", async () => {
    await applyRoster(db, LECTURER, [
      tab("Attn of BIT101", [{ name: "Ama Mine", id: 905001111 }]),
    ]);
    await applyRoster(db, OTHER, [
      tab("Attn of BIT101", [{ name: "Ama Theirs", id: 905001111 }]),
    ]);

    const mine = await classOf(LECTURER, "BIT101");
    const theirs = await classOf(OTHER, "BIT101");
    expect(mine.id).not.toBe(theirs.id);

    const rows = await db
      .select({ lecturerId: students.lecturerId, name: students.name })
      .from(students)
      .where(eq(students.studentId, "905001111"))
      .all();
    // One record per lecturer; neither sheet renamed the other's student.
    expect(rows).toEqual(
      expect.arrayContaining([
        { lecturerId: LECTURER, name: "Ama Mine" },
        { lecturerId: OTHER, name: "Ama Theirs" },
      ]),
    );
    expect(rows).toHaveLength(2);
  });

  it("only deactivates students in the syncing lecturer's classes", async () => {
    await applyRoster(db, LECTURER, [tab("Attn of BIT101", [{ id: 905001111 }])]);
    await applyRoster(db, OTHER, [tab("Attn of BIT101", [{ id: 905001111 }])]);
    await applyRoster(db, LECTURER, [tab("Attn of BIT101", [])]);

    const active = await db
      .select({ lecturerId: classes.lecturerId, active: enrollments.active })
      .from(enrollments)
      .innerJoin(classes, eq(classes.id, enrollments.classId))
      .all();
    expect(active).toEqual(
      expect.arrayContaining([
        { lecturerId: LECTURER, active: false },
        { lecturerId: OTHER, active: true },
      ]),
    );
  });
});

describe("ownership", () => {
  it("lets a lecturer reach only their own records", async () => {
    await applyRoster(db, LECTURER, [tab("Attn of BIT101", [{ id: 905001111 }])]);
    const cls = await classOf(LECTURER, "BIT101");
    const student = (await db.select().from(students).get())!;
    await db
      .insert(sessions)
      .values({ id: "s1", classId: cls.id, week: 1, status: "ACTIVE", startedAt: 0 })
      .run();
    const item = await db
      .insert(assignments)
      .values({ classId: cls.id, title: "A1", dueAt: 0, createdAt: 0 })
      .returning()
      .get();
    const sub = await db
      .insert(submissions)
      .values({
        assignmentId: item.id,
        studentId: student.id,
        status: "COMPLETE",
        uploadToken: "t",
        startedAt: 0,
      })
      .returning()
      .get();

    expect(await ownsClass(db, LECTURER, cls.id)).toBe(true);
    expect(await ownsSession(db, LECTURER, "s1")).toBe(true);
    expect(await ownsAssignment(db, LECTURER, item.id)).toBe(true);
    expect(await ownsSubmission(db, LECTURER, sub.id)).toBe(true);
    expect(await ownsStudent(db, LECTURER, student.id)).toBe(true);

    expect(await ownsClass(db, OTHER, cls.id)).toBe(false);
    expect(await ownsSession(db, OTHER, "s1")).toBe(false);
    expect(await ownsAssignment(db, OTHER, item.id)).toBe(false);
    expect(await ownsSubmission(db, OTHER, sub.id)).toBe(false);
    expect(await ownsStudent(db, OTHER, student.id)).toBe(false);
  });
});

describe("sheet sync per lecturer", () => {
  it("reports and sends only the lecturer's own queue", async () => {
    await applyRoster(db, LECTURER, [tab("Attn of BIT101", [{ id: 905001111 }])]);
    await applyRoster(db, OTHER, [tab("Attn of BIT102", [{ id: 905002222 }])]);
    const mine = await classOf(LECTURER, "BIT101");
    const theirs = await classOf(OTHER, "BIT102");
    for (const [classId, studentId] of [
      [mine.id, "905001111"],
      [theirs.id, "905002222"],
    ] as const) {
      await db
        .insert(syncJobs)
        .values({ classId, studentId, week: 1, value: 1, createdAt: Date.now() })
        .run();
    }

    expect((await getSyncStatus(db, LECTURER)).pending).toBe(1);
    expect((await getSyncStatus(db, OTHER)).pending).toBe(1);

    const tabsRead: string[] = [];
    const io: SheetIo = {
      async fetchTabValues(titles) {
        tabsRead.push(...titles);
        return titles.map((title) => ({
          title,
          values: buildTab([{ id: 905001111 }], { weeks: 4 }),
        }));
      },
      async writeCells() {},
    };
    await processSyncJobs(db, io, { lecturerId: LECTURER });
    expect(tabsRead).toEqual(["Attn of BIT101"]);
    expect((await getSyncStatus(db, LECTURER)).pending).toBe(0);
    expect((await getSyncStatus(db, OTHER)).pending).toBe(1);
  });
});

describe("lookupCohortModules", () => {
  async function setUp() {
    await createCohort(db, "BSEM Year 1");
    await createCohort(db, "BSEM Year 2");
    const [year1, year2] = await db.select().from(cohorts).all();
    await applyRoster(db, LECTURER, [
      tab("Attn of BSEM1201", [{ name: "Ama", id: 905001111 }]),
      tab("Attn of BSEM1299", [{ name: "Ama", id: 905001111 }]),
      tab("Attn of BSEM2201", [{ name: "Ama", id: 905001111 }]),
    ]);
    await applyRoster(db, OTHER, [
      tab("Attn of BSEM1203", [{ name: "Ama B.", id: 905001111 }]),
      tab("Attn of BSEM1205", [{ name: "Kofi", id: 905002222 }]),
    ]);
    const put = async (lecturerId: number, code: string, cohortId: number) => {
      const cls = await classOf(lecturerId, code);
      await db.update(classes).set({ cohortId }).where(eq(classes.id, cls.id)).run();
      return cls;
    };
    const withWork = async (classId: number) =>
      db
        .insert(assignments)
        .values({ classId, title: "A1", dueAt: 0, createdAt: 0 })
        .run();

    const a = await put(LECTURER, "BSEM1201", year1.id);
    // In the cohort but nothing set yet.
    await put(LECTURER, "BSEM1299", year1.id);
    const c = await put(LECTURER, "BSEM2201", year2.id);
    const d = await put(OTHER, "BSEM1203", year1.id);
    const e = await put(OTHER, "BSEM1205", year1.id);
    for (const cls of [a, c, d, e]) await withWork(cls.id);
    return { year1, a, d };
  }

  it("lists the student's modules with work in the cohort, across lecturers", async () => {
    const { year1, a, d } = await setUp();
    const result = await lookupCohortModules(db, {
      cohortId: year1.id,
      studentIdRaw: "1111",
      ip: "test",
    });
    expect(result).toEqual({
      code: "OK",
      student: { name: "Ama", studentId: "905001111" },
      modules: [
        { classId: a.id, code: "BSEM1201", moduleName: "Test Module", lecturerName: "" },
        { classId: d.id, code: "BSEM1203", moduleName: "Test Module", lecturerName: "Dr Other" },
      ],
    });
  });

  it("refuses an ID on no module in the cohort, or a bad ID", async () => {
    const { year1 } = await setUp();
    expect(
      (await lookupCohortModules(db, { cohortId: year1.id, studentIdRaw: "3333", ip: "test" })).code,
    ).toBe("NOT_FOUND");
    expect(
      (await lookupCohortModules(db, { cohortId: year1.id, studentIdRaw: "12", ip: "test" })).code,
    ).toBe("INVALID_ID");
  });

  it("opens a module's items with the lecturer's own record of the student", async () => {
    const { d } = await setUp();
    const result = await lookupStudent(db, {
      classId: d.id,
      studentIdRaw: "1111",
      ip: "test",
    });
    expect(result).toMatchObject({
      code: "OK",
      student: { name: "Ama B.", studentId: "905001111" },
    });
  });
});

describe("sign-in", () => {
  it("lets in admins and approved emails only", async () => {
    process.env.ADMIN_EMAILS = "Boss@Example.com";
    expect(await isApproved(db, "boss@example.com")).toBe(true);
    expect(await isApproved(db, "new@example.com")).toBe(false);
    await approveEmail(db, " New@Example.com ");
    expect(await isApproved(db, "new@example.com")).toBe(true);
    await revokeEmail(db, "NEW@example.com");
    expect(await isApproved(db, "new@example.com")).toBe(false);
  });

  it("hands the legacy data to the first admin to sign in", async () => {
    process.env.ADMIN_EMAILS = "boss@example.com";
    const legacy = await db
      .insert(lecturers)
      .values({ name: "", createdAt: 0 })
      .returning()
      .get();

    // A non-admin gets a fresh account.
    const other = await recordSignIn(db, {
      googleSub: "sub-new",
      email: "new@example.com",
      name: "New",
      refreshTokenEnc: "enc-new",
      legacyDriveFolderId: "folder",
    });
    expect(other.id).not.toBe(legacy.id);
    expect(other.driveFolderId).toBeNull();

    const admin = await recordSignIn(db, {
      googleSub: "sub-boss",
      email: "Boss@example.com",
      name: "Boss",
      refreshTokenEnc: "enc-1",
      legacyDriveFolderId: "folder",
    });
    expect(admin).toMatchObject({
      id: legacy.id,
      email: "boss@example.com",
      driveFolderId: "folder",
      refreshTokenEnc: "enc-1",
    });

    // Signing in again without a new refresh token keeps the stored one.
    const again = await recordSignIn(db, {
      googleSub: "sub-boss",
      email: "boss@example.com",
      name: "Boss",
      refreshTokenEnc: null,
    });
    expect(again).toMatchObject({ id: legacy.id, refreshTokenEnc: "enc-1" });
  });
});

describe("admin", () => {
  it("lists admins, approved emails and lecturers", async () => {
    process.env.ADMIN_EMAILS = "boss@example.com";
    await approveEmail(db, "other@example.com");
    await approveEmail(db, "pending@example.com");
    const rows = await listAccess(db);
    expect(rows.map((r) => [r.email, r.admin, r.approved, Boolean(r.lecturer)])).toEqual([
      ["boss@example.com", true, false, false],
      ["lecturer@example.com", false, false, true],
      ["other@example.com", false, true, true],
      ["pending@example.com", false, true, false],
    ]);
  });

  it("deletes a cohort only once no module is in it", async () => {
    await createCohort(db, "Year 1");
    expect(await createCohort(db, "Year 1")).toMatchObject({ ok: false });
    const [year1] = await listCohorts(db);
    await applyRoster(db, LECTURER, [tab("Attn of BIT101", [])]);
    await db.update(classes).set({ cohortId: year1.id }).run();
    expect((await listCohorts(db))[0].moduleCount).toBe(1);

    expect(await deleteCohort(db, year1.id)).toMatchObject({ ok: false });
    await db.update(classes).set({ cohortId: null }).run();
    expect(await deleteCohort(db, year1.id)).toEqual({ ok: true });
    expect(await listCohorts(db)).toEqual([]);
  });
});
