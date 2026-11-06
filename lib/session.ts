// Signed lecturer session values. Pure functions with no Next.js imports so
// they can be used from proxy.ts, server code and tests alike.
//
//   <lecturerId>.<expiresAt ms>.<signature>
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE = "lecturer_session";
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

function sign(secret: string, lecturerId: number, expiresAt: number): string {
  return createHmac("sha256", secret)
    .update(`lecturer-session:${lecturerId}:${expiresAt}`)
    .digest("base64url");
}

export function safeEqual(a: string, b: string): boolean {
  // Hashing first gives equal-length buffers and hides the length.
  const left = createHash("sha256").update(a).digest();
  const right = createHash("sha256").update(b).digest();
  return timingSafeEqual(left, right);
}

export function createSessionToken(
  secret: string,
  lecturerId: number,
  now: number = Date.now(),
  ttlMs: number = SESSION_TTL_MS,
): string {
  const expiresAt = now + ttlMs;
  return `${lecturerId}.${expiresAt}.${sign(secret, lecturerId, expiresAt)}`;
}

// The signed-in lecturer's id, or null when the token is missing, forged or
// expired.
export function verifySessionToken(
  token: string | undefined,
  secret: string | undefined,
  now: number = Date.now(),
): { lecturerId: number } | null {
  if (!token || !secret) return null;
  const [idPart, expiresPart, signature, ...rest] = token.split(".");
  if (!idPart || !expiresPart || !signature || rest.length > 0) return null;
  if (!/^[1-9]\d{0,15}$/.test(idPart) || !/^\d+$/.test(expiresPart)) {
    return null;
  }
  const lecturerId = Number(idPart);
  const expiresAt = Number(expiresPart);
  if (!safeEqual(signature, sign(secret, lecturerId, expiresAt))) return null;
  return expiresAt > now ? { lecturerId } : null;
}
