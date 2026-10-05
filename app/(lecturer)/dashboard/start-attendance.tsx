"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { startSession } from "@/lib/actions/sessions";

export function StartAttendance({
  classId,
  totalWeeks,
  suggestedWeek,
  sessionWeeks,
}: {
  classId: number;
  totalWeeks: number;
  suggestedWeek: number | null;
  // Weeks that already have a (closed) session.
  sessionWeeks: number[];
}) {
  // The suggested week starts in one press unless it was already taken.
  const quick =
    suggestedWeek !== null && !sessionWeeks.includes(suggestedWeek)
      ? suggestedWeek
      : null;
  const [open, setOpen] = useState(false);
  const [week, setWeek] = useState(suggestedWeek ?? 1);
  const [state, action, pending] = useActionState(startSession, undefined);
  const reopening = sessionWeeks.includes(week);

  return (
    <>
      {!open && (
        <div className="flex flex-wrap items-center gap-2">
          {quick !== null && (
            <form action={action}>
              <input type="hidden" name="classId" value={classId} />
              <input type="hidden" name="week" value={quick} />
              <Button type="submit" arrow disabled={pending}>
                {pending ? "Starting…" : `Start week ${quick}`}
              </Button>
            </form>
          )}
          <Button
            variant={quick === null ? "primary" : "ghost"}
            disabled={pending}
            aria-expanded={false}
            onClick={() => setOpen(true)}
          >
            {quick === null ? "Start attendance" : "Other week"}
          </Button>
        </div>
      )}

      {open && (
        <div className="reveal w-full">
          <form action={action} className="border-t border-line pt-5">
            <input type="hidden" name="classId" value={classId} />
            <fieldset>
              <legend className="text-sm font-medium">Which week?</legend>
              <div className="mt-3 flex flex-wrap gap-1.5 p-0.5">
                {Array.from({ length: totalWeeks }, (_, i) => i + 1).map((n) => {
                  const taken = sessionWeeks.includes(n);
                  return (
                    <label key={n} className="relative">
                      <input
                        type="radio"
                        name="week"
                        value={n}
                        checked={week === n}
                        onChange={() => setWeek(n)}
                        className="peer sr-only"
                      />
                      <span
                        className={`flex size-10 cursor-pointer items-center justify-center rounded-full text-sm font-medium tabular-nums transition-[background-color,color,transform] duration-300 ease-spring peer-checked:scale-105 peer-checked:bg-ink peer-checked:text-white peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ink ${
                          taken
                            ? "bg-accent-soft text-accent-strong"
                            : "bg-sunken text-ink hover:bg-line-strong"
                        }`}
                      >
                        {n}
                      </span>
                      <span className="sr-only">
                        {taken ? " (already taken)" : ""}
                        {n === suggestedWeek ? " (this week)" : ""}
                      </span>
                    </label>
                  );
                })}
              </div>
              <p className="mt-3 text-sm text-muted">
                {suggestedWeek === null
                  ? "No start date is set, so no week is suggested."
                  : `By the start date, this is week ${suggestedWeek}.`}{" "}
                {sessionWeeks.length > 0 && "Green weeks were already taken."}
                {reopening &&
                  ` Starting week ${week} reopens it and keeps its records.`}
              </p>
            </fieldset>

            <div className="mt-5 flex flex-wrap items-center gap-2">
              <Button type="submit" arrow disabled={pending}>
                {pending
                  ? "Starting…"
                  : `${reopening ? "Reopen" : "Start"} week ${week}`}
              </Button>
              <Button
                variant="ghost"
                disabled={pending}
                onClick={() => setOpen(false)}
              >
                Cancel
              </Button>
            </div>
          </form>
        </div>
      )}

      {state?.error && (
        <p role="alert" className="w-full text-sm text-danger">
          {state.error}{" "}
          {state.activeSessionId && (
            <Link
              href={`/sessions/${state.activeSessionId}`}
              className="font-medium underline underline-offset-4"
            >
              Open it
            </Link>
          )}
        </p>
      )}
    </>
  );
}
