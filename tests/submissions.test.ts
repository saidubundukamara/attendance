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
