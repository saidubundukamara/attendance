// Google sends the lecturer back here after sign-in.
import { cookies } from "next/headers";
import { startLecturerSession } from "@/lib/auth";
import { encryptSecret } from "@/lib/crypto";
import { db } from "@/lib/db";
import {
  DRIVE_FILE_SCOPE,
  newOAuthClient,
  OAUTH_COOKIE,
  oauthClientId,
} from "@/lib/google/oauth";
import { isApproved, recordSignIn } from "@/lib/lecturers";
import { isRateLimited, recordHit } from "@/lib/ratelimit";
import { getClientIp } from "@/lib/request";
import { safeEqual } from "@/lib/session";

const LIMIT = 20;
const WINDOW_MS = 10 * 60 * 1000;

function go(path: string): Response {
  const base = process.env.APP_URL ?? "http://localhost:3000";
  return Response.redirect(new URL(path, base), 302);
}

function loginError(code: string): Response {
  return go(`/login?error=${encodeURIComponent(code)}`);
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const jar = await cookies();
  const saved = jar.get(OAUTH_COOKIE)?.value ?? "";
  jar.delete({ name: OAUTH_COOKIE, path: "/auth/google" });

  const key = `oauth:${await getClientIp()}`;
  if (isRateLimited(key, LIMIT, WINDOW_MS)) return loginError("rate-limited");
  recordHit(key, WINDOW_MS);

  // Cancelled on Google's screen.
  if (params.get("error")) return loginError("cancelled");

  const code = params.get("code");
  const state = params.get("state") ?? "";
  const [savedState, codeVerifier] = saved.split(".");
  if (!code || !savedState || !codeVerifier || !safeEqual(state, savedState)) {
    return loginError("expired");
  }

  let tokens;
  let profile;
  try {
    const client = newOAuthClient();
    ({ tokens } = await client.getToken({ code, codeVerifier }));
    if (!tokens.id_token) throw new Error("No ID token.");
    const ticket = await client.verifyIdToken({
      idToken: tokens.id_token,
      audience: oauthClientId(),
    });
    profile = ticket.getPayload();
  } catch (error) {
    console.error("Google sign-in failed", error);
    return loginError("google");
  }
  if (!profile?.sub || !profile.email || !profile.email_verified) {
    return loginError("unverified");
  }
  if (!(await isApproved(db, profile.email))) {
    return go(`/login?error=not-approved&email=${encodeURIComponent(profile.email)}`);
  }
  // The lecturer can untick Drive access on the consent screen.
  if (!(tokens.scope ?? "").split(" ").includes(DRIVE_FILE_SCOPE)) {
    return loginError("drive-scope");
  }

  const lecturer = await recordSignIn(db, {
    googleSub: profile.sub,
    email: profile.email,
    name: profile.name ?? "",
    refreshTokenEnc: tokens.refresh_token
      ? encryptSecret(tokens.refresh_token)
      : null,
    // The old sheet isn't copied over: drive.file only reaches a sheet the
    // lecturer has picked, so the admin picks it again on /setup.
    legacyDriveFolderId: process.env.GOOGLE_DRIVE_FOLDER_ID || undefined,
  });
  // Google only issues a refresh token on the consent screen. Without one
  // the app can't reach the sheet or Drive while the lecturer is away.
  if (!lecturer.refreshTokenEnc) return go("/auth/google?consent=1");

  await startLecturerSession(lecturer.id);
  return go(lecturer.sheetId ? "/dashboard" : "/setup");
}
