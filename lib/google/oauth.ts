// Sign in with Google. The same consent gives the app offline access to the
// files it creates or the lecturer picks (drive.file), which is how it reaches
// each lecturer's attendance sheet and submissions folder. Every scope here is
// non-sensitive, so the Google app can be published to Production without a
// security review, and refresh tokens don't expire after 7 days as they do
// for apps left in Testing.
import { google } from "googleapis";

export const DRIVE_FILE_SCOPE = "https://www.googleapis.com/auth/drive.file";
export const SIGN_IN_SCOPES = ["openid", "email", "profile", DRIVE_FILE_SCOPE];

// Holds "<state>.<PKCE verifier>" between the redirect to Google and back.
export const OAUTH_COOKIE = "google_oauth";

export type OAuthClient = InstanceType<typeof google.auth.OAuth2>;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable ${name}`);
  return value;
}

export function oauthClientId(): string {
  return requireEnv("GOOGLE_OAUTH_CLIENT_ID");
}

export function redirectUri(): string {
  return new URL("/auth/google/callback", requireEnv("APP_URL")).toString();
}

export function newOAuthClient(): OAuthClient {
  return new google.auth.OAuth2(
    oauthClientId(),
    requireEnv("GOOGLE_OAUTH_CLIENT_SECRET"),
    redirectUri(),
  );
}
