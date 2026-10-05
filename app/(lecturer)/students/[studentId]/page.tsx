import Link from "next/link";
import { notFound } from "next/navigation";
import { BackLink } from "@/components/ui/back-link";
import { markClass, MarkIcon, markLabel } from "@/components/ui/status";
import { requireLecturer } from "@/lib/auth";
import { getStudentSummary } from "@/lib/data/history";
import { db } from "@/lib/db";

export const metadata = { title: "Student — Attendance" };

export default async function StudentPage({
  params,
}: {
  params: Promise<{ studentId: string }>;
}) {
  await requireLecturer();
  const { studentId } = await params;
  const student = getStudentSummary(db, studentId);
  if (!student) notFound();

  return (
    <div className="stagger mx-auto max-w-3xl">
      <div>
        <BackLink />
        <h1 className="mt-4 text-4xl font-semibold tracking-tight">
          {student.name || "Unnamed student"}
        </h1>
        <p className="mt-1 text-lg text-muted tabular-nums">
          {student.studentId}
        </p>
      </div>

      {student.classes.length === 0 && (
        <p className="mt-12 text-muted">Not on any class list.</p>
      )}

      {student.classes.map((cls, index) => (
        <section
          key={cls.classId}
          style={{ "--i": index + 1 } as React.CSSProperties}
          className="mt-10 border-t border-line pt-8"
        >
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-xl font-semibold tracking-tight">
              <Link
                href={`/classes/${cls.classId}`}
                className="underline-offset-4 hover:underline"
              >
                {cls.code}
              </Link>
              {cls.moduleName && (
                <span className="font-normal text-muted"> · {cls.moduleName}</span>
              )}
            </h2>
            {!cls.active && (
              <span className="text-sm text-muted">
                No longer on this class list
              </span>
            )}
          </div>

          <dl className="mt-6 flex flex-wrap gap-x-12 gap-y-4">
            {[
              ["Attendance", cls.percent === null ? "—" : `${cls.percent}%`],
              ["Present", cls.present],
              ["Absent", cls.absent],
            ].map(([label, value]) => (
              <div key={label} className="flex flex-col-reverse">
                <dt className="text-sm text-muted">{label}</dt>
                <dd className="text-3xl font-semibold tracking-tight tabular-nums">
                  {value}
                </dd>
              </div>
            ))}
          </dl>

          {cls.weeks.length === 0 ? (
            <p className="mt-6 text-sm text-muted">
              No attendance has been taken for this class yet.
            </p>
          ) : (
            <ul className="mt-6 flex flex-wrap gap-x-2 gap-y-3">
              {cls.weeks.map((week) => (
                <li
                  key={week.week}
                  className="flex flex-col items-center gap-1.5"
                >
                  <span
                    title={`Week ${week.week}: ${markLabel(week.status)}`}
                    className={`flex size-9 items-center justify-center rounded-full ${markClass(week.status)}`}
                  >
                    <MarkIcon mark={week.status} />
                    <span className="sr-only">
                      Week {week.week}: {markLabel(week.status)}
                    </span>
                  </span>
                  <span aria-hidden="true" className="text-xs text-muted tabular-nums">
                    W{week.week}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}
    </div>
  );
}
