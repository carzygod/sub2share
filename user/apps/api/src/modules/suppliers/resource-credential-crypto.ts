import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const encryptionVersion = "aes-256-gcm:v1";

export function encryptSupplierResourceCredential(secret: string, encryptionSecret: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(encryptionSecret), iv);
  const encrypted = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    encryptionVersion,
    encryptedValue: [
      encryptionVersion,
      iv.toString("base64url"),
      tag.toString("base64url"),
      encrypted.toString("base64url")
    ].join("."),
    keyFingerprint: credentialFingerprint(secret)
  };
}

export function decryptSupplierResourceCredential(encryptedValue: string, encryptionSecret: string) {
  const [version, ivText, tagText, encryptedText] = encryptedValue.split(".");
  if (version !== encryptionVersion || !ivText || !tagText || !encryptedText) {
    throw new Error("Unsupported supplier resource credential encryption payload");
  }

  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(encryptionSecret), Buffer.from(ivText, "base64url"));
  decipher.setAuthTag(Buffer.from(tagText, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedText, "base64url")),
    decipher.final()
  ]).toString("utf8");
}

export function credentialFingerprint(secret: string) {
  return createHash("sha256").update(secret).digest("hex").slice(0, 16);
}

function encryptionKey(secret: string) {
  return createHash("sha256").update(secret).digest();
}
