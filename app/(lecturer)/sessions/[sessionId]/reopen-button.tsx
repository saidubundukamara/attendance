"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { startSession } from "@/lib/actions/sessions";

export function ReopenButton({
  classId,
  week,
}: {
  classId: number;
  week: number;
}) {
  const [state, action, pending] = useActionState(startSession, undefined);

  return (
    <form action={action} className="flex flex-wrap items-center gap-3">
      <input type="hidden" name="classId" value={classId} />
      <input type="hidden" name="week" value={week} />
      <Button type="submit" variant="secondary" disabled={pending}>
        {pending ? "Reopening…" : "Reopen attendance"}
      </Button>
      {state?.error && (
        <p role="alert" className="text-sm text-danger">
          {state.error}
        </p>
      )}
    </form>
  );
}
