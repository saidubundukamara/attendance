import { db } from "@/lib/db";
import { fetchTabValues, listAttendanceTabs, writeCells } from "./client";
import { parseAttendanceTab } from "./parse";
import { applyRoster, type RosterSyncReport } from "./roster";
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
