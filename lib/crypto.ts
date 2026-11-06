// Encryption for Google refresh tokens at rest. AES-256-GCM with a key from
// TOKEN_ENCRYPTION_KEY (32 bytes, base64; `openssl rand -base64 32`).
//
//   v1.<iv>.<tag>.<ciphertext>   (base64url parts)
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

function key(secret?: string): Buffer {
  const value = secret ?? process.env.TOKEN_ENCRYPTION_KEY;
  if (!value) throw new Error("Missing environment variable TOKEN_ENCRYPTION_KEY");
  const bytes = Buffer.from(value, "base64");
  if (bytes.length !== 32) {
    throw new Error("TOKEN_ENCRYPTION_KEY must be 32 bytes, base64 encoded.");
  }
  return bytes;
}

export function encryptSecret(plain: string, secret?: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(secret), iv);
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [
    "v1",
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    body.toString("base64url"),
  ].join(".");
}

// Throws when the value was tampered with or encrypted under another key.
export function decryptSecret(sealed: string, secret?: string): string {
  const [version, iv, tag, body] = sealed.split(".");
  if (version !== "v1" || !iv || !tag || body === undefined) {
    throw new Error("Unreadable encrypted value.");
  }
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key(secret),
    Buffer.from(iv, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(body, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}
