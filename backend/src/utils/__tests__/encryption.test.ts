import { describe, it, expect } from 'vitest';
import { encryptCode, decryptCode, validateEncryptionKey } from '../encryption.js';
import { randomBytes } from 'node:crypto';

// A valid 64-hex-char key (32 bytes)
const VALID_KEY = 'a'.repeat(64);

// A different valid key for wrong-key tests
const WRONG_KEY = 'b'.repeat(64);

describe('encryption utilities', () => {
  // ─── validateEncryptionKey ───────────────────────────────────

  describe('validateEncryptionKey()', () => {
    it('accepts a valid 64-char hex key', () => {
      expect(() => validateEncryptionKey(VALID_KEY)).not.toThrow();
    });

    it('accepts mixed-case hex key', () => {
      const mixedKey = 'aAbBcCdDeEfF0011223344556677889900112233445566778899aAbBcCdDeEfF';
      expect(() => validateEncryptionKey(mixedKey)).not.toThrow();
    });

    it('rejects key shorter than 64 chars', () => {
      expect(() => validateEncryptionKey('a'.repeat(62))).toThrow(
        'Invalid encryption key',
      );
    });

    it('rejects key longer than 64 chars', () => {
      expect(() => validateEncryptionKey('a'.repeat(66))).toThrow(
        'Invalid encryption key',
      );
    });

    it('rejects non-hex characters', () => {
      const badKey = 'g'.repeat(64);
      expect(() => validateEncryptionKey(badKey)).toThrow(
        'Invalid encryption key',
      );
    });

    it('rejects empty string', () => {
      expect(() => validateEncryptionKey('')).toThrow('Invalid encryption key');
    });
  });

  // ─── encryptCode / decryptCode roundtrip ─────────────────────

  describe('encryptCode() + decryptCode() roundtrip', () => {
    it('encrypts and decrypts back to original plaintext', () => {
      const plaintext = 'GIFT-CARD-CODE-12345';
      const encrypted = encryptCode(plaintext, VALID_KEY);
      const decrypted = decryptCode(encrypted, VALID_KEY);
      expect(decrypted).toBe(plaintext);
    });

    it('roundtrips with special characters', () => {
      const plaintext = '🎫 Gift-Card/Special+Chars=2024!';
      const encrypted = encryptCode(plaintext, VALID_KEY);
      const decrypted = decryptCode(encrypted, VALID_KEY);
      expect(decrypted).toBe(plaintext);
    });

    it('roundtrips with long plaintext', () => {
      const plaintext = 'A'.repeat(500);
      const encrypted = encryptCode(plaintext, VALID_KEY);
      const decrypted = decryptCode(encrypted, VALID_KEY);
      expect(decrypted).toBe(plaintext);
    });

    it('produces different ciphertexts for same plaintext (random IV)', () => {
      const plaintext = 'SAME-CODE';
      const encrypted1 = encryptCode(plaintext, VALID_KEY);
      const encrypted2 = encryptCode(plaintext, VALID_KEY);
      expect(encrypted1).not.toBe(encrypted2);

      // But both decrypt to the same thing
      expect(decryptCode(encrypted1, VALID_KEY)).toBe(plaintext);
      expect(decryptCode(encrypted2, VALID_KEY)).toBe(plaintext);
    });

    it('encrypted format is iv:ciphertext:authTag (3 hex segments)', () => {
      const encrypted = encryptCode('test', VALID_KEY);
      const parts = encrypted.split(':');
      expect(parts).toHaveLength(3);

      // Each segment should be valid hex
      for (const part of parts) {
        expect(part).toMatch(/^[0-9a-f]+$/);
      }

      // IV should be 24 hex chars (12 bytes)
      expect(parts[0]).toHaveLength(24);
    });
  });

  // ─── encryptCode negative tests ──────────────────────────────

  describe('encryptCode() negative tests', () => {
    it('rejects empty plaintext', () => {
      expect(() => encryptCode('', VALID_KEY)).toThrow(
        'Plaintext must be a non-empty string',
      );
    });

    it('rejects invalid key', () => {
      expect(() => encryptCode('test', 'short')).toThrow(
        'Invalid encryption key',
      );
    });
  });

  // ─── decryptCode negative tests ──────────────────────────────

  describe('decryptCode() negative tests', () => {
    it('fails with wrong key (auth tag mismatch)', () => {
      const encrypted = encryptCode('secret-code', VALID_KEY);
      expect(() => decryptCode(encrypted, WRONG_KEY)).toThrow();
    });

    it('fails with tampered ciphertext', () => {
      const encrypted = encryptCode('secret-code', VALID_KEY);
      const parts = encrypted.split(':');
      // Flip a byte in ciphertext
      const tampered = parts[0] + ':ff' + parts[1].slice(2) + ':' + parts[2];
      expect(() => decryptCode(tampered, VALID_KEY)).toThrow();
    });

    it('rejects malformed string with wrong segment count (1)', () => {
      expect(() => decryptCode('no-colons-here', VALID_KEY)).toThrow(
        'Malformed encrypted string',
      );
    });

    it('rejects malformed string with wrong segment count (2)', () => {
      expect(() => decryptCode('only:two', VALID_KEY)).toThrow(
        'Malformed encrypted string',
      );
    });

    it('rejects malformed string with 4 segments', () => {
      expect(() => decryptCode('a:b:c:d', VALID_KEY)).toThrow(
        'Malformed encrypted string',
      );
    });

    it('rejects empty encrypted string', () => {
      expect(() => decryptCode('', VALID_KEY)).toThrow(
        'Encrypted string must be non-empty',
      );
    });

    it('rejects empty segments (::)', () => {
      expect(() => decryptCode('::', VALID_KEY)).toThrow(
        'one or more segments are empty',
      );
    });

    it('rejects invalid key on decrypt', () => {
      expect(() => decryptCode('aabb:ccdd:eeff', 'short')).toThrow(
        'Invalid encryption key',
      );
    });
  });
});
