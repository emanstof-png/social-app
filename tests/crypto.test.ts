import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  decryptSecret,
  encryptSecret,
  maskSecret,
  resetEncryptionKeyCache,
  secretsMatch,
} from "@/lib/llm/crypto";

/**
 * provider_keys.key holds ciphertext only (ARCHITECTURE.md). These cover the
 * round trip and the ways it is meant to fail loudly rather than silently
 * returning a wrong key.
 */

const KEY_A = randomBytes(32).toString("base64");
const KEY_B = randomBytes(32).toString("base64");

function useKey(key: string | undefined) {
  if (key === undefined) delete process.env.ENCRYPTION_KEY;
  else process.env.ENCRYPTION_KEY = key;
  resetEncryptionKeyCache();
}

const originalKey = process.env.ENCRYPTION_KEY;

beforeEach(() => useKey(KEY_A));
afterEach(() => useKey(originalKey));

describe("encryptSecret / decryptSecret", () => {
  it("round-trips a key", () => {
    const secret = "sk-or-v1-abcdef0123456789";
    expect(decryptSecret(encryptSecret(secret))).toBe(secret);
  });

  it("produces different ciphertext each time, so rows do not leak equality", () => {
    const secret = "sk-or-v1-abcdef0123456789";
    expect(encryptSecret(secret)).not.toBe(encryptSecret(secret));
  });

  it("writes the versioned four-part format", () => {
    const parts = encryptSecret("hello").split(".");
    expect(parts).toHaveLength(4);
    expect(parts[0]).toBe("v1");
  });

  it("round-trips non-ASCII", () => {
    const secret = "clé-æøå-🔑";
    expect(decryptSecret(encryptSecret(secret))).toBe(secret);
  });

  it("refuses to decrypt under a different ENCRYPTION_KEY", () => {
    const stored = encryptSecret("sk-or-v1-abcdef");
    useKey(KEY_B);
    expect(() => decryptSecret(stored)).toThrow(/ENCRYPTION_KEY has most likely changed/);
  });

  it("detects a tampered ciphertext rather than returning garbage", () => {
    const stored = encryptSecret("sk-or-v1-abcdef");
    const parts = stored.split(".");
    const data = Buffer.from(parts[3], "base64");
    data[0] ^= 0xff;
    parts[3] = data.toString("base64");

    expect(() => decryptSecret(parts.join("."))).toThrow();
  });

  it("rejects a value that is not in the v1 format", () => {
    expect(() => decryptSecret("plaintext-key")).toThrow(/expected v1 format/);
  });

  it("explains how to generate a key when ENCRYPTION_KEY is missing", () => {
    useKey(undefined);
    expect(() => encryptSecret("x")).toThrow(/openssl rand -base64 32/);
  });

  it("rejects an ENCRYPTION_KEY that is the wrong length", () => {
    useKey(Buffer.from("too-short").toString("base64"));
    expect(() => encryptSecret("x")).toThrow(/must decode to 32 bytes/);
  });
});

describe("maskSecret", () => {
  it("shows only the last four characters", () => {
    expect(maskSecret("sk-or-v1-abcd1234")).toBe("••••1234");
  });

  it("reveals nothing for a very short value", () => {
    expect(maskSecret("ab")).toBe("••••");
  });
});

describe("secretsMatch", () => {
  it("matches identical secrets", () => {
    expect(secretsMatch("abc123", "abc123")).toBe(true);
  });

  it("rejects different secrets of equal length", () => {
    expect(secretsMatch("abc123", "abc124")).toBe(false);
  });

  it("rejects different lengths without throwing", () => {
    expect(secretsMatch("abc", "abcdef")).toBe(false);
  });
});
