// Signed lecturer session values. Pure functions with no Next.js imports so
// they can be used from proxy.ts, server code and tests alike.
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE = "lecturer_session";
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

function sign(secret: string, expiresAt: number): string {
  return createHmac("sha256", secret)
    .update(`lecturer-session:${expiresAt}`)
    .digest("base64url");
}

function safeEqual(a: string, b: string): boolean {
  // Hashing first gives equal-length buffers and hides the length.
  const left = createHash("sha256").update(a).digest();
  const right = createHash("sha256").update(b).digest();
  return timingSafeEqual(left, right);
}

export function createSessionToken(
  secret: string,
  now: number = Date.now(),
  ttlMs: number = SESSION_TTL_MS,
): string {
  const expiresAt = now + ttlMs;
  return `${expiresAt}.${sign(secret, expiresAt)}`;
}

export function verifySessionToken(
  token: string | undefined,
  secret: string | undefined,
  now: number = Date.now(),
): boolean {
  if (!token || !secret) return false;
  const [expiresPart, signature, ...rest] = token.split(".");
  if (!expiresPart || !signature || rest.length > 0) return false;
  if (!/^\d+$/.test(expiresPart)) return false;
  const expiresAt = Number(expiresPart);
  if (!safeEqual(signature, sign(secret, expiresAt))) return false;
  return expiresAt > now;
}

export function verifyPassword(
  input: string,
  expected: string | undefined,
): boolean {
  if (!expected) return false;
  return safeEqual(input, expected);
}
