import Link from "next/link";
import { notFound } from "next/navigation";
import { BackLink } from "@/components/ui/back-link";
import { ArrowBadge, buttonClass } from "@/components/ui/button";
import { LiveDot } from "@/components/ui/status";
import { requireLecturer } from "@/lib/auth";
import { getClassAssignments } from "@/lib/data/assignments";
import { getClass } from "@/lib/data/classes";
import { getClassHistory } from "@/lib/data/history";
import { db } from "@/lib/db";
import { formatDateTime } from "@/lib/format";
import { appTimeZone } from "@/lib/timezone";
import { suggestWeek } from "@/lib/week";
import { StartAttendance } from "../../dashboard/start-attendance";
import { AssignmentsSection } from "./assignments-section";
import { HistoryGrid, type WeekInfo } from "./history-grid";
import { SettingsForm } from "./settings-form";

type Props = { params: Promise<{ classId: string }> };

async function loadClass(classId: string) {
  return /^\d+$/.test(classId) ? await getClass(Number(classId)) : null;
}

export async function generateMetadata({ params }: Props) {
  const cls = await loadClass((await params).classId);
  return { title: `${cls?.code ?? "Class"} — Attendance` };
}

const DAY_MS = 24 * 60 * 60 * 1000;

export default async function ClassPage({ params }: Props) {
  await requireLecturer();
  const cls = await loadClass((await params).classId);
  const history = cls ? await getClassHistory(db, cls.id) : null;
  if (!cls || !history) notFound();
  const items = await getClassAssignments(db, cls.id);

  const timeZone = appTimeZone();
  const now = new Date();
  const currentWeek = suggestWeek(cls.startDate, now, cls.totalWeeks);
  const active = history.weeks.find((w) => w.session?.status === "ACTIVE");

  const day = new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    timeZone,
  });
  const time = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone,
  });
  // The start date is a calendar date, so its weeks are counted in UTC.
  const startMs = cls.startDate ? Date.parse(`${cls.startDate}T00:00:00Z`) : null;
  const plannedDay = new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
  const weekInfo: WeekInfo = {};
  for (const week of history.weeks) {
    const s = week.session;
    weekInfo[week.week] = s
      ? {
          date: day.format(s.startedAt),
          times: `${time.format(s.startedAt)}–${s.endedAt ? time.format(s.endedAt) : "open"}`,
        }
      : {
          date:
            startMs === null
              ? null
              : plannedDay.format(startMs + (week.week - 1) * 7 * DAY_MS),
          times: null,
        };
  }

  return (
    <div className="stagger">
      <div>
        <BackLink />
        <div className="mt-4 flex flex-wrap items-end justify-between gap-x-8 gap-y-5">
          <div className="min-w-0">
            <h1 className="text-4xl font-semibold tracking-tight">{cls.code}</h1>
            <p className="mt-1 text-lg text-muted">
              {[cls.moduleName, cls.moduleCode].filter(Boolean).join(" · ") ||
                "No module details in the sheet"}
            </p>
          </div>
          {active?.session ? (
            <div className="flex flex-wrap items-center gap-4">
              <p className="flex items-center gap-2.5 text-sm font-medium text-accent-strong">
                <LiveDot />
                Week {active.week} is open
              </p>
              <Link
                href={`/sessions/${active.session.id}`}
                className={buttonClass({ variant: "accent", arrow: true })}
              >
                View QR
                <ArrowBadge />
              </Link>
            </div>
          ) : (
            // Direct child so its week picker can wrap to full width.
            <StartAttendance
              classId={cls.id}
              totalWeeks={cls.totalWeeks}
              suggestedWeek={currentWeek}
              sessionWeeks={history.weeks
                .filter((w) => w.session)
                .map((w) => w.week)}
            />
          )}
        </div>

        <details className="group mt-5 text-sm" open={!cls.startDate}>
          <summary className="inline-flex cursor-pointer list-none flex-wrap items-center gap-x-2 rounded-lg py-1 text-muted hover:text-ink [&::-webkit-details-marker]:hidden">
            {cls.startDate && startMs !== null ? (
              <span>
                Week 1 started {plannedDay.format(startMs)} · {cls.totalWeeks}{" "}
                teaching weeks
                {currentWeek !== null && (
                  <span className="font-medium whitespace-nowrap text-ink">
                    {" "}
                    · now week {currentWeek}
                  </span>
                )}
              </span>
            ) : (
              <span className="font-medium text-warn">
                No start date yet, so this week can’t be highlighted or
                suggested.
              </span>
            )}
            <span className="font-medium text-ink underline underline-offset-4 group-open:hidden">
              Edit
            </span>
          </summary>
          <SettingsForm
            classId={cls.id}
            startDate={cls.startDate ?? ""}
            totalWeeks={cls.totalWeeks}
          />
        </details>
      </div>

      <section className="mt-12" style={{ "--i": 1 } as React.CSSProperties}>
        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
          <h2 className="text-lg font-semibold tracking-tight">
            Attendance
            <span className="ml-2 font-normal text-muted tabular-nums">
              {history.activeCount}{" "}
              {history.activeCount === 1 ? "student" : "students"}
            </span>
          </h2>
          <p className="text-sm text-muted">
            From sheet tab “{cls.sheetTab}”
            {cls.lastSyncedAt
              ? ` · synced ${formatDateTime(cls.lastSyncedAt)}`
              : ""}
          </p>
        </div>
        <HistoryGrid
          classId={cls.id}
          history={history}
          currentWeek={currentWeek}
          weekInfo={weekInfo}
        />
      </section>

      <section
        className="mt-14 border-t border-line pt-8"
        style={{ "--i": 2 } as React.CSSProperties}
      >
        <AssignmentsSection
          classId={cls.id}
          classCode={cls.code}
          items={items}
          studentCount={history.activeCount}
          submitUrl={`${process.env.APP_URL ?? ""}/submit`}
          sheetError={cls.submissionsSheetError}
          timeZone={timeZone}
          now={now.getTime()}
        />
      </section>
    </div>
  );
}
