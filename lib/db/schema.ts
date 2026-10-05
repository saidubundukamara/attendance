import { sql } from "drizzle-orm";
import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

// Timestamps are Unix milliseconds. Booleans are 0/1.

export const classes = sqliteTable("classes", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  // From the sheet tab name, e.g. "BSEM1201".
  code: text("code").notNull().unique(),
  // Full tab title, e.g. "Attn of BSEM1201".
  sheetTab: text("sheet_tab").notNull().unique(),
  moduleName: text("module_name"),
  moduleCode: text("module_code"),
  // ISO date (YYYY-MM-DD); null until the lecturer sets it.
  startDate: text("start_date"),
  totalWeeks: integer("total_weeks").notNull().default(15),
  lastSyncedAt: integer("last_synced_at"),
});

export const students = sqliteTable("students", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  // The ID printed in the sheet, always compared as a string.
  studentId: text("student_id").notNull().unique(),
  name: text("name").notNull(),
});

export const enrollments = sqliteTable(
  "enrollments",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    classId: integer("class_id")
      .notNull()
      .references(() => classes.id),
    studentId: integer("student_id")
      .notNull()
      .references(() => students.id),
    // False once the ID disappears from the sheet; history is kept.
    active: integer("active", { mode: "boolean" }).notNull().default(true),
  },
  (t) => [
    uniqueIndex("enrollments_class_student_uq").on(t.classId, t.studentId),
  ],
);

export const sessions = sqliteTable(
  "sessions",
  {
    // Random UUID; appears inside signed tokens.
    id: text("id").primaryKey(),
    classId: integer("class_id")
      .notNull()
      .references(() => classes.id),
    week: integer("week").notNull(),
    status: text("status", { enum: ["ACTIVE", "CLOSED"] }).notNull(),
    startedAt: integer("started_at").notNull(),
    endedAt: integer("ended_at"),
  },
  (t) => [
    uniqueIndex("sessions_class_week_uq").on(t.classId, t.week),
    // One active session per class.
    uniqueIndex("sessions_one_active_per_class_uq")
      .on(t.classId)
      .where(sql`${t.status} = 'ACTIVE'`),
  ],
);

export const attendance = sqliteTable(
  "attendance",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.id),
    studentId: integer("student_id")
      .notNull()
      .references(() => students.id),
    status: text("status", { enum: ["PRESENT", "ABSENT"] }).notNull(),
    source: text("source", { enum: ["QR", "MANUAL"] }).notNull(),
    checkInAt: integer("check_in_at"),
    deviceId: text("device_id"),
    ip: text("ip"),
    userAgent: text("user_agent"),
    nonce: text("nonce"),
    flagged: integer("flagged", { mode: "boolean" }).notNull().default(false),
  },
  (t) => [
    uniqueIndex("attendance_session_student_uq").on(t.sessionId, t.studentId),
    // Device rule: one QR check-in per phone per session.
    uniqueIndex("attendance_session_device_uq")
      .on(t.sessionId, t.deviceId)
      .where(sql`${t.source} = 'QR'`),
  ],
);

export const checkinAttempts = sqliteTable(
  "checkin_attempts",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    // Not a foreign key: attempts are logged even when the session is unknown.
    sessionId: text("session_id"),
    studentIdEntered: text("student_id_entered"),
    deviceId: text("device_id"),
    ip: text("ip"),
    userAgent: text("user_agent"),
    nonce: text("nonce"),
    result: text("result").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [index("checkin_attempts_session_idx").on(t.sessionId)],
);

export const manualChanges = sqliteTable("manual_changes", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  sessionId: text("session_id")
    .notNull()
    .references(() => sessions.id),
  studentId: integer("student_id")
    .notNull()
    .references(() => students.id),
  previousStatus: text("previous_status", { enum: ["PRESENT", "ABSENT"] }),
  newStatus: text("new_status", { enum: ["PRESENT", "ABSENT"] }).notNull(),
  reason: text("reason"),
  createdAt: integer("created_at").notNull(),
});

// Outbox of cell writes waiting to reach the Google Sheet.
export const syncJobs = sqliteTable(
  "sync_jobs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    classId: integer("class_id")
      .notNull()
      .references(() => classes.id),
    // The sheet's student ID string, so the row can be found at write time.
    studentId: text("student_id").notNull(),
    week: integer("week").notNull(),
    value: integer("value").notNull(),
    status: text("status", { enum: ["PENDING", "DONE", "FAILED"] })
      .notNull()
      .default("PENDING"),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    createdAt: integer("created_at").notNull(),
    doneAt: integer("done_at"),
  },
  (t) => [index("sync_jobs_status_idx").on(t.status, t.classId)],
);
