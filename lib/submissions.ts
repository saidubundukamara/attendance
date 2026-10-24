// Assignment submission rules. No HTTP here: the route handlers pass in what
// they read from the request and turn the returned code into a response.
// Drive is passed in so the rules can be tested without the network.
import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import {
  assignments,
  classes,
  enrollments,
  students,
  submissionFiles,
  submissions,
} from "@/lib/db/schema";
import type { DriveIo } from "@/lib/google/drive";
import { isRateLimited, recordHit } from "@/lib/ratelimit";
import { isValidStudentId, normalizeStudentId } from "@/lib/sheets/parse";
import { expandStudentId } from "@/lib/student-id";
import {
  ALLOWED_TYPES,
  type AllowedExtension,
  checkFiles,
  cleanFileName,
  fileExtension,
  type FileMeta,
} from "@/lib/submission-files";

export type SubmitCode =
  | "OK"
  | "NOT_FOUND"
  | "INVALID_ID"
  | "NO_ASSIGNMENT"
  | "CLOSED"
  | "ALREADY_SUBMITTED"
  | "BAD_FILE"
  | "EXPIRED"
  | "UPLOAD_FAILED"
  | "RATE_LIMITED";

// Time allowed between starting an upload and confirming it. Lateness is
// judged at the start, so this stops a start "reserving" an on-time slot.
export const UPLOAD_WINDOW_MS = 3 * 60 * 60 * 1000;

// A whole class usually shares one public IP on campus Wi-Fi, so this only
// stops scripted guessing, not a room of students submitting together.
const IP_LIMIT = 120;
const IP_WINDOW_MS = 60 * 1000;

export function classFolderName(cls: {
  code: string;
  moduleName: string | null;
}): string {
  return cls.moduleName ? `${cls.code} - ${cls.moduleName}` : cls.code;
}

// Folder the assignment's files go into, created on first use. Two students
// arriving together may both create one; the first to be saved is used.
export async function ensureAssignmentFolder(
  db: Db,
  drive: DriveIo,
  assignmentId: number,
): Promise<string> {
  const row = await db
    .select({
      title: assignments.title,
      folderId: assignments.driveFolderId,
      classId: classes.id,
      classFolderId: classes.driveFolderId,
      code: classes.code,
      moduleName: classes.moduleName,
    })
    .from(assignments)
    .innerJoin(classes, eq(classes.id, assignments.classId))
    .where(eq(assignments.id, assignmentId))
    .get();
  if (!row) throw new Error(`Assignment ${assignmentId} not found.`);
  if (row.folderId) return row.folderId;

  let classFolderId = row.classFolderId;
  if (!classFolderId) {
    const created = await drive.createFolder(
      classFolderName(row),
      drive.rootFolderId(),
    );
    await db
      .update(classes)
      .set({ driveFolderId: created })
      .where(and(eq(classes.id, row.classId), isNull(classes.driveFolderId)))
      .run();
    classFolderId =
      (
        await db
          .select({ id: classes.driveFolderId })
          .from(classes)
          .where(eq(classes.id, row.classId))
          .get()
      )?.id ?? created;
  }

  const created = await drive.createFolder(row.title, classFolderId);
  await db
    .update(assignments)
    .set({ driveFolderId: created })
    .where(
      and(eq(assignments.id, assignmentId), isNull(assignments.driveFolderId)),
    )
    .run();
  return (
    (
      await db
        .select({ id: assignments.driveFolderId })
        .from(assignments)
        .where(eq(assignments.id, assignmentId))
        .get()
    )?.id ?? created
  );
}

function limited(ip: string, now: number): boolean {
  const key = `submit:ip:${ip}`;
  if (isRateLimited(key, IP_LIMIT, IP_WINDOW_MS, now)) return true;
  recordHit(key, IP_WINDOW_MS, now);
  return false;
}

type EnrolledStudent = { id: number; studentId: string; name: string };

async function findEnrolledStudent(
  db: Db,
  classId: number,
  studentIdRaw: string | null,
): Promise<EnrolledStudent | "INVALID_ID" | "NOT_FOUND"> {
  // Students type only the last four digits; everything below uses the full ID.
  const enteredId = expandStudentId(
    normalizeStudentId(studentIdRaw ?? "").slice(0, 32),
  );
  if (!isValidStudentId(enteredId)) return "INVALID_ID";
  const student = await db
    .select({
      id: students.id,
      studentId: students.studentId,
      name: students.name,
    })
    .from(enrollments)
    .innerJoin(students, eq(students.id, enrollments.studentId))
    .where(
      and(
        eq(enrollments.classId, classId),
        eq(enrollments.active, true),
        eq(students.studentId, enteredId),
      ),
    )
    .get();
  return student ?? "NOT_FOUND";
}

export type StudentItem = {
  id: number;
  title: string;
  kind: "ASSIGNMENT" | "CLASSWORK" | "PROJECT";
  instructions: string | null;
  dueAt: number;
  open: boolean;
  submission: { late: boolean; submittedAt: number; files: string[] } | null;
};

export type LookupResult =
  | {
      code: "OK";
      student: { name: string; studentId: string };
      items: StudentItem[];
    }
  | { code: "NOT_FOUND" | "INVALID_ID" | "RATE_LIMITED" };

// The student's name and every item for the class with their status.
export async function lookupStudent(
  db: Db,
  input: { classId: number; studentIdRaw: string | null; ip: string },
  now: number = Date.now(),
): Promise<LookupResult> {
  if (limited(input.ip, now)) return { code: "RATE_LIMITED" };
  const student = await findEnrolledStudent(
    db,
    input.classId,
    input.studentIdRaw,
  );
  if (typeof student === "string") return { code: student };

  const items = await db
    .select({
      id: assignments.id,
      title: assignments.title,
      kind: assignments.kind,
      instructions: assignments.instructions,
      dueAt: assignments.dueAt,
      open: assignments.open,
    })
    .from(assignments)
    .where(eq(assignments.classId, input.classId))
    .orderBy(asc(assignments.dueAt), asc(assignments.id))
    .all();

  const done = items.length
    ? await db
        .select({
          submissionId: submissions.id,
          assignmentId: submissions.assignmentId,
          late: submissions.late,
          submittedAt: submissions.submittedAt,
        })
        .from(submissions)
        .where(
          and(
            eq(submissions.studentId, student.id),
            eq(submissions.status, "COMPLETE"),
            inArray(
              submissions.assignmentId,
              items.map((item) => item.id),
            ),
          ),
        )
        .all()
    : [];
  const files = done.length
    ? await db
        .select({
          submissionId: submissionFiles.submissionId,
          name: submissionFiles.originalName,
        })
        .from(submissionFiles)
        .where(
          inArray(
            submissionFiles.submissionId,
            done.map((d) => d.submissionId),
          ),
        )
        .orderBy(asc(submissionFiles.id))
        .all()
    : [];

  return {
    code: "OK",
    student: { name: student.name, studentId: student.studentId },
    items: items.map((item) => {
      const sub = done.find((d) => d.assignmentId === item.id);
      return {
        ...item,
        submission: sub
          ? {
              late: sub.late,
              submittedAt: sub.submittedAt ?? 0,
              files: files
                .filter((f) => f.submissionId === sub.submissionId)
                .map((f) => f.name),
            }
          : null,
      };
    }),
  };
}

export type StartInput = {
  classId: number;
  studentIdRaw: string | null;
  assignmentId: number;
  files: FileMeta[];
  origin: string;
  ip: string;
  userAgent: string;
};

export type StartResult =
  | {
      code: "OK";
      submissionId: number;
      token: string;
      late: boolean;
      uploads: { fileId: number; uploadUrl: string }[];
    }
  | { code: Exclude<SubmitCode, "OK">; message?: string };

export async function startSubmission(
  db: Db,
  drive: DriveIo,
  input: StartInput,
  now: number = Date.now(),
): Promise<StartResult> {
  if (limited(input.ip, now)) return { code: "RATE_LIMITED" };

  const student = await findEnrolledStudent(
    db,
    input.classId,
    input.studentIdRaw,
  );
  if (typeof student === "string") return { code: student };

  const assignment = await db
    .select()
    .from(assignments)
    .where(
      and(
        eq(assignments.id, input.assignmentId),
        eq(assignments.classId, input.classId),
      ),
    )
    .get();
  if (!assignment) return { code: "NO_ASSIGNMENT" };
  if (!assignment.open) return { code: "CLOSED" };

  const existing = await db
    .select({ status: submissions.status })
    .from(submissions)
    .where(
      and(
        eq(submissions.assignmentId, assignment.id),
        eq(submissions.studentId, student.id),
      ),
    )
    .get();
  if (existing?.status === "COMPLETE") return { code: "ALREADY_SUBMITTED" };

  const problem = checkFiles(input.files);
  if (problem) return { code: "BAD_FILE", message: problem };

  const planned = input.files.map((file) => {
    const originalName = cleanFileName(file.name);
    const ext = fileExtension(originalName) as AllowedExtension;
    return {
      originalName,
      driveName: `${student.studentId} - ${student.name} - ${originalName}`,
      mime: ALLOWED_TYPES[ext],
      size: file.size,
    };
  });

  let uploadUrls: string[];
  try {
    const folderId = await ensureAssignmentFolder(db, drive, assignment.id);
    uploadUrls = await Promise.all(
      planned.map((file) =>
        drive.createUploadSession({
          name: file.driveName,
          mime: file.mime,
          size: file.size,
          parentId: folderId,
          origin: input.origin,
        }),
      ),
    );
  } catch (error) {
    console.error("Could not start Drive upload", error);
    return { code: "UPLOAD_FAILED" };
  }

  const token = randomUUID();
  const late = now > assignment.dueAt;
  const userAgent = input.userAgent.slice(0, 300);

  const saved = await db.transaction(async (tx) => {
    // A PENDING row from an earlier, unfinished try is taken over; a
    // COMPLETE one is left alone and nothing comes back.
    const row = await tx
      .insert(submissions)
      .values({
        assignmentId: assignment.id,
        studentId: student.id,
        status: "PENDING",
        uploadToken: token,
        startedAt: now,
        late,
        ip: input.ip,
        userAgent,
      })
      .onConflictDoUpdate({
        target: [submissions.assignmentId, submissions.studentId],
        set: { uploadToken: token, startedAt: now, late, ip: input.ip, userAgent },
        setWhere: eq(submissions.status, "PENDING"),
      })
      .returning({ id: submissions.id })
      .get();
    if (!row) return null;
    await tx
      .delete(submissionFiles)
      .where(eq(submissionFiles.submissionId, row.id))
      .run();
    const fileRows = await tx
      .insert(submissionFiles)
      .values(planned.map((file) => ({ submissionId: row.id, ...file })))
      .returning({ id: submissionFiles.id })
      .all();
    return { submissionId: row.id, fileIds: fileRows.map((f) => f.id) };
  });
  if (!saved) return { code: "ALREADY_SUBMITTED" };

  return {
    code: "OK",
    submissionId: saved.submissionId,
    token,
    late,
    uploads: saved.fileIds.map((fileId, i) => ({
      fileId,
      uploadUrl: uploadUrls[i],
    })),
  };
}

export type CompleteInput = {
  submissionId: number;
  token: string;
  uploads: { fileId: number; driveFileId: string }[];
  ip: string;
};

export type CompleteResult =
  | {
      code: "OK";
      classId: number;
      late: boolean;
      submittedAt: number;
      files: string[];
    }
  | { code: Exclude<SubmitCode, "OK">; message?: string };

export async function completeSubmission(
  db: Db,
  drive: DriveIo,
  input: CompleteInput,
  now: number = Date.now(),
): Promise<CompleteResult> {
  if (limited(input.ip, now)) return { code: "RATE_LIMITED" };

  const sub = await db
    .select({
      id: submissions.id,
      status: submissions.status,
      token: submissions.uploadToken,
      startedAt: submissions.startedAt,
      late: submissions.late,
      submittedAt: submissions.submittedAt,
      assignmentId: submissions.assignmentId,
      classId: assignments.classId,
      folderId: assignments.driveFolderId,
    })
    .from(submissions)
    .innerJoin(assignments, eq(assignments.id, submissions.assignmentId))
    .where(eq(submissions.id, input.submissionId))
    .get();
  if (!sub || sub.token !== input.token) return { code: "EXPIRED" };

  const files = await db
    .select()
    .from(submissionFiles)
    .where(eq(submissionFiles.submissionId, sub.id))
    .orderBy(asc(submissionFiles.id))
    .all();
  const names = files.map((f) => f.originalName);

  // A repeated request after success (e.g. a retry on a flaky connection).
  if (sub.status === "COMPLETE") {
    return {
      code: "OK",
      classId: sub.classId,
      late: sub.late,
      submittedAt: sub.submittedAt ?? now,
      files: names,
    };
  }
  if (now - sub.startedAt > UPLOAD_WINDOW_MS) return { code: "EXPIRED" };

  const given = new Map(input.uploads.map((u) => [u.fileId, u.driveFileId]));
  const driveIds = files.map((f) => given.get(f.id));
  if (
    driveIds.some((id) => !id) ||
    new Set(driveIds).size !== files.length ||
    !sub.folderId
  ) {
    return { code: "UPLOAD_FAILED", message: "Some files did not finish uploading." };
  }

  try {
    const found = await Promise.all(
      driveIds.map((id) => drive.getFile(id as string)),
    );
    for (const [i, file] of files.entries()) {
      const remote = found[i];
      if (
        !remote ||
        !remote.parents.includes(sub.folderId) ||
        remote.name !== file.driveName ||
        remote.size !== file.size
      ) {
        return {
          code: "UPLOAD_FAILED",
          message: `"${file.originalName}" did not reach Google Drive.`,
        };
      }
    }
  } catch (error) {
    console.error("Could not check Drive upload", error);
    return { code: "UPLOAD_FAILED" };
  }

  const completed = await db.transaction(async (tx) => {
    const result = await tx
      .update(submissions)
      .set({ status: "COMPLETE", submittedAt: now })
      .where(
        and(
          eq(submissions.id, sub.id),
          eq(submissions.status, "PENDING"),
          eq(submissions.uploadToken, input.token),
        ),
      )
      .run();
    if (result.rowsAffected === 0) return false;
    for (const [i, file] of files.entries()) {
      await tx
        .update(submissionFiles)
        .set({ driveFileId: driveIds[i] })
        .where(eq(submissionFiles.id, file.id))
        .run();
    }
    return true;
  });
  if (!completed) {
    // Another request finished it first, or a newer start took it over.
    const latest = await db
      .select({ status: submissions.status, token: submissions.uploadToken })
      .from(submissions)
      .where(eq(submissions.id, sub.id))
      .get();
    if (latest?.status !== "COMPLETE" || latest.token !== input.token) {
      return { code: "EXPIRED" };
    }
  }

  return {
    code: "OK",
    classId: sub.classId,
    late: sub.late,
    submittedAt: now,
    files: names,
  };
}

// Lateness follows the deadline: moving it re-judges every submission
// against when its upload started.
export async function rejudgeLateness(
  db: Db,
  assignmentId: number,
  dueAt: number,
): Promise<void> {
  await db
    .update(submissions)
    .set({ late: sql`${submissions.startedAt} > ${dueAt}` })
    .where(eq(submissions.assignmentId, assignmentId))
    .run();
}
