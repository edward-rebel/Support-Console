import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from "node:crypto";

// AES-256-GCM encryption for OAuth tokens at rest (spec §3.7). The key is the
// hex-encoded ENCRYPTION_KEY env var (32 bytes / 64 hex chars).

export interface EncryptedPayload {
  v: 1;
  iv: string; // base64
  tag: string; // base64
  data: string; // base64
}

function keyBuffer(hexKey: string): Buffer {
  const buf = Buffer.from(hexKey, "hex");
  if (buf.length !== 32) {
    throw new Error(
      "ENCRYPTION_KEY must be 32 bytes hex-encoded (64 hex chars). " +
        "Generate one with: openssl rand -hex 32",
    );
  }
  return buf;
}

export function encryptJson(value: unknown, hexKey: string): EncryptedPayload {
  const key = keyBuffer(hexKey);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const plaintext = Buffer.from(JSON.stringify(value), "utf8");
  const data = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    v: 1,
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    data: data.toString("base64"),
  };
}

export function decryptJson<T>(payload: EncryptedPayload, hexKey: string): T {
  const key = keyBuffer(hexKey);
  const iv = Buffer.from(payload.iv, "base64");
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(Buffer.from(payload.tag, "base64"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(payload.data, "base64")),
    decipher.final(),
  ]);
  return JSON.parse(plaintext.toString("utf8")) as T;
}
