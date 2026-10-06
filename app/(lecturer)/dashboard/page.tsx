import Link from "next/link";
import { after } from "next/server";
import { ArrowBadge, buttonClass } from "@/components/ui/button";
import { LiveDot } from "@/components/ui/status";
import { requireLecturer } from "@/lib/auth";
import { getDashboardClasses } from "@/lib/data/classes";
import { db } from "@/lib/db";
import { formatDate } from "@/lib/format";
import { retryStalledSync } from "@/lib/sheets/sync";
import { getSyncStatus } from "@/lib/sheets/write";
import { suggestWeek } from "@/lib/week";
import { SheetSyncStatus } from "../sheet-sync-status";
import { StartAttendance } from "./start-attendance";
import { SyncRosterButton } from "./sync-roster-button";

export const metadata = { title: "Classes — Attendance" };

export default async function DashboardPage() {
  await requireLecturer();
  const classes = await getDashboardClasses();
  const today = new Date();
  const sync = await getSyncStatus(db);
  if (sync.stalled) after(() => retryStalledSync());

  return (
    <div className="mx-auto max-w-3xl">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <h1 className="animate-rise text-4xl font-semibold tracking-tight">
          Classes
        </h1>
        <SyncRosterButton />
      </div>

      {/* This page does not refresh itself, so it only reports a stuck sync. */}
      {sync.stalled && (
        <div className="mt-6">
          <SheetSyncStatus {...sync} />
        </div>
      )}

      {classes.length === 0 ? (
        <div className="mt-16 animate-rise">
          <p className="text-xl font-medium">No classes yet</p>
          <p className="mt-2 max-w-md text-muted">
            Classes come from the tabs of your Google Sheet. Press{" "}
            <span className="font-medium text-ink">Sync roster</span> to load
            them along with their students.
          </p>
        </div>
      ) : (
        <ul className="stagger mt-8 space-y-4">
          {classes.map((cls, index) => {
            const week = suggestWeek(cls.startDate, today, cls.totalWeeks);
            const active = cls.sessions.find((s) => s.status === "ACTIVE");
            const moduleLine = [cls.moduleName, cls.moduleCode]
              .filter(Boolean)
              .join(" · ");
            return (
              <li
                key={cls.id}
                style={{ "--i": index + 1 } as React.CSSProperties}
                className="flex flex-wrap items-center justify-between gap-x-8 gap-y-5 rounded-3xl bg-surface p-6 shadow-soft ring-1 ring-line sm:p-8"
              >
                <div className="min-w-0">
                  <h2 className="text-2xl font-semibold tracking-tight">
                    <Link
                      href={`/classes/${cls.id}`}
                      className="underline-offset-4 hover:underline"
                    >
                      {cls.code}
                    </Link>
                  </h2>
                  <p className="mt-0.5 text-muted">
                    {moduleLine || "No module details in the sheet"}
                  </p>
                  <p className="mt-4 text-sm text-muted">
                    <span className="tabular-nums">{cls.studentCount}</span>{" "}
                    {cls.studentCount === 1 ? "student" : "students"}
                    {week !== null && (
                      <>
                        {" · "}Week {week} of {cls.totalWeeks}
                      </>
                    )}
                    {" · "}
                    {cls.lastSession
                      ? `Last taken Week ${cls.lastSession.week}, ${formatDate(cls.lastSession.startedAt)}`
                      : "Not taken yet"}
                  </p>
                  {week === null && (
                    <Link
                      href={`/classes/${cls.id}`}
                      className="mt-2 inline-block text-sm font-medium text-warn underline-offset-4 hover:underline"
                    >
                      Set a start date to get the week suggested
                    </Link>
                  )}
                </div>

                {active ? (
                  <div className="flex flex-wrap items-center gap-4">
                    <p className="flex items-center gap-2.5 text-sm font-medium text-accent-strong">
                      <LiveDot />
                      Week {active.week} is open
                    </p>
                    <Link
                      href={`/sessions/${active.id}`}
                      className={buttonClass({
                        variant: "accent",
                        arrow: true,
                      })}
                    >
                      View QR
                      <ArrowBadge />
                    </Link>
                  </div>
                ) : (
                  <StartAttendance
                    classId={cls.id}
                    totalWeeks={cls.totalWeeks}
                    suggestedWeek={week}
                    sessionWeeks={cls.sessions.map((s) => s.week)}
                  />
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
