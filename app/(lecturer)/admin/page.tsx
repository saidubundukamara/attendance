import { listAccess, listCohorts } from "@/lib/admin";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { formatDate } from "@/lib/format";
import { ApproveForm, CohortRow, CreateCohortForm, RevokeButton } from "./forms";

export const metadata = { title: "Admin — Attendance" };

export default async function AdminPage() {
  await requireAdmin();
  const [access, cohorts] = await Promise.all([listAccess(db), listCohorts(db)]);

  return (
    <div className="stagger mx-auto max-w-3xl">
      <h1 className="text-4xl font-semibold tracking-tight">Admin</h1>

      <section className="mt-10" style={{ "--i": 1 } as React.CSSProperties}>
        <h2 className="text-xl font-semibold tracking-tight">Lecturers</h2>
        <p className="mt-1 text-muted">
          Only approved Google accounts can sign in. Each lecturer connects
          their own sheet and keeps submissions in their own Drive.
        </p>
        <div className="mt-6">
          <ApproveForm />
        </div>
        <ul className="mt-6 divide-y divide-line border-y border-line">
          {access.map((row) => (
            <li
              key={row.email}
              className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 py-4"
            >
              <div className="min-w-0">
                <p className="font-medium break-all">
                  {row.lecturer?.name ? `${row.lecturer.name} · ` : ""}
                  {row.email}
                  {row.admin && (
                    <span className="ml-2 rounded-full bg-ink/5 px-2 py-0.5 text-xs font-medium text-muted">
                      Admin
                    </span>
                  )}
                </p>
                <p className="mt-0.5 text-sm text-muted">
                  {!row.lecturer
                    ? "Hasn't signed in yet"
                    : [
                        row.lecturer.hasSheet
                          ? `Sheet: ${row.lecturer.sheetName || "connected"}`
                          : "No sheet picked yet",
                        `${row.lecturer.classCount} ${row.lecturer.classCount === 1 ? "class" : "classes"}`,
                        row.lecturer.connected
                          ? null
                          : "Needs to reconnect Google",
                        row.lecturer.lastLoginAt
                          ? `Last signed in ${formatDate(row.lecturer.lastLoginAt)}`
                          : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                </p>
              </div>
              {!row.admin && <RevokeButton email={row.email} />}
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-14" style={{ "--i": 2 } as React.CSSProperties}>
        <h2 className="text-xl font-semibold tracking-tight">Cohorts</h2>
        <p className="mt-1 text-muted">
          A cohort groups the modules a set of students takes, across
          lecturers. Students pick their cohort on the submit page, then the
          module. Lecturers put each module in a cohort in its settings.
        </p>
        <div className="mt-6">
          <CreateCohortForm />
        </div>
        {cohorts.length > 0 && (
          <ul className="mt-6 divide-y divide-line border-y border-line">
            {cohorts.map((c) => (
              <CohortRow key={c.id} id={c.id} name={c.name} moduleCount={c.moduleCount} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
