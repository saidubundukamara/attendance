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
  // Drive folder holding this class's assignment folders; created on first use.
  driveFolderId: text("drive_folder_id"),
  // Last failure writing the "Subs of <CODE>" tab; null once it succeeds.
  submissionsSheetError: text("submissions_sheet_error"),
  // Leases (Unix ms) held by whichever run is writing this class's attendance
  // or submissions tab, so overlapping runs can't write stale values. Null
  // or past means free; a run that dies frees it by running out.
  sheetSyncUntil: integer("sheet_sync_until"),
  submissionsSyncUntil: integer("submissions_sync_until"),
  // Bumped by every request to rewrite the submissions tab, so the run
  // holding the lease knows to go again.
  submissionsSyncRequested: integer("submissions_sync_requested")
    .notNull()
    .default(0),
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

// Something students hand in: an assignment, a piece of classwork or a project.
export const assignments = sqliteTable(
  "assignments",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    classId: integer("class_id")
      .notNull()
      .references(() => classes.id),
    // Also the column header in the class's submissions tab.
    title: text("title").notNull(),
    kind: text("kind", { enum: ["ASSIGNMENT", "CLASSWORK", "PROJECT"] })
      .notNull()
      .default("ASSIGNMENT"),
    instructions: text("instructions"),
    dueAt: integer("due_at").notNull(),
    // Closed items accept no new submissions, late or not.
    open: integer("open", { mode: "boolean" }).notNull().default(true),
    // Created on first use; files land in <root>/<class>/<title>/.
    driveFolderId: text("drive_folder_id"),
    // Group work: one student submits for up to `maxGroupSize` people,
    // themselves included.
    groupWork: integer("group_work", { mode: "boolean" })
      .notNull()
      .default(false),
    maxGroupSize: integer("max_group_size"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [uniqueIndex("assignments_class_title_uq").on(t.classId, t.title)],
);

// One per student per assignment. PENDING while the files are uploading
// straight to Drive; COMPLETE once they have all been checked, after which
// the student cannot submit again.
export const submissions = sqliteTable(
  "submissions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    assignmentId: integer("assignment_id")
      .notNull()
      .references(() => assignments.id),
    studentId: integer("student_id")
      .notNull()
      .references(() => students.id),
    status: text("status", { enum: ["PENDING", "COMPLETE"] }).notNull(),
    // Random secret handed to the browser that started the upload; only it
    // can complete the submission.
    uploadToken: text("upload_token").notNull(),
    // Lateness is judged by when the upload started, so a slow connection
    // near the deadline is not penalised.
    startedAt: integer("started_at").notNull(),
    late: integer("late", { mode: "boolean" }).notNull().default(false),
    submittedAt: integer("submitted_at"),
    ip: text("ip"),
    userAgent: text("user_agent"),
  },
  (t) => [
    uniqueIndex("submissions_assignment_student_uq").on(
      t.assignmentId,
      t.studentId,
    ),
  ],
);

export const submissionFiles = sqliteTable(
  "submission_files",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    submissionId: integer("submission_id")
      .notNull()
      .references(() => submissions.id),
    // The name the student's file had, and the name it was given in Drive.
    originalName: text("original_name").notNull(),
    driveName: text("drive_name").notNull(),
    mime: text("mime").notNull(),
    size: integer("size").notNull(),
    // Null until the upload is confirmed.
    driveFileId: text("drive_file_id"),
  },
  (t) => [index("submission_files_submission_idx").on(t.submissionId)],
);

// Everyone a submission covers: the student who submitted, plus their group
// mates on group work. "Has this student handed in?" is answered here, joined
// to a COMPLETE submission. Rows of an unfinished (PENDING) submission are
// kept too and simply don't count until it completes.
export const submissionMembers = sqliteTable(
  "submission_members",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    submissionId: integer("submission_id")
      .notNull()
      .references(() => submissions.id),
    assignmentId: integer("assignment_id")
      .notNull()
      .references(() => assignments.id),
    studentId: integer("student_id")
      .notNull()
      .references(() => students.id),
  },
  (t) => [
    index("submission_members_assignment_student_idx").on(
      t.assignmentId,
      t.studentId,
    ),
    index("submission_members_submission_idx").on(t.submissionId),
  ],
);
