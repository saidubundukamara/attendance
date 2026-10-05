"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Cross, Refresh } from "@/components/ui/icons";
import { syncRosterAction } from "@/lib/actions/classes";

export function SyncRosterButton() {
  const [state, action, pending] = useActionState(syncRosterAction, undefined);
  // Holds the result that was closed, so the next sync shows again.
  const [dismissed, setDismissed] = useState<typeof state>(undefined);
  const shown = state && state !== dismissed ? state : undefined;

  return (
    <div className="flex max-w-md flex-col items-end gap-3">
      <form action={action}>
        <Button type="submit" variant="secondary" disabled={pending}>
          <Refresh
            className={`size-4 ${pending ? "animate-spin" : "transition-transform duration-500 ease-spring group-hover:rotate-45"}`}
          />
          {pending ? "Syncing…" : "Sync roster"}
        </Button>
      </form>

      {shown?.ok === false && (
        <p role="alert" className="animate-rise text-right text-sm text-danger">
          Sync failed: {shown.error}
        </p>
      )}

      {shown?.ok && (
        <div
          role="status"
          className="relative w-full animate-rise rounded-2xl bg-surface p-4 pr-10 text-sm shadow-soft ring-1 ring-line"
        >
          <button
            type="button"
            onClick={() => setDismissed(shown)}
            aria-label="Dismiss sync result"
            className="absolute top-2.5 right-2.5 flex size-7 items-center justify-center rounded-full text-muted transition-colors hover:bg-ink/5 hover:text-ink"
          >
            <Cross className="size-3.5" />
          </button>
          {shown.report.classes.length === 0 ? (
            <p>No tabs named “Attn of …” were found in the sheet.</p>
          ) : (
            <ul className="space-y-2">
              {shown.report.classes.map((cls) => (
                <li key={cls.sheetTab}>
                  <p>
                    <span className="font-medium">{cls.code || cls.sheetTab}</span>
                    <span className="text-muted">
                      {" "}
                      · {cls.found} students, {cls.added} added,{" "}
                      {cls.deactivated} removed
                    </span>
                  </p>
                  {cls.warnings.length > 0 && (
                    <ul className="mt-1 list-disc pl-5 text-warn">
                      {cls.warnings.map((warning) => (
                        <li key={warning}>{warning}</li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
