import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { checkIn, type CheckInInput } from "@/lib/checkin";
import {
  escapeHtml,
  idErrorMessage,
  renderForm,
  renderResult,
} from "@/lib/checkin-page";
import type { Db } from "@/lib/db/client";
import {
  attendance,
  checkinAttempts,
  classes,
  enrollments,
  students,
  syncJobs,
} from "@/lib/db/schema";
import { closeSession, openSession } from "@/lib/sessions";
import { expandStudentId, studentIdSuffix } from "@/lib/student-id";
import { PASS_TTL_SECONDS, signPass, signQrToken } from "@/lib/token";
import { createTestDb } from "./helpers/db";

const NOW = 1_800_000_000_000;
let db: Db;
let sessionId: string;
let otherSessionId: string;

beforeAll(async () => {
  process.env.QR_SECRET = "test-qr-secret";
});

beforeEach(async () => {
  db = await createTestDb();
  const [classA, classB] = await Promise.all(
    ["TEST101", "TEST202"].map(
      async (code) =>
        (
          await db
            .insert(classes)
            .values({ code, sheetTab: `Attn of ${code}`, totalWeeks: 15 })
            .returning()
            .get()
        ).id,
    ),
  );
  const enroll = async (classId: number, studentId: string, active = true) => {
    const id = (
      await db
        .insert(students)
        .values({ studentId, name: `Student ${studentId.slice(-1)}` })
        .returning()
        .get()
    ).id;
    await db
      .insert(enrollments)
      .values({ classId, studentId: id, active })
      .run();
  };
  await enroll(classA, "900000001");
  await enroll(classA, "900000002");
  await enroll(classA, "900000003", false);
  await enroll(classB, "900000009");

  const open = async (classId: number) => {
    const result = await openSession(db, classId, 5, NOW);
    if (!result.ok) throw new Error(result.reason);
    return result.sessionId;
  };
  sessionId = await open(classA);
  otherSessionId = await open(classB);
});

async function submit(
  studentIdRaw: string,
  overrides: Partial<CheckInInput> & { session?: string; at?: number } = {},
) {
  const deviceId = overrides.deviceId ?? randomUUID();
  const { session, at, ...rest } = overrides;
  return await checkIn(
    db,
    {
      pass: signPass(
        { sessionId: session ?? sessionId, nonce: "nonce1", deviceId },
        NOW,
      ),
      studentIdRaw,
      deviceId,
      ip: "203.0.113.5",
      userAgent: `UA-${deviceId}`,
      ...rest,
    },
    at ?? NOW + 1000,
  );
}

const rows = async () => await db.select().from(attendance).all();

describe("checkIn", () => {
  it("records a valid check-in and queues the sheet write", async () => {
    const deviceId = randomUUID();
    const result = await submit(" 900000001 ", { deviceId });
    expect(result).toEqual({ code: "OK", sessionId, studentName: "Student 1" });
    expect(await rows()).toHaveLength(1);
    expect((await rows())[0]).toMatchObject({
      sessionId,
      status: "PRESENT",
      source: "QR",
      checkInAt: NOW + 1000,
      deviceId,
      ip: "203.0.113.5",
      nonce: "nonce1",
      flagged: false,
    });
    expect(await db.select().from(syncJobs).all()).toMatchObject([
      { studentId: "900000001", week: 5, value: 1, status: "PENDING" },
    ]);
  });

  it("answers ALREADY for a repeat, from the same or another phone", async () => {
    const deviceId = randomUUID();
    await submit("900000001", { deviceId });
    expect((await submit("900000001", { deviceId })).code).toBe("ALREADY");
    expect((await submit("900000001")).code).toBe("ALREADY");
    expect(await rows()).toHaveLength(1);
    expect(await db.select().from(syncJobs).all()).toHaveLength(1);
  });

  it("blocks a second student from the same phone", async () => {
    const deviceId = randomUUID();
    await submit("900000001", { deviceId });
    expect((await submit("900000002", { deviceId })).code).toBe("DEVICE_USED");
    expect(await rows()).toHaveLength(1);
  });

  it("lets the same phone check in to a different class's session", async () => {
    const deviceId = randomUUID();
    await submit("900000001", { deviceId });
    expect(
      (await submit("900000009", { deviceId, session: otherSessionId })).code,
    ).toBe("OK");
  });

  it("rejects IDs that are unknown, from another class, or inactive", async () => {
    expect((await submit("900000777")).code).toBe("NOT_FOUND");
    expect((await submit("900000009")).code).toBe("NOT_FOUND");
    expect((await submit("900000003")).code).toBe("NOT_FOUND");
    expect(await rows()).toHaveLength(0);
  });

  it("accepts the last four digits in place of the full ID", async () => {
    const classId = (await db
      .select()
      .from(classes)
      .where(eq(classes.code, "TEST101"))
      .get())!.id;
    const id = (
      await db
        .insert(students)
        .values({ studentId: "905005069", name: "Student 9" })
        .returning()
        .get()
    ).id;
    await db.insert(enrollments).values({ classId, studentId: id }).run();

    expect((await submit("5069")).code).toBe("OK");
    expect(await rows()).toHaveLength(1);
    // The attempt is logged against the full ID.
    expect(
      (await db.select().from(checkinAttempts).all()).map(
        (a) => a.studentIdEntered,
      ),
    ).toEqual(["905005069"]);
    expect((await submit("905005069")).code).toBe("ALREADY");
    expect((await submit("0001")).code).toBe("NOT_FOUND");
  });

  it("rejects malformed IDs", async () => {
    for (const bad of ["", "abc", "12", "9000000011111111", "1 OR 1=1"]) {
      expect((await submit(bad)).code).toBe("INVALID_ID");
    }
  });

  it("rejects a closed session", async () => {
    await closeSession(db, sessionId);
    expect((await submit("900000001")).code).toBe("CLOSED");
    // Closing marked both enrolled students absent; the scan changed nothing.
    expect((await rows()).map((r) => r.status)).toEqual(["ABSENT", "ABSENT"]);
  });

  it("rejects an expired pass", async () => {
    const at = NOW + PASS_TTL_SECONDS * 1000;
    expect((await submit("900000001", { at })).code).toBe("EXPIRED");
  });

  it("rejects a pass used from a different phone, or with no device cookie", async () => {
    const pass = signPass(
      { sessionId, nonce: "n", deviceId: randomUUID() },
      NOW,
    );
    expect(
      (await submit("900000001", { pass, deviceId: randomUUID() })).code,
    ).toBe("EXPIRED");
    expect((await submit("900000001", { pass, deviceId: null })).code).toBe(
      "EXPIRED",
    );
  });

  it("rejects a missing or forged pass, and a QR token used as a pass", async () => {
    const deviceId = randomUUID();
    const good = signPass({ sessionId, nonce: "n", deviceId }, NOW);
    const forged = good.replace(sessionId, otherSessionId);
    const qr = signQrToken(sessionId, NOW).token;
    for (const pass of [null, "", "junk", forged, qr]) {
      expect((await submit("900000001", { pass, deviceId })).code).toBe(
        "EXPIRED",
      );
    }
    expect(await rows()).toHaveLength(0);
  });

  it("rejects a pass for a session that does not exist", async () => {
    expect((await submit("900000001", { session: randomUUID() })).code).toBe(
      "EXPIRED",
    );
  });

  it("turns an absent mark into present when the student checks in", async () => {
    const student = await db
      .select()
      .from(students)
      .where(eq(students.studentId, "900000001"))
      .get();
    await db
      .insert(attendance)
      .values({
        sessionId,
        studentId: student!.id,
        status: "ABSENT",
        source: "MANUAL",
      })
      .run();
    expect((await submit("900000001")).code).toBe("OK");
    expect(await rows()).toMatchObject([{ status: "PRESENT", source: "QR" }]);
  });

  it("flags a second check-in from the same address and browser", async () => {
    await submit("900000001", { userAgent: "SamePhone" });
    await submit("900000002", { userAgent: "SamePhone" });
    expect((await rows()).map((r) => r.flagged)).toEqual([false, true]);
  });

  it("does not flag different browsers on the same address", async () => {
    await submit("900000001");
    await submit("900000002");
    expect((await rows()).map((r) => r.flagged)).toEqual([false, false]);
  });

  it("stops a phone that keeps guessing", async () => {
    const deviceId = randomUUID();
    // One at a time: the limit depends on the order they arrive in.
    const codes: string[] = [];
    for (let i = 0; i < 10; i++) {
      codes.push((await submit(`90000077${i}`, { deviceId })).code);
    }
    expect(codes.slice(0, 8)).toEqual(Array(8).fill("NOT_FOUND"));
    expect(codes.slice(8)).toEqual(["RATE_LIMITED", "RATE_LIMITED"]);
    // Even the right ID is refused once the phone is limited.
    expect((await submit("900000001", { deviceId })).code).toBe("RATE_LIMITED");
  });

  it("logs every attempt with its result", async () => {
    const deviceId = randomUUID();
    await submit("900000777", { deviceId });
    await submit("900000001", { deviceId });
    await submit("900000001", { pass: "junk" });
    expect(
      (await db.select().from(checkinAttempts).all()).map((a) => [
        a.studentIdEntered,
        a.result,
        a.sessionId,
      ]),
    ).toEqual([
      ["900000777", "NOT_FOUND", sessionId],
      ["900000001", "OK", sessionId],
      ["900000001", "EXPIRED", null],
    ]);
  });
});

describe("check-in page HTML", () => {
  const session = {
    moduleName: `Web <b>"Design"</b>`,
    classCode: "TEST101",
    week: 5,
  };

  it("escapes sheet and user supplied text", async () => {
    expect(escapeHtml(`<a href="x">&'`)).toBe(
      "&lt;a href=&quot;x&quot;&gt;&amp;&#39;",
    );
    const form = renderForm({
      session,
      pass: "p",
      error: "bad",
      value: `"><script>alert(1)</script>`,
    });
    expect(form).not.toContain("alert(1)");
    expect(form).not.toContain("<b>");
    expect(form).toContain("Week 5 attendance");
  });

  it("is small and loads nothing external", async () => {
    const form = renderForm({ session, pass: "p".repeat(140) });
    expect(Buffer.byteLength(form)).toBeLessThan(6000);
    expect(form).not.toMatch(/src=|href=|url\(|@import/);
  });

  it("shows the fixed prefix and refills only the last four digits", async () => {
    const form = renderForm({ session, pass: "p", value: "905001234" });
    expect(form).toContain('<span class="pre" aria-hidden="true">90500</span>');
    expect(form).toContain('value="1234"');
    expect(idErrorMessage("NOT_FOUND", "1234")).toContain("90500 1234");
    expect(idErrorMessage("INVALID_ID", "12")).toContain("last 4 digits");
  });

  it("names the student on success", async () => {
    const page = renderResult("OK", session, "Student <One>");
    expect(page).toContain("You’re checked in");
    expect(page).toContain("Student &lt;One&gt;");
    expect(page).not.toContain("<script");
  });
});

describe("student ID prefix", () => {
  it("expands four digits and leaves everything else alone", async () => {
    expect(expandStudentId("5069")).toBe("905005069");
    expect(expandStudentId("905005069")).toBe("905005069");
    expect(expandStudentId("12")).toBe("12");
    expect(studentIdSuffix("905005069")).toBe("5069");
    expect(studentIdSuffix("900000001")).toBe("");
  });
});
