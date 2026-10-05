"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { inputClass } from "@/components/ui/field";
import { Warning } from "@/components/ui/icons";
import { setAttendanceAction } from "@/lib/actions/attendance";
import type { LiveSession, LiveStudent } from "@/lib/data/sessions";
import { SheetSyncStatus } from "../../sheet-sync-status";

const POLL_MS = 3000;
// How many recent check-ins the projected view names.
const RECENT = 4;

const timeFormat = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
});

function statusLabel(student: LiveStudent): string {
  if (student.status === "PRESENT") {
    return student.source === "MANUAL" ? "Present (manual)" : "Present";
  }
  return student.status === "ABSENT" ? "Absent" : "Not checked in";
}

export function LiveAttendance({
  sessionId,
  initial,
  visual,
  heading,
  footer,
}: {
  sessionId: string;
  initial: LiveSession;
  // The QR while open, the closed panel afterwards.
  visual: React.ReactNode;
  heading: React.ReactNode;
  footer: React.ReactNode;
}) {
  const router = useRouter();
  const [live, setLive] = useState(initial);
  const [showList, setShowList] = useState(initial.status === "CLOSED");
  const [missingOnly, setMissingOnly] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Rows whose status changed in the latest poll, so only those flash.
  const [changed, setChanged] = useState<ReadonlySet<number>>(new Set());
  const last = useRef(initial);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const load = useCallback(async (): Promise<LiveSession | null> => {
    try {
      const res = await fetch(`/api/sessions/${sessionId}/live`, {
        cache: "no-store",
      });
      if (res.status === 401 || res.status === 404) {
        router.refresh();
        return null;
      }
      if (!res.ok) return null;
      const next = (await res.json()) as LiveSession;
      const before = new Map(last.current.students.map((s) => [s.id, s.status]));
      setChanged(
        new Set(
          next.students
            .filter((s) => before.has(s.id) && before.get(s.id) !== s.status)
            .map((s) => s.id),
        ),
      );
      last.current = next;
      setLive(next);
      return next;
    } catch {
      // Keep showing the last known list; the next poll tries again.
      return null;
    }
  }, [sessionId, router]);

  useEffect(() => {
    if (initial.status !== "ACTIVE") return;
    let stopped = false;

    async function tick() {
      const next = document.visibilityState === "visible" ? await load() : null;
      if (stopped) return;
      if (next && next.status !== "ACTIVE") {
        // Ended from another tab or device.
        router.refresh();
        return;
      }
      timer.current = setTimeout(tick, POLL_MS);
    }

    timer.current = setTimeout(tick, POLL_MS);
    return () => {
      stopped = true;
      clearTimeout(timer.current);
    };
  }, [initial.status, load, router]);

  async function mark(student: LiveStudent, status: "PRESENT" | "ABSENT") {
    setBusy(student.id);
    setError(null);
    try {
      const result = await setAttendanceAction({
        sessionId,
        studentId: student.id,
        status,
        reason: reason.trim() || undefined,
      });
      if (!result.ok) setError(result.error);
      await load();
    } catch {
      setError("Could not save the change. Check the connection and try again.");
    } finally {
      setBusy(null);
    }
  }

  const active = initial.status === "ACTIVE";
  const flagged = live.students.filter((student) => student.flagged).length;
  const missing = live.total - live.present;
  const share = live.total > 0 ? Math.min(live.present / live.total, 1) : 0;
  // The list arrives with the newest check-ins first.
  const recent = live.students
    .filter((student) => student.status === "PRESENT" && student.time)
    .slice(0, RECENT);
  const rows = missingOnly
    ? live.students.filter((student) => student.status !== "PRESENT")
    : live.students;

  return (
    <>
      <div className="mt-6 grid items-center gap-10 lg:grid-cols-[auto_minmax(0,1fr)] lg:gap-16">
        {visual}

        <div className="stagger min-w-0">
          <div>{heading}</div>

          <div className="mt-8" style={{ "--i": 1 } as React.CSSProperties}>
            <p
              className="flex items-baseline gap-3 tabular-nums"
              aria-live="polite"
              aria-atomic="true"
            >
              {/* Remounting on change makes the new figure tick into place. */}
              <span
                key={live.present}
                className="inline-block animate-tick text-8xl leading-none font-semibold tracking-tighter"
              >
                {live.present}
              </span>
              <span className="text-3xl font-medium text-faint">
                / {live.total}
              </span>
              <span className="sr-only">students checked in</span>
            </p>
            <div
              aria-hidden="true"
              className="mt-5 h-1.5 overflow-hidden rounded-full bg-sunken"
            >
              <div
                className="h-full origin-left rounded-full bg-accent transition-transform duration-700 ease-out-expo"
                style={{ transform: `scaleX(${share})` }}
              />
            </div>
            <p className="mt-3 text-muted">
              {live.total === 0
                ? "No students on this class list yet."
                : missing <= 0
                  ? "Everyone is checked in."
                  : `${missing} still to check in`}
            </p>
          </div>

          {active && (
            <div className="mt-8" style={{ "--i": 2 } as React.CSSProperties}>
              {recent.length === 0 ? (
                <p className="max-w-sm text-lg text-pretty">
                  Scan the code with your phone camera, then enter the last 4
                  digits of your student ID.
                </p>
              ) : (
                <ul aria-label="Latest check-ins" className="space-y-1.5">
                  {recent.map((student) => (
                    <li
                      key={student.id}
                      className="flex animate-rise items-baseline justify-between gap-4 text-lg"
                    >
                      <span className="truncate">{student.name || "—"}</span>
                      <span
                        className="text-sm text-faint tabular-nums"
                        suppressHydrationWarning
                      >
                        {student.time ? timeFormat.format(student.time) : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <div className="mt-10" style={{ "--i": 3 } as React.CSSProperties}>
            {footer}
          </div>
        </div>
      </div>

      {live.sync.pending > 0 && (
        <div className="mt-10">
          <SheetSyncStatus
            key={`${live.sync.stalled}:${live.sync.lastError ?? ""}`}
            pending={live.sync.pending}
            lastError={live.sync.lastError}
            stalled={live.sync.stalled}
          />
        </div>
      )}

      <section className="mt-12 border-t border-line pt-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="flex items-center gap-2.5 text-lg font-semibold tracking-tight">
            Students
            {flagged > 0 && (
              <span className="flex items-center gap-1 rounded-full bg-warn-soft px-2 py-0.5 text-xs font-medium text-warn">
                <Warning className="size-3" />
                {flagged} to review
              </span>
            )}
          </h2>
          <Button
            variant="secondary"
            size="sm"
            aria-expanded={showList}
            aria-controls="student-list"
            onClick={() => setShowList((shown) => !shown)}
          >
            {showList ? "Hide list" : "Show list"}
          </Button>
        </div>

        {showList && (
          <div id="student-list" className="mt-5 animate-rise">
            <div className="flex flex-wrap items-center gap-3">
              <div
                role="group"
                aria-label="Filter students"
                className="flex rounded-full bg-sunken p-1 text-sm font-medium"
              >
                {[
                  { value: false, label: `All ${live.students.length}` },
                  { value: true, label: `Not checked in ${Math.max(missing, 0)}` },
                ].map((option) => (
                  <button
                    key={option.label}
                    type="button"
                    aria-pressed={missingOnly === option.value}
                    onClick={() => setMissingOnly(option.value)}
                    className={`h-8 rounded-full px-3.5 tabular-nums transition-[background-color,color,box-shadow] duration-300 ease-spring ${
                      missingOnly === option.value
                        ? "bg-surface text-ink shadow-soft"
                        : "text-muted hover:text-ink"
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              <input
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                maxLength={200}
                aria-label="Reason for manual changes"
                placeholder="Reason for manual changes (optional)"
                className={`${inputClass} h-10 min-w-0 flex-1 basis-64 text-sm`}
              />
            </div>

            {error && (
              <p role="alert" className="mt-3 text-sm text-danger">
                {error}
              </p>
            )}
            {flagged > 0 && (
              <p className="mt-3 flex max-w-prose gap-2 text-sm text-warn">
                <Warning className="mt-0.5 size-4" />
                Marked check-ins came from the same network address and browser
                as another one in this session. It can be two students with the
                same phone model, or one phone used twice.
              </p>
            )}

            <div className="mt-4 overflow-x-auto rounded-2xl bg-surface shadow-soft ring-1 ring-line">
              <table className="w-full text-left text-sm">
                <thead className="text-muted">
                  <tr className="border-b border-line">
                    <th className="px-4 py-3 font-medium">Student</th>
                    <th className="hidden px-4 py-3 font-medium sm:table-cell">
                      ID
                    </th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="hidden px-4 py-3 font-medium sm:table-cell">
                      Time
                    </th>
                    <th className="px-4 py-3">
                      <span className="sr-only">Change</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {rows.map((student) => {
                    const present = student.status === "PRESENT";
                    return (
                      <tr key={student.id}>
                        <td className="px-4 py-2.5">
                          <span className="flex items-center gap-1.5">
                            {student.flagged && (
                              <span
                                title="Possible duplicate phone"
                                className="text-warn"
                              >
                                <Warning className="size-4" />
                                <span className="sr-only">
                                  Possible duplicate phone
                                </span>
                              </span>
                            )}
                            <Link
                              href={`/students/${student.studentId}`}
                              className="underline-offset-4 hover:underline"
                            >
                              {student.name || "—"}
                            </Link>
                          </span>
                        </td>
                        <td className="hidden px-4 py-2.5 text-muted tabular-nums sm:table-cell">
                          {student.studentId}
                        </td>
                        <td className="px-4 py-2.5">
                          <span
                            className={`-mx-2 inline-block rounded-full px-2 py-0.5 font-medium ${
                              changed.has(student.id) ? "animate-flash" : ""
                            } ${
                              present
                                ? "text-accent-strong"
                                : student.status === "ABSENT"
                                  ? "text-danger"
                                  : "text-muted"
                            }`}
                          >
                            {statusLabel(student)}
                          </span>
                        </td>
                        <td
                          className="hidden px-4 py-2.5 text-muted tabular-nums sm:table-cell"
                          suppressHydrationWarning
                        >
                          {student.time ? timeFormat.format(student.time) : ""}
                        </td>
                        <td className="px-4 py-2 text-right">
                          <Button
                            variant="secondary"
                            size="sm"
                            disabled={busy !== null}
                            onClick={() =>
                              mark(student, present ? "ABSENT" : "PRESENT")
                            }
                          >
                            {busy === student.id
                              ? "Saving…"
                              : present
                                ? "Mark absent"
                                : "Mark present"}
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                  {rows.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-4 py-8 text-center text-muted">
                        {live.students.length === 0
                          ? "No students on this class list yet."
                          : "Everyone is checked in."}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>
    </>
  );
}
