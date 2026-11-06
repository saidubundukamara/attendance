"use server";

import { redirect } from "next/navigation";
import { endLecturerSession } from "@/lib/auth";

// Signing in happens at /auth/google; see app/auth/google.
export async function logout(): Promise<void> {
  await endLecturerSession();
  redirect("/login");
}
