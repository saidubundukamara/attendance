// Sends queued attendance values to the Google Sheet. The sheet access is
// passed in so this can be tested without the network.
import {
  and,
  asc,
  count,
  desc,
  eq,
  inArray,
  isNotNull,
  lt,
  min,
  ne,
  or,
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

  const jobs = await db
    .select()
    .from(syncJobs)
    .where(
      options.includeExhausted
        ? ne(syncJobs.status, "DONE")
        : or(
            eq(syncJobs.status, "PENDING"),
            and(
              eq(syncJobs.status, "FAILED"),
              lt(syncJobs.attempts, MAX_ATTEMPTS),
            ),
          ),
    )
    .orderBy(asc(syncJobs.id))
    .all();
  if (jobs.length === 0) return summary;

  const byClass = new Map<number, typeof jobs>();
  for (const job of jobs) {
    byClass.set(job.classId, [...(byClass.get(job.classId) ?? []), job]);
  }

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
  const markFailed = async (job: (typeof jobs)[number], message: string) => {
    await db
      .update(syncJobs)
      .set({ status: "FAILED", attempts: job.attempts + 1, lastError: message })
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

  for (const [classId, classJobs] of byClass) {
    const cls = await db
      .select()
      .from(classes)
      .where(eq(classes.id, classId))
      .get();
    if (!cls) continue;
    const allIds = classJobs.map((job) => job.id);

    let values: unknown[][];
    try {
      values = (await io.fetchTabValues([cls.sheetTab]))[0]?.values ?? [];
    } catch (error) {
      await defer(
        allIds,
        `Could not read "${cls.sheetTab}": ${errorMessage(error)}`,
      );
      continue;
    }

    const tab = parseAttendanceTab(values);
    const rowById = new Map(tab.students.map((s) => [s.studentId, s.row]));

    // Later jobs for the same cell replace earlier ones (present, then
    // corrected to absent, writes only the 0).
    const latest = new Map<string, (typeof jobs)[number]>();
    const superseded: number[] = [];
    for (const job of classJobs) {
      const key = `${job.studentId}:${job.week}`;
      const earlier = latest.get(key);
      if (earlier) superseded.push(earlier.id);
      latest.set(key, job);
    }

    const writes: { job: (typeof jobs)[number]; cell: CellWrite }[] = [];
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
        continue;
      }
    }
    await markDone([
      ...writes.map((w) => w.job.id),
      ...unchanged,
      ...superseded,
    ]);
  }

  return summary;
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
