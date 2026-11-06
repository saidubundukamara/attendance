import { describe, expect, it } from "vitest";
import { clearHits, isRateLimited, recordHit } from "@/lib/ratelimit";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import {
  createSessionToken,
  SESSION_TTL_MS,
  verifySessionToken,
} from "@/lib/session";

const SECRET = "test-secret";
const NOW = 1_800_000_000_000;

describe("session token", () => {
  it("round-trips with the lecturer id", () => {
    const token = createSessionToken(SECRET, 7, NOW);
    expect(verifySessionToken(token, SECRET, NOW + 1000)).toEqual({
      lecturerId: 7,
    });
  });

  it("is rejected once expired", () => {
    const token = createSessionToken(SECRET, 7, NOW);
    expect(verifySessionToken(token, SECRET, NOW + SESSION_TTL_MS)).toBeNull();
  });

  it("is rejected when the expiry is extended", () => {
    const [id, expires, signature] = createSessionToken(SECRET, 7, NOW).split(".");
    const forged = `${id}.${Number(expires) + 1}.${signature}`;
    expect(verifySessionToken(forged, SECRET, NOW)).toBeNull();
  });

  it("is rejected when the lecturer id is swapped", () => {
    const [, expires, signature] = createSessionToken(SECRET, 7, NOW).split(".");
    expect(verifySessionToken(`8.${expires}.${signature}`, SECRET, NOW)).toBeNull();
  });

  it("is rejected with a different secret, or when malformed or missing", () => {
    const token = createSessionToken(SECRET, 7, NOW);
    expect(verifySessionToken(token, "other-secret", NOW)).toBeNull();
    expect(verifySessionToken(token, undefined, NOW)).toBeNull();
    expect(verifySessionToken(undefined, SECRET, NOW)).toBeNull();
    expect(verifySessionToken("garbage", SECRET, NOW)).toBeNull();
    expect(verifySessionToken(`${token}.extra`, SECRET, NOW)).toBeNull();
    expect(verifySessionToken(`0.${NOW + 1000}.x`, SECRET, NOW)).toBeNull();
  });
});

describe("token encryption", () => {
  const KEY = Buffer.alloc(32, 7).toString("base64");

  it("round-trips and uses a fresh IV each time", () => {
    const a = encryptSecret("1//refresh-token", KEY);
    const b = encryptSecret("1//refresh-token", KEY);
    expect(a).not.toBe(b);
    expect(decryptSecret(a, KEY)).toBe("1//refresh-token");
  });

  it("refuses a tampered value or the wrong key", () => {
    const sealed = encryptSecret("secret", KEY);
    const parts = sealed.split(".");
    parts[3] = Buffer.from("other").toString("base64url");
    expect(() => decryptSecret(parts.join("."), KEY)).toThrow();
    expect(() =>
      decryptSecret(sealed, Buffer.alloc(32, 8).toString("base64")),
    ).toThrow();
    expect(() => encryptSecret("x", "short")).toThrow(/32 bytes/);
  });
});


describe("rate limit", () => {
  it("blocks after the limit and recovers when the window passes", () => {
    const key = "test:limit";
    clearHits(key);
    for (let i = 0; i < 3; i++) {
      expect(isRateLimited(key, 3, 1000, NOW + i)).toBe(false);
      recordHit(key, 1000, NOW + i);
    }
    expect(isRateLimited(key, 3, 1000, NOW + 10)).toBe(true);
    expect(isRateLimited(key, 3, 1000, NOW + 1001)).toBe(false);
  });
});
