"use client";

import { useActionState, useEffect, useRef, useState } from "react";
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
  groupWork: boolean;
  maxGroupSize: number;
};

// Adds an item to a class, or edits one when `assignmentId` is given.
export function AssignmentForm({
  classId,
  assignmentId,
  values,
  timeZone,
  groupLocked = false,
}: {
  classId: number;
  assignmentId?: number;
  values: Values;
  timeZone: string;
  // True once anyone has handed in: group settings can no longer change.
  groupLocked?: boolean;
}) {
  const editing = assignmentId !== undefined;
  const [state, action, pending] = useActionState(
    editing ? updateAssignment : createAssignment,
    undefined,
  );
  const form = useRef<HTMLFormElement>(null);
  const [groupWork, setGroupWork] = useState(values.groupWork);
  // On a new item the box follows the type (Projects are group work) until
  // the lecturer ticks or unticks it themselves.
  const [groupTouched, setGroupTouched] = useState(editing);

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
          onChange={(event) => {
            if (!groupTouched && !groupLocked) {
              setGroupWork(event.target.value === "PROJECT");
            }
          }}
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
      <fieldset className="sm:col-span-2" disabled={groupLocked}>
        <legend className="sr-only">Group work</legend>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
          <label className="inline-flex min-h-10 cursor-pointer items-center gap-2.5 text-sm font-medium">
            <input
              type="checkbox"
              name="groupWork"
              checked={groupWork}
              onChange={(event) => {
                setGroupTouched(true);
                setGroupWork(event.target.checked);
              }}
              className="size-4 accent-accent"
            />
            Group work
          </label>
          {groupWork && (
            <label className="inline-flex items-center gap-2.5 text-sm">
              Up to
              <input
                type="number"
                name="maxGroupSize"
                min={2}
                max={10}
                required
                defaultValue={values.maxGroupSize}
                className={`${inputClass} w-20 tabular-nums`}
              />
              people per group
            </label>
          )}
        </div>
        <p className="mt-1.5 text-xs text-muted">
          {groupLocked
            ? "Fixed now that students have started handing in."
            : groupWork
              ? "One student submits for the group and adds the others by ID. Everyone listed is marked as submitted."
              : "Each student submits their own work."}
        </p>
      </fieldset>
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
