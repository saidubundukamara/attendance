// Sends queued attendance values to the Google Sheet. The sheet access is
// passed in so this can be tested without the network.
import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  lt,
  min,
  ne,
  or,
  sql,
} from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import { classes, syncJobs } from "@/lib/db/schema";
import { parseAttendanceTab } from "./parse";

export type CellWrite = {
  tab: string;
  row: number;
  col: number;
  value: number;
};

export type SheetIo = {
  fetchTabValues(
    titles: string[],
  ): Promise<{ title: string; values: unknown[][] }[]>;
  writeCells(cells: CellWrite[]): Promise<void>;
};

export type SyncSummary = {
  done: number;
  failed: number;
  // Jobs left for a later run because the sheet could not be reached.
  deferred: number;
  errors: string[];
};

// A job that cannot be placed (student or week missing from the sheet) stops
// being retried automatically after this many tries.
export const MAX_ATTEMPTS = 10;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// Blank, 0 and 1 are the only values the app will overwrite.
function isOverwritable(cell: unknown): boolean {
  if (cell === null || cell === undefined) return true;
  if (typeof cell === "number") return cell === 0 || cell === 1;
  const text = String(cell).trim();
  return text === "" || text === "0" || text === "1";
}

function cellEquals(cell: unknown, value: number): boolean {
  if (typeof cell === "number") return cell === value;
  return typeof cell === "string" && cell.trim() === String(value);
}

export async function processSyncJobs(
  db: Db,
  io: SheetIo,
  options: { includeExhausted?: boolean; now?: () => number } = {},
): Promise<SyncSummary> {
  const now = options.now ?? Date.now;
  const summary: SyncSummary = { done: 0, failed: 0, deferred: 0, errors: [] };

  const waiting = options.includeExhausted
    ? ne(syncJobs.status, "DONE")
    : or(
        eq(syncJobs.status, "PENDING"),
        and(
          eq(syncJobs.status, "FAILED"),
          lt(syncJobs.attempts, MAX_ATTEMPTS),
        ),
      );
  const classIds = (
    await db
      .selectDistinct({ classId: syncJobs.classId })
      .from(syncJobs)
      .where(waiting)
      .all()
  ).map((row) => row.classId);
  if (classIds.length === 0) return summary;

  const markDone = async (ids: number[]) => {
    if (ids.length === 0) return;
    await db
      .update(syncJobs)
      .set({ status: "DONE", doneAt: now(), lastError: null })
      .where(inArray(syncJobs.id, ids))
      .run();
    summary.done += ids.length;
  };
  // The job itself cannot be placed; counts towards MAX_ATTEMPTS.
  const markFailed = async (job: typeof syncJobs.$inferSelect, message: string) => {
    await db
      .update(syncJobs)
      .set({
        status: "FAILED",
        attempts: sql`${syncJobs.attempts} + 1`,
        lastError: message,
      })
      .where(eq(syncJobs.id, job.id))
      .run();
    summary.failed++;
    summary.errors.push(message);
  };
  // The sheet could not be reached; the jobs stay queued without penalty.
  const defer = async (ids: number[], message: string) => {
    if (ids.length > 0) {
      await db
        .update(syncJobs)
        .set({ status: "PENDING", lastError: message })
        .where(inArray(syncJobs.id, ids))
        .run();
    }
    summary.deferred += ids.length;
    summary.errors.push(message);
  };

  const syncClass = async (
    cls: typeof classes.$inferSelect,
    classJobs: (typeof syncJobs.$inferSelect)[],
  ) => {
    const allIds = classJobs.map((job) => job.id);

    let values: unknown[][];
    try {
      values = (await io.fetchTabValues([cls.sheetTab]))[0]?.values ?? [];
    } catch (error) {
      await defer(
        allIds,
        `Could not read "${cls.sheetTab}": ${errorMessage(error)}`,
      );
      return;
    }

    const tab = parseAttendanceTab(values);
    const rowById = new Map(tab.students.map((s) => [s.studentId, s.row]));

    // Later jobs for the same cell replace earlier ones (present, then
    // corrected to absent, writes only the 0).
    const latest = new Map<string, typeof syncJobs.$inferSelect>();
    const superseded: number[] = [];
    for (const job of classJobs) {
      const key = `${job.studentId}:${job.week}`;
      const earlier = latest.get(key);
      if (earlier) superseded.push(earlier.id);
      latest.set(key, job);
    }

    const writes: { job: typeof syncJobs.$inferSelect; cell: CellWrite }[] = [];
    const unchanged: number[] = [];
    for (const job of latest.values()) {
      const row = rowById.get(job.studentId);
      const col = tab.weekCols.get(job.week);
      if (tab.headerRow === null) {
        await markFailed(job, `"${cls.sheetTab}" has no "ID Number" header.`);
      } else if (row === undefined) {
        await markFailed(
          job,
          `Student ${job.studentId} not found in "${cls.sheetTab}".`,
        );
      } else if (col === undefined) {
        await markFailed(
          job,
          `Week ${job.week} column not found in "${cls.sheetTab}".`,
        );
      } else if (!isOverwritable(values[row]?.[col])) {
        await markFailed(
          job,
          `"${cls.sheetTab}" week ${job.week} for ${job.studentId} contains "${String(values[row]?.[col])}"; left unchanged.`,
        );
      } else if (cellEquals(values[row]?.[col], job.value)) {
        unchanged.push(job.id);
      } else {
        writes.push({
          job,
          cell: { tab: cls.sheetTab, row, col, value: job.value },
        });
      }
    }

    if (writes.length > 0) {
      try {
        // One request per class per run keeps well inside the API quota.
        await io.writeCells(writes.map((w) => w.cell));
      } catch (error) {
        await defer(
          [...writes.map((w) => w.job.id), ...unchanged, ...superseded],
          `Could not write to "${cls.sheetTab}": ${errorMessage(error)}`,
        );
        return;
      }
    }
    await markDone([
      ...writes.map((w) => w.job.id),
      ...unchanged,
      ...superseded,
    ]);
  };

  for (const classId of classIds) {
    // Only one run writes a class's tab at a time, or an older run could
    // write a value after a newer one. A class another run holds is left to
    // it: that run goes round again for anything queued meanwhile.
    const cls = await takeLease(db, classId, now());
    if (!cls) continue;
    try {
      let seen = 0;
      let first = true;
      for (;;) {
        const jobs = await db
          .select()
          .from(syncJobs)
          .where(
            and(
              eq(syncJobs.classId, classId),
              first
                ? waiting
                : and(eq(syncJobs.status, "PENDING"), gt(syncJobs.id, seen)),
            ),
          )
          .orderBy(asc(syncJobs.id))
          .all();
        first = false;
        if (jobs.length > 0) {
          seen = jobs[jobs.length - 1].id;
          await syncClass(cls, jobs);
        }
        // Freed only if nothing new was queued since the read above.
        if (await releaseLease(db, classId, seen)) break;
        await db
          .update(classes)
          .set({ sheetSyncUntil: now() + LEASE_MS })
          .where(eq(classes.id, classId))
          .run();
      }
    } catch (error) {
      await db
        .update(classes)
        .set({ sheetSyncUntil: null })
        .where(eq(classes.id, classId))
        .run();
      throw error;
    }
  }

  return summary;
}

// Long enough for any sync run; a run that dies frees the class after this.
export const LEASE_MS = 2 * 60 * 1000;

// Takes the class's sync lease in one statement; null when another run
// holds it.
async function takeLease(db: Db, classId: number, now: number) {
  return await db
    .update(classes)
    .set({ sheetSyncUntil: now + LEASE_MS })
    .where(
      and(
        eq(classes.id, classId),
        or(isNull(classes.sheetSyncUntil), lt(classes.sheetSyncUntil, now)),
      ),
    )
    .returning()
    .get();
}

// Frees the lease unless a job newer than `seen` is waiting, in one
// statement so a job queued at the same moment can't be stranded.
async function releaseLease(db: Db, classId: number, seen: number) {
  const result = await db
    .update(classes)
    .set({ sheetSyncUntil: null })
    .where(
      and(
        eq(classes.id, classId),
        sql`NOT EXISTS (SELECT 1 FROM ${syncJobs} WHERE ${syncJobs.classId} = ${classId} AND ${syncJobs.status} = 'PENDING' AND ${syncJobs.id} > ${seen})`,
      ),
    )
    .run();
  return result.rowsAffected > 0;
}

export type SyncStatus = {
  pending: number;
  lastError: string | null;
  // False while entries are simply on their way: every check-in waits a few
  // seconds in the queue. True once one has failed or waited too long.
  stalled: boolean;
};

// A healthy sync finishes well inside this.
export const STALLED_AFTER_MS = 20_000;

export async function getSyncStatus(
  db: Db,
  now: number = Date.now(),
): Promise<SyncStatus> {
  const queue = await db
    .select({ value: count(), oldest: min(syncJobs.createdAt) })
    .from(syncJobs)
    .where(ne(syncJobs.status, "DONE"))
    .get();
  const pending = queue?.value ?? 0;
  const lastError = pending
    ? ((
        await db
          .select({ lastError: syncJobs.lastError })
          .from(syncJobs)
          .where(
            and(ne(syncJobs.status, "DONE"), isNotNull(syncJobs.lastError)),
          )
          .orderBy(desc(syncJobs.id))
          .limit(1)
          .get()
      )?.lastError ?? null)
    : null;
  const stalled =
    pending > 0 &&
    (lastError !== null || now - (queue?.oldest ?? now) > STALLED_AFTER_MS);
  return { pending, lastError, stalled };
}
