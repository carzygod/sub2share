import { encryptSupplierResourceCredential } from "../suppliers/resource-credential-crypto.js";

export interface InitialResourceCredentialInput {
  credentialType?: string;
  credentialStatus?: string;
  credentialSecret?: string | null;
}

export function initialResourceCredentialCreateData(input: InitialResourceCredentialInput, encryptionSecret: string) {
  const secret = input.credentialSecret?.trim();
  if (!secret) return null;

  const encrypted = encryptSupplierResourceCredential(secret, encryptionSecret);
  return {
    credentialType: input.credentialType ?? "openai_refresh_token",
    encryptedValue: encrypted.encryptedValue,
    encryptionVersion: encrypted.encryptionVersion,
    keyFingerprint: encrypted.keyFingerprint,
    status: input.credentialStatus ?? "active"
  };
}
