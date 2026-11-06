import Link from "next/link";
import { Notice } from "@/components/ui/notice";
import { logout } from "@/lib/actions/auth";
import { requireLecturer } from "@/lib/auth";

const navLink =
  "flex h-8 items-center rounded-full px-3 text-sm text-muted transition-colors duration-200 hover:bg-ink/5 hover:text-ink";

export default async function LecturerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const lecturer = await requireLecturer();

  return (
    <>
      <header className="pointer-events-none sticky top-0 z-10 flex justify-center px-4 pt-4">
        <nav
          aria-label="Main"
          className="pointer-events-auto flex h-11 items-center gap-1 rounded-full bg-surface pr-1.5 pl-5 shadow-soft ring-1 ring-line"
        >
          <Link
            href="/dashboard"
            className="mr-3 text-sm font-semibold tracking-tight"
          >
            Attendance
          </Link>
          <Link href="/setup" className={navLink}>
            Sheet
          </Link>
          {lecturer.isAdmin && (
            <Link href="/admin" className={navLink}>
              Admin
            </Link>
          )}
          <form action={logout}>
            <button type="submit" className={navLink}>
              Sign out
            </button>
          </form>
        </nav>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 pt-10 pb-24 sm:px-8">
        {lecturer.authError && (
          <Notice
            role="alert"
            className="mx-auto mb-8 max-w-3xl"
            action={
              // Signing in again through the consent screen stores a fresh
              // token and clears the error.
              <a
                href="/auth/google?consent=1"
                className="font-medium underline underline-offset-4"
              >
                Reconnect Google
              </a>
            }
          >
            <p className="font-medium">The app can&apos;t reach your Google account</p>
            <p>
              Attendance and submissions are still recorded here, but they
              can&apos;t reach your sheet or Drive until you reconnect.
            </p>
          </Notice>
        )}
        {children}
      </main>
    </>
  );
}
