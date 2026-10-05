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

beforeAll(() => {
  process.env.QR_SECRET = "test-qr-secret";
});

beforeEach(() => {
  db = createTestDb();
  classId = db
    .insert(classes)
    .values({ code: "TEST101", sheetTab: "Attn of TEST101" })
    .returning()
    .get().id;
  ids = {};
  const add = (studentId: string, active = true, enrolled = true) => {
    const id = db
      .insert(students)
      .values({ studentId, name: `Student ${studentId.slice(-1)}` })
      .returning()
      .get().id;
    if (enrolled) db.insert(enrollments).values({ classId, studentId: id, active }).run();
    ids[studentId] = id;
  };
  add("900000001");
  add("900000002");
  add("900000003");
  add("900000004", false);
  add("900000005", true, false);

  const opened = openSession(db, classId, 5, NOW);
  if (!opened.ok) throw new Error(opened.reason);
  sessionId = opened.sessionId;
});

function scan(studentId: string, deviceId = randomUUID()) {
  return checkIn(
    db,
    {
      pass: signPass({ sessionId, nonce: "n", deviceId }, NOW),
      studentIdRaw: studentId,
      deviceId,
      ip: "203.0.113.5",
      userAgent: `UA-${deviceId}`,
    },
    NOW + 1000,
  ).code;
}

const statusOf = (studentId: string) =>
  db
    .select()
    .from(attendance)
    .all()
    .find((row) => row.studentId === ids[studentId]);

const jobValues = () =>
  db.select().from(syncJobs).all().map((job) => [job.studentId, job.week, job.value]);

describe("closeSession absentees", () => {
  it("marks enrolled students without a record absent and queues a 0 for each", () => {
    scan("900000001");
    expect(closeSession(db, sessionId, NOW + 5000)).toBe(true);

    expect(statusOf("900000001")).toMatchObject({ status: "PRESENT", source: "QR" });
    expect(statusOf("900000002")).toMatchObject({ status: "ABSENT", source: "MANUAL" });
    expect(statusOf("900000003")).toMatchObject({ status: "ABSENT", source: "MANUAL" });
    // Removed from the sheet, and never enrolled: no rows.
    expect(statusOf("900000004")).toBeUndefined();
    expect(statusOf("900000005")).toBeUndefined();
    expect(jobValues()).toEqual([
      ["900000001", 5, 1],
      ["900000002", 5, 0],
      ["900000003", 5, 0],
    ]);
  });

  it("does not add anything when closed twice", () => {
    closeSession(db, sessionId);
    expect(closeSession(db, sessionId)).toBe(false);
    expect(db.select().from(attendance).all()).toHaveLength(3);
    expect(db.select().from(syncJobs).all()).toHaveLength(3);
  });

  it("lets an absentee check in after the session is reopened", () => {
    closeSession(db, sessionId);
    openSession(db, classId, 5);
    expect(scan("900000002")).toBe("OK");
    expect(statusOf("900000002")).toMatchObject({ status: "PRESENT", source: "QR" });

    closeSession(db, sessionId);
    expect(db.select().from(attendance).all()).toHaveLength(3);
    expect(jobValues().at(-1)).toEqual(["900000002", 5, 1]);
  });
});

describe("setAttendance", () => {
  const set = (studentId: string, status: "PRESENT" | "ABSENT", reason?: string) =>
    setAttendance(
      db,
      { sessionId, studentId: ids[studentId], status, reason },
      NOW + 2000,
    );

  it("marks a student present by hand, logs it and queues a 1", () => {
    expect(set("900000001", "PRESENT", "  phone dead ")).toEqual({ ok: true, changed: true });
    expect(statusOf("900000001")).toMatchObject({
      status: "PRESENT",
      source: "MANUAL",
      checkInAt: NOW + 2000,
      deviceId: null,
    });
    expect(db.select().from(manualChanges).all()).toMatchObject([
      {
        sessionId,
        studentId: ids["900000001"],
        previousStatus: null,
        newStatus: "PRESENT",
        reason: "phone dead",
        createdAt: NOW + 2000,
      },
    ]);
    expect(jobValues()).toEqual([["900000001", 5, 1]]);
  });

  it("changes present to absent and records the previous status", () => {
    scan("900000001");
    set("900000001", "ABSENT");
    expect(statusOf("900000001")).toMatchObject({
      status: "ABSENT",
      source: "MANUAL",
      checkInAt: null,
    });
    expect(db.select().from(manualChanges).get()).toMatchObject({
      previousStatus: "PRESENT",
      newStatus: "ABSENT",
      reason: null,
    });
    expect(jobValues()).toEqual([
      ["900000001", 5, 1],
      ["900000001", 5, 0],
    ]);
  });

  it("does nothing when the status is already what was asked", () => {
    set("900000001", "PRESENT");
    expect(set("900000001", "PRESENT")).toEqual({ ok: true, changed: false });
    expect(db.select().from(manualChanges).all()).toHaveLength(1);
    expect(db.select().from(syncJobs).all()).toHaveLength(1);
  });

  it("works after the session is closed", () => {
    closeSession(db, sessionId);
    expect(set("900000002", "PRESENT")).toEqual({ ok: true, changed: true });
    expect(statusOf("900000002")?.status).toBe("PRESENT");
  });

  it("frees the phone when a wrong QR check-in is un-marked", () => {
    const phone = randomUUID();
    expect(scan("900000002", phone)).toBe("OK");
    expect(scan("900000001", phone)).toBe("DEVICE_USED");
    set("900000002", "ABSENT");
    expect(scan("900000001", phone)).toBe("OK");
  });

  it("clears a suspicious flag when the lecturer confirms by hand", () => {
    db.insert(attendance)
      .values({
        sessionId,
        studentId: ids["900000001"],
        status: "ABSENT",
        source: "QR",
        flagged: true,
      })
      .run();
    set("900000001", "PRESENT");
    expect(statusOf("900000001")?.flagged).toBe(false);
  });

  it("refuses students who are not on the class list, and unknown ids", () => {
    expect(set("900000004", "PRESENT")).toEqual({ ok: false, reason: "NOT_ENROLLED" });
    expect(set("900000005", "PRESENT")).toEqual({ ok: false, reason: "NOT_ENROLLED" });
    expect(
      setAttendance(db, { sessionId, studentId: 9999, status: "PRESENT" }),
    ).toEqual({ ok: false, reason: "STUDENT_NOT_FOUND" });
    expect(
      setAttendance(db, { sessionId: "nope", studentId: ids["900000001"], status: "PRESENT" }),
    ).toEqual({ ok: false, reason: "SESSION_NOT_FOUND" });
    expect(db.select().from(attendance).all()).toHaveLength(0);
  });

  it("still allows corrections for a student who has a record but left the sheet", () => {
    scan("900000003");
    db.update(enrollments).set({ active: false }).run();
    expect(set("900000003", "ABSENT")).toEqual({ ok: true, changed: true });
  });
});
