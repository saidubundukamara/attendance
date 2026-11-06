// Starts Google sign-in. ?consent=1 forces the consent screen, which is the
// only time Google hands out a refresh token.
import { randomBytes } from "node:crypto";
import { Auth } from "googleapis";
import { cookies } from "next/headers";
import { secureCookies } from "@/lib/auth";
import {
  newOAuthClient,
  OAUTH_COOKIE,
  SIGN_IN_SCOPES,
} from "@/lib/google/oauth";

export async function GET(request: Request) {
  const consent = new URL(request.url).searchParams.get("consent") === "1";
  const client = newOAuthClient();
  const { codeVerifier, codeChallenge } =
    await client.generateCodeVerifierAsync();
  const state = randomBytes(24).toString("base64url");

  (await cookies()).set(OAUTH_COOKIE, `${state}.${codeVerifier}`, {
    httpOnly: true,
    sameSite: "lax",
    secure: secureCookies(),
    path: "/auth/google",
    maxAge: 10 * 60,
  });

  const url = client.generateAuthUrl({
    access_type: "offline",
    scope: SIGN_IN_SCOPES,
    include_granted_scopes: true,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: Auth.CodeChallengeMethod.S256,
    prompt: consent ? "consent select_account" : "select_account",
  });
  return Response.redirect(url, 302);
}
