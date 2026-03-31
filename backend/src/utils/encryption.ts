// ─── AES-256-GCM Encryption Utilities ──────────────────────────
// Encrypts/decrypts gift card codes using AES-256-GCM with random
// 12-byte IV. Storage format: hex(iv):hex(ciphertext):hex(authTag).

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96-bit IV recommended for GCM
const AUTH_TAG_LENGTH = 16; // 128-bit auth tag

// ─── Key Validation ────────────────────────────────────────────

/**
 * Validates that a hex key is exactly 64 hex characters (32 bytes).
 * Throws a descriptive error if not.
 */
export function validateEncryptionKey(hexKey: string): void {
  if (typeof hexKey !== 'string' || !/^[0-9a-fA-F]{64}$/.test(hexKey)) {
    throw new Error(
      `Invalid encryption key: expected exactly 64 hex characters (32 bytes for AES-256), got ${typeof hexKey === 'string' ? hexKey.length : typeof hexKey} characters`,
    );
  }
}

// ─── Encrypt ───────────────────────────────────────────────────

/**
 * Encrypt a plaintext string with AES-256-GCM.
 * Returns `hex(iv):hex(ciphertext):hex(authTag)`.
 */
export function encryptCode(plaintext: string, hexKey: string): string {
  if (typeof plaintext !== 'string' || plaintext.length === 0) {
    throw new Error('Plaintext must be a non-empty string');
  }

  validateEncryptionKey(hexKey);

  const key = Buffer.from(hexKey, 'hex');
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });

  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);

  const authTag = cipher.getAuthTag();

  return `${iv.toString('hex')}:${encrypted.toString('hex')}:${authTag.toString('hex')}`;
}

// ─── Decrypt ───────────────────────────────────────────────────

/**
 * Decrypt an AES-256-GCM encrypted string.
 * Expects format `hex(iv):hex(ciphertext):hex(authTag)`.
 */
export function decryptCode(encrypted: string, hexKey: string): string {
  if (typeof encrypted !== 'string' || encrypted.length === 0) {
    throw new Error('Encrypted string must be non-empty');
  }

  validateEncryptionKey(hexKey);

  const parts = encrypted.split(':');
  if (parts.length !== 3) {
    throw new Error(
      `Malformed encrypted string: expected format "iv:ciphertext:authTag" (3 colon-separated segments), got ${parts.length} segment(s)`,
    );
  }

  const [ivHex, ciphertextHex, authTagHex] = parts;

  // Validate hex segments aren't empty
  if (!ivHex || !ciphertextHex || !authTagHex) {
    throw new Error('Malformed encrypted string: one or more segments are empty');
  }

  const iv = Buffer.from(ivHex, 'hex');
  const ciphertext = Buffer.from(ciphertextHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');

  const decipher = createDecipheriv(ALGORITHM, Buffer.from(hexKey, 'hex'), iv, {
    authTagLength: AUTH_TAG_LENGTH,
  });
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);

  return decrypted.toString('utf8');
}
