import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";
import { db } from "@/lib/db";
import {
  getLecturer,
  isAdminEmail,
  isApproved,
  type Lecturer,
} from "@/lib/lecturers";
import {
  createSessionToken,
  SESSION_COOKIE,
  SESSION_TTL_MS,
  verifySessionToken,
} from "./session";

export type SignedInLecturer = Lecturer & { email: string; isAdmin: boolean };

// The lecturer the session cookie belongs to, while they are still approved.
// Removing someone from the approved list signs them out on their next
// request. Cached for the request, so the layout and page share one lookup.
export const getSignedInLecturer = cache(
  async (): Promise<SignedInLecturer | null> => {
    const token = (await cookies()).get(SESSION_COOKIE)?.value;
    const session = verifySessionToken(token, process.env.AUTH_SECRET);
    if (!session) return null;
    const lecturer = await getLecturer(db, session.lecturerId);
    if (!lecturer?.email || !(await isApproved(db, lecturer.email))) {
      return null;
    }
    return {
      ...lecturer,
      email: lecturer.email,
      isAdmin: isAdminEmail(lecturer.email),
    };
  },
);

// The security boundary: call at the top of every lecturer page, server
// action and route handler, and scope everything it reads or changes to the
// returned lecturer. proxy.ts is only an early redirect.
export async function requireLecturer(): Promise<SignedInLecturer> {
  const lecturer = await getSignedInLecturer();
  if (!lecturer) redirect("/login");
  return lecturer;
}

export async function requireAdmin(): Promise<SignedInLecturer> {
  const lecturer = await requireLecturer();
  if (!lecturer.isAdmin) notFound();
  return lecturer;
}

export function secureCookies(): boolean {
  // Tied to the URL scheme rather than NODE_ENV so a plain-HTTP LAN
  // deployment can still store the cookie.
  return (process.env.APP_URL ?? "").startsWith("https://");
}

export async function startLecturerSession(lecturerId: number): Promise<void> {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("Missing environment variable AUTH_SECRET");
  (await cookies()).set(
    SESSION_COOKIE,
    createSessionToken(secret, lecturerId),
    {
      httpOnly: true,
      sameSite: "lax",
      secure: secureCookies(),
      path: "/",
      maxAge: SESSION_TTL_MS / 1000,
    },
  );
}

export async function endLecturerSession(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
}
