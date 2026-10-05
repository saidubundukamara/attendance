import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  createSessionToken,
  SESSION_COOKIE,
  SESSION_TTL_MS,
  verifySessionToken,
} from "./session";

export async function isLecturer(): Promise<boolean> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return verifySessionToken(token, process.env.AUTH_SECRET);
}

// The security boundary: call at the top of every lecturer page, server
// action and route handler. proxy.ts is only an early redirect.
export async function requireLecturer(): Promise<void> {
  if (!(await isLecturer())) redirect("/login");
}

export async function startLecturerSession(): Promise<void> {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("Missing environment variable AUTH_SECRET");
  (await cookies()).set(SESSION_COOKIE, createSessionToken(secret), {
    httpOnly: true,
    sameSite: "lax",
    // Tied to the URL scheme rather than NODE_ENV so a plain-HTTP LAN
    // deployment can still store the cookie.
    secure: (process.env.APP_URL ?? "").startsWith("https://"),
    path: "/",
    maxAge: SESSION_TTL_MS / 1000,
  });
}

export async function endLecturerSession(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
}
