import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/lib/db/client";
import {
  assignments,
  classes,
  enrollments,
  students,
  submissions,
} from "@/lib/db/schema";
import type { DriveFile, DriveIo } from "@/lib/google/drive";
import { clearHits } from "@/lib/ratelimit";
import { checkFiles, cleanFileName } from "@/lib/submission-files";
import {
  completeSubmission,
  lookupStudent,
  rejudgeLateness,
  startSubmission,
  UPLOAD_WINDOW_MS,
} from "@/lib/submissions";
import { createTestDb } from "./helpers/db";

const NOW = 1_800_000_000_000;
const DAY = 86_400_000;
const PDF = { name: "essay.pdf", size: 1000, type: "application/pdf" };

let db: Db;
let classId: number;
let otherClassId: number;
let assignmentId: number;
let ipCounter = 0;
let ip: string;

// Records what would be sent to Drive; "uploads" a file when asked.
function fakeDrive() {
  let next = 0;
  const files = new Map<string, DriveFile>();
  const sessions = new Map<string, { name: string; parentId: string; size: number }>();
  const io: DriveIo = {
    rootFolderId: () => "root",
    createFolder: async (name) => `folder-${++next}-${name}`,
    renameFolder: async () => {},
    createUploadSession: async ({ name, parentId, size }) => {
      const url = `https://upload.test/${++next}`;
      sessions.set(url, { name, parentId, size });
      return url;
    },
    getFile: async (id) => files.get(id) ?? null,
  };
  // What the browser's PUT would do.
  const upload = (url: string, size?: number) => {
    const s = sessions.get(url);
    if (!s) throw new Error("unknown session");
    const id = `file-${++next}`;
    files.set(id, {
      id,
      name: s.name,
      size: size ?? s.size,
      parents: [s.parentId],
    });
    return id;
  };
  return { io, upload, files };
}

let drive: ReturnType<typeof fakeDrive>;

beforeEach(async () => {
  db = await createTestDb();
  // A fresh IP per test keeps the in-memory rate limiter out of the way.
  ip = `10.0.0.${++ipCounter}`;
  clearHits(`submit:ip:${ip}`);
  drive = fakeDrive();
  classId = (
    await db
      .insert(classes)
      .values({ code: "TEST101", sheetTab: "Attn of TEST101" })
      .returning()
      .get()
  ).id;
  otherClassId = (
    await db
      .insert(classes)
      .values({ code: "OTHER1", sheetTab: "Attn of OTHER1" })
      .returning()
      .get()
  ).id;
  const add = async (studentId: string, name: string, cls: number, active = true) => {
    const id = (
      await db.insert(students).values({ studentId, name }).returning().get()
    ).id;
    await db.insert(enrollments).values({ classId: cls, studentId: id, active }).run();
  };
  await add("905001111", "Ada Lovelace", classId);
  await add("905002222", "Left Student", classId, false);
  await add("905003333", "Other Class", otherClassId);
  assignmentId = (
    await db
      .insert(assignments)
      .values({ classId, title: "Assignment 1", dueAt: NOW + DAY, createdAt: NOW })
      .returning()
      .get()
  ).id;
});

function start(overrides: Partial<Parameters<typeof startSubmission>[2]> = {}, now = NOW) {
  return startSubmission(
    db,
    drive.io,
    {
      classId,
      studentIdRaw: "1111",
      assignmentId,
      files: [PDF],
      origin: "https://app.test",
      ip,
      userAgent: "test",
      ...overrides,
    },
    now,
  );
}

async function submitOk(now = NOW) {
  const started = await start({}, now);
  if (started.code !== "OK") throw new Error(started.code);
  const uploads = started.uploads.map((u) => ({
    fileId: u.fileId,
    driveFileId: drive.upload(u.uploadUrl),
  }));
  return completeSubmission(
    db,
    drive.io,
    { submissionId: started.submissionId, token: started.token, uploads, ip },
    now + 1000,
  );
}

describe("file rules", () => {
  it("accepts pdf, docx and zip, including types browsers leave blank", () => {
    expect(
      checkFiles([
        PDF,
        { name: "report.DOCX", size: 10, type: "" },
        { name: "code.zip", size: 10, type: "application/x-zip-compressed" },
      ]),
    ).toBeNull();
  });

  it("rejects other types, disguised files, empty and oversized files", () => {
    expect(checkFiles([{ name: "a.exe", size: 1, type: "" }])).toMatch(/not a PDF/);
    expect(checkFiles([{ name: "a.pdf", size: 1, type: "image/png" }])).toMatch(/real/);
    expect(checkFiles([{ name: "a.pdf", size: 0, type: "application/pdf" }])).toMatch(/empty/);
    expect(
      checkFiles([{ name: "a.pdf", size: 51 * 1024 * 1024, type: "application/pdf" }]),
    ).toMatch(/larger/);
    expect(checkFiles([])).toMatch(/at least one/);
    expect(checkFiles(Array(6).fill(PDF))).toMatch(/up to 5/);
  });

  it("strips paths and control characters from names", () => {
    expect(cleanFileName("C:\\Users\\me\\My\u0007 essay.pdf")).toBe("My essay.pdf");
    expect(cleanFileName(`${"x".repeat(200)}.pdf`)).toMatch(/\.pdf$/);
    expect(cleanFileName(`${"x".repeat(200)}.pdf`).length).toBeLessThanOrEqual(120);
  });
});

describe("lookupStudent", () => {
  it("finds an enrolled student by the last four digits", async () => {
    const result = await lookupStudent(db, { classId, studentIdRaw: "1111", ip }, NOW);
    expect(result).toMatchObject({
      code: "OK",
      student: { name: "Ada Lovelace", studentId: "905001111" },
      items: [{ title: "Assignment 1", submission: null }],
    });
  });

  it("refuses students of another class, removed students and bad IDs", async () => {
    const look = (raw: string) => lookupStudent(db, { classId, studentIdRaw: raw, ip }, NOW);
    expect((await look("3333")).code).toBe("NOT_FOUND");
    expect((await look("2222")).code).toBe("NOT_FOUND");
    expect((await look("12")).code).toBe("INVALID_ID");
  });

  it("shows a finished submission", async () => {
    await submitOk();
    const result = await lookupStudent(db, { classId, studentIdRaw: "1111", ip }, NOW);
    expect(result).toMatchObject({
      items: [{ submission: { late: false, files: ["essay.pdf"] } }],
    });
  });
});

describe("startSubmission and completeSubmission", () => {
  it("records an on-time submission and names the file after the student", async () => {
    const result = await submitOk();
    expect(result).toMatchObject({ code: "OK", late: false, files: ["essay.pdf"] });
    const [file] = [...drive.files.values()];
    expect(file.name).toBe("905001111 - Ada Lovelace - essay.pdf");
    expect(file.parents[0]).toMatch(/Assignment 1$/);
  });

  it("accepts work after the deadline and marks it late", async () => {
    const result = await submitOk(NOW + 2 * DAY);
    expect(result).toMatchObject({ code: "OK", late: true });
  });

  it("allows one submission per student", async () => {
    await submitOk();
    expect((await start()).code).toBe("ALREADY_SUBMITTED");
  });

  it("refuses closed items and items from another class", async () => {
    await db.update(assignments).set({ open: false }).run();
    expect((await start()).code).toBe("CLOSED");
    expect((await start({ classId: otherClassId, studentIdRaw: "3333" })).code).toBe(
      "NO_ASSIGNMENT",
    );
  });

  it("refuses bad files before contacting Drive", async () => {
    const result = await start({ files: [{ name: "virus.exe", size: 5, type: "" }] });
    expect(result).toMatchObject({ code: "BAD_FILE" });
  });

  it("lets an unfinished upload be started again, and only the newest one counts", async () => {
    const first = await start();
    const second = await start();
    if (first.code !== "OK" || second.code !== "OK") throw new Error("start failed");
    expect(second.submissionId).toBe(first.submissionId);
    const stale = await completeSubmission(
      db,
      drive.io,
      {
        submissionId: first.submissionId,
        token: first.token,
        uploads: [{ fileId: first.uploads[0].fileId, driveFileId: drive.upload(first.uploads[0].uploadUrl) }],
        ip,
      },
      NOW,
    );
    expect(stale.code).toBe("EXPIRED");
  });

  it("refuses files that did not arrive whole or in the right place", async () => {
    const started = await start();
    if (started.code !== "OK") throw new Error(started.code);
    const fileId = started.uploads[0].fileId;
    const complete = (driveFileId: string) =>
      completeSubmission(
        db,
        drive.io,
        { submissionId: started.submissionId, token: started.token, uploads: [{ fileId, driveFileId }], ip },
        NOW,
      );
    expect((await complete("missing")).code).toBe("UPLOAD_FAILED");
    expect((await complete(drive.upload(started.uploads[0].uploadUrl, 10))).code).toBe(
      "UPLOAD_FAILED",
    );
    const row = await db.select().from(submissions).get();
    expect(row?.status).toBe("PENDING");
  });

  it("expires an upload confirmed too long after it started", async () => {
    const started = await start();
    if (started.code !== "OK") throw new Error(started.code);
    const uploads = [
      { fileId: started.uploads[0].fileId, driveFileId: drive.upload(started.uploads[0].uploadUrl) },
    ];
    const result = await completeSubmission(
      db,
      drive.io,
      { submissionId: started.submissionId, token: started.token, uploads, ip },
      NOW + UPLOAD_WINDOW_MS + 1,
    );
    expect(result.code).toBe("EXPIRED");
  });

  it("treats a repeated confirmation as success", async () => {
    const started = await start();
    if (started.code !== "OK") throw new Error(started.code);
    const input = {
      submissionId: started.submissionId,
      token: started.token,
      uploads: [{ fileId: started.uploads[0].fileId, driveFileId: drive.upload(started.uploads[0].uploadUrl) }],
      ip,
    };
    expect((await completeSubmission(db, drive.io, input, NOW)).code).toBe("OK");
    expect((await completeSubmission(db, drive.io, input, NOW)).code).toBe("OK");
  });

  it("re-judges lateness when the deadline moves", async () => {
    await submitOk(NOW + 2 * DAY);
    await rejudgeLateness(db, assignmentId, NOW + 3 * DAY);
    expect((await db.select().from(submissions).get())?.late).toBe(false);
  });
});

describe("getClassSubmissionMatrix", () => {
  it("lists who is missing per item and counts per student", async () => {
    const { getClassSubmissionMatrix } = await import("@/lib/data/assignments");
    const second = (
      await db
        .insert(assignments)
        .values({ classId, title: "Classwork - Week 5", dueAt: NOW - DAY, createdAt: NOW })
        .returning()
        .get()
    ).id;
    await submitOk();
    const matrix = await getClassSubmissionMatrix(db, classId);

    // Only active students are chased; Ada has handed in Assignment 1.
    expect(matrix.students.map((s) => s.name)).toEqual(["Ada Lovelace"]);
    const byTitle = Object.fromEntries(
      matrix.items.map((i) => [i.title, i.missing.map((s) => s.name)]),
    );
    expect(byTitle).toEqual({ "Classwork - Week 5": ["Ada Lovelace"], "Assignment 1": [] });
    expect(matrix.students[0].missing).toBe(1);
    expect(matrix.students[0].cells[second]).toBeNull();
    expect(matrix.students[0].cells[assignmentId]).toMatchObject({ late: false });
  });
});

describe("group work", () => {
  let projectId: number;
  const ids: Record<string, number> = {};

  beforeEach(async () => {
    for (const [studentId, name] of [
      ["905004444", "Bob Kamara"],
      ["905005555", "Cara Sesay"],
      ["905006666", "Dan Koroma"],
    ]) {
      const id = (
        await db.insert(students).values({ studentId, name }).returning().get()
      ).id;
      await db.insert(enrollments).values({ classId, studentId: id }).run();
      ids[name] = id;
    }
    projectId = (
      await db
        .insert(assignments)
        .values({
          classId,
          title: "Group project",
          kind: "PROJECT",
          groupWork: true,
          maxGroupSize: 3,
          dueAt: NOW + DAY,
          createdAt: NOW,
        })
        .returning()
        .get()
    ).id;
  });

  async function groupSubmit(submitter: string, members: string[], now = NOW) {
    const started = await start(
      { studentIdRaw: submitter, assignmentId: projectId, memberIdsRaw: members },
      now,
    );
    if (started.code !== "OK") return started;
    const uploads = started.uploads.map((u) => ({
      fileId: u.fileId,
      driveFileId: drive.upload(u.uploadUrl),
    }));
    return completeSubmission(
      db,
      drive.io,
      { submissionId: started.submissionId, token: started.token, uploads, ip },
      now + 1000,
    );
  }

  it("marks every member as submitted from one submission", async () => {
    const done = await groupSubmit("1111", ["4444", "5555"]);
    expect(done).toMatchObject({
      code: "OK",
      members: ["Ada Lovelace", "Bob Kamara", "Cara Sesay"],
    });

    const bob = await lookupStudent(db, { classId, studentIdRaw: "4444", ip });
    if (bob.code !== "OK") throw new Error(bob.code);
    expect(bob.items.find((i) => i.id === projectId)?.submission).toMatchObject({
      submittedBy: "Ada Lovelace",
      members: ["Ada Lovelace", "Bob Kamara", "Cara Sesay"],
      files: ["essay.pdf"],
    });
    const ada = await lookupStudent(db, { classId, studentIdRaw: "1111", ip });
    if (ada.code !== "OK") throw new Error(ada.code);
    expect(ada.items.find((i) => i.id === projectId)?.submission?.submittedBy).toBeNull();

    // Bob can't hand in again for the group.
    expect((await start({ studentIdRaw: "4444", assignmentId: projectId })).code).toBe(
      "ALREADY_SUBMITTED",
    );
  });

  it("counts members on the lecturer pages and in the sheet", async () => {
    const { getAssignmentDetail, getClassAssignments, getClassSubmissionMatrix } =
      await import("@/lib/data/assignments");
    const { loadSubmissionsGrid } = await import("@/lib/sheets/submissions");
    await groupSubmit("1111", ["4444"]);

    const item = (await getClassAssignments(db, classId)).find((i) => i.id === projectId);
    expect(item?.submitted).toBe(2);

    const detail = await getAssignmentDetail(db, projectId);
    const byName = Object.fromEntries(
      detail!.roster.map((e) => [e.name, e.submission]),
    );
    expect(byName["Ada Lovelace"]).toMatchObject({ submittedBy: null, groupmates: ["Bob Kamara"] });
    expect(byName["Bob Kamara"]).toMatchObject({
      submittedBy: "Ada Lovelace",
      groupmates: ["Ada Lovelace"],
      files: [{ name: "essay.pdf" }],
    });
    expect(byName["Cara Sesay"]).toBeNull();

    const matrix = await getClassSubmissionMatrix(db, classId);
    expect(
      matrix.items.find((i) => i.id === projectId)?.missing.map((s) => s.name),
    ).toEqual(["Cara Sesay", "Dan Koroma"]);

    const grid = await loadSubmissionsGrid(db, classId);
    expect(grid.cells.get(`${ids["Bob Kamara"]}:${projectId}`)).toMatchObject({ late: false });
    expect(grid.cells.get(`${ids["Cara Sesay"]}:${projectId}`)).toBeUndefined();
  });

  it("refuses groups that break the rules", async () => {
    const code = async (submitter: string, members: string[]) => {
      const r = await start({ studentIdRaw: submitter, assignmentId: projectId, memberIdsRaw: members });
      return r.code === "OK" ? "OK" : `${r.code}: ${r.message ?? ""}`;
    };
    expect(await code("1111", ["4444", "5555", "6666"])).toMatch(/^BAD_GROUP: .*at most 3/);
    expect(await code("1111", ["3333"])).toMatch(/^BAD_GROUP: .*ending 3333/);
    expect(await code("1111", ["2222"])).toMatch(/^BAD_GROUP/); // left the class
    expect(await code("1111", ["1111"])).toMatch(/^BAD_GROUP: You're already/);
    expect(await code("1111", ["4444", "4444"])).toMatch(/^BAD_GROUP: Bob Kamara is listed twice/);
    // Members on individual work.
    const r = await start({ memberIdsRaw: ["4444"] });
    expect(r.code).toBe("BAD_GROUP");
  });

  it("won't put someone in two groups", async () => {
    await groupSubmit("1111", ["4444"]);
    const again = await groupSubmit("5555", ["4444"]);
    expect(again).toMatchObject({
      code: "MEMBER_TAKEN",
      message: "Bob Kamara has already been submitted for by Ada Lovelace.",
    });
  });

  it("stops the second of two overlapping groups at confirmation", async () => {
    const first = await start({ studentIdRaw: "1111", assignmentId: projectId, memberIdsRaw: ["4444"] });
    const second = await start({ studentIdRaw: "5555", assignmentId: projectId, memberIdsRaw: ["4444"] });
    if (first.code !== "OK" || second.code !== "OK") throw new Error("start failed");
    const finish = (s: typeof first) =>
      completeSubmission(
        db,
        drive.io,
        {
          submissionId: s.submissionId,
          token: s.token,
          uploads: s.uploads.map((u) => ({ fileId: u.fileId, driveFileId: drive.upload(u.uploadUrl) })),
          ip,
        },
        NOW + 1000,
      );
    expect((await finish(first)).code).toBe("OK");
    expect((await finish(second)).code).toBe("MEMBER_TAKEN");
    // Cara is still free to hand in with someone else.
    expect((await groupSubmit("5555", ["6666"])).code).toBe("OK");
  });

  it("looks up a group mate's name as they're added", async () => {
    const { lookupMember } = await import("@/lib/submissions");
    const look = (memberRaw: string, target = projectId) =>
      lookupMember(db, { classId, assignmentId: target, submitterRaw: "1111", memberRaw, ip });
    expect(await look("4444")).toEqual({
      code: "OK",
      member: { studentId: "905004444", name: "Bob Kamara" },
    });
    expect((await look("1111")).code).toBe("BAD_GROUP");
    expect((await look("3333")).code).toBe("NOT_FOUND");
    expect((await look("4444", assignmentId)).code).toBe("BAD_GROUP");
    await groupSubmit("5555", ["4444"]);
    expect(await look("4444")).toMatchObject({ code: "MEMBER_TAKEN" });
  });
});

describe("submission members", () => {
  it("are written for every submission, and backfilled for older ones", async () => {
    const { submissionMembers } = await import("@/lib/db/schema");
    await submitOk();
    const rows = await db.select().from(submissionMembers).all();
    expect(rows).toHaveLength(1);
    // The backfill itself runs in the migration; check its SQL covers it.
    const fs = await import("node:fs");
    const sqlText = fs.readFileSync("drizzle/0002_melted_starjammers.sql", "utf8");
    expect(sqlText).toMatch(/INSERT INTO `submission_members`.*SELECT `id`, `assignment_id`, `student_id` FROM `submissions`/);
  });
});
