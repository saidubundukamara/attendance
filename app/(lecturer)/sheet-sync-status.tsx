"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Refresh } from "@/components/ui/icons";
import { Notice } from "@/components/ui/notice";
import { retrySheetSyncAction } from "@/lib/actions/classes";

// Shown only while attendance is waiting to reach the Google Sheet. Entries
// normally arrive within seconds, so the warning waits until one is stuck.
export function SheetSyncStatus({
  pending,
  lastError,
  stalled,
}: {
  pending: number;
  lastError: string | null;
  stalled: boolean;
}) {
  const [state, action, running] = useActionState(
    retrySheetSyncAction,
    undefined,
  );
  const left = state ? state.pending : pending;
  const error = state ? state.error : lastError;

  if (left === 0) {
    return state ? <Notice tone="ok">Google Sheet is up to date.</Notice> : null;
  }

  if (!stalled && !state) {
    return (
      <p role="status" className="flex items-center gap-2 text-sm text-muted">
        <Refresh className="size-3.5 animate-spin" />
        Saving {left} {left === 1 ? "entry" : "entries"} to the Google Sheet…
      </p>
    );
  }

  return (
    <Notice
      action={
        <form action={action}>
          <Button type="submit" variant="secondary" size="sm" disabled={running}>
            {running ? "Syncing…" : "Retry sync"}
          </Button>
        </form>
      }
    >
      <p className="font-medium">
        {left} {left === 1 ? "entry" : "entries"} not yet in the Google Sheet
      </p>
      <p>
        Attendance is saved here and is not lost. It is retried automatically
        while a session is open.
        {error ? ` Last error: ${error}` : ""}
      </p>
    </Notice>
  );
}
