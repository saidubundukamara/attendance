// The admin's view: approved emails, lecturers and cohorts. Takes the
// database as an argument so it can be tested without Next.js.
import { asc, count, eq, sql } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import {
  allowedEmails,
  classes,
  cohorts,
  lecturers,
} from "@/lib/db/schema";
import { adminEmails, normalizeEmail } from "@/lib/lecturers";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isEmail(value: string): boolean {
  return EMAIL.test(value) && value.length <= 254;
}

export async function approveEmail(db: Db, email: string, now = Date.now()) {
  await db
    .insert(allowedEmails)
    .values({ email: normalizeEmail(email), addedAt: now })
    .onConflictDoNothing()
    .run();
}

export async function revokeEmail(db: Db, email: string) {
  await db
    .delete(allowedEmails)
    .where(eq(allowedEmails.email, normalizeEmail(email)))
    .run();
}

export type AccessRow = {
  email: string;
  admin: boolean;
  // Approved here; admins are approved by ADMIN_EMAILS instead.
  approved: boolean;
  lecturer: {
    id: number;
    name: string;
    sheetName: string | null;
    hasSheet: boolean;
    connected: boolean;
    lastLoginAt: number | null;
    classCount: number;
  } | null;
};

// Everyone who can or could sign in, admins first, then by email.
export async function listAccess(db: Db): Promise<AccessRow[]> {
  const admins = adminEmails();
  const approved = await db.select().from(allowedEmails).all();
  const people = await db
    .select({
      id: lecturers.id,
      email: lecturers.email,
      name: lecturers.name,
      sheetId: lecturers.sheetId,
      sheetName: lecturers.sheetName,
      refreshTokenEnc: lecturers.refreshTokenEnc,
      authError: lecturers.authError,
      lastLoginAt: lecturers.lastLoginAt,
      classCount: sql<number>`(SELECT COUNT(*) FROM ${classes} WHERE ${classes.lecturerId} = ${lecturers.id})`,
    })
    .from(lecturers)
    .all();

  const rows = new Map<string, AccessRow>();
  const row = (email: string) => {
    let r = rows.get(email);
    if (!r) {
      r = { email, admin: admins.has(email), approved: false, lecturer: null };
      rows.set(email, r);
    }
    return r;
  };
  for (const email of admins) row(email);
  for (const a of approved) row(a.email).approved = true;
  for (const p of people) {
    if (!p.email) continue;
    row(p.email).lecturer = {
      id: p.id,
      name: p.name,
      sheetName: p.sheetName,
      hasSheet: Boolean(p.sheetId),
      connected: Boolean(p.refreshTokenEnc) && !p.authError,
      lastLoginAt: p.lastLoginAt,
      classCount: p.classCount,
    };
  }
  return [...rows.values()].sort(
    (a, b) => Number(b.admin) - Number(a.admin) || a.email.localeCompare(b.email),
  );
}

export async function listCohorts(db: Db) {
  return await db
    .select({
      id: cohorts.id,
      name: cohorts.name,
      moduleCount: count(classes.id),
    })
    .from(cohorts)
    .leftJoin(classes, eq(classes.cohortId, cohorts.id))
    .groupBy(cohorts.id)
    .orderBy(asc(cohorts.name))
    .all();
}

export type CohortResult = { ok: true } | { ok: false; error: string };

function isUnique(error: unknown): boolean {
  for (let e = error as { message?: string; cause?: unknown } | undefined; e; e = e.cause as typeof e) {
    if (e.message?.includes("UNIQUE constraint failed")) return true;
  }
  return false;
}

export async function createCohort(
  db: Db,
  name: string,
  now = Date.now(),
): Promise<CohortResult> {
  try {
    await db.insert(cohorts).values({ name, createdAt: now }).run();
    return { ok: true };
  } catch (error) {
    if (isUnique(error)) return { ok: false, error: `“${name}” already exists.` };
    throw error;
  }
}

export async function renameCohort(
  db: Db,
  id: number,
  name: string,
): Promise<CohortResult> {
  try {
    const result = await db
      .update(cohorts)
      .set({ name })
      .where(eq(cohorts.id, id))
      .run();
    return result.rowsAffected
      ? { ok: true }
      : { ok: false, error: "Cohort not found." };
  } catch (error) {
    if (isUnique(error)) return { ok: false, error: `“${name}” already exists.` };
    throw error;
  }
}

// Only while no module is in it, so no student loses their way to a module.
export async function deleteCohort(db: Db, id: number): Promise<CohortResult> {
  const row = await db
    .delete(cohorts)
    .where(
      sql`${cohorts.id} = ${id} AND NOT EXISTS (SELECT 1 FROM ${classes} WHERE ${classes.cohortId} = ${id})`,
    )
    .returning({ id: cohorts.id })
    .get();
  if (row) return { ok: true };
  const exists = await db
    .select({ id: cohorts.id })
    .from(cohorts)
    .where(eq(cohorts.id, id))
    .get();
  return exists
    ? { ok: false, error: "Modules are still in this cohort. Move them first." }
    : { ok: false, error: "Cohort not found." };
}
