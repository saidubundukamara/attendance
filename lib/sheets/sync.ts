import { db } from "@/lib/db";
import { appTimeZone } from "@/lib/timezone";
import {
  ensureTab,
  fetchTabValues,
  listAttendanceTabs,
  replaceTabValues,
  writeCells,
} from "./client";
import { parseAttendanceTab } from "./parse";
import {
  applyRoster,
  classesNeedingSubsSync,
  type RosterSyncReport,
} from "./roster";
import { writeSubmissionsTab } from "./submissions";
import { processSyncJobs, type SyncSummary } from "./write";

// Reads every "Attn of ..." tab from the Google Sheet and updates the roster.
export async function syncRoster(): Promise<RosterSyncReport> {
  const titles = await listAttendanceTabs();
  const tabs = await fetchTabValues(titles);
  return applyRoster(
    db,
    tabs.map(({ title, values }) => ({
      title,
      parsed: parseAttendanceTab(values),
    })),
  );
}

const globalForSync = globalThis as unknown as {
  __sheetSync?: { running: boolean; again: boolean };
};
const state = (globalForSync.__sheetSync ??= { running: false, again: false });

// Check-ins arrive in bursts; waiting briefly lets one sheet request carry
// many of them and keeps the request rate under the API quota.
const BATCH_DELAY_MS = 2000;

// Sends queued attendance to the sheet in the background. Safe to call after
// every check-in: overlapping calls collapse into one follow-up run.
export async function scheduleSheetSync(): Promise<void> {
  if (state.running) {
    state.again = true;
    return;
  }
  state.running = true;
  try {
    do {
      state.again = false;
      await new Promise((resolve) => setTimeout(resolve, BATCH_DELAY_MS));
      await processSyncJobs(db, { fetchTabValues, writeCells });
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
let lastAutoRetry = 0;

export function retryStalledSync(now: number = Date.now()): void {
  if (state.running || now - lastAutoRetry < AUTO_RETRY_EVERY_MS) return;
  lastAutoRetry = now;
  void scheduleSheetSync();
}

// Immediate run for the "Retry sync" button, including jobs that had
// stopped retrying on their own.
export function retrySheetSync(): Promise<SyncSummary> {
  return processSyncJobs(
    db,
    { fetchTabValues, writeCells },
    { includeExhausted: true },
  );
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
  report: RosterSyncReport,
): Promise<void> {
  const ids = await classesNeedingSubsSync(db, report);
  await Promise.all(ids.map((id) => scheduleSubmissionsSync(id)));
}

// Immediate rewrite, for the lecturer's "Update sheet" button.
export function syncSubmissionsTab(classId: number): Promise<void> {
  return writeSubmissionsTab(
    db,
    { ensureTab, replaceTabValues },
    classId,
    appTimeZone(),
  );
}
