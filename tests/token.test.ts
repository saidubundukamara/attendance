import { describe, expect, it } from "vitest";
import {
  PASS_TTL_SECONDS,
  QR_TTL_SECONDS,
  signPass,
  signQrToken,
  verifyPass,
  verifyQrToken,
} from "@/lib/token";

const SECRET = "test-qr-secret";
const NOW = 1_800_000_000_000;
const SESSION = "0b0e3a52-6f0a-4f6e-9a57-3f1f3b7c9d10";
const DEVICE = "7d9c1e44-2b7b-4f0e-8f55-9a1d2c3b4e5f";

describe("QR token", () => {
  it("round-trips", () => {
    const { token, payload } = signQrToken(SESSION, NOW, SECRET);
    expect(verifyQrToken(token, NOW + 1000, SECRET)).toEqual({
      ok: true,
      payload,
    });
    expect(payload.sessionId).toBe(SESSION);
  });

  it("uses a fresh nonce each time", () => {
    const a = signQrToken(SESSION, NOW, SECRET);
    const b = signQrToken(SESSION, NOW, SECRET);
    expect(a.payload.nonce).not.toBe(b.payload.nonce);
    expect(a.token).not.toBe(b.token);
  });

  it("expires after its lifetime", () => {
    const { token } = signQrToken(SESSION, NOW, SECRET);
    const justBefore = NOW + (QR_TTL_SECONDS - 1) * 1000;
    const after = NOW + QR_TTL_SECONDS * 1000;
    expect(verifyQrToken(token, justBefore, SECRET).ok).toBe(true);
    expect(verifyQrToken(token, after, SECRET)).toEqual({
      ok: false,
      error: "EXPIRED",
    });
  });

  it("fails when any character is changed", () => {
    const { token } = signQrToken(SESSION, NOW, SECRET);
    for (let i = 0; i < token.length; i++) {
      if (token[i] === ".") continue;
      const swapped = token[i] === "A" ? "B" : "A";
      const tampered = token.slice(0, i) + swapped + token.slice(i + 1);
      expect(verifyQrToken(tampered, NOW, SECRET).ok).toBe(false);
    }
  });

  it("cannot have its session or expiry swapped", () => {
    const { token } = signQrToken(SESSION, NOW, SECRET);
    const [, exp, nonce, sig] = token.split(".");
    const otherSession = `${DEVICE}.${exp}.${nonce}.${sig}`;
    const longer = `${SESSION}.${Number(exp) + 3600}.${nonce}.${sig}`;
    expect(verifyQrToken(otherSession, NOW, SECRET)).toEqual({
      ok: false,
      error: "BAD_SIGNATURE",
    });
    expect(verifyQrToken(longer, NOW, SECRET)).toEqual({
      ok: false,
      error: "BAD_SIGNATURE",
    });
  });

  it("rejects a different secret and malformed input", () => {
    const { token } = signQrToken(SESSION, NOW, SECRET);
    expect(verifyQrToken(token, NOW, "other").ok).toBe(false);
    for (const bad of [undefined, null, "", "abc", "a.b.c.d", "a.1.c", "a b.1.c.d"]) {
      expect(verifyQrToken(bad, NOW, SECRET)).toEqual({
        ok: false,
        error: "MALFORMED",
      });
    }
  });
});

describe("check-in pass", () => {
  const input = { sessionId: SESSION, nonce: "abc123", deviceId: DEVICE };

  it("round-trips with the device and nonce", () => {
    const pass = signPass(input, NOW, SECRET);
    const result = verifyPass(pass, NOW + 1000, SECRET);
    expect(result.ok && result.payload).toMatchObject(input);
  });

  it("expires after its lifetime", () => {
    const pass = signPass(input, NOW, SECRET);
    const after = NOW + PASS_TTL_SECONDS * 1000;
    expect(verifyPass(pass, after - 1000, SECRET).ok).toBe(true);
    expect(verifyPass(pass, after, SECRET)).toEqual({
      ok: false,
      error: "EXPIRED",
    });
  });

  it("cannot be moved to another device", () => {
    const parts = signPass(input, NOW, SECRET).split(".");
    parts[3] = SESSION;
    expect(verifyPass(parts.join("."), NOW, SECRET)).toEqual({
      ok: false,
      error: "BAD_SIGNATURE",
    });
  });

  it("is not accepted as a QR token, and a QR token is not a pass", () => {
    const pass = signPass(input, NOW, SECRET);
    const { token } = signQrToken(SESSION, NOW, SECRET);
    expect(verifyQrToken(pass, NOW, SECRET).ok).toBe(false);
    expect(verifyPass(token, NOW, SECRET).ok).toBe(false);

    // Same field count, signed as the other kind.
    const [s, exp, nonce, sig] = token.split(".");
    expect(verifyPass(`${s}.${exp}.${nonce}.${DEVICE}.${sig}`, NOW, SECRET).ok).toBe(false);
  });
});
