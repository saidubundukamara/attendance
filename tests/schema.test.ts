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

beforeEach(async () => {
  db = await createTestDb();
  classId = (
    await db
      .insert(classes)
      .values({ code: "TEST101", sheetTab: "Attn of TEST101" })
      .returning()
      .get()
  ).id;
  studentA = (
    await db
      .insert(students)
      .values({ studentId: "900000001", name: "Student One" })
      .returning()
      .get()
  ).id;
  studentB = (
    await db
      .insert(students)
      .values({ studentId: "900000002", name: "Student Two" })
      .returning()
      .get()
  ).id;
});

async function startSession(
  id: string,
  week: number,
  status: "ACTIVE" | "CLOSED",
) {
  return await db
    .insert(sessions)
    .values({ id, classId, week, status, startedAt: Date.now() })
    .run();
}

describe("schema constraints", () => {
  it("allows one enrollment per student per class", async () => {
    await db.insert(enrollments).values({ classId, studentId: studentA }).run();
    await expect(
      db.insert(enrollments).values({ classId, studentId: studentA }).run(),
    ).rejects.toMatchObject({
      cause: { message: expect.stringMatching(/UNIQUE/) },
    });
  });

  it("allows one session per class per week", async () => {
    await startSession("s1", 1, "CLOSED");
    await expect(startSession("s2", 1, "CLOSED")).rejects.toMatchObject({
      cause: { message: expect.stringMatching(/UNIQUE/) },
    });
  });

  it("allows one active session per class, any number of closed ones", async () => {
    await startSession("s1", 1, "CLOSED");
    await startSession("s2", 2, "CLOSED");
    await startSession("s3", 3, "ACTIVE");
    await expect(startSession("s4", 4, "ACTIVE")).rejects.toMatchObject({
      cause: { message: expect.stringMatching(/UNIQUE/) },
    });
  });

  it("rejects a second attendance row for the same student", async () => {
    await startSession("s1", 1, "ACTIVE");
    const row = {
      sessionId: "s1",
      studentId: studentA,
      status: "PRESENT" as const,
      source: "QR" as const,
      deviceId: "device-1",
    };
    await db.insert(attendance).values(row).run();
    await expect(
      db
        .insert(attendance)
        .values({ ...row, deviceId: "device-2" })
        .run(),
    ).rejects.toMatchObject({
      cause: { message: expect.stringMatching(/UNIQUE/) },
    });
  });

  it("rejects a second QR check-in from the same device", async () => {
    await startSession("s1", 1, "ACTIVE");
    await db
      .insert(attendance)
      .values({
        sessionId: "s1",
        studentId: studentA,
        status: "PRESENT",
        source: "QR",
        deviceId: "device-1",
      })
      .run();
    await expect(
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
    ).rejects.toMatchObject({
      cause: { message: expect.stringMatching(/UNIQUE/) },
    });
  });

  it("does not apply the device rule to manual rows", async () => {
    await startSession("s1", 1, "ACTIVE");
    for (const studentId of [studentA, studentB]) {
      await db
        .insert(attendance)
        .values({
          sessionId: "s1",
          studentId,
          status: "ABSENT",
          source: "MANUAL",
        })
        .run();
    }
    expect(await db.select().from(attendance).all()).toHaveLength(2);
  });

  it("enforces foreign keys", async () => {
    await expect(
      db
        .insert(attendance)
        .values({
          sessionId: "missing",
          studentId: studentA,
          status: "PRESENT",
          source: "MANUAL",
        })
        .run(),
    ).rejects.toMatchObject({
      cause: { message: expect.stringMatching(/FOREIGN KEY/) },
    });
  });
});
