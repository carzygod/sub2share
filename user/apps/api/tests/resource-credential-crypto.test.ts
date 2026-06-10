import assert from "node:assert/strict";
import test from "node:test";
import {
  credentialFingerprint,
  decryptSupplierResourceCredential,
  encryptSupplierResourceCredential
} from "../src/modules/suppliers/resource-credential-crypto.js";

test("encrypts supplier resource credentials without storing plaintext", () => {
  const secret = "sk-test-resource-secret";
  const encryptionSecret = "test-encryption-secret-at-least-sixteen-characters";
  const encrypted = encryptSupplierResourceCredential(secret, encryptionSecret);

  assert.notEqual(encrypted.encryptedValue, secret);
  assert.equal(encrypted.encryptionVersion, "aes-256-gcm:v1");
  assert.equal(encrypted.keyFingerprint, credentialFingerprint(secret));
  assert.equal(decryptSupplierResourceCredential(encrypted.encryptedValue, encryptionSecret), secret);
});

test("rejects supplier resource credentials decrypted with the wrong key", () => {
  const encrypted = encryptSupplierResourceCredential(
    "sk-test-resource-secret",
    "test-encryption-secret-at-least-sixteen-characters"
  );

  assert.throws(() => decryptSupplierResourceCredential(encrypted.encryptedValue, "different-secret-at-least-sixteen-characters"));
});
