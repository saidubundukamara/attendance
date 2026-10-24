"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { inputClass } from "@/components/ui/field";
import { type DeadlineState, updateDeadline } from "@/lib/actions/assignments";

// The deadline under the item's title, with a Change button that opens a
// small form in place: a picker plus one-press extensions.
export function DeadlineEditor({
  assignmentId,
  label,
  status,
  value,
  timeZone,
  quick,
}: {
  assignmentId: number;
  // "Due Sat 31 Oct, 18:47", formatted on the server.
  label: string;
  status: { text: string; tone: "ok" | "warn" | "muted" };
  // The current deadline as a datetime-local value.
  value: string;
  timeZone: string;
  quick: { label: string; detail: string; ms: number }[];
}) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(
    async (prev: DeadlineState, formData: FormData) => {
      const result = await updateDeadline(prev, formData);
      // Close once saved; the page re-renders with the new deadline.
      if (result?.ok) setOpen(false);
      return result;
    },
    undefined,
  );

  const tone =
    status.tone === "ok"
      ? "text-accent-strong"
      : status.tone === "warn"
        ? "text-warn"
        : "text-muted";

  if (!open) {
    return (
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-2">
        <p className="text-lg text-muted">
          {label} · <span className={tone}>{status.text}</span>
        </p>
        <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
          Change deadline
        </Button>
        {state?.ok && (
          <p role="status" className="animate-rise text-sm text-accent-strong">
            {state.message}
          </p>
        )}
      </div>
    );
  }

  return (
    <form
      action={action}
      className="mt-3 max-w-xl animate-rise rounded-2xl bg-surface p-4 shadow-soft ring-1 ring-line"
      onKeyDown={(event) => {
        if (event.key === "Escape") setOpen(false);
      }}
    >
      <input type="hidden" name="assignmentId" value={assignmentId} />
      <label htmlFor="deadline" className="block text-sm font-medium">
        New deadline <span className="font-normal text-muted">({timeZone})</span>
      </label>
      <div className="mt-1.5 flex flex-wrap items-center gap-2">
        <input
          id="deadline"
          name="dueAt"
          type="datetime-local"
          required
          defaultValue={value}
          autoFocus
          className={`${inputClass} min-w-0 flex-1 basis-56`}
        />
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save"}
        </Button>
        <Button variant="ghost" disabled={pending} onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
      <p className="mt-4 text-sm text-muted">Or extend in one press:</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {quick.map((option) => (
          <button
            key={option.ms}
            type="submit"
            name="quick"
            value={option.ms}
            formNoValidate
            disabled={pending}
            className="rounded-xl bg-sunken px-3 py-2 text-left text-sm transition-colors duration-200 hover:bg-line-strong disabled:opacity-50"
          >
            <span className="font-medium">{option.label}</span>
            <span className="block text-xs text-muted">{option.detail}</span>
          </button>
        ))}
      </div>
      <p className="mt-4 text-xs text-muted">
        Submissions already in are re-checked against the new deadline, so
        late marks update here and in the sheet.
      </p>
      {state && !state.ok && (
        <p role="alert" className="mt-3 text-sm text-danger">
          {state.message}
        </p>
      )}
    </form>
  );
}
