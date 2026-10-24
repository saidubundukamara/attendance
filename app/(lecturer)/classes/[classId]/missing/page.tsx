import Link from "next/link";
import { notFound } from "next/navigation";
import { BackLink } from "@/components/ui/back-link";
import { Check, Cross, Dot } from "@/components/ui/icons";
import { requireLecturer } from "@/lib/auth";
import { getClassSubmissionMatrix, type MatrixCell } from "@/lib/data/assignments";
import { getClass } from "@/lib/data/classes";
import { db } from "@/lib/db";
import { appTimeZone, formatDeadline } from "@/lib/timezone";
import { CopyButton } from "../copy-link-button";

type Props = {
  params: Promise<{ classId: string }>;
  searchParams: Promise<{ view?: string; all?: string }>;
};

async function loadClass(classId: string) {
  return /^\d+$/.test(classId) ? await getClass(Number(classId)) : null;
}

export async function generateMetadata({ params }: Props) {
  const cls = await loadClass((await params).classId);
  return { title: `Missing work · ${cls?.code ?? "Class"} — Attendance` };
}

const tab = (active: boolean) =>
  `h-8 rounded-full px-3 text-sm leading-8 transition-colors duration-200 ${
    active ? "bg-ink text-white" : "text-muted hover:bg-ink/5 hover:text-ink"
  }`;

export default async function MissingWorkPage({ params, searchParams }: Props) {
  await requireLecturer();
  const cls = await loadClass((await params).classId);
  if (!cls) notFound();
  const { view, all } = await searchParams;
  const byStudent = view === "students";
  const showAll = all === "1";

  const { items, students } = await getClassSubmissionMatrix(db, cls.id);
  const timeZone = appTimeZone();
  const now = new Date().getTime();
  const submitUrl = `${process.env.APP_URL ?? ""}/submit`;
  const totalMissing = students.reduce((sum, s) => sum + s.missing, 0);

  return (
    <div className="stagger">
      <div>
        <BackLink href={`/classes/${cls.id}`}>{cls.code}</BackLink>
        <h1 className="mt-4 text-4xl font-semibold tracking-tight">
          Missing work
        </h1>
        <p className="mt-1 text-lg text-muted">
          {items.length === 0
            ? "No assignments set for this class yet."
            : totalMissing === 0
              ? "Everyone has handed in everything."
              : `${totalMissing} ${totalMissing === 1 ? "submission" : "submissions"} not yet handed in across ${items.length} ${items.length === 1 ? "assignment" : "assignments"}.`}
        </p>
      </div>

      {items.length > 0 && (
        <nav
          aria-label="View"
          className="mt-8 flex gap-1"
          style={{ "--i": 1 } as React.CSSProperties}
        >
          <Link href="?" aria-current={!byStudent ? "page" : undefined} className={tab(!byStudent)}>
            By assignment
          </Link>
          <Link
            href="?view=students"
            aria-current={byStudent ? "page" : undefined}
            className={tab(byStudent)}
          >
            By student
          </Link>
        </nav>
      )}

      <div style={{ "--i": 2 } as React.CSSProperties}>
        {items.length === 0 ? (
          <Link
            href={`/classes/${cls.id}`}
            className="mt-8 inline-block font-medium underline underline-offset-4"
          >
            Add an assignment on the class page
          </Link>
        ) : byStudent ? (
          <ByStudent
            items={items}
            students={students}
            showAll={showAll}
            now={now}
            classCode={cls.code}
          />
        ) : (
          <ByAssignment
            items={items}
            studentCount={students.length}
            classCode={cls.code}
            classId={cls.id}
            submitUrl={submitUrl}
            timeZone={timeZone}
            now={now}
          />
        )}
      </div>
    </div>
  );
}

type Data = Awaited<ReturnType<typeof getClassSubmissionMatrix>>;

function ByAssignment({
  items,
  studentCount,
  classCode,
  classId,
  submitUrl,
  timeZone,
  now,
}: {
  items: Data["items"];
  studentCount: number;
  classCode: string;
  classId: number;
  submitUrl: string;
  timeZone: string;
  now: number;
}) {
  return (
    <div className="mt-6 space-y-10">
      {items.map((item) => {
        const due = formatDeadline(item.dueAt, timeZone);
        const overdue = now > item.dueAt;
        // Ready to paste into the class group chat.
        const text = [
          `${classCode} · ${item.title} (due ${due})`,
          "Not yet submitted:",
          ...item.missing.map((s, i) => `${i + 1}. ${s.name} (${s.studentId})`),
          "",
          `Submit at ${submitUrl}`,
        ].join("\n");
        return (
          <section key={item.id} className="border-t border-line pt-6">
            <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
              <div className="min-w-0">
                <h2 className="text-lg font-semibold tracking-tight">
                  <Link
                    href={`/classes/${classId}/assignments/${item.id}`}
                    className="underline-offset-4 hover:underline"
                  >
                    {item.title}
                  </Link>
                </h2>
                <p className="text-sm text-muted">
                  Due {due} ·{" "}
                  {!item.open ? (
                    "Closed"
                  ) : overdue ? (
                    <span className="text-warn">Deadline passed</span>
                  ) : (
                    <span className="text-accent-strong">Open</span>
                  )}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <p className="text-sm tabular-nums">
                  {item.missing.length === 0 ? (
                    <span className="font-medium text-accent-strong">
                      All {studentCount} submitted
                    </span>
                  ) : (
                    <>
                      <span className={`font-medium ${overdue ? "text-danger" : ""}`}>
                        {item.missing.length}
                      </span>
                      <span className="text-muted"> of {studentCount} missing</span>
                    </>
                  )}
                </p>
                {item.missing.length > 0 && (
                  <CopyButton text={text} label="Copy list" />
                )}
              </div>
            </div>
            {item.missing.length > 0 && (
              <ul className="mt-4 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2 lg:grid-cols-3">
                {item.missing.map((s) => (
                  <li key={s.id} className="flex min-w-0 items-baseline gap-2 py-1">
                    <span className="truncate">{s.name}</span>
                    <span className="shrink-0 text-xs text-muted tabular-nums">
                      {s.studentId}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}

function StatusCell({ cell, overdue }: { cell: MatrixCell; overdue: boolean }) {
  if (cell?.late) {
    return (
      <span className="mx-auto flex h-7 w-fit items-center rounded-full bg-warn-soft px-2 text-xs font-semibold text-warn">
        LATE
      </span>
    );
  }
  if (cell) {
    return (
      <span className="mx-auto flex size-7 items-center justify-center rounded-full bg-accent-soft text-accent-strong">
        <Check className="size-3.5" />
      </span>
    );
  }
  return overdue ? (
    <span className="mx-auto flex size-7 items-center justify-center rounded-full bg-danger-soft text-danger">
      <Cross className="size-3.5" />
    </span>
  ) : (
    <span className="mx-auto flex size-7 items-center justify-center rounded-full bg-sunken text-faint">
      <Dot className="size-3.5" />
    </span>
  );
}

function ByStudent({
  items,
  students,
  showAll,
  now,
  classCode,
}: {
  items: Data["items"];
  students: Data["students"];
  showAll: boolean;
  now: number;
  classCode: string;
}) {
  const behind = students
    .filter((s) => s.missing > 0)
    .sort((a, b) => b.missing - a.missing || a.name.localeCompare(b.name));
  const rows = showAll ? students : behind;
  const text = [
    `${classCode} · students with work not yet submitted:`,
    ...behind.map((s, i) => {
      const titles = items.filter((item) => !s.cells[item.id]).map((item) => item.title);
      return `${i + 1}. ${s.name} (${s.studentId}): ${titles.join(", ")}`;
    }),
  ].join("\n");

  return (
    <div className="mt-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted">
          {showAll
            ? `All ${students.length} students.`
            : behind.length === 0
              ? "Nobody is missing anything."
              : `${behind.length} of ${students.length} students have something missing, most first.`}{" "}
          <Link
            href={showAll ? "?view=students" : "?view=students&all=1"}
            className="font-medium text-ink underline-offset-4 hover:underline"
          >
            {showAll ? "Only students with missing work" : "Show everyone"}
          </Link>
        </p>
        {behind.length > 0 && <CopyButton text={text} label="Copy list" />}
      </div>

      {rows.length > 0 && (
        <div className="mt-4 overflow-x-auto rounded-2xl bg-surface shadow-soft ring-1 ring-line">
          <table className="w-full border-collapse text-sm">
            <thead className="text-muted">
              <tr className="border-b border-line">
                <th className="sticky left-0 z-10 bg-surface px-4 py-3 text-left font-medium">
                  Student
                </th>
                {items.map((item) => (
                  <th
                    key={item.id}
                    className="max-w-32 px-2 py-3 text-center align-bottom font-medium"
                    title={item.title}
                  >
                    <span className="line-clamp-2">{item.title}</span>
                  </th>
                ))}
                <th className="px-4 py-3 text-right font-medium">Missing</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((s) => (
                <tr key={s.id}>
                  <th
                    scope="row"
                    className="sticky left-0 z-10 bg-surface px-4 py-2 text-left font-normal"
                  >
                    <span className="block max-w-40 truncate sm:max-w-56">{s.name}</span>
                    <span className="block text-xs text-muted tabular-nums">{s.studentId}</span>
                  </th>
                  {items.map((item) => (
                    <td key={item.id} className="px-2 py-2">
                      <StatusCell cell={s.cells[item.id]} overdue={now > item.dueAt} />
                    </td>
                  ))}
                  <td
                    className={`px-4 py-2 text-right font-medium tabular-nums ${s.missing > 0 ? "text-danger" : "text-muted"}`}
                  >
                    {s.missing}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
        <span className="inline-flex items-center gap-1.5">
          <Check className="size-3 text-accent-strong" /> Submitted
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="font-semibold text-warn">LATE</span> Submitted late
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Cross className="size-3 text-danger" /> Missing, deadline passed
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Dot className="size-3" /> Not in yet, still open
        </span>
      </p>
    </div>
  );
}
