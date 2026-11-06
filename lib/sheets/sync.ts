import { db } from "@/lib/db";
import { getLecturer, type Lecturer } from "@/lib/lecturers";
import { lecturerOfClass } from "@/lib/data/ownership";
import { appTimeZone } from "@/lib/timezone";
import {
  fetchTabValues,
  listAttendanceTabs,
  sheetCtxFor,
  sheetIo,
} from "./client";
import { parseAttendanceTab } from "./parse";
import {
  applyRoster,
  classesNeedingSubsSync,
  type RosterSyncReport,
} from "./roster";
import { writeSubmissionsTab } from "./submissions";
import { processSyncJobs, type SyncSummary } from "./write";

type SheetLecturer = Pick<Lecturer, "id" | "refreshTokenEnc" | "sheetId">;

// Reads every "Attn of ..." tab from the lecturer's sheet and updates their
// roster.
export async function syncRoster(
  lecturer: SheetLecturer,
): Promise<RosterSyncReport> {
  const ctx = sheetCtxFor(lecturer);
  const titles = await listAttendanceTabs(ctx);
  const tabs = await fetchTabValues(ctx, titles);
  return applyRoster(
    db,
    lecturer.id,
    tabs.map(({ title, values }) => ({
      title,
      parsed: parseAttendanceTab(values),
    })),
  );
}

// One per lecturer: each has their own sheet and API quota.
const globalForSync = globalThis as unknown as {
  __sheetSync?: Map<number, { running: boolean; again: boolean }>;
};
const states = (globalForSync.__sheetSync ??= new Map());

function stateFor(lecturerId: number) {
  let state = states.get(lecturerId);
  if (!state) {
    state = { running: false, again: false };
    states.set(lecturerId, state);
  }
  return state;
}

// Check-ins arrive in bursts; waiting briefly lets one sheet request carry
// many of them and keeps the request rate under the API quota.
const BATCH_DELAY_MS = 2000;

async function runSheetSync(
  lecturerId: number,
  options: { includeExhausted?: boolean } = {},
): Promise<SyncSummary> {
  const lecturer = await getLecturer(db, lecturerId);
  if (!lecturer) return { done: 0, failed: 0, deferred: 0, errors: [] };
  return processSyncJobs(db, sheetIo(sheetCtxFor(lecturer)), {
    ...options,
    lecturerId,
  });
}

// Sends the lecturer's queued attendance to their sheet in the background.
// Safe to call after every check-in: overlapping calls collapse into one
// follow-up run.
export async function scheduleSheetSync(lecturerId: number): Promise<void> {
  const state = stateFor(lecturerId);
  if (state.running) {
    state.again = true;
    return;
  }
  state.running = true;
  try {
    do {
      state.again = false;
      await new Promise((resolve) => setTimeout(resolve, BATCH_DELAY_MS));
      await runSheetSync(lecturerId);
    } while (state.again);
  } catch (error) {
    console.error("Sheet sync failed", error);
  } finally {
    state.running = false;
  }
}

// Entries the sheet refused or that never got sent (network down, server
// restarted mid-sync) are only retried when something calls this. Pages that
// show the queue call it on every load, so it limits itself.
const AUTO_RETRY_EVERY_MS = 30_000;
const lastAutoRetry = new Map<number, number>();

export function retryStalledSync(
  lecturerId: number,
  now: number = Date.now(),
): void {
  if (stateFor(lecturerId).running) return;
  if (now - (lastAutoRetry.get(lecturerId) ?? 0) < AUTO_RETRY_EVERY_MS) return;
  lastAutoRetry.set(lecturerId, now);
  void scheduleSheetSync(lecturerId);
}

// Immediate retry for the lecturer's button, including entries that have
// stopped retrying on their own.
export function retrySheetSync(lecturerId: number): Promise<SyncSummary> {
  return runSheetSync(lecturerId, { includeExhausted: true });
}

const globalForSubs = globalThis as unknown as {
  __submissionsSync?: { running: boolean; classIds: Set<number> };
};
const subsState = (globalForSubs.__submissionsSync ??= {
  running: false,
  classIds: new Set<number>(),
});

// Rewrites a class's "Subs of <CODE>" tab in the background. Submissions
// near a deadline arrive together, so calls in quick succession share a run.
export async function scheduleSubmissionsSync(classId: number): Promise<void> {
  subsState.classIds.add(classId);
  if (subsState.running) return;
  subsState.running = true;
  try {
    while (subsState.classIds.size > 0) {
      await new Promise((resolve) => setTimeout(resolve, BATCH_DELAY_MS));
      const ids = [...subsState.classIds];
      subsState.classIds.clear();
      for (const id of ids) {
        try {
          await syncSubmissionsTab(id);
        } catch (error) {
          // Recorded on the class and shown to the lecturer.
          console.error("Submissions sheet sync failed", error);
        }
      }
    }
  } finally {
    subsState.running = false;
  }
}

// New students get a row in each "Subs of" tab, and those who left drop
// out, without waiting for the next submission.
export async function scheduleSubmissionsSyncAfterRoster(
  lecturerId: number,
  report: RosterSyncReport,
): Promise<void> {
  const ids = await classesNeedingSubsSync(db, lecturerId, report);
  await Promise.all(ids.map((id) => scheduleSubmissionsSync(id)));
}

// Immediate rewrite, for the lecturer's "Update sheet" button.
export async function syncSubmissionsTab(classId: number): Promise<void> {
  const lecturer = await lecturerOfClass(db, classId);
  if (!lecturer) return;
  return writeSubmissionsTab(
    db,
    sheetIo(sheetCtxFor(lecturer)),
    classId,
    appTimeZone(),
  );
}
