"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { ConfirmButton } from "@/components/ui/confirm-button";
import { Refresh } from "@/components/ui/icons";
import {
  deleteAssignment,
  removeSubmissionAction,
  resyncSubmissionsSheet,
  setAssignmentOpen,
} from "@/lib/actions/assignments";

export function OpenToggle({ id, open }: { id: number; open: boolean }) {
  const [pending, start] = useTransition();
  if (open) {
    return (
      <ConfirmButton
        label="Close submissions"
        question="Stop accepting submissions?"
        confirmLabel="Close"
        pendingLabel="Closing…"
        pending={pending}
        size="sm"
        onConfirm={() => start(() => setAssignmentOpen(id, false))}
      />
    );
  }
  return (
    <Button
      size="sm"
      variant="secondary"
      disabled={pending}
      onClick={() => start(() => setAssignmentOpen(id, true))}
    >
      {pending ? "Reopening…" : "Reopen submissions"}
    </Button>
  );
}

export function DeleteButton({ id }: { id: number }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex flex-wrap items-center gap-3">
      <ConfirmButton
        label="Delete item"
        question="Delete this item?"
        confirmLabel="Delete"
        pendingLabel="Deleting…"
        pending={pending}
        size="sm"
        onConfirm={() =>
          start(async () => {
            const result = await deleteAssignment(id);
            if (result) setError(result.error);
          })
        }
      />
      {error && <p className="text-sm text-danger">{error}</p>}
    </div>
  );
}

// Asks first; only the confirm press removes anything.
export function RemoveSubmissionButton({
  submissionId,
  question,
}: {
  submissionId: number;
  question: string;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="mt-2 flex flex-wrap items-center justify-end gap-3">
      <ConfirmButton
        label="Remove"
        question={question}
        confirmLabel="Remove"
        pendingLabel="Removing…"
        pending={pending}
        size="sm"
        onConfirm={() =>
          start(async () => {
            const result = await removeSubmissionAction(submissionId);
            if (result) setError(result.error);
          })
        }
      />
      {error && <p className="text-sm text-danger">{error}</p>}
    </div>
  );
}

export function ResyncButton({ classId }: { classId: number }) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; message: string }>();
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button
        size="sm"
        variant="secondary"
        disabled={pending}
        onClick={() =>
          start(async () => setResult(await resyncSubmissionsSheet(classId)))
        }
      >
        <Refresh className={`size-3.5 ${pending ? "animate-spin" : ""}`} />
        {pending ? "Updating…" : "Update sheet"}
      </Button>
      {result && (
        <p
          role="status"
          className={`text-sm ${result.ok ? "text-accent-strong" : "text-danger"}`}
        >
          {result.message}
        </p>
      )}
    </div>
  );
}
