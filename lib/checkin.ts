// Student check-in rules. No HTTP here: the route handler passes in what it
// read from the request and renders whatever code comes back.
import { and, eq, ne } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import {
  attendance,
  checkinAttempts,
  classes,
  enrollments,
  sessions,
  students,
  syncJobs,
} from "@/lib/db/schema";
import { isRateLimited, recordHit } from "@/lib/ratelimit";
import { isValidStudentId, normalizeStudentId } from "@/lib/sheets/parse";
import { expandStudentId } from "@/lib/student-id";
import { verifyPass } from "@/lib/token";

export type CheckInCode =
  | "OK"
  | "ALREADY"
  | "NOT_FOUND"
  | "INVALID_ID"
  | "DEVICE_USED"
  | "EXPIRED"
  | "CLOSED"
  | "RATE_LIMITED";

export type CheckInInput = {
  pass: string | null;
  studentIdRaw: string | null;
  deviceId: string | null;
  ip: string;
  userAgent: string;
};

export type CheckInResult = {
  code: CheckInCode;
  sessionId: string | null;
  studentName: string | null;
};

// Submissions allowed from one phone in one session, including mistypes.
const DEVICE_LIMIT = 8;
const DEVICE_WINDOW_MS = 60 * 60 * 1000;
// A whole class usually shares one public IP on campus Wi-Fi, so this only
// stops scripted guessing, not a room of students checking in together.
const IP_LIMIT = 120;
const IP_WINDOW_MS = 60 * 1000;

const DEVICE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function isDeviceId(value: string | null | undefined): value is string {
  return typeof value === "string" && DEVICE_ID.test(value);
}

export function getCheckInSession(db: Db, sessionId: string) {
  return db
    .select({
      id: sessions.id,
      status: sessions.status,
      week: sessions.week,
      classId: classes.id,
      classCode: classes.code,
      moduleName: classes.moduleName,
    })
    .from(sessions)
    .innerJoin(classes, eq(classes.id, sessions.classId))
    .where(eq(sessions.id, sessionId))
    .get();
}

// The student this phone already checked in for the session, if any.
export function getDeviceCheckIn(db: Db, sessionId: string, deviceId: string) {
  return db
    .select({ name: students.name, studentId: students.studentId })
    .from(attendance)
    .innerJoin(students, eq(students.id, attendance.studentId))
    .where(
      and(
        eq(attendance.sessionId, sessionId),
        eq(attendance.deviceId, deviceId),
        eq(attendance.source, "QR"),
      ),
    )
    .get();
}

function isUniqueViolation(error: unknown): string | null {
  const parts: string[] = [];
  for (let e = error as { message?: string; cause?: unknown } | undefined; e; ) {
    if (e.message) parts.push(e.message);
    e = e.cause as typeof e;
  }
  const text = parts.join(" ");
  return text.includes("UNIQUE constraint failed") ? text : null;
}

export function checkIn(
  db: Db,
  input: CheckInInput,
  now: number = Date.now(),
): CheckInResult {
  const userAgent = input.userAgent.slice(0, 300);
  // Students type only the last four digits; everything below uses the full ID.
  const enteredId = expandStudentId(
    normalizeStudentId(input.studentIdRaw ?? "").slice(0, 32),
  );
  let sessionId: string | null = null;
  let nonce: string | null = null;
  let studentName: string | null = null;

  const code = ((): CheckInCode => {
    // 1. Pass: signed by us, not expired, issued to this phone.
    const pass = verifyPass(input.pass, now);
    if (!pass.ok || !isDeviceId(input.deviceId)) return "EXPIRED";
    if (pass.payload.deviceId !== input.deviceId) return "EXPIRED";
    const deviceId = input.deviceId;
    sessionId = pass.payload.sessionId;
    nonce = pass.payload.nonce;

    // 2. Session: class and week come from here, never from the form.
    const session = getCheckInSession(db, pass.payload.sessionId);
    if (!session) return "EXPIRED";
    if (session.status !== "ACTIVE") return "CLOSED";

    // 3. Rate limits.
    const deviceKey = `checkin:device:${session.id}:${deviceId}`;
    const ipKey = `checkin:ip:${input.ip}`;
    if (
      isRateLimited(deviceKey, DEVICE_LIMIT, DEVICE_WINDOW_MS, now) ||
      isRateLimited(ipKey, IP_LIMIT, IP_WINDOW_MS, now)
    ) {
      return "RATE_LIMITED";
    }
    recordHit(deviceKey, DEVICE_WINDOW_MS, now);
    recordHit(ipKey, IP_WINDOW_MS, now);

    // 4. Shape of the ID.
    if (!isValidStudentId(enteredId)) return "INVALID_ID";

    // 5. Enrolled in this session's class, per the sheet.
    const student = db
      .select({ id: students.id, name: students.name })
      .from(enrollments)
      .innerJoin(students, eq(students.id, enrollments.studentId))
      .where(
        and(
          eq(enrollments.classId, session.classId),
          eq(enrollments.active, true),
          eq(students.studentId, enteredId),
        ),
      )
      .get();
    if (!student) return "NOT_FOUND";
    studentName = student.name;

    try {
      return db.transaction((tx): CheckInCode => {
        // 6. Already present?
        const existing = tx
          .select({ id: attendance.id, status: attendance.status })
          .from(attendance)
          .where(
            and(
              eq(attendance.sessionId, session.id),
              eq(attendance.studentId, student.id),
            ),
          )
          .get();
        if (existing?.status === "PRESENT") return "ALREADY";

        // 7. One student per phone per session.
        const deviceRow = tx
          .select({ id: attendance.id })
          .from(attendance)
          .where(
            and(
              eq(attendance.sessionId, session.id),
              eq(attendance.deviceId, deviceId),
              eq(attendance.source, "QR"),
            ),
          )
          .get();
        if (deviceRow) return "DEVICE_USED";

        // Same network address and browser under a different device ID
        // suggests the cookie was cleared between check-ins. Flag, don't block.
        const lookalike =
          input.ip === "unknown"
            ? undefined
            : tx
                .select({ id: attendance.id })
                .from(attendance)
                .where(
                  and(
                    eq(attendance.sessionId, session.id),
                    eq(attendance.source, "QR"),
                    eq(attendance.ip, input.ip),
                    eq(attendance.userAgent, userAgent),
                    ne(attendance.deviceId, deviceId),
                  ),
                )
                .get();

        // 8. Record it.
        const row = {
          status: "PRESENT" as const,
          source: "QR" as const,
          checkInAt: now,
          deviceId,
          ip: input.ip,
          userAgent,
          nonce: pass.payload.nonce,
          flagged: Boolean(lookalike),
        };
        if (existing) {
          // Marked absent earlier (e.g. the session was ended, then reopened).
          tx.update(attendance).set(row).where(eq(attendance.id, existing.id)).run();
        } else {
          tx.insert(attendance)
            .values({ sessionId: session.id, studentId: student.id, ...row })
            .run();
        }
        // Queued in the same transaction so a recorded check-in always has
        // a matching sheet write.
        tx.insert(syncJobs)
          .values({
            classId: session.classId,
            studentId: enteredId,
            week: session.week,
            value: 1,
            createdAt: now,
          })
          .run();
        return "OK";
      });
    } catch (error) {
      // Two submissions raced; the unique indexes decided.
      const violation = isUniqueViolation(error);
      if (!violation) throw error;
      return violation.includes("device_id") ? "DEVICE_USED" : "ALREADY";
    }
  })();

  db.insert(checkinAttempts)
    .values({
      sessionId,
      studentIdEntered: enteredId || null,
      deviceId: isDeviceId(input.deviceId) ? input.deviceId : null,
      ip: input.ip,
      userAgent,
      nonce,
      result: code,
      createdAt: now,
    })
    .run();

  return { code, sessionId, studentName };
}
