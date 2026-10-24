"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { inputClass } from "@/components/ui/field";
import { Plus } from "@/components/ui/icons";
import { markClass, MarkIcon, markLabel } from "@/components/ui/status";
import { setAttendanceAction } from "@/lib/actions/attendance";
import { recordPastWeekAction } from "@/lib/actions/sessions";
import type { ClassHistory, HistoryStudent, HistoryWeek } from "@/lib/data/history";

type Selection = { student: HistoryStudent; week: HistoryWeek };

// Per-week labels, formatted on the server in the college's time zone.
export type WeekInfo = Record<
  number,
  { date: string | null; times: string | null }
>;

export function HistoryGrid({
  classId,
  history,
  currentWeek,
  weekInfo,
}: {
  classId: number;
  history: ClassHistory;
  // Null when the class has no start date.
  currentWeek: number | null;
  weekInfo: WeekInfo;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Selection | null>(null);
  // The untaken week waiting for a second press before it is recorded.
  const [recording, setRecording] = useState<number | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // True while there are columns hidden off the right edge.
  const [more, setMore] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const firstAction = useRef<HTMLButtonElement>(null);

  const open = selected !== null || recording !== null;

  function close() {
    setSelected(null);
    setRecording(null);
    setError(null);
  }

  // The bar opens at the bottom of the screen, away from the cell, so take
  // the keyboard there with it; Escape puts it away.
  useEffect(() => {
    if (!open) return;
    // Keep the chosen cell clear of the bar (its scroll margin is the bar's
    // height), then take the keyboard to the bar.
    scroller.current
      ?.querySelector<HTMLElement>('[aria-pressed="true"]')
      ?.scrollIntoView({ block: "nearest" });
    firstAction.current?.focus({ preventScroll: true });
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setSelected(null);
      setRecording(null);
      setError(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, selected, recording]);

  // On a narrow screen, start with this week in view and say when more
  // weeks sit off to the right.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const update = () =>
      setMore(el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
    const target = el.querySelector<HTMLElement>("[data-current-week]");
    const sticky = el.querySelector<HTMLElement>("thead th");
    if (target && sticky && el.scrollWidth > el.clientWidth) {
      el.scrollLeft = Math.max(
        0,
        target.offsetLeft - sticky.offsetWidth - target.offsetWidth * 2,
      );
    }
    update();
    el.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      el.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, []);

  async function run(task: () => Promise<{ ok: boolean; error?: string }>) {
    setBusy(true);
    setError(null);
    try {
      const result = await task();
      if (!result.ok) setError(result.error ?? "Something went wrong.");
      else {
        setSelected(null);
        setRecording(null);
        setReason("");
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

  const isFuture = (week: number) => currentWeek !== null && week > currentWeek;
  const anyTaken = history.weeks.some((w) => w.session);
  const current = selected?.student.cells[selected.week.week] ?? null;

  return (
    <div className="mt-4">
      <p className="text-sm text-muted">
        {anyTaken
          ? "Select a mark to change it. Use + to fill in a week that was not taken in the app."
          : "No attendance taken yet. Start this week’s session above, or use + to fill in a past week."}
      </p>

      <div className="relative mt-3">
        <div
          ref={scroller}
          className="overflow-x-auto rounded-2xl bg-surface shadow-soft ring-1 ring-line"
        >
          <table className="w-full border-collapse text-sm">
            <thead className="text-muted">
              <tr className="border-b border-line">
                <th className="sticky left-0 z-10 bg-surface px-4 py-3 text-left align-bottom font-medium">
                  Student
                </th>
                <th className="hidden px-3 py-3 text-left align-bottom font-medium sm:table-cell">
                  ID
                </th>
                {history.weeks.map((week) => {
                  const info = weekInfo[week.week];
                  const now = week.week === currentWeek;
                  const label = (
                    <span
                      className={`inline-flex h-6 items-center rounded-full px-1.5 ${
                        now ? "bg-ink text-white" : ""
                      }`}
                    >
                      W{week.week}
                    </span>
                  );
                  return (
                    <th
                      key={week.week}
                      data-current-week={now || undefined}
                      aria-current={now ? "date" : undefined}
                      className="min-w-10 px-0.5 pt-2.5 pb-2 text-center align-bottom font-medium tabular-nums"
                    >
                      {week.session ? (
                        <Link
                          href={`/sessions/${week.session.id}`}
                          className={`underline-offset-4 hover:underline ${
                            week.session.status === "ACTIVE"
                              ? "text-accent-strong"
                              : "text-ink"
                          }`}
                          title={
                            info?.times
                              ? `Open week ${week.week} (${info.times})`
                              : `Open week ${week.week}`
                          }
                        >
                          {label}
                        </Link>
                      ) : (
                        <span className={isFuture(week.week) ? "text-faint" : "text-muted"}>
                          {label}
                        </span>
                      )}
                      <span
                        className={`mt-0.5 block text-xs font-normal whitespace-nowrap ${
                          isFuture(week.week) ? "text-faint" : "text-muted"
                        }`}
                      >
                        {info?.date ?? " "}
                      </span>
                    </th>
                  );
                })}
                <th className="hidden px-4 py-3 text-right align-bottom font-medium sm:table-cell">
                  Present
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {history.students.map((student) => {
                const total =
                  student.percent === null ? "—" : `${student.percent}%`;
                return (
                  <tr key={student.id}>
                    <th
                      scope="row"
                      className="sticky left-0 z-10 bg-surface px-4 py-0.5 text-left font-normal"
                    >
                      <div className="flex max-w-40 items-center gap-3 sm:max-w-48">
                        <Link
                          href={`/students/${student.studentId}`}
                          className="min-w-0 truncate py-2 underline-offset-4 hover:underline"
                        >
                          {student.name || "—"}
                        </Link>
                        {!student.active && (
                          <span className="shrink-0 text-xs text-muted">(left)</span>
                        )}
                        {/* On phones the total rides with the name. */}
                        <span className="ml-auto shrink-0 text-muted tabular-nums sm:hidden">
                          {total}
                        </span>
                      </div>
                    </th>
                    <td className="hidden px-3 py-1.5 text-muted tabular-nums sm:table-cell">
                      {student.studentId}
                    </td>
                    {history.weeks.map((week) => {
                      const status = student.cells[week.week];
                      if (!week.session) {
                        return <td key={week.week} className="px-0.5 py-1.5" />;
                      }
                      const isSelected =
                        selected?.student.id === student.id &&
                        selected.week.week === week.week;
                      return (
                        <td key={week.week} className="px-0.5 py-1">
                          <button
                            type="button"
                            onClick={() => {
                              setRecording(null);
                              setError(null);
                              setSelected({ student, week });
                            }}
                            aria-label={`${student.name}, week ${week.week}: ${markLabel(status).toLowerCase()}`}
                            aria-pressed={isSelected}
                            className={`mx-auto flex size-8 scroll-mb-52 items-center justify-center sm:scroll-mb-28 rounded-full transition-transform duration-300 ease-spring hover:scale-110 active:scale-95 ${markClass(status)} ${
                              isSelected ? "scale-110 ring-2 ring-ink ring-offset-2" : ""
                            }`}
                          >
                            <MarkIcon mark={status} />
                          </button>
                        </td>
                      );
                    })}
                    <td className="hidden px-4 py-1.5 text-right whitespace-nowrap tabular-nums sm:table-cell">
                      {student.percent === null ? (
                        <span className="text-muted">—</span>
                      ) : (
                        <>
                          {student.present}
                          <span className="text-muted"> · {student.percent}%</span>
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot className="border-t border-line bg-canvas text-xs text-muted">
              <tr>
                <th
                  scope="row"
                  className="sticky left-0 z-10 bg-canvas px-4 py-2 text-left font-medium whitespace-nowrap"
                >
                  Week total
                </th>
                <td className="hidden sm:table-cell" />
                {history.weeks.map((week) => (
                  <td key={week.week} className="px-0.5 py-2 text-center tabular-nums">
                    {week.session ? (
                      <span title={`${week.present} present, ${week.absent} absent`}>
                        {week.percent === null ? "—" : `${week.percent}%`}
                      </span>
                    ) : isFuture(week.week) ? null : (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => {
                          setSelected(null);
                          setError(null);
                          setRecording(week.week);
                        }}
                        aria-pressed={recording === week.week}
                        title={`Fill in week ${week.week} by hand`}
                        aria-label={`Fill in week ${week.week} by hand`}
                        className={`mx-auto flex size-7 scroll-mb-52 items-center sm:scroll-mb-28 justify-center rounded-full bg-surface text-muted ring-1 ring-line-strong transition-[transform,color] duration-300 ease-spring hover:scale-110 hover:text-ink disabled:opacity-50 ${
                          recording === week.week ? "scale-110 text-ink ring-2 ring-ink" : ""
                        }`}
                      >
                        <Plus className="size-3" />
                      </button>
                    )}
                  </td>
                ))}
                <td className="hidden sm:table-cell" />
              </tr>
            </tfoot>
          </table>
        </div>
        {more && (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-y-px right-px w-10 rounded-r-2xl bg-gradient-to-l from-surface to-transparent"
          />
        )}
      </div>

      {/* One bar, two jobs: correct a mark, or confirm filling in a week.
          It sits at the bottom of the screen so it is in view wherever the
          cell was. */}
      {/* Room to scroll the last rows above the bar. */}
      {open && <div aria-hidden className="h-48 sm:h-24" />}
      {open && (
        <div className="fixed inset-x-0 bottom-4 z-30 flex justify-center px-4">
          {selected ? (
            <div
              key={`${selected.student.id}:${selected.week.week}`}
              role="group"
              aria-label={`Change ${selected.student.name}, week ${selected.week.week}`}
              className="flex w-full max-w-3xl animate-rise flex-wrap items-center gap-2 rounded-2xl bg-surface p-2 pl-4 text-sm shadow-plate ring-1 ring-line"
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
                  ref={firstAction}
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
                  ref={current === "PRESENT" ? firstAction : undefined}
                  variant="destructive"
                  size="sm"
                  disabled={busy}
                  onClick={() => mark("ABSENT")}
                >
                  Mark absent
                </Button>
              )}
              <Button variant="ghost" size="sm" disabled={busy} onClick={close}>
                Cancel
              </Button>
              {error && (
                <p role="alert" className="w-full px-1 text-danger">
                  {error}
                </p>
              )}
            </div>
          ) : (
            <div
              role="group"
              aria-label={`Fill in week ${recording} by hand`}
              className="flex w-full max-w-3xl animate-rise flex-wrap items-center gap-2 rounded-2xl bg-surface p-2 pl-4 text-sm shadow-plate ring-1 ring-line"
            >
              <p className="mr-2 min-w-0 flex-1 basis-64">
                <span className="font-medium">Fill in week {recording} by hand?</span>
                <span className="text-muted">
                  {" "}
                  It is added with nobody marked. Nothing reaches the Google
                  Sheet until you mark a student.
                </span>
              </p>
              <Button
                ref={firstAction}
                size="sm"
                disabled={busy}
                onClick={() => recording !== null && recordWeek(recording)}
              >
                {busy ? "Adding…" : "Add week"}
              </Button>
              <Button variant="ghost" size="sm" disabled={busy} onClick={close}>
                Cancel
              </Button>
              {error && (
                <p role="alert" className="w-full px-1 text-danger">
                  {error}
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
