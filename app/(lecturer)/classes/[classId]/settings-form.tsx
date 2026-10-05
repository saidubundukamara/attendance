"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { inputClass, Label } from "@/components/ui/field";
import { updateClassSettings } from "@/lib/actions/classes";

export function SettingsForm({
  classId,
  startDate,
  totalWeeks,
}: {
  classId: number;
  startDate: string;
  totalWeeks: number;
}) {
  const [state, action, pending] = useActionState(
    updateClassSettings,
    undefined,
  );

  return (
    <form action={action} className="mt-5 flex flex-wrap items-end gap-4">
      <input type="hidden" name="classId" value={classId} />
      <div>
        <Label htmlFor="startDate">Week 1 starts on</Label>
        <input
          id="startDate"
          name="startDate"
          type="date"
          defaultValue={startDate}
          className={inputClass}
        />
      </div>
      <div>
        <Label htmlFor="totalWeeks">Teaching weeks</Label>
        <input
          id="totalWeeks"
          name="totalWeeks"
          type="number"
          min={1}
          max={52}
          required
          defaultValue={totalWeeks}
          className={`${inputClass} w-24 tabular-nums`}
        />
      </div>
      <Button type="submit" size="lg" className="h-11" disabled={pending}>
        {pending ? "Saving…" : "Save"}
      </Button>
      {state && (
        <p
          role="status"
          className={`animate-rise self-center text-sm ${state.ok ? "text-accent-strong" : "text-danger"}`}
        >
          {state.message}
        </p>
      )}
    </form>
  );
}
