import Link from "next/link";
import { ArrowRight, Plus } from "@/components/ui/icons";
import { Notice } from "@/components/ui/notice";
import type { getClassAssignments } from "@/lib/data/assignments";
import { formatDeadline, msToLocalInput } from "@/lib/timezone";
import { AssignmentForm } from "./assignment-form";
import { ResyncButton } from "./assignments/[assignmentId]/controls";
import { CopyLinkButton } from "./copy-link-button";

const KIND_LABEL = {
  ASSIGNMENT: "Assignment",
  CLASSWORK: "Classwork",
  PROJECT: "Project",
} as const;

// The default deadline offered for a new item: a week from now at 23:59.
function nextWeek(timeZone: string, now: number): string {
  return `${msToLocalInput(now + 7 * 86_400_000, timeZone).slice(0, 10)}T23:59`;
}

export function AssignmentsSection({
  classId,
  classCode,
  items,
  studentCount,
  submitUrl,
  sheetError,
  timeZone,
  now,
}: {
  classId: number;
  classCode: string;
  items: Awaited<ReturnType<typeof getClassAssignments>>;
  studentCount: number;
  submitUrl: string;
  sheetError: string | null;
  timeZone: string;
  now: number;
}) {
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
        <h2 className="text-lg font-semibold tracking-tight">
          Assignments
          <span className="ml-2 font-normal text-muted tabular-nums">
            {items.length}
          </span>
        </h2>
        <CopyLinkButton url={submitUrl} />
      </div>
      <p className="mt-1 max-w-prose text-sm text-muted">
        Students hand in at{" "}
        <a
          href={submitUrl}
          className="font-medium break-all text-ink underline-offset-4 hover:underline"
        >
          {submitUrl.replace(/^https?:\/\//, "")}
        </a>
        . Each submission is logged in the “Subs of {classCode}” tab.
      </p>

      {sheetError && (
        <Notice
          tone="danger"
          className="mt-4"
          action={<ResyncButton classId={classId} />}
        >
          {sheetError}
        </Notice>
      )}

      {items.length === 0 ? (
        <p className="mt-5 text-muted">
          No assignments yet. Add one and students can start handing in.
        </p>
      ) : (
        <ul className="mt-5 divide-y divide-line overflow-hidden rounded-2xl bg-surface shadow-soft ring-1 ring-line">
          {items.map((item) => {
            const overdue = now > item.dueAt;
            const state = !item.open
              ? "Closed"
              : overdue
                ? "Deadline passed · accepting late work"
                : "Open";
            return (
              <li key={item.id}>
                <Link
                  href={`/classes/${classId}/assignments/${item.id}`}
                  className="group flex items-center gap-4 px-4 py-3.5 transition-colors duration-200 hover:bg-sunken"
                >
                  <span className="min-w-0 flex-1">
                    <span className="font-medium">{item.title}</span>
                    <span className="ml-2 text-sm text-muted">
                      {KIND_LABEL[item.kind]}
                    </span>
                    <span className="block text-sm text-muted">
                      <span
                        className={
                          !item.open ? "" : overdue ? "text-warn" : "text-accent-strong"
                        }
                      >
                        {state}
                      </span>{" "}
                      · due {formatDeadline(item.dueAt, timeZone)}
                    </span>
                  </span>
                  <span className="shrink-0 text-right text-sm tabular-nums">
                    <span className="font-medium">{item.submitted}</span>
                    <span className="text-muted">/{studentCount}</span>
                    {item.late > 0 && (
                      <span className="block text-xs text-warn">
                        {item.late} late
                      </span>
                    )}
                  </span>
                  <ArrowRight className="size-3.5 shrink-0 text-muted transition-transform duration-300 ease-spring group-hover:translate-x-0.5" />
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      <details className="group mt-5">
        <summary className="inline-flex h-10 cursor-pointer list-none items-center gap-2 rounded-full bg-surface px-5 text-sm font-medium ring-1 ring-line-strong ring-inset transition-colors duration-200 hover:bg-sunken [&::-webkit-details-marker]:hidden">
          <Plus className="size-3.5 group-open:hidden" />
          <span className="group-open:hidden">New assignment</span>
          <span className="hidden group-open:inline">Close</span>
        </summary>
        <AssignmentForm
          classId={classId}
          timeZone={timeZone}
          values={{
            title: "",
            kind: "ASSIGNMENT",
            dueAt: nextWeek(timeZone, now),
            instructions: "",
          }}
        />
      </details>
    </>
  );
}
