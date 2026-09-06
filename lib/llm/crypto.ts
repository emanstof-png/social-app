import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

/**
 * Provider API keys are encrypted in the application before they touch
 * Supabase (ARCHITECTURE.md: provider_keys.key holds ciphertext only).
 *
 * AES-256-GCM. ENCRYPTION_KEY is 32 bytes, base64-encoded. Stored form is
 * "v1.<iv>.<tag>.<ciphertext>", each part base64. The version prefix is there
 * so the scheme can change later without guessing at what old rows contain.
 */

const VERSION = "v1";
const IV_BYTES = 12;
const KEY_BYTES = 32;

let cachedKey: Buffer | null = null;

function encryptionKey(): Buffer {
  if (cachedKey) return cachedKey;

  const raw = process.env.ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      "Missing ENCRYPTION_KEY. Set it in .env.local (local) and in the Vercel " +
        "project settings (deployed). Generate one with: " +
        "openssl rand -base64 32",
    );
  }

  const key = Buffer.from(raw, "base64");
  if (key.length !== KEY_BYTES) {
    throw new Error(
      `ENCRYPTION_KEY must decode to ${KEY_BYTES} bytes, got ${key.length}. ` +
        "Generate one with: openssl rand -base64 32",
    );
  }

  cachedKey = key;
  return cachedKey;
}

/** Test seam: forget the cached key after changing process.env in a test. */
export function resetEncryptionKeyCache(): void {
  cachedKey = null;
}

export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return [
    VERSION,
    iv.toString("base64"),
    tag.toString("base64"),
    ciphertext.toString("base64"),
  ].join(".");
}

export function decryptSecret(stored: string): string {
  const parts = stored.split(".");
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new Error(
      "Stored provider key is not in the expected v1 format. It was probably " +
        "written with a different ENCRYPTION_KEY or scheme; re-enter the key " +
        "in Settings.",
    );
  }

  const [, ivB64, tagB64, dataB64] = parts;
  const decipher = createDecipheriv(
    "aes-256-gcm",
    encryptionKey(),
    Buffer.from(ivB64, "base64"),
  );
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));

  try {
    return Buffer.concat([
      decipher.update(Buffer.from(dataB64, "base64")),
      decipher.final(),
    ]).toString("utf8");
  } catch (cause) {
    // GCM auth failure: wrong key, or the row was tampered with.
    throw new Error(
      "Could not decrypt a stored provider key. ENCRYPTION_KEY has most " +
        "likely changed since the key was saved; re-enter it in Settings.",
      { cause },
    );
  }
}

/**
 * What Settings shows instead of the key itself: last 4 characters only, so
 * the user can tell which key is stored without the plaintext reaching the
 * browser.
 */
export function maskSecret(plaintext: string): string {
  const tail = plaintext.slice(-4);
  return tail.length === 4 ? `••••${tail}` : "••••";
}

/** Constant-time compare, for confirming a re-entered key matches. */
export function secretsMatch(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
