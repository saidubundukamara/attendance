"use client";

import { useActionState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { inputClass, Label } from "@/components/ui/field";
import {
  createAssignment,
  updateAssignment,
} from "@/lib/actions/assignments";

type Values = {
  title: string;
  kind: "ASSIGNMENT" | "CLASSWORK" | "PROJECT";
  dueAt: string;
  instructions: string;
};

// Adds an item to a class, or edits one when `assignmentId` is given.
export function AssignmentForm({
  classId,
  assignmentId,
  values,
  timeZone,
}: {
  classId: number;
  assignmentId?: number;
  values: Values;
  timeZone: string;
}) {
  const editing = assignmentId !== undefined;
  const [state, action, pending] = useActionState(
    editing ? updateAssignment : createAssignment,
    undefined,
  );
  const form = useRef<HTMLFormElement>(null);

  // A new item was added: clear the title for the next one.
  useEffect(() => {
    if (!editing && state?.ok && form.current) {
      const title = form.current.elements.namedItem("title");
      if (title instanceof HTMLInputElement) title.value = "";
      const notes = form.current.elements.namedItem("instructions");
      if (notes instanceof HTMLTextAreaElement) notes.value = "";
    }
  }, [editing, state]);

  const prefix = editing ? `edit-${assignmentId}` : "new";

  return (
    <form ref={form} action={action} className="mt-5 grid gap-4 sm:grid-cols-2">
      <input type="hidden" name="classId" value={classId} />
      {editing && (
        <input type="hidden" name="assignmentId" value={assignmentId} />
      )}
      <div className="sm:col-span-2">
        <Label htmlFor={`${prefix}-title`}>Title</Label>
        <input
          id={`${prefix}-title`}
          name="title"
          required
          maxLength={100}
          defaultValue={values.title}
          placeholder="Assignment 1"
          className={`${inputClass} w-full`}
        />
      </div>
      <div>
        <Label htmlFor={`${prefix}-kind`}>Type</Label>
        <select
          id={`${prefix}-kind`}
          name="kind"
          defaultValue={values.kind}
          className={`${inputClass} w-full`}
        >
          <option value="ASSIGNMENT">Assignment</option>
          <option value="CLASSWORK">Classwork</option>
          <option value="PROJECT">Project</option>
        </select>
      </div>
      <div>
        <Label htmlFor={`${prefix}-dueAt`}>Deadline ({timeZone})</Label>
        <input
          id={`${prefix}-dueAt`}
          name="dueAt"
          type="datetime-local"
          required
          defaultValue={values.dueAt}
          className={`${inputClass} w-full`}
        />
      </div>
      <div className="sm:col-span-2">
        <Label htmlFor={`${prefix}-instructions`}>
          Instructions <span className="font-normal text-muted">(optional)</span>
        </Label>
        <textarea
          id={`${prefix}-instructions`}
          name="instructions"
          rows={6}
          maxLength={2000}
          aria-describedby={`${prefix}-instructions-hint`}
          defaultValue={values.instructions}
          className={`${inputClass} h-auto w-full py-2.5`}
        />
        <p id={`${prefix}-instructions-hint`} className="mt-1.5 text-xs text-muted">
          Paste from Word or type freely. **Bold**, *italic*, numbered and
          bulleted lists show formatted to students.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-4 sm:col-span-2">
        <Button type="submit" size="lg" className="h-11" disabled={pending}>
          {pending ? "Saving…" : editing ? "Save changes" : "Add assignment"}
        </Button>
        {state && (
          <p
            role="status"
            className={`animate-rise text-sm ${state.ok ? "text-accent-strong" : "text-danger"}`}
          >
            {state.message}
          </p>
        )}
      </div>
    </form>
  );
}
