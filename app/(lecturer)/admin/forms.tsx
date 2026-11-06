"use client";

import { useActionState, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { ConfirmButton } from "@/components/ui/confirm-button";
import { inputClass, Label } from "@/components/ui/field";
import {
  type AdminState,
  approveEmailAction,
  createCohortAction,
  deleteCohortAction,
  renameCohortAction,
  revokeEmailAction,
} from "@/lib/actions/admin";

function Message({ state }: { state: AdminState }) {
  if (!state) return null;
  return (
    <p
      role="status"
      className={`animate-rise self-center text-sm ${state.ok ? "text-accent-strong" : "text-danger"}`}
    >
      {state.message}
    </p>
  );
}

export function ApproveForm() {
  const [state, action, pending] = useActionState(approveEmailAction, undefined);
  return (
    <form action={action} className="flex flex-wrap items-end gap-3">
      <div className="min-w-0 flex-1 basis-64">
        <Label htmlFor="approve-email">Lecturer&apos;s Google email</Label>
        <input
          id="approve-email"
          name="email"
          type="email"
          required
          autoComplete="off"
          placeholder="name@gmail.com"
          className={`${inputClass} w-full`}
        />
      </div>
      <Button type="submit" size="lg" className="h-11" disabled={pending}>
        {pending ? "Approving…" : "Approve"}
      </Button>
      <Message state={state} />
    </form>
  );
}

export function RevokeButton({ email }: { email: string }) {
  const [state, setState] = useState<AdminState>(undefined);
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <ConfirmButton
        size="sm"
        label="Remove access"
        question={`Stop ${email} signing in?`}
        confirmLabel="Remove"
        pendingLabel="Removing…"
        pending={pending}
        onConfirm={() => start(async () => setState(await revokeEmailAction(email)))}
      />
      {state && !state.ok && <Message state={state} />}
    </div>
  );
}

export function CreateCohortForm() {
  const [state, action, pending] = useActionState(createCohortAction, undefined);
  return (
    <form action={action} className="flex flex-wrap items-end gap-3">
      <div className="min-w-0 flex-1 basis-64">
        <Label htmlFor="cohort-name">New cohort</Label>
        <input
          id="cohort-name"
          name="name"
          required
          maxLength={80}
          autoComplete="off"
          placeholder="e.g. BSEM Year 1"
          className={`${inputClass} w-full`}
        />
      </div>
      <Button type="submit" size="lg" className="h-11" disabled={pending}>
        {pending ? "Adding…" : "Add cohort"}
      </Button>
      <Message state={state} />
    </form>
  );
}

export function CohortRow({
  id,
  name,
  moduleCount,
}: {
  id: number;
  name: string;
  moduleCount: number;
}) {
  const [state, action, pending] = useActionState(renameCohortAction, undefined);
  const [deleteState, setDeleteState] = useState<AdminState>(undefined);
  const [deleting, start] = useTransition();
  return (
    <li className="flex flex-wrap items-center gap-3 py-4">
      <form action={action} className="flex min-w-0 flex-1 basis-72 flex-wrap items-center gap-3">
        <input type="hidden" name="id" value={id} />
        <label className="sr-only" htmlFor={`cohort-${id}`}>
          Cohort name
        </label>
        <input
          id={`cohort-${id}`}
          name="name"
          defaultValue={name}
          required
          maxLength={80}
          className={`${inputClass} min-w-0 flex-1`}
        />
        <Button type="submit" variant="secondary" size="sm" disabled={pending}>
          {pending ? "Saving…" : "Rename"}
        </Button>
        <Message state={state} />
      </form>
      <span className="text-sm text-muted tabular-nums">
        {moduleCount} {moduleCount === 1 ? "module" : "modules"}
      </span>
      {moduleCount === 0 && (
        <ConfirmButton
          size="sm"
          label="Delete"
          question={`Delete “${name}”?`}
          confirmLabel="Delete"
          pendingLabel="Deleting…"
          pending={deleting}
          onConfirm={() => start(async () => setDeleteState(await deleteCohortAction(id)))}
        />
      )}
      {deleteState && !deleteState.ok && <Message state={deleteState} />}
    </li>
  );
}
