import { redirect } from "next/navigation";
import { ArrowBadge, buttonClass } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { getSignedInLecturer } from "@/lib/auth";

export const metadata = { title: "Sign in — Attendance" };

const ERRORS: Record<string, string> = {
  cancelled: "Sign-in was cancelled.",
  expired: "That sign-in link expired. Try again.",
  google: "Google sign-in failed. Try again.",
  unverified: "Your Google account's email address isn't verified.",
  "drive-scope":
    "Allow access to Google Drive files on Google's screen: the app needs it to reach your attendance sheet and store submissions.",
  "rate-limited": "Too many attempts. Try again in a few minutes.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; email?: string }>;
}) {
  if (await getSignedInLecturer()) redirect("/dashboard");
  const { error, email } = await searchParams;

  return (
    <main className="flex min-h-[100dvh] flex-1 items-center justify-center px-4 pb-[12vh]">
      <div className="stagger w-full max-w-sm">
        <h1 className="text-4xl font-semibold tracking-tight">Attendance</h1>
        <p className="mt-2 text-muted" style={{ "--i": 1 } as React.CSSProperties}>
          Lecturers sign in with the Google account that holds their
          attendance sheet.
        </p>
        <div className="mt-10" style={{ "--i": 2 } as React.CSSProperties}>
          {error === "not-approved" ? (
            <Notice role="alert" className="mb-6">
              <p className="font-medium">
                {email ? `${email} isn't approved yet.` : "This account isn't approved yet."}
              </p>
              <p>
                Ask the administrator to add this email address, then sign in
                again.
              </p>
            </Notice>
          ) : error && ERRORS[error] ? (
            <Notice role="alert" tone="danger" className="mb-6">
              {ERRORS[error]}
            </Notice>
          ) : null}
          {/* A plain link: the route handler redirects to Google. */}
          <a
            href="/auth/google"
            className={buttonClass({ size: "lg", arrow: true, block: true })}
          >
            Sign in with Google
            <ArrowBadge size="lg" />
          </a>
        </div>
      </div>
    </main>
  );
}
