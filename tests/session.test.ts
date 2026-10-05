import { describe, expect, it } from "vitest";
import { clearHits, isRateLimited, recordHit } from "@/lib/ratelimit";
import {
  createSessionToken,
  SESSION_TTL_MS,
  verifyPassword,
  verifySessionToken,
} from "@/lib/session";

const SECRET = "test-secret";
const NOW = 1_800_000_000_000;

describe("session token", () => {
  it("round-trips", () => {
    const token = createSessionToken(SECRET, NOW);
    expect(verifySessionToken(token, SECRET, NOW + 1000)).toBe(true);
  });

  it("is rejected once expired", () => {
    const token = createSessionToken(SECRET, NOW);
    expect(verifySessionToken(token, SECRET, NOW + SESSION_TTL_MS)).toBe(false);
  });

  it("is rejected when the expiry is extended", () => {
    const [expires, signature] = createSessionToken(SECRET, NOW).split(".");
    const forged = `${Number(expires) + 1}.${signature}`;
    expect(verifySessionToken(forged, SECRET, NOW)).toBe(false);
  });

  it("is rejected with a different secret, or when malformed or missing", () => {
    const token = createSessionToken(SECRET, NOW);
    expect(verifySessionToken(token, "other-secret", NOW)).toBe(false);
    expect(verifySessionToken(token, undefined, NOW)).toBe(false);
    expect(verifySessionToken(undefined, SECRET, NOW)).toBe(false);
    expect(verifySessionToken("garbage", SECRET, NOW)).toBe(false);
    expect(verifySessionToken(`${token}.extra`, SECRET, NOW)).toBe(false);
  });
});

describe("verifyPassword", () => {
  it("matches only the exact password", () => {
    expect(verifyPassword("hunter2", "hunter2")).toBe(true);
    expect(verifyPassword("hunter", "hunter2")).toBe(false);
    expect(verifyPassword("", "hunter2")).toBe(false);
    expect(verifyPassword("anything", undefined)).toBe(false);
    expect(verifyPassword("", "")).toBe(false);
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
