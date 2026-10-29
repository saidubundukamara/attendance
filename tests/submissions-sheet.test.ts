import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { assignments, classes } from "@/lib/db/schema";
import {
  buildSubmissionsGrid,
  writeSubmissionsTab,
} from "@/lib/sheets/submissions";
import { createTestDb } from "./helpers/db";

const at = Date.UTC(2026, 9, 24, 14, 5);

describe("buildSubmissionsGrid", () => {
  it("puts one column per item and stamps each submission", () => {
    const grid = buildSubmissionsGrid(
      {
        columns: [
          { id: 1, title: "Assignment 1" },
          { id: 2, title: "Classwork - Week 5" },
        ],
        rows: [
          { id: 10, studentId: "905001111", name: "Ada" },
          { id: 11, studentId: "905002222", name: "Ben" },
        ],
        cells: new Map([
          ["10:1", { late: false, submittedAt: at }],
          ["11:2", { late: true, submittedAt: at }],
        ]),
      },
      "Africa/Freetown",
    );
    expect(grid).toEqual([
      ["ID Number", "Name", "Assignment 1", "Classwork - Week 5"],
      ["905001111", "Ada", "24 Oct 14:05", ""],
      ["905002222", "Ben", "", "LATE 24 Oct 14:05"],
    ]);
  });
});

describe("writeSubmissionsTab overlapping runs", () => {
  const NOW = 1_800_000_000_000;

  async function setup() {
    const db = await createTestDb();
    const classId = (
      await db
        .insert(classes)
        .values({ code: "TEST101", sheetTab: "Attn of TEST101" })
        .returning()
        .get()
    ).id;
    const addItem = (title: string) =>
      db
        .insert(assignments)
        .values({ classId, title, dueAt: NOW, createdAt: NOW })
        .run();
    const written: string[][][] = [];
    const io = {
      ensureTab: async () => {},
      replaceTabValues: async (_title: string, values: string[][]) => {
        written.push(values);
      },
    };
    const cls = async () =>
      (await db.select().from(classes).where(eq(classes.id, classId)).get())!;
    return { db, classId, addItem, written, io, cls };
  }

  it("rewrites again for a change made while it was writing", async () => {
    const { db, classId, addItem, written, io, cls } = await setup();
    await addItem("Assignment 1");
    const replace = io.replaceTabValues;
    io.replaceTabValues = async (title, values) => {
      await replace(title, values);
      if (written.length === 1) {
        // A second item is added, and its sync request finds this run busy.
        await addItem("Assignment 2");
        await writeSubmissionsTab(db, io, classId, "UTC", () => NOW);
      }
    };
    await writeSubmissionsTab(db, io, classId, "UTC", () => NOW);
    expect(written).toHaveLength(2);
    expect(written[1][0]).toEqual(["ID Number", "Name", "Assignment 1", "Assignment 2"]);
    expect((await cls()).submissionsSyncUntil).toBeNull();
  });

  it("leaves the tab to a run already writing it", async () => {
    const { db, classId, written, io, cls } = await setup();
    await db
      .update(classes)
      .set({ submissionsSyncUntil: NOW + 60_000 })
      .where(eq(classes.id, classId))
      .run();
    await writeSubmissionsTab(db, io, classId, "UTC", () => NOW);
    expect(written).toEqual([]);
    expect((await cls()).submissionsSyncRequested).toBe(1);
  });

  it("records a failure and frees the tab", async () => {
    const { db, classId, io, cls } = await setup();
    io.replaceTabValues = async () => {
      throw new Error("quota");
    };
    await expect(writeSubmissionsTab(db, io, classId, "UTC", () => NOW)).rejects.toThrow("quota");
    const row = await cls();
    expect(row.submissionsSheetError).toMatch(/quota/);
    expect(row.submissionsSyncUntil).toBeNull();
  });
});
