"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { z } from "zod";
import { requireLecturer } from "@/lib/auth";
import { db } from "@/lib/db";
import { lecturers } from "@/lib/db/schema";
import { googleAuthFor, noteGoogleFailure } from "@/lib/google/auth";
import {
  getSpreadsheetTitle,
  listAttendanceTabs,
  sheetCtxFor,
} from "@/lib/sheets/client";
import {
  scheduleSubmissionsSyncAfterRoster,
  syncRoster,
} from "@/lib/sheets/sync";

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// A short-lived access token for the Google Picker in the lecturer's
// browser. Picking a file there is what grants this app drive.file access
// to it.
export async function pickerToken(): Promise<
  { ok: true; token: string } | { ok: false; error: string }
> {
  const lecturer = await requireLecturer();
  try {
    const auth = googleAuthFor(lecturer);
    const { token } = await auth
      .getAccessToken()
      .catch((error) => noteGoogleFailure(lecturer.id, error));
    if (!token) return { ok: false, error: "Google did not return a token." };
    return { ok: true, token };
  } catch (error) {
    return { ok: false, error: message(error) };
  }
}

export type ConnectState =
  | { ok: true; title: string; tabs: number }
  | { ok: false; error: string }
  | undefined;

// The picker returns opaque file ids; anything else is refused.
const sheetId = z.string().regex(/^[A-Za-z0-9_-]{20,100}$/);

export async function connectSheet(id: string): Promise<ConnectState> {
  const lecturer = await requireLecturer();
  const parsed = sheetId.safeParse(id);
  if (!parsed.success) return { ok: false, error: "That isn't a Google Sheet." };

  const candidate = { ...lecturer, sheetId: parsed.data };
  let title: string;
  let tabs: string[];
  try {
    const ctx = sheetCtxFor(candidate);
    title = await getSpreadsheetTitle(ctx);
    tabs = await listAttendanceTabs(ctx);
  } catch (error) {
    return { ok: false, error: `Could not open the sheet: ${message(error)}` };
  }
  if (tabs.length === 0) {
    return {
      ok: false,
      error: `“${title}” has no tabs named “Attn of …”. Name each class's tab “Attn of <CLASS CODE>”, e.g. “Attn of BIT2101”, then pick it again.`,
    };
  }

  await db
    .update(lecturers)
    .set({ sheetId: parsed.data, sheetName: title })
    .where(eq(lecturers.id, lecturer.id))
    .run();

  try {
    const report = await syncRoster(candidate);
    after(() => scheduleSubmissionsSyncAfterRoster(lecturer.id, report));
  } catch (error) {
    // Connected anyway; the dashboard's Sync roster button retries.
    console.error("First roster sync failed", error);
  }
  revalidatePath("/", "layout");
  return { ok: true, title, tabs: tabs.length };
}
