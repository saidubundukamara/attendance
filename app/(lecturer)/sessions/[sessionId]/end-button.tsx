"use client";

import { useFormStatus } from "react-dom";
import { ConfirmButton } from "@/components/ui/confirm-button";
import { endSession } from "@/lib/actions/sessions";

function Confirm({ week }: { week: number }) {
  const { pending } = useFormStatus();
  return (
    <ConfirmButton
      type="submit"
      label="End attendance"
      question={`End week ${week} check-in?`}
      confirmLabel="End attendance"
      pendingLabel="Ending…"
      pending={pending}
    />
  );
}

export function EndButton({
  sessionId,
  week,
}: {
  sessionId: string;
  week: number;
}) {
  return (
    <form action={endSession}>
      <input type="hidden" name="sessionId" value={sessionId} />
      <Confirm week={week} />
    </form>
  );
}
