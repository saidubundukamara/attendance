"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  approveEmail,
  createCohort,
  deleteCohort,
  isEmail,
  renameCohort,
  revokeEmail,
} from "@/lib/admin";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { isAdminEmail, normalizeEmail } from "@/lib/lecturers";

export type AdminState = { ok: boolean; message: string } | undefined;

export async function approveEmailAction(
  _prev: AdminState,
  formData: FormData,
): Promise<AdminState> {
  await requireAdmin();
  const email = normalizeEmail(String(formData.get("email") ?? ""));
  if (!isEmail(email)) return { ok: false, message: "Enter an email address." };
  await approveEmail(db, email);
  revalidatePath("/admin");
  return { ok: true, message: `${email} can now sign in.` };
}

export async function revokeEmailAction(email: string): Promise<AdminState> {
  await requireAdmin();
  if (isAdminEmail(email)) {
    return { ok: false, message: "Admins are set by ADMIN_EMAILS." };
  }
  await revokeEmail(db, email);
  revalidatePath("/admin");
  return { ok: true, message: `${email} can no longer sign in.` };
}

const cohortName = z
  .string()
  .trim()
  .min(1, "Enter a name.")
  .max(80, "Keep the name under 80 characters.");

export async function createCohortAction(
  _prev: AdminState,
  formData: FormData,
): Promise<AdminState> {
  await requireAdmin();
  const name = cohortName.safeParse(formData.get("name") ?? "");
  if (!name.success) return { ok: false, message: name.error.issues[0].message };
  const result = await createCohort(db, name.data);
  if (!result.ok) return { ok: false, message: result.error };
  revalidatePath("/admin");
  return { ok: true, message: `Added “${name.data}”.` };
}

export async function renameCohortAction(
  _prev: AdminState,
  formData: FormData,
): Promise<AdminState> {
  await requireAdmin();
  const id = z.coerce.number().int().positive().safeParse(formData.get("id"));
  const name = cohortName.safeParse(formData.get("name") ?? "");
  if (!id.success) return { ok: false, message: "Cohort not found." };
  if (!name.success) return { ok: false, message: name.error.issues[0].message };
  const result = await renameCohort(db, id.data, name.data);
  if (!result.ok) return { ok: false, message: result.error };
  revalidatePath("/admin");
  return { ok: true, message: "Saved." };
}

export async function deleteCohortAction(id: number): Promise<AdminState> {
  await requireAdmin();
  const result = await deleteCohort(db, id);
  if (!result.ok) return { ok: false, message: result.error };
  revalidatePath("/admin");
  return { ok: true, message: "Deleted." };
}
