import assert from "node:assert/strict";
import test from "node:test";
import { credentialFingerprint } from "../src/modules/suppliers/resource-credential-crypto.js";
import { initialResourceCredentialCreateData } from "../src/modules/admin/resource-credential-create.js";

test("initial resource credential create data encrypts an optional secret", () => {
  const data = initialResourceCredentialCreateData({
    credentialSecret: " test-refresh-token ",
    credentialType: "openai_refresh_token",
    credentialStatus: "active"
  }, "test-encryption-secret-at-least-sixteen-characters");

  assert.ok(data);
  assert.equal(data.credentialType, "openai_refresh_token");
  assert.equal(data.status, "active");
  assert.equal(data.encryptionVersion, "aes-256-gcm:v1");
  assert.equal(data.keyFingerprint, credentialFingerprint("test-refresh-token"));
  assert.notEqual(data.encryptedValue, "test-refresh-token");
});

test("initial resource credential create data is omitted without a secret", () => {
  assert.equal(initialResourceCredentialCreateData({}, "test-encryption-secret-at-least-sixteen-characters"), null);
  assert.equal(initialResourceCredentialCreateData({ credentialSecret: " " }, "test-encryption-secret-at-least-sixteen-characters"), null);
});
