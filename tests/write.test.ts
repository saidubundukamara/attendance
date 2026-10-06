import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/lib/db/client";
import { classes, syncJobs } from "@/lib/db/schema";
import { cellRange, columnLetter } from "@/lib/sheets/client";
import {
  getSyncStatus,
  MAX_ATTEMPTS,
  processSyncJobs,
  type CellWrite,
  type SheetIo,
} from "@/lib/sheets/write";
import { createTestDb } from "./helpers/db";
import { buildTab } from "./helpers/sheet";

const TAB = "Attn of TEST101";
let db: Db;
let classId: number;
let sheet: unknown[][];
let written: CellWrite[][];
let io: SheetIo;
let readError: Error | null;
let writeError: Error | null;

beforeEach(async () => {
  db = await createTestDb();
  classId = (
    await db
      .insert(classes)
      .values({ code: "TEST101", sheetTab: TAB })
      .returning()
      .get()
  ).id;
  // Rows 11-13 (index 10-12); WK1 is column E (index 4).
  sheet = buildTab([
    { name: "Student One", id: 900000001 },
    { name: "Student Two", id: 900000002 },
    { name: "Student Three", id: 900000003 },
  ]);
  written = [];
  readError = null;
  writeError = null;
  io = {
    async fetchTabValues(titles) {
      if (readError) throw readError;
      return titles.map((title) => ({ title, values: sheet }));
    },
    async writeCells(cells) {
      if (writeError) throw writeError;
      written.push(cells);
      for (const cell of cells) sheet[cell.row][cell.col] = cell.value;
    },
  };
});

async function queue(studentId: string, week: number, value = 1) {
  return (
    await db
      .insert(syncJobs)
      .values({ classId, studentId, week, value, createdAt: 1 })
      .returning()
      .get()
  ).id;
}

const jobs = async () => await db.select().from(syncJobs).all();

describe("A1 ranges", () => {
  it("converts column indexes to letters", async () => {
    expect([0, 4, 18, 25, 26, 27, 701, 702].map(columnLetter)).toEqual([
      "A",
      "E",
      "S",
      "Z",
      "AA",
      "AB",
      "ZZ",
      "AAA",
    ]);
  });

  it("quotes the tab name", async () => {
    expect(cellRange({ tab: TAB, row: 10, col: 4 })).toBe(
      "'Attn of TEST101'!E11",
    );
    expect(cellRange({ tab: "Attn of O'Brien", row: 0, col: 0 })).toBe(
      "'Attn of O''Brien'!A1",
    );
  });
});

describe("processSyncJobs", () => {
  it("writes each check-in to the student's row and week column in one request", async () => {
    await queue("900000001", 1);
    await queue("900000003", 5);
    const summary = await processSyncJobs(db, io, { now: () => 99 });

    expect(summary).toEqual({ done: 2, failed: 0, deferred: 0, errors: [] });
    expect(written).toEqual([
      [
        { tab: TAB, row: 10, col: 4, value: 1 },
        { tab: TAB, row: 12, col: 8, value: 1 },
      ],
    ]);
    expect((await jobs()).map((j) => [j.status, j.doneAt])).toEqual([
      ["DONE", 99],
      ["DONE", 99],
    ]);
  });

  it("finds the row by ID after the sheet is re-sorted", async () => {
    [sheet[10], sheet[12]] = [sheet[12], sheet[10]];
    await queue("900000001", 1);
    await processSyncJobs(db, io);
    expect(written[0]).toEqual([{ tab: TAB, row: 12, col: 4, value: 1 }]);
  });

  it("does nothing when the queue is empty or already done", async () => {
    await processSyncJobs(db, io);
    await queue("900000001", 1);
    await processSyncJobs(db, io);
    await processSyncJobs(db, io);
    expect(written).toHaveLength(1);
  });

  it("skips the write when the cell already holds the value", async () => {
    sheet[10][4] = 1;
    await queue("900000001", 1);
    const summary = await processSyncJobs(db, io);
    expect(summary.done).toBe(1);
    expect(written).toEqual([]);
  });

  it("writes only the latest value for a cell", async () => {
    await queue("900000001", 1, 1);
    await queue("900000001", 1, 0);
    sheet[10][4] = 1;
    const summary = await processSyncJobs(db, io);
    expect(summary.done).toBe(2);
    expect(written).toEqual([[{ tab: TAB, row: 10, col: 4, value: 0 }]]);
  });

  it("fails a job for a missing student without blocking the others", async () => {
    await queue("900000777", 1);
    await queue("900000002", 1);
    const summary = await processSyncJobs(db, io);
    expect(summary).toMatchObject({ done: 1, failed: 1 });
    expect(summary.errors[0]).toContain("Student 900000777 not found");
    expect((await jobs()).map((j) => [j.status, j.attempts])).toEqual([
      ["FAILED", 1],
      ["DONE", 0],
    ]);
    expect(sheet[11][4]).toBe(1);
  });

  it("fails a job for a week with no column", async () => {
    await queue("900000001", 16);
    const summary = await processSyncJobs(db, io);
    expect(summary.errors).toEqual([`Week 16 column not found in "${TAB}".`]);
  });

  it("leaves a cell alone when it holds something other than 1, 0 or blank", async () => {
    sheet[10][4] = "!";
    await queue("900000001", 1);
    const summary = await processSyncJobs(db, io);
    expect(summary.failed).toBe(1);
    expect(summary.errors[0]).toContain('contains "!"');
    expect(sheet[10][4]).toBe("!");
    expect(written).toEqual([]);
  });

  it("keeps jobs queued, without penalty, when the sheet cannot be read", async () => {
    await queue("900000001", 1);
    readError = new Error("network down");
    for (let i = 0; i < MAX_ATTEMPTS + 5; i++) {
      const summary = await processSyncJobs(db, io);
      expect(summary).toMatchObject({ done: 0, deferred: 1 });
    }
    expect((await jobs())[0]).toMatchObject({ status: "PENDING", attempts: 0 });
    expect(await getSyncStatus(db)).toEqual({
      pending: 1,
      lastError: `Could not read "${TAB}": network down`,
      stalled: true,
    });

    readError = null;
    expect((await processSyncJobs(db, io)).done).toBe(1);
    expect(await getSyncStatus(db)).toEqual({
      pending: 0,
      lastError: null,
      stalled: false,
    });
    expect((await jobs())[0].lastError).toBeNull();
  });

  it("only calls the queue stalled once an entry has waited or failed", async () => {
    await db
      .insert(syncJobs)
      .values({
        classId,
        studentId: "900000001",
        week: 1,
        value: 1,
        createdAt: 1000,
      })
      .run();
    expect(await getSyncStatus(db, 3000)).toMatchObject({
      pending: 1,
      stalled: false,
    });
    expect(await getSyncStatus(db, 60_000)).toMatchObject({
      pending: 1,
      stalled: true,
    });
  });

  it("keeps jobs queued when the write is rejected", async () => {
    await queue("900000001", 1);
    writeError = new Error("quota exceeded");
    const summary = await processSyncJobs(db, io);
    expect(summary).toMatchObject({ done: 0, deferred: 1 });
    expect(sheet[10][4]).toBe(0);

    writeError = null;
    await processSyncJobs(db, io);
    expect(sheet[10][4]).toBe(1);
  });

  it("stops retrying an unplaceable job, until a manual retry", async () => {
    await queue("900000777", 1);
    for (let i = 0; i < MAX_ATTEMPTS + 3; i++) await processSyncJobs(db, io);
    expect((await jobs())[0].attempts).toBe(MAX_ATTEMPTS);
    expect((await getSyncStatus(db)).pending).toBe(1);

    // The student is added to the sheet, then the lecturer clicks Retry.
    sheet.push(["", 4, "Late Joiner", 900000777, ...Array(15).fill(0), 0]);
    const summary = await processSyncJobs(db, io, { includeExhausted: true });
    expect(summary.done).toBe(1);
    expect(sheet[13][4]).toBe(1);
  });

  it("handles two classes independently", async () => {
    const other = (
      await db
        .insert(classes)
        .values({ code: "TEST202", sheetTab: "Attn of TEST202" })
        .returning()
        .get()
    ).id;
    await queue("900000001", 2);
    await db
      .insert(syncJobs)
      .values({
        classId: other,
        studentId: "900000002",
        week: 3,
        value: 1,
        createdAt: 1,
      })
      .run();
    await processSyncJobs(db, io);
    expect(written.map((cells) => cells[0].tab).sort()).toEqual([
      "Attn of TEST101",
      "Attn of TEST202",
    ]);
  });
});
