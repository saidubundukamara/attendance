import { redirect } from "next/navigation";
import { isLecturer } from "@/lib/auth";
import { LoginForm } from "./login-form";

export const metadata = { title: "Sign in — Attendance" };

export default async function LoginPage() {
  if (await isLecturer()) redirect("/dashboard");

  return (
    <main className="flex min-h-[100dvh] flex-1 items-center justify-center px-4 pb-[12vh]">
      <div className="stagger w-full max-w-xs">
        <h1 className="text-4xl font-semibold tracking-tight">Attendance</h1>
        <p className="mt-2 text-muted" style={{ "--i": 1 } as React.CSSProperties}>
          Sign in to take attendance.
        </p>
        <div style={{ "--i": 2 } as React.CSSProperties}>
          <LoginForm />
        </div>
      </div>
    </main>
  );
}
