import { notFound } from "next/navigation";
import { BackLink } from "@/components/ui/back-link";
import { Check } from "@/components/ui/icons";
import { Notice } from "@/components/ui/notice";
import { LiveDot } from "@/components/ui/status";
import { requireLecturer } from "@/lib/auth";
import { getLiveSession, getSessionView } from "@/lib/data/sessions";
import { formatDateTime } from "@/lib/format";
import { buildSessionQr } from "@/lib/qr";
import { EndButton } from "./end-button";
import { LiveAttendance } from "./live-attendance";
import { QrDisplay } from "./qr-display";
import { ReopenButton } from "./reopen-button";

export const metadata = { title: "Attendance session" };

export default async function SessionPage({
  params,
  searchParams,
}: {
  params: Promise<{ sessionId: string }>;
  searchParams: Promise<{ roster?: string }>;
}) {
  await requireLecturer();
  const { sessionId } = await params;
  const { roster } = await searchParams;
  const [session, live] = await Promise.all([
    getSessionView(sessionId),
    getLiveSession(sessionId),
  ]);
  if (!session || !live) notFound();

  const active = session.status === "ACTIVE";
  const qr = active ? await buildSessionQr(session.id) : null;

  return (
    <div>
      <BackLink />

      <div className="mt-4 space-y-3 empty:hidden">
        {roster === "stale" && (
          <Notice role="alert">
            The Google Sheet could not be reached, so the student list was not
            refreshed. Students added to the sheet since the last sync will be
            rejected until you sync the roster.
          </Notice>
        )}
        {active && !process.env.APP_URL && (
          <Notice role="alert">
            APP_URL is not set, so the QR points at localhost and will not open
            on students’ phones.
          </Notice>
        )}
      </div>

      {/* Remounts with fresh data when the session is ended or reopened. */}
      <LiveAttendance
        key={session.status}
        sessionId={session.id}
        initial={live}
        visual={
          qr ? (
            <QrDisplay sessionId={session.id} initial={qr} />
          ) : (
            <div className="flex aspect-square w-full animate-rise flex-col items-center justify-center rounded-[2.25rem] bg-sunken text-center lg:w-[min(64dvh,34rem)]">
              <span className="flex size-16 items-center justify-center rounded-full bg-surface text-muted shadow-soft">
                <Check className="size-7" />
              </span>
              <p className="mt-6 text-2xl font-semibold tracking-tight">
                Attendance closed
              </p>
              <p className="mt-1 text-muted">
                {session.endedAt
                  ? `Ended ${formatDateTime(session.endedAt)}`
                  : "No longer accepting check-ins"}
              </p>
            </div>
          )
        }
        heading={
          <>
            <p className="text-lg text-muted">
              {session.moduleName ?? session.classCode}
              {session.moduleName ? ` · ${session.classCode}` : ""}
            </p>
            <h1 className="mt-1 text-5xl font-semibold tracking-tight sm:text-6xl">
              Week {session.week}
            </h1>
          </>
        }
        footer={
          <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
            <p className="flex items-center gap-2.5 text-sm text-muted">
              {active ? (
                <>
                  <LiveDot />
                  <span>
                    <span className="font-medium text-accent-strong">Open</span>{" "}
                    since {formatDateTime(session.startedAt)}
                  </span>
                </>
              ) : (
                <span>Started {formatDateTime(session.startedAt)}</span>
              )}
            </p>
            {active ? (
              <EndButton sessionId={session.id} week={session.week} />
            ) : (
              <ReopenButton classId={session.classId} week={session.week} />
            )}
          </div>
        }
      />
    </div>
  );
}
