// A Google client acting as one lecturer, from their stored refresh token.
import { eq } from "drizzle-orm";
import { decryptSecret } from "@/lib/crypto";
import { db } from "@/lib/db";
import { lecturers } from "@/lib/db/schema";
import type { Lecturer } from "@/lib/lecturers";
import { DRIVE_FILE_SCOPE, newOAuthClient, type OAuthClient } from "./oauth";

export class GoogleNotConnectedError extends Error {
  constructor(message = "Google access for this lecturer is missing. Sign in again to reconnect.") {
    super(message);
    this.name = "GoogleNotConnectedError";
  }
}

// Clients are reused for a lecturer while their stored token is unchanged,
// so access tokens are refreshed only when they expire.
const globalForAuth = globalThis as unknown as {
  __googleClients?: Map<number, { tokenEnc: string; client: OAuthClient }>;
};
const clients = (globalForAuth.__googleClients ??= new Map());

export function googleAuthFor(
  lecturer: Pick<Lecturer, "id" | "refreshTokenEnc">,
): OAuthClient {
  const tokenEnc = lecturer.refreshTokenEnc;
  if (!tokenEnc) throw new GoogleNotConnectedError();
  const cached = clients.get(lecturer.id);
  if (cached?.tokenEnc === tokenEnc) return cached.client;

  const client = newOAuthClient();
  client.setCredentials({
    refresh_token: decryptSecret(tokenEnc),
    scope: DRIVE_FILE_SCOPE,
  });
  clients.set(lecturer.id, { tokenEnc, client });
  return client;
}

// Google answers invalid_grant once the lecturer revokes access, changes
// their password or the token otherwise stops working.
export function isRevokedGrant(error: unknown): boolean {
  for (let e = error as { message?: unknown; response?: { data?: { error?: unknown } }; cause?: unknown } | undefined; e; e = e.cause as typeof e) {
    if (e.response?.data?.error === "invalid_grant") return true;
    if (typeof e.message === "string" && e.message.includes("invalid_grant")) {
      return true;
    }
  }
  return false;
}

// Records a revoked token so the lecturer pages can ask them to reconnect.
// Rethrows a clearer error either way.
export async function noteGoogleFailure(
  lecturerId: number,
  error: unknown,
): Promise<never> {
  if (isRevokedGrant(error)) {
    clients.delete(lecturerId);
    const message =
      "Google access was revoked or has expired. Sign out and sign in again to reconnect.";
    await db
      .update(lecturers)
      .set({ authError: message })
      .where(eq(lecturers.id, lecturerId))
      .run();
    throw new GoogleNotConnectedError(message);
  }
  throw error;
}
