// Stateless signed tokens for the student flow.
//
//   QR token:  <sessionId>.<exp>.<nonce>.<sig>             (encoded in the QR)
//   Pass:      <sessionId>.<exp>.<nonce>.<deviceId>.<sig>  (issued after a scan)
//
// `exp` is Unix seconds. The two kinds are signed with different prefixes, so
// one can never be accepted as the other.
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const QR_ROTATE_SECONDS = 60;
export const QR_TTL_SECONDS = 90;
export const PASS_TTL_SECONDS = 180;

export type TokenError = "MALFORMED" | "BAD_SIGNATURE" | "EXPIRED";

export type QrPayload = { sessionId: string; exp: number; nonce: string };
export type PassPayload = QrPayload & { deviceId: string };

type Result<T> = { ok: true; payload: T } | { ok: false; error: TokenError };

const PART = /^[A-Za-z0-9_-]+$/;

function getSecret(secret?: string): string {
  const value = secret ?? process.env.QR_SECRET;
  if (!value) throw new Error("Missing environment variable QR_SECRET");
  return value;
}

function sign(kind: "qr" | "pass", body: string, secret: string): string {
  return createHmac("sha256", secret)
    .update(`${kind}:${body}`)
    .digest("base64url");
}

function signatureMatches(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function verify(
  kind: "qr" | "pass",
  token: string | undefined | null,
  partCount: number,
  now: number,
  secret?: string,
): Result<string[]> {
  if (!token) return { ok: false, error: "MALFORMED" };
  const parts = token.split(".");
  if (parts.length !== partCount || !parts.every((part) => PART.test(part))) {
    return { ok: false, error: "MALFORMED" };
  }
  const signature = parts.pop() as string;
  if (!/^\d+$/.test(parts[1])) return { ok: false, error: "MALFORMED" };
  if (!signatureMatches(signature, sign(kind, parts.join("."), getSecret(secret)))) {
    return { ok: false, error: "BAD_SIGNATURE" };
  }
  if (Number(parts[1]) * 1000 <= now) return { ok: false, error: "EXPIRED" };
  return { ok: true, payload: parts };
}

export function signQrToken(
  sessionId: string,
  now: number = Date.now(),
  secret?: string,
): { token: string; payload: QrPayload } {
  const payload: QrPayload = {
    sessionId,
    exp: Math.floor(now / 1000) + QR_TTL_SECONDS,
    nonce: randomBytes(6).toString("base64url"),
  };
  const body = `${payload.sessionId}.${payload.exp}.${payload.nonce}`;
  return { token: `${body}.${sign("qr", body, getSecret(secret))}`, payload };
}

export function verifyQrToken(
  token: string | undefined | null,
  now: number = Date.now(),
  secret?: string,
): Result<QrPayload> {
  const result = verify("qr", token, 4, now, secret);
  if (!result.ok) return result;
  const [sessionId, exp, nonce] = result.payload;
  return { ok: true, payload: { sessionId, exp: Number(exp), nonce } };
}

// Issued when a valid QR is scanned, so a slow typist is not rejected at
// submit. Bound to the device that scanned and carries the QR's nonce.
export function signPass(
  input: { sessionId: string; nonce: string; deviceId: string },
  now: number = Date.now(),
  secret?: string,
): string {
  const exp = Math.floor(now / 1000) + PASS_TTL_SECONDS;
  const body = `${input.sessionId}.${exp}.${input.nonce}.${input.deviceId}`;
  return `${body}.${sign("pass", body, getSecret(secret))}`;
}

export function verifyPass(
  token: string | undefined | null,
  now: number = Date.now(),
  secret?: string,
): Result<PassPayload> {
  const result = verify("pass", token, 5, now, secret);
  if (!result.ok) return result;
  const [sessionId, exp, nonce, deviceId] = result.payload;
  return { ok: true, payload: { sessionId, exp: Number(exp), nonce, deviceId } };
}
