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

beforeAll(() => {
  process.env.QR_SECRET = "test-qr-secret";
});

beforeEach(() => {
  db = createTestDb();
  const [classA, classB] = ["TEST101", "TEST202"].map(
    (code) =>
      db
        .insert(classes)
        .values({ code, sheetTab: `Attn of ${code}`, totalWeeks: 15 })
        .returning()
        .get().id,
  );
  const enroll = (classId: number, studentId: string, active = true) => {
    const id = db
      .insert(students)
      .values({ studentId, name: `Student ${studentId.slice(-1)}` })
      .returning()
      .get().id;
    db.insert(enrollments).values({ classId, studentId: id, active }).run();
  };
  enroll(classA, "900000001");
  enroll(classA, "900000002");
  enroll(classA, "900000003", false);
  enroll(classB, "900000009");

  const open = (classId: number) => {
    const result = openSession(db, classId, 5, NOW);
    if (!result.ok) throw new Error(result.reason);
    return result.sessionId;
  };
  sessionId = open(classA);
  otherSessionId = open(classB);
});

function submit(
  studentIdRaw: string,
  overrides: Partial<CheckInInput> & { session?: string; at?: number } = {},
) {
  const deviceId = overrides.deviceId ?? randomUUID();
  const { session, at, ...rest } = overrides;
  return checkIn(
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

const rows = () => db.select().from(attendance).all();

describe("checkIn", () => {
  it("records a valid check-in and queues the sheet write", () => {
    const deviceId = randomUUID();
    const result = submit(" 900000001 ", { deviceId });
    expect(result).toEqual({ code: "OK", sessionId, studentName: "Student 1" });
    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toMatchObject({
      sessionId,
      status: "PRESENT",
      source: "QR",
      checkInAt: NOW + 1000,
      deviceId,
      ip: "203.0.113.5",
      nonce: "nonce1",
      flagged: false,
    });
    expect(db.select().from(syncJobs).all()).toMatchObject([
      { studentId: "900000001", week: 5, value: 1, status: "PENDING" },
    ]);
  });

  it("answers ALREADY for a repeat, from the same or another phone", () => {
    const deviceId = randomUUID();
    submit("900000001", { deviceId });
    expect(submit("900000001", { deviceId }).code).toBe("ALREADY");
    expect(submit("900000001").code).toBe("ALREADY");
    expect(rows()).toHaveLength(1);
    expect(db.select().from(syncJobs).all()).toHaveLength(1);
  });

  it("blocks a second student from the same phone", () => {
    const deviceId = randomUUID();
    submit("900000001", { deviceId });
    expect(submit("900000002", { deviceId }).code).toBe("DEVICE_USED");
    expect(rows()).toHaveLength(1);
  });

  it("lets the same phone check in to a different class's session", () => {
    const deviceId = randomUUID();
    submit("900000001", { deviceId });
    expect(submit("900000009", { deviceId, session: otherSessionId }).code).toBe("OK");
  });

  it("rejects IDs that are unknown, from another class, or inactive", () => {
    expect(submit("900000777").code).toBe("NOT_FOUND");
    expect(submit("900000009").code).toBe("NOT_FOUND");
    expect(submit("900000003").code).toBe("NOT_FOUND");
    expect(rows()).toHaveLength(0);
  });

  it("accepts the last four digits in place of the full ID", () => {
    const classId = db
      .select()
      .from(classes)
      .where(eq(classes.code, "TEST101"))
      .get()!.id;
    const id = db
      .insert(students)
      .values({ studentId: "905005069", name: "Student 9" })
      .returning()
      .get().id;
    db.insert(enrollments).values({ classId, studentId: id }).run();

    expect(submit("5069").code).toBe("OK");
    expect(rows()).toHaveLength(1);
    // The attempt is logged against the full ID.
    expect(
      db.select().from(checkinAttempts).all().map((a) => a.studentIdEntered),
    ).toEqual(["905005069"]);
    expect(submit("905005069").code).toBe("ALREADY");
    expect(submit("0001").code).toBe("NOT_FOUND");
  });

  it("rejects malformed IDs", () => {
    for (const bad of ["", "abc", "12", "9000000011111111", "1 OR 1=1"]) {
      expect(submit(bad).code).toBe("INVALID_ID");
    }
  });

  it("rejects a closed session", () => {
    closeSession(db, sessionId);
    expect(submit("900000001").code).toBe("CLOSED");
    // Closing marked both enrolled students absent; the scan changed nothing.
    expect(rows().map((r) => r.status)).toEqual(["ABSENT", "ABSENT"]);
  });

  it("rejects an expired pass", () => {
    const at = NOW + PASS_TTL_SECONDS * 1000;
    expect(submit("900000001", { at }).code).toBe("EXPIRED");
  });

  it("rejects a pass used from a different phone, or with no device cookie", () => {
    const pass = signPass({ sessionId, nonce: "n", deviceId: randomUUID() }, NOW);
    expect(submit("900000001", { pass, deviceId: randomUUID() }).code).toBe("EXPIRED");
    expect(submit("900000001", { pass, deviceId: null }).code).toBe("EXPIRED");
  });

  it("rejects a missing or forged pass, and a QR token used as a pass", () => {
    const deviceId = randomUUID();
    const good = signPass({ sessionId, nonce: "n", deviceId }, NOW);
    const forged = good.replace(sessionId, otherSessionId);
    const qr = signQrToken(sessionId, NOW).token;
    for (const pass of [null, "", "junk", forged, qr]) {
      expect(submit("900000001", { pass, deviceId }).code).toBe("EXPIRED");
    }
    expect(rows()).toHaveLength(0);
  });

  it("rejects a pass for a session that does not exist", () => {
    expect(submit("900000001", { session: randomUUID() }).code).toBe("EXPIRED");
  });

  it("turns an absent mark into present when the student checks in", () => {
    const student = db.select().from(students).where(eq(students.studentId, "900000001")).get();
    db.insert(attendance)
      .values({ sessionId, studentId: student!.id, status: "ABSENT", source: "MANUAL" })
      .run();
    expect(submit("900000001").code).toBe("OK");
    expect(rows()).toMatchObject([{ status: "PRESENT", source: "QR" }]);
  });

  it("flags a second check-in from the same address and browser", () => {
    submit("900000001", { userAgent: "SamePhone" });
    submit("900000002", { userAgent: "SamePhone" });
    expect(rows().map((r) => r.flagged)).toEqual([false, true]);
  });

  it("does not flag different browsers on the same address", () => {
    submit("900000001");
    submit("900000002");
    expect(rows().map((r) => r.flagged)).toEqual([false, false]);
  });

  it("stops a phone that keeps guessing", () => {
    const deviceId = randomUUID();
    const codes = Array.from({ length: 10 }, (_, i) =>
      submit(`90000077${i}`, { deviceId }).code,
    );
    expect(codes.slice(0, 8)).toEqual(Array(8).fill("NOT_FOUND"));
    expect(codes.slice(8)).toEqual(["RATE_LIMITED", "RATE_LIMITED"]);
    // Even the right ID is refused once the phone is limited.
    expect(submit("900000001", { deviceId }).code).toBe("RATE_LIMITED");
  });

  it("logs every attempt with its result", () => {
    const deviceId = randomUUID();
    submit("900000777", { deviceId });
    submit("900000001", { deviceId });
    submit("900000001", { pass: "junk" });
    expect(
      db.select().from(checkinAttempts).all().map((a) => [a.studentIdEntered, a.result, a.sessionId]),
    ).toEqual([
      ["900000777", "NOT_FOUND", sessionId],
      ["900000001", "OK", sessionId],
      ["900000001", "EXPIRED", null],
    ]);
  });
});

describe("check-in page HTML", () => {
  const session = { moduleName: `Web <b>"Design"</b>`, classCode: "TEST101", week: 5 };

  it("escapes sheet and user supplied text", () => {
    expect(escapeHtml(`<a href="x">&'`)).toBe("&lt;a href=&quot;x&quot;&gt;&amp;&#39;");
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

  it("is small and loads nothing external", () => {
    const form = renderForm({ session, pass: "p".repeat(140) });
    expect(Buffer.byteLength(form)).toBeLessThan(6000);
    expect(form).not.toMatch(/src=|href=|url\(|@import/);
  });

  it("shows the fixed prefix and refills only the last four digits", () => {
    const form = renderForm({ session, pass: "p", value: "905001234" });
    expect(form).toContain('<span class="pre" aria-hidden="true">90500</span>');
    expect(form).toContain('value="1234"');
    expect(idErrorMessage("NOT_FOUND", "1234")).toContain("90500 1234");
    expect(idErrorMessage("INVALID_ID", "12")).toContain("last 4 digits");
  });

  it("names the student on success", () => {
    const page = renderResult("OK", session, "Student <One>");
    expect(page).toContain("You’re checked in");
    expect(page).toContain("Student &lt;One&gt;");
    expect(page).not.toContain("<script");
  });
});

describe("student ID prefix", () => {
  it("expands four digits and leaves everything else alone", () => {
    expect(expandStudentId("5069")).toBe("905005069");
    expect(expandStudentId("905005069")).toBe("905005069");
    expect(expandStudentId("12")).toBe("12");
    expect(studentIdSuffix("905005069")).toBe("5069");
    expect(studentIdSuffix("900000001")).toBe("");
  });
});
