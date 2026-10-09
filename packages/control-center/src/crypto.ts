import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

export interface SecretCodec {
  /** Encrypts a plain secret into the `enc:v1:iv:tag:payload` storage format. */
  encrypt(plainValue: string): string;
  /** Decrypts; returns "" when the value cannot be opened with the current key. */
  decrypt(storedValue: string): string;
  /** Masked preview for API responses: `...last4`. */
  preview(plainOrStoredValue: string): string;
}

/**
 * Format-compatible with the legacy AES-256-GCM `enc:v1:` storage, so values
 * migrated from older deployments keep decrypting.
 */
export function createSecretCodec(secretKeySource: string): SecretCodec {
  const key = createHash("sha256").update(secretKeySource || "aigc-provider-control-center-fallback-secret").digest();

  function encrypt(plainValue: string) {
    if (!plainValue) return "";
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const encrypted = Buffer.concat([cipher.update(plainValue, "utf-8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `enc:v1:${iv.toString("base64")}:${tag.toString("base64")}:${encrypted.toString("base64")}`;
  }

  function decrypt(storedValue: string) {
    if (!storedValue) return "";
    if (!storedValue.startsWith("enc:v1:")) return storedValue;
    try {
      const [, , ivRaw, tagRaw, encryptedRaw] = storedValue.split(":");
      if (!ivRaw || !tagRaw || !encryptedRaw) return "";
      const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivRaw, "base64"));
      decipher.setAuthTag(Buffer.from(tagRaw, "base64"));
      return Buffer.concat([decipher.update(Buffer.from(encryptedRaw, "base64")), decipher.final()]).toString("utf-8");
    } catch {
      return "";
    }
  }

  function preview(plainOrStoredValue: string) {
    const plain = decrypt(plainOrStoredValue) || plainOrStoredValue;
    return plain ? `...${plain.slice(-4)}` : "";
  }

  return { encrypt, decrypt, preview };
}
