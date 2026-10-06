import { randomUUID } from "node:crypto";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setAttendance } from "@/lib/attendance";
import { checkIn } from "@/lib/checkin";
import type { Db } from "@/lib/db/client";
import {
  attendance,
  classes,
  enrollments,
  manualChanges,
  students,
  syncJobs,
} from "@/lib/db/schema";
import { closeSession, openSession } from "@/lib/sessions";
import { signPass } from "@/lib/token";
import { createTestDb } from "./helpers/db";

const NOW = 1_800_000_000_000;
let db: Db;
let classId: number;
let sessionId: string;
let ids: Record<string, number>;

beforeAll(async () => {
  process.env.QR_SECRET = "test-qr-secret";
});

beforeEach(async () => {
  db = await createTestDb();
  classId = (
    await db
      .insert(classes)
      .values({ code: "TEST101", sheetTab: "Attn of TEST101" })
      .returning()
      .get()
  ).id;
  ids = {};
  const add = async (studentId: string, active = true, enrolled = true) => {
    const id = (
      await db
        .insert(students)
        .values({ studentId, name: `Student ${studentId.slice(-1)}` })
        .returning()
        .get()
    ).id;
    if (enrolled)
      await db
        .insert(enrollments)
        .values({ classId, studentId: id, active })
        .run();
    ids[studentId] = id;
  };
  await add("900000001");
  await add("900000002");
  await add("900000003");
  await add("900000004", false);
  await add("900000005", true, false);

  const opened = await openSession(db, classId, 5, NOW);
  if (!opened.ok) throw new Error(opened.reason);
  sessionId = opened.sessionId;
});

async function scan(studentId: string, deviceId = randomUUID()) {
  return (
    await checkIn(
      db,
      {
        pass: signPass({ sessionId, nonce: "n", deviceId }, NOW),
        studentIdRaw: studentId,
        deviceId,
        ip: "203.0.113.5",
        userAgent: `UA-${deviceId}`,
      },
      NOW + 1000,
    )
  ).code;
}

const statusOf = async (studentId: string) =>
  (await db.select().from(attendance).all()).find(
    (row) => row.studentId === ids[studentId],
  );

const jobValues = async () =>
  (await db.select().from(syncJobs).all()).map((job) => [
    job.studentId,
    job.week,
    job.value,
  ]);

describe("closeSession absentees", () => {
  it("marks enrolled students without a record absent and queues a 0 for each", async () => {
    await scan("900000001");
    expect(await closeSession(db, sessionId, NOW + 5000)).toBe(true);

    expect(await statusOf("900000001")).toMatchObject({
      status: "PRESENT",
      source: "QR",
    });
    expect(await statusOf("900000002")).toMatchObject({
      status: "ABSENT",
      source: "MANUAL",
    });
    expect(await statusOf("900000003")).toMatchObject({
      status: "ABSENT",
      source: "MANUAL",
    });
    // Removed from the sheet, and never enrolled: no rows.
    expect(await statusOf("900000004")).toBeUndefined();
    expect(await statusOf("900000005")).toBeUndefined();
    expect(await jobValues()).toEqual([
      ["900000001", 5, 1],
      ["900000002", 5, 0],
      ["900000003", 5, 0],
    ]);
  });

  it("does not add anything when closed twice", async () => {
    await closeSession(db, sessionId);
    expect(await closeSession(db, sessionId)).toBe(false);
    expect(await db.select().from(attendance).all()).toHaveLength(3);
    expect(await db.select().from(syncJobs).all()).toHaveLength(3);
  });

  it("lets an absentee check in after the session is reopened", async () => {
    await closeSession(db, sessionId);
    await openSession(db, classId, 5);
    expect(await scan("900000002")).toBe("OK");
    expect(await statusOf("900000002")).toMatchObject({
      status: "PRESENT",
      source: "QR",
    });

    await closeSession(db, sessionId);
    expect(await db.select().from(attendance).all()).toHaveLength(3);
    expect((await jobValues()).at(-1)).toEqual(["900000002", 5, 1]);
  });
});

describe("setAttendance", () => {
  const set = (
    studentId: string,
    status: "PRESENT" | "ABSENT",
    reason?: string,
  ) =>
    setAttendance(
      db,
      { sessionId, studentId: ids[studentId], status, reason },
      NOW + 2000,
    );

  it("marks a student present by hand, logs it and queues a 1", async () => {
    expect(await set("900000001", "PRESENT", "  phone dead ")).toEqual({
      ok: true,
      changed: true,
    });
    expect(await statusOf("900000001")).toMatchObject({
      status: "PRESENT",
      source: "MANUAL",
      checkInAt: NOW + 2000,
      deviceId: null,
    });
    expect(await db.select().from(manualChanges).all()).toMatchObject([
      {
        sessionId,
        studentId: ids["900000001"],
        previousStatus: null,
        newStatus: "PRESENT",
        reason: "phone dead",
        createdAt: NOW + 2000,
      },
    ]);
    expect(await jobValues()).toEqual([["900000001", 5, 1]]);
  });

  it("changes present to absent and records the previous status", async () => {
    await scan("900000001");
    await set("900000001", "ABSENT");
    expect(await statusOf("900000001")).toMatchObject({
      status: "ABSENT",
      source: "MANUAL",
      checkInAt: null,
    });
    expect(await db.select().from(manualChanges).get()).toMatchObject({
      previousStatus: "PRESENT",
      newStatus: "ABSENT",
      reason: null,
    });
    expect(await jobValues()).toEqual([
      ["900000001", 5, 1],
      ["900000001", 5, 0],
    ]);
  });

  it("does nothing when the status is already what was asked", async () => {
    await set("900000001", "PRESENT");
    expect(await set("900000001", "PRESENT")).toEqual({
      ok: true,
      changed: false,
    });
    expect(await db.select().from(manualChanges).all()).toHaveLength(1);
    expect(await db.select().from(syncJobs).all()).toHaveLength(1);
  });

  it("works after the session is closed", async () => {
    await closeSession(db, sessionId);
    expect(await set("900000002", "PRESENT")).toEqual({
      ok: true,
      changed: true,
    });
    expect((await statusOf("900000002"))?.status).toBe("PRESENT");
  });

  it("frees the phone when a wrong QR check-in is un-marked", async () => {
    const phone = randomUUID();
    expect(await scan("900000002", phone)).toBe("OK");
    expect(await scan("900000001", phone)).toBe("DEVICE_USED");
    await set("900000002", "ABSENT");
    expect(await scan("900000001", phone)).toBe("OK");
  });

  it("clears a suspicious flag when the lecturer confirms by hand", async () => {
    await db
      .insert(attendance)
      .values({
        sessionId,
        studentId: ids["900000001"],
        status: "ABSENT",
        source: "QR",
        flagged: true,
      })
      .run();
    await set("900000001", "PRESENT");
    expect((await statusOf("900000001"))?.flagged).toBe(false);
  });

  it("refuses students who are not on the class list, and unknown ids", async () => {
    expect(await set("900000004", "PRESENT")).toEqual({
      ok: false,
      reason: "NOT_ENROLLED",
    });
    expect(await set("900000005", "PRESENT")).toEqual({
      ok: false,
      reason: "NOT_ENROLLED",
    });
    expect(
      await setAttendance(db, {
        sessionId,
        studentId: 9999,
        status: "PRESENT",
      }),
    ).toEqual({ ok: false, reason: "STUDENT_NOT_FOUND" });
    expect(
      await setAttendance(db, {
        sessionId: "nope",
        studentId: ids["900000001"],
        status: "PRESENT",
      }),
    ).toEqual({ ok: false, reason: "SESSION_NOT_FOUND" });
    expect(await db.select().from(attendance).all()).toHaveLength(0);
  });

  it("still allows corrections for a student who has a record but left the sheet", async () => {
    await scan("900000003");
    await db.update(enrollments).set({ active: false }).run();
    expect(await set("900000003", "ABSENT")).toEqual({
      ok: true,
      changed: true,
    });
  });
});
