"use server";

import { redirect } from "next/navigation";
import { endLecturerSession, startLecturerSession } from "@/lib/auth";
import { clearHits, isRateLimited, recordHit } from "@/lib/ratelimit";
import { getClientIp } from "@/lib/request";
import { verifyPassword } from "@/lib/session";

export type LoginState = { error: string } | undefined;

const MAX_FAILED_LOGINS = 5;
const LOGIN_WINDOW_MS = 10 * 60 * 1000;

export async function login(
  _prev: LoginState,
  formData: FormData,
): Promise<LoginState> {
  if (!process.env.LECTURER_PASSWORD || !process.env.AUTH_SECRET) {
    return {
      error: "Login is not configured. Set LECTURER_PASSWORD and AUTH_SECRET.",
    };
  }

  const key = `login:${await getClientIp()}`;
  if (isRateLimited(key, MAX_FAILED_LOGINS, LOGIN_WINDOW_MS)) {
    return { error: "Too many attempts. Try again in a few minutes." };
  }

  const password = formData.get("password");
  if (
    typeof password !== "string" ||
    !verifyPassword(password, process.env.LECTURER_PASSWORD)
  ) {
    recordHit(key, LOGIN_WINDOW_MS);
    return { error: "Incorrect password." };
  }

  clearHits(key);
  await startLecturerSession();
  redirect("/dashboard");
}

export async function logout(): Promise<void> {
  await endLecturerSession();
  redirect("/login");
}
