// Who may sign in, and the lecturer record each Google account maps to.
// Takes the database as an argument so it can be tested without Next.js.
import { and, eq, isNull } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import { allowedEmails, lecturers } from "@/lib/db/schema";

export type Lecturer = typeof lecturers.$inferSelect;

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

// ADMIN_EMAILS: comma-separated. Admins can always sign in, approve other
// lecturers and manage cohorts.
export function adminEmails(env: string | undefined = process.env.ADMIN_EMAILS) {
  return new Set(
    (env ?? "")
      .split(",")
      .map(normalizeEmail)
      .filter(Boolean),
  );
}

export function isAdminEmail(email: string | null | undefined): boolean {
  return Boolean(email) && adminEmails().has(normalizeEmail(email as string));
}

export async function isApproved(db: Db, email: string): Promise<boolean> {
  const normalized = normalizeEmail(email);
  if (isAdminEmail(normalized)) return true;
  const row = await db
    .select({ email: allowedEmails.email })
    .from(allowedEmails)
    .where(eq(allowedEmails.email, normalized))
    .get();
  return Boolean(row);
}

export async function getLecturer(db: Db, id: number) {
  return await db.select().from(lecturers).where(eq(lecturers.id, id)).get();
}

export type SignInInput = {
  googleSub: string;
  email: string;
  name: string;
  // Encrypted. Google only sends a refresh token when the lecturer consents,
  // so a sign-in without one keeps the stored token.
  refreshTokenEnc: string | null;
  // The single-lecturer version's submissions folder, copied onto the
  // legacy row when an admin claims it. Reachable with drive.file because
  // the same Google Cloud project created it.
  legacyDriveFolderId?: string;
};

// Finds or creates the lecturer for a Google account and records the
// sign-in. The first admin to sign in takes over the data the migration kept
// from the single-lecturer version.
export async function recordSignIn(
  db: Db,
  input: SignInInput,
  now: number = Date.now(),
): Promise<Lecturer> {
  const email = normalizeEmail(input.email);
  return await db.transaction(async (tx) => {
    let row =
      (await tx
        .select()
        .from(lecturers)
        .where(eq(lecturers.googleSub, input.googleSub))
        .get()) ??
      (await tx.select().from(lecturers).where(eq(lecturers.email, email)).get());

    if (!row && isAdminEmail(email)) {
      const legacy = await tx
        .select()
        .from(lecturers)
        .where(and(isNull(lecturers.email), isNull(lecturers.googleSub)))
        .get();
      if (legacy) {
        row = await tx
          .update(lecturers)
          .set({
            driveFolderId:
              legacy.driveFolderId ?? input.legacyDriveFolderId ?? null,
          })
          .where(eq(lecturers.id, legacy.id))
          .returning()
          .get();
      }
    }

    const fields = {
      email,
      name: input.name,
      googleSub: input.googleSub,
      lastLoginAt: now,
      authError: null,
      ...(input.refreshTokenEnc
        ? { refreshTokenEnc: input.refreshTokenEnc }
        : {}),
    };
    if (row) {
      return await tx
        .update(lecturers)
        .set(fields)
        .where(eq(lecturers.id, row.id))
        .returning()
        .get();
    }
    return await tx
      .insert(lecturers)
      .values({ ...fields, createdAt: now })
      .returning()
      .get();
  });
}
