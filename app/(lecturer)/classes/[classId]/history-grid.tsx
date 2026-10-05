"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { inputClass } from "@/components/ui/field";
import { Plus } from "@/components/ui/icons";
import { markClass, MarkIcon, markLabel } from "@/components/ui/status";
import { setAttendanceAction } from "@/lib/actions/attendance";
import { recordPastWeekAction } from "@/lib/actions/sessions";
import type { ClassHistory, HistoryStudent, HistoryWeek } from "@/lib/data/history";

const dateFormat = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
});
const timeFormat = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
});

type Selection = { student: HistoryStudent; week: HistoryWeek };

export function HistoryGrid({
  classId,
  history,
}: {
  classId: number;
  history: ClassHistory;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Selection | null>(null);
  // The untaken week waiting for a second press before it is recorded.
  const [recording, setRecording] = useState<number | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(task: () => Promise<{ ok: boolean; error?: string }>) {
    setBusy(true);
    setError(null);
    try {
      const result = await task();
      if (!result.ok) setError(result.error ?? "Something went wrong.");
      else {
        setSelected(null);
        setRecording(null);
      }
      router.refresh();
    } catch {
      setError("Could not save the change. Check the connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  function mark(status: "PRESENT" | "ABSENT") {
    if (!selected?.week.session) return;
    const { student, week } = selected;
    return run(() =>
      setAttendanceAction({
        sessionId: week.session!.id,
        studentId: student.id,
        status,
        reason: reason.trim() || undefined,
      }),
    );
  }

  function recordWeek(week: number) {
    return run(() => recordPastWeekAction(classId, week));
  }

  if (history.students.length === 0) {
    return (
      <p className="mt-6 max-w-md text-muted">
        No students with an ID in this tab yet. Add them in the Google Sheet,
        then sync the roster from the classes page.
      </p>
    );
  }

  const current = selected?.student.cells[selected.week.week] ?? null;

  return (
    <div className="mt-4">
      {error && (
        <p role="alert" className="mb-3 text-sm text-danger">
          {error}
        </p>
      )}

      {/* One bar, three jobs: hint, cell editor, and record-by-hand confirm. */}
      <div className="flex min-h-14 items-center">
        {selected ? (
          <div
            key={`${selected.student.id}:${selected.week.week}`}
            className="flex w-full animate-rise flex-wrap items-center gap-2 rounded-2xl bg-surface p-2 pl-4 text-sm shadow-soft ring-1 ring-line"
          >
            <p className="mr-2">
              <span className="font-medium">
                {selected.student.name || selected.student.studentId}
              </span>
              <span className="text-muted">
                {" "}
                · Week {selected.week.week} · {markLabel(current)}
              </span>
            </p>
            <input
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              maxLength={200}
              placeholder="Reason (optional)"
              aria-label="Reason for the change"
              className={`${inputClass} h-9 min-w-0 flex-1 basis-40 text-sm`}
            />
            {current !== "PRESENT" && (
              <Button
                variant="accent"
                size="sm"
                disabled={busy}
                onClick={() => mark("PRESENT")}
              >
                Mark present
              </Button>
            )}
            {current !== "ABSENT" && (
              <Button
                variant="destructive"
                size="sm"
                disabled={busy}
                onClick={() => mark("ABSENT")}
              >
                Mark absent
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => setSelected(null)}
            >
              Cancel
            </Button>
          </div>
        ) : recording !== null ? (
          <div
            role="group"
            aria-label={`Record week ${recording} by hand`}
            className="flex w-full animate-rise flex-wrap items-center gap-2 rounded-2xl bg-surface p-2 pl-4 text-sm shadow-soft ring-1 ring-line"
          >
            <p className="mr-2 min-w-0 flex-1 basis-64">
              <span className="font-medium">Record week {recording} by hand?</span>
              <span className="text-muted">
                {" "}
                It is added with nobody marked. Nothing reaches the Google
                Sheet until you mark a student.
              </span>
            </p>
            <Button
              size="sm"
              disabled={busy}
              onClick={() => recordWeek(recording)}
            >
              {busy ? "Adding…" : "Add week"}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => setRecording(null)}
            >
              Cancel
            </Button>
          </div>
        ) : (
          <p className="text-sm text-muted">
            Select a cell to correct it. Use the plus under a week that was not
            taken in the app to fill it in by hand.
          </p>
        )}
      </div>

      <div className="mt-2 overflow-x-auto rounded-2xl bg-surface shadow-soft ring-1 ring-line">
        <table className="w-full border-collapse text-sm">
          <thead className="text-muted">
            <tr className="border-b border-line">
              <th className="sticky left-0 z-10 bg-surface px-4 py-3 text-left font-medium">
                Student
              </th>
              <th className="hidden px-3 py-3 text-left font-medium sm:table-cell">ID</th>
              {history.weeks.map((week) => (
                <th key={week.week} className="px-1 py-3 text-center font-medium tabular-nums">
                  {week.session ? (
                    <Link
                      href={`/sessions/${week.session.id}`}
                      className={`underline-offset-4 hover:underline ${week.session.status === "ACTIVE" ? "text-accent-strong" : "text-ink"}`}
                      title={`Open Week ${week.week}`}
                    >
                      W{week.week}
                    </Link>
                  ) : (
                    <span className="text-faint">W{week.week}</span>
                  )}
                </th>
              ))}
              <th className="px-4 py-3 text-right font-medium">Present</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {history.students.map((student) => (
              <tr key={student.id}>
                <th
                  scope="row"
                  className="sticky left-0 z-10 max-w-36 truncate bg-surface sm:max-w-56 px-4 py-1.5 text-left font-normal"
                >
                  <Link
                    href={`/students/${student.studentId}`}
                    className="underline-offset-4 hover:underline"
                  >
                    {student.name || "—"}
                  </Link>
                  {!student.active && (
                    <span className="ml-1 text-xs text-muted">(left)</span>
                  )}
                </th>
                <td className="hidden px-3 py-1.5 text-muted tabular-nums sm:table-cell">
                  {student.studentId}
                </td>
                {history.weeks.map((week) => {
                  const status = student.cells[week.week];
                  if (!week.session) {
                    return <td key={week.week} className="px-1 py-1.5" />;
                  }
                  const isSelected =
                    selected?.student.id === student.id &&
                    selected.week.week === week.week;
                  return (
                    <td key={week.week} className="px-1 py-1">
                      <button
                        type="button"
                        onClick={() => {
                          setRecording(null);
                          setSelected({ student, week });
                        }}
                        aria-label={`${student.name}, week ${week.week}: ${markLabel(status).toLowerCase()}`}
                        aria-pressed={isSelected}
                        className={`mx-auto flex size-7 items-center justify-center rounded-full transition-transform duration-300 ease-spring hover:scale-110 active:scale-95 ${markClass(status)} ${
                          isSelected ? "scale-110 ring-2 ring-ink ring-offset-2" : ""
                        }`}
                      >
                        <MarkIcon mark={status} />
                      </button>
                    </td>
                  );
                })}
                <td className="px-4 py-1.5 text-right tabular-nums">
                  {student.present}
                  {student.percent !== null && (
                    <span className="text-muted"> · {student.percent}%</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot className="border-t border-line bg-canvas text-xs text-muted">
            <SummaryRow label="Present" weeks={history.weeks} value={(w) => (w.session ? w.present : "")} />
            <SummaryRow label="Absent" weeks={history.weeks} value={(w) => (w.session ? w.absent : "")} />
            <SummaryRow
              label="Attendance"
              weeks={history.weeks}
              value={(w) => (w.percent === null ? "" : `${w.percent}%`)}
            />
            <SummaryRow
              label="Date"
              weeks={history.weeks}
              value={(w) => (w.session ? dateFormat.format(w.session.startedAt) : "")}
            />
            <SummaryRow
              label="Start – end"
              weeks={history.weeks}
              value={(w) =>
                w.session
                  ? `${timeFormat.format(w.session.startedAt)}–${
                      w.session.endedAt ? timeFormat.format(w.session.endedAt) : "open"
                    }`
                  : ""
              }
            />
            <tr>
              <th scope="row" className="sticky left-0 bg-canvas px-4 py-1.5 text-left font-medium whitespace-nowrap">
                Not taken
              </th>
              <td className="hidden sm:table-cell" />
              {history.weeks.map((week) => (
                <td key={week.week} className="px-1 py-1.5 text-center">
                  {!week.session && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        setSelected(null);
                        setRecording(week.week);
                      }}
                      title={`Record Week ${week.week} by hand`}
                      aria-label={`Record week ${week.week} by hand`}
                      className="mx-auto flex size-6 items-center justify-center rounded-full bg-surface text-muted ring-1 ring-line-strong transition-[transform,color] duration-300 ease-spring hover:scale-110 hover:text-ink disabled:opacity-50"
                    >
                      <Plus className="size-3" />
                    </button>
                  )}
                </td>
              ))}
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

function SummaryRow({
  label,
  weeks,
  value,
}: {
  label: string;
  weeks: HistoryWeek[];
  value: (week: HistoryWeek) => string | number;
}) {
  return (
    <tr>
      <th scope="row" className="sticky left-0 bg-canvas px-4 py-1.5 text-left font-medium whitespace-nowrap">
        {label}
      </th>
      <td className="hidden sm:table-cell" />
      {weeks.map((week) => (
        <td
          key={week.week}
          className="whitespace-nowrap px-1 py-1.5 text-center tabular-nums"
          suppressHydrationWarning
        >
          {value(week)}
        </td>
      ))}
      <td />
    </tr>
  );
}
