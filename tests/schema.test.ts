import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/lib/db/client";
import {
  attendance,
  classes,
  enrollments,
  sessions,
  students,
} from "@/lib/db/schema";
import { createTestDb } from "./helpers/db";

let db: Db;
let classId: number;
let studentA: number;
let studentB: number;

beforeEach(() => {
  db = createTestDb();
  classId = db
    .insert(classes)
    .values({ code: "TEST101", sheetTab: "Attn of TEST101" })
    .returning()
    .get().id;
  studentA = db
    .insert(students)
    .values({ studentId: "900000001", name: "Student One" })
    .returning()
    .get().id;
  studentB = db
    .insert(students)
    .values({ studentId: "900000002", name: "Student Two" })
    .returning()
    .get().id;
});

function startSession(id: string, week: number, status: "ACTIVE" | "CLOSED") {
  return db
    .insert(sessions)
    .values({ id, classId, week, status, startedAt: Date.now() })
    .run();
}

describe("schema constraints", () => {
  it("allows one enrollment per student per class", () => {
    db.insert(enrollments).values({ classId, studentId: studentA }).run();
    expect(() =>
      db.insert(enrollments).values({ classId, studentId: studentA }).run(),
    ).toThrow(/UNIQUE/);
  });

  it("allows one session per class per week", () => {
    startSession("s1", 1, "CLOSED");
    expect(() => startSession("s2", 1, "CLOSED")).toThrow(/UNIQUE/);
  });

  it("allows one active session per class, any number of closed ones", () => {
    startSession("s1", 1, "CLOSED");
    startSession("s2", 2, "CLOSED");
    startSession("s3", 3, "ACTIVE");
    expect(() => startSession("s4", 4, "ACTIVE")).toThrow(/UNIQUE/);
  });

  it("rejects a second attendance row for the same student", () => {
    startSession("s1", 1, "ACTIVE");
    const row = {
      sessionId: "s1",
      studentId: studentA,
      status: "PRESENT" as const,
      source: "QR" as const,
      deviceId: "device-1",
    };
    db.insert(attendance).values(row).run();
    expect(() =>
      db
        .insert(attendance)
        .values({ ...row, deviceId: "device-2" })
        .run(),
    ).toThrow(/UNIQUE/);
  });

  it("rejects a second QR check-in from the same device", () => {
    startSession("s1", 1, "ACTIVE");
    db.insert(attendance)
      .values({
        sessionId: "s1",
        studentId: studentA,
        status: "PRESENT",
        source: "QR",
        deviceId: "device-1",
      })
      .run();
    expect(() =>
      db
        .insert(attendance)
        .values({
          sessionId: "s1",
          studentId: studentB,
          status: "PRESENT",
          source: "QR",
          deviceId: "device-1",
        })
        .run(),
    ).toThrow(/UNIQUE/);
  });

  it("does not apply the device rule to manual rows", () => {
    startSession("s1", 1, "ACTIVE");
    for (const studentId of [studentA, studentB]) {
      db.insert(attendance)
        .values({ sessionId: "s1", studentId, status: "ABSENT", source: "MANUAL" })
        .run();
    }
    expect(db.select().from(attendance).all()).toHaveLength(2);
  });

  it("enforces foreign keys", () => {
    expect(() =>
      db
        .insert(attendance)
        .values({
          sessionId: "missing",
          studentId: studentA,
          status: "PRESENT",
          source: "MANUAL",
        })
        .run(),
    ).toThrow(/FOREIGN KEY/);
  });
});
