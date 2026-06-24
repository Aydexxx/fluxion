import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret, loadEncryptionKey } from "../crypto";

const KEY_B64 = "Ov7Z9RtjhZKnmPXQRoSPCwtGeTK8ellFXcOQZzMu4oA=";
const key = loadEncryptionKey(KEY_B64);

describe("crypto — key loading", () => {
  it("accepts a 32-byte base64 key", () => {
    expect(loadEncryptionKey(KEY_B64)).toHaveLength(32);
  });

  it("accepts a 64-char hex key", () => {
    const hex = "a".repeat(64);
    expect(loadEncryptionKey(hex)).toHaveLength(32);
  });

  it("rejects a key that is not 32 bytes", () => {
    expect(() => loadEncryptionKey("dG9vLXNob3J0")).toThrow(/32 bytes/);
  });
});

describe("crypto — AES-256-GCM round-trip", () => {
  it("decrypts what it encrypts", () => {
    const plaintext = JSON.stringify({ token: "sk-secret-123", note: "ünïcodé ✓" });
    const packed = encryptSecret(plaintext, key);
    expect(decryptSecret(packed, key)).toBe(plaintext);
  });

  it("produces the versioned v1:iv:tag:ciphertext format", () => {
    const packed = encryptSecret("hello", key);
    const parts = packed.split(":");
    expect(parts).toHaveLength(4);
    expect(parts[0]).toBe("v1");
  });

  it("never stores the plaintext in the ciphertext", () => {
    const packed = encryptSecret("super-secret-value", key);
    expect(packed).not.toContain("super-secret-value");
  });

  it("uses a fresh IV each time, so equal plaintexts encrypt differently", () => {
    expect(encryptSecret("same", key)).not.toBe(encryptSecret("same", key));
  });

  it("fails authentication when the ciphertext is tampered with", () => {
    const packed = encryptSecret("tamper-me", key);
    const parts = packed.split(":");
    const data = Buffer.from(parts[3], "base64");
    data[0] ^= 0xff; // flip a bit
    const tampered = [parts[0], parts[1], parts[2], data.toString("base64")].join(":");
    expect(() => decryptSecret(tampered, key)).toThrow();
  });

  it("fails to decrypt with a different key", () => {
    const other = loadEncryptionKey("2mLPAPxi2jTwoTjIR2QeSFgD1ZU2t2vBX5183NZIb54=");
    const packed = encryptSecret("cross-key", key);
    expect(() => decryptSecret(packed, other)).toThrow();
  });

  it("rejects a malformed payload", () => {
    expect(() => decryptSecret("not-a-valid-payload", key)).toThrow(/Malformed/);
  });
});
