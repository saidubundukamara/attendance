import Link from "next/link";
import { notFound } from "next/navigation";
import { BackLink } from "@/components/ui/back-link";
import { ArrowRight } from "@/components/ui/icons";
import { Notice } from "@/components/ui/notice";
import { RichText } from "@/components/ui/rich-text";
import { requireLecturer } from "@/lib/auth";
import {
  getAssignmentDetail,
  hasSubmissions,
  type RosterEntry,
} from "@/lib/data/assignments";
import { db } from "@/lib/db";
import { driveFileUrl, driveFolderUrl } from "@/lib/google/drive";
import {
  appTimeZone,
  formatDeadline,
  localInputToMs,
  msToLocalInput,
  relativeToNow,
} from "@/lib/timezone";
import { AssignmentForm } from "../../assignment-form";
import { CopyLinkButton } from "../../copy-link-button";
import {
  DeleteButton,
  OpenToggle,
  RemoveSubmissionButton,
  ResyncButton,
} from "./controls";
import { DeadlineEditor } from "./deadline-editor";

export const metadata = { title: "Assignment — Attendance" };

const FILTERS = {
  all: { label: "All", empty: "No students on this class.", test: () => true },
  missing: {
    label: "Missing",
    empty: "Everyone has submitted.",
    test: (e: RosterEntry) => !e.submission,
  },
  submitted: {
    label: "Submitted",
    empty: "Nobody has submitted yet.",
    test: (e: RosterEntry) => Boolean(e.submission),
  },
  late: {
    label: "Late",
    empty: "No late submissions.",
    test: (e: RosterEntry) => Boolean(e.submission?.late),
  },
} as const;
type Filter = keyof typeof FILTERS;

// The confirmation names everyone a removal would affect.
function removeQuestion(entry: RosterEntry): string {
  const everyone = [entry.name, ...(entry.submission?.groupmates ?? [])];
  const tail =
    "The files go to the Drive trash and they can submit again.";
  if (everyone.length === 1) return `Remove ${entry.name}'s submission? ${tail}`;
  const names = `${everyone.slice(0, -1).join(", ")} and ${everyone.at(-1)}`;
  return `Remove this submission for ${names}? ${tail}`;
}

function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default async function AssignmentPage({
  params,
  searchParams,
}: {
  params: Promise<{ classId: string; assignmentId: string }>;
  searchParams: Promise<{ show?: string; edit?: string }>;
}) {
  await requireLecturer();
  const { classId, assignmentId } = await params;
  const { show, edit } = await searchParams;
  const detail = /^\d+$/.test(assignmentId)
    ? await getAssignmentDetail(db, Number(assignmentId))
    : null;
  if (!detail || String(detail.assignment.classId) !== classId) notFound();

  const { assignment, roster } = detail;
  const timeZone = appTimeZone();
  const now = new Date().getTime();
  const filter: Filter = show && show in FILTERS ? (show as Filter) : "all";
  const shown = roster.filter(FILTERS[filter].test);
  const submitted = roster.filter((e) => e.submission).length;
  const late = roster.filter((e) => e.submission?.late).length;
  const anyStarted = submitted > 0;
  // Includes uploads still in progress, matching what updateAssignment checks.
  const groupLocked = anyStarted || (await hasSubmissions(db, assignment.id));

  // One-press extensions. From the current deadline while it is ahead;
  // once it has passed, from tonight at 23:59 so the options are sensible.
  const DAY = 86_400_000;
  const base =
    assignment.dueAt > now
      ? assignment.dueAt
      : (localInputToMs(
          `${msToLocalInput(now, timeZone).slice(0, 10)}T23:59`,
          timeZone,
        ) ?? now);
  const quick = [
    { label: "+1 day", days: 1 },
    { label: "+3 days", days: 3 },
    { label: "+1 week", days: 7 },
  ].map(({ label, days }) => {
    const ms = base + days * DAY;
    return { label, ms, detail: formatDeadline(ms, timeZone) };
  });

  return (
    <div className="stagger">
      <div>
        <BackLink href={`/classes/${classId}`}>{detail.classCode}</BackLink>
        <h1 className="mt-4 text-4xl font-semibold tracking-tight">
          {assignment.title}
        </h1>
        <DeadlineEditor
          assignmentId={assignment.id}
          label={`Due ${formatDeadline(assignment.dueAt, timeZone)}`}
          status={
            !assignment.open
              ? { text: "Closed", tone: "muted" }
              : now > assignment.dueAt
                ? { text: "Deadline passed · accepting late work", tone: "warn" }
                : { text: `Open · closes ${relativeToNow(assignment.dueAt, now)}`, tone: "ok" }
          }
          value={msToLocalInput(assignment.dueAt, timeZone)}
          timeZone={timeZone}
          quick={quick}
        />
        {assignment.groupWork && (
          <p className="mt-2 text-sm text-muted">
            Group work · up to {assignment.maxGroupSize} per group. One student
            submits for everyone listed.
          </p>
        )}
        {assignment.instructions && (
          // Folded so long instructions don't push the roster down.
          <details className="group mt-3">
            <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 text-sm font-medium text-muted transition-colors duration-200 hover:text-ink [&::-webkit-details-marker]:hidden">
              <ArrowRight className="size-3 transition-transform duration-200 group-open:rotate-90" />
              Instructions students see
            </summary>
            <RichText
              text={assignment.instructions}
              className="mt-3 rounded-2xl bg-surface p-4 text-sm ring-1 ring-line"
            />
          </details>
        )}
      </div>

      <div
        className="mt-6 flex flex-wrap items-center gap-3"
        style={{ "--i": 1 } as React.CSSProperties}
      >
        <OpenToggle id={assignment.id} open={assignment.open} />
        <Link
          href="?edit=1#edit"
          className="inline-flex h-8 items-center rounded-full px-3.5 text-sm font-medium ring-1 ring-line-strong ring-inset transition-colors duration-200 hover:bg-sunken"
        >
          Edit details
        </Link>
        <CopyLinkButton url={`${process.env.APP_URL ?? ""}/submit`} />
        {assignment.driveFolderId && (
          <a
            href={driveFolderUrl(assignment.driveFolderId)}
            target="_blank"
            rel="noreferrer"
            className="text-sm font-medium underline-offset-4 hover:underline"
          >
            Open Drive folder
          </a>
        )}
      </div>

      {detail.sheetError && (
        <Notice
          tone="danger"
          className="mt-6"
          action={<ResyncButton classId={assignment.classId} />}
        >
          {detail.sheetError}
        </Notice>
      )}

      <section className="mt-10" style={{ "--i": 2 } as React.CSSProperties}>
        <div className="flex flex-wrap items-baseline justify-between gap-4">
          <h2 className="text-lg font-semibold tracking-tight">
            <span className="tabular-nums">{submitted}</span>
            <span className="font-normal text-muted">
              {" "}
              of {roster.length} submitted
            </span>
            {late > 0 && (
              <span className="ml-2 font-normal text-warn">{late} late</span>
            )}
          </h2>
          <nav aria-label="Filter" className="flex gap-1">
            {(Object.keys(FILTERS) as Filter[]).map((key) => (
              <Link
                key={key}
                href={key === "all" ? "?" : `?show=${key}`}
                aria-current={filter === key ? "page" : undefined}
                className={`h-8 rounded-full px-3 text-sm leading-8 transition-colors duration-200 ${filter === key ? "bg-ink text-white" : "text-muted hover:bg-ink/5 hover:text-ink"}`}
              >
                {FILTERS[key].label}
              </Link>
            ))}
          </nav>
        </div>

        {shown.length === 0 ? (
          <p className="mt-6 text-muted">{FILTERS[filter].empty}</p>
        ) : (
          <ul className="mt-5 divide-y divide-line overflow-hidden rounded-2xl bg-surface shadow-soft ring-1 ring-line">
            {shown.map((entry) => (
              <li
                key={entry.id}
                className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2 px-4 py-3"
              >
                <div className="min-w-0">
                  <p className="font-medium">
                    {entry.name}
                    {!entry.active && (
                      <span className="ml-2 text-xs font-normal text-muted">
                        (no longer on roster)
                      </span>
                    )}
                  </p>
                  <p className="font-mono text-xs text-muted">
                    {entry.studentId}
                  </p>
                  {entry.submission?.submittedBy ? (
                    <p className="mt-1 text-sm text-muted">
                      Submitted by {entry.submission.submittedBy}
                    </p>
                  ) : entry.submission?.groupmates.length ? (
                    <p className="mt-1 text-sm text-muted">
                      For the group, with {entry.submission.groupmates.join(", ")}
                    </p>
                  ) : null}
                </div>
                {entry.submission ? (
                  <div className="text-right text-sm">
                    <p>
                      {entry.submission.late && (
                        <span className="mr-2 rounded-full bg-warn-soft px-2 py-0.5 text-xs font-semibold text-warn">
                          LATE
                        </span>
                      )}
                      <span className="text-muted">
                        {formatDeadline(entry.submission.submittedAt, timeZone)}
                      </span>
                    </p>
                    <ul className="mt-1 space-y-0.5">
                      {entry.submission.files.map((file) => (
                        <li key={file.driveFileId}>
                          <a
                            href={driveFileUrl(file.driveFileId)}
                            target="_blank"
                            rel="noreferrer"
                            className="font-medium underline-offset-4 hover:underline"
                          >
                            {file.name}
                          </a>
                          <span className="ml-1.5 text-xs text-muted">
                            {formatSize(file.size)}
                          </span>
                        </li>
                      ))}
                    </ul>
                    <RemoveSubmissionButton
                      submissionId={entry.submission.id}
                      question={removeQuestion(entry)}
                    />
                  </div>
                ) : (
                  <span className="text-sm text-muted">Not submitted</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section
        className="mt-14 border-t border-line pt-8"
        style={{ "--i": 3 } as React.CSSProperties}
      >
        <details id="edit" className="group scroll-mt-24" open={edit === "1"}>
          <summary className="inline-flex cursor-pointer list-none items-center gap-2 text-lg font-semibold tracking-tight [&::-webkit-details-marker]:hidden">
            Edit details
            <span className="text-sm font-normal text-muted group-open:hidden">
              title, type, deadline, group, instructions
            </span>
          </summary>
          <p className="mt-1 max-w-prose text-sm text-muted">
            Moving the deadline re-checks which submissions count as late.
          </p>
          <AssignmentForm
            classId={assignment.classId}
            assignmentId={assignment.id}
            timeZone={timeZone}
            values={{
              title: assignment.title,
              kind: assignment.kind,
              dueAt: msToLocalInput(assignment.dueAt, timeZone),
              instructions: assignment.instructions ?? "",
              groupWork: assignment.groupWork,
              maxGroupSize: assignment.maxGroupSize ?? 4,
            }}
            groupLocked={groupLocked}
          />
        </details>
        <div className="mt-10 flex flex-wrap items-center gap-6">
          <ResyncButton classId={assignment.classId} />
          {!anyStarted && <DeleteButton id={assignment.id} />}
        </div>
      </section>
    </div>
  );
}
