import Link from "next/link";
import { logout } from "@/lib/actions/auth";
import { requireLecturer } from "@/lib/auth";

export default async function LecturerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireLecturer();

  return (
    <>
      <header className="pointer-events-none sticky top-0 z-10 flex justify-center px-4 pt-4">
        <nav
          aria-label="Main"
          className="pointer-events-auto flex h-11 items-center gap-1 rounded-full bg-surface/80 pr-1.5 pl-5 shadow-soft ring-1 ring-line backdrop-blur-xl"
        >
          <Link
            href="/dashboard"
            className="mr-3 text-sm font-semibold tracking-tight"
          >
            Attendance
          </Link>
          <form action={logout}>
            <button
              type="submit"
              className="h-8 rounded-full px-3 text-sm text-muted transition-colors duration-200 hover:bg-ink/5 hover:text-ink"
            >
              Sign out
            </button>
          </form>
        </nav>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 pt-10 pb-24 sm:px-8">
        {children}
      </main>
    </>
  );
}
