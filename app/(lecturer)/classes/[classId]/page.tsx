import { notFound } from "next/navigation";
import { BackLink } from "@/components/ui/back-link";
import { requireLecturer } from "@/lib/auth";
import { getClass } from "@/lib/data/classes";
import { getClassHistory } from "@/lib/data/history";
import { db } from "@/lib/db";
import { formatDateTime } from "@/lib/format";
import { HistoryGrid } from "./history-grid";
import { SettingsForm } from "./settings-form";

export const metadata = { title: "Class — Attendance" };

export default async function ClassPage({
  params,
}: {
  params: Promise<{ classId: string }>;
}) {
  await requireLecturer();
  const { classId } = await params;
  const cls = /^\d+$/.test(classId) ? getClass(Number(classId)) : null;
  const history = cls ? getClassHistory(db, cls.id) : null;
  if (!cls || !history) notFound();

  return (
    <div className="stagger">
      <div>
        <BackLink />
        <h1 className="mt-4 text-4xl font-semibold tracking-tight">{cls.code}</h1>
        <p className="mt-1 text-lg text-muted">
          {[cls.moduleName, cls.moduleCode].filter(Boolean).join(" · ")}
        </p>
      </div>

      <section className="mt-12" style={{ "--i": 1 } as React.CSSProperties}>
        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
          <h2 className="text-lg font-semibold tracking-tight">
            Attendance
            <span className="ml-2 font-normal text-muted tabular-nums">
              {history.activeCount} students
            </span>
          </h2>
          <p className="text-sm text-muted">
            From sheet tab “{cls.sheetTab}”
            {cls.lastSyncedAt
              ? ` · synced ${formatDateTime(cls.lastSyncedAt)}`
              : ""}
          </p>
        </div>
        <HistoryGrid classId={cls.id} history={history} />
      </section>

      <section
        className="mt-14 border-t border-line pt-8"
        style={{ "--i": 2 } as React.CSSProperties}
      >
        <h2 className="text-lg font-semibold tracking-tight">Schedule</h2>
        <p className="mt-1 max-w-prose text-sm text-muted">
          The start date is used to suggest the teaching week. You can still
          pick a different week when starting attendance.
        </p>
        <SettingsForm
          classId={cls.id}
          startDate={cls.startDate ?? ""}
          totalWeeks={cls.totalWeeks}
        />
      </section>
    </div>
  );
}
