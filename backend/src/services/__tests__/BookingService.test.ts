import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Database, type DatabaseConnection } from '../../services/Database.js';
import { createBookingService, type BookingService } from '../BookingService.js';
import type { PassengerDetails } from '../../types/index.js';

// 32-byte hex key for testing
const TEST_KEY = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2';

const TEST_PASSENGER: PassengerDetails = {
  givenName: 'Jane',
  familyName: 'Smith',
  bornOn: '1985-03-20',
  email: 'jane@example.com',
  phoneNumber: '+19876543210',
  gender: 'female',
};

const TEST_PASSENGER_2: PassengerDetails = {
  givenName: 'Bob',
  familyName: 'Jones',
  bornOn: '1992-07-10',
  email: 'bob@example.com',
  phoneNumber: '+11112223333',
  gender: 'male',
};

describe('BookingService', () => {
  let db: Database;
  let conn: DatabaseConnection;
  let svc: BookingService;

  beforeEach(async () => {
    db = new Database(':memory:');
    conn = await db.connect();
    await db.runMigrations();

    // Insert a strategy for FK constraint
    await conn.run(
      `INSERT INTO strategies (name, owner_wallet, token_mint, fee_source, threshold_sol, slippage_bps, distribution_mode, credit_mode, cron_expression)
       VALUES ('Test Strategy', 'wallet123', 'mint123', 'CLAIMABLE_POSITIONS', 0.5, 50, 'OWNER_ONLY', 'DUFFEL_BOOKING', '0 * * * *')`,
    );

    svc = createBookingService(conn, TEST_KEY);
  });

  afterEach(() => {
    db.close();
  });

  // ─── Construction ────────────────────────────────────────────

  describe('factory', () => {
    it('throws on invalid encryption key', () => {
      expect(() => createBookingService(conn, 'short')).toThrow('Invalid encryption key');
    });

    it('throws on empty encryption key', () => {
      expect(() => createBookingService(conn, '')).toThrow('Invalid encryption key');
    });
  });

  // ─── create() ────────────────────────────────────────────────

  describe('create()', () => {
    it('creates a booking with encrypted passenger data', async () => {
      const booking = await svc.create({
        strategyId: 1,
        walletAddress: 'wallet123',
        offerId: 'off_001',
        passengers: [TEST_PASSENGER],
        amountUsd: 199.99,
        currency: 'USD',
      });

      expect(booking.id).toBe('1');
      expect(booking.strategyId).toBe('1');
      expect(booking.walletAddress).toBe('wallet123');
      expect(booking.offerId).toBe('off_001');
      expect(booking.status).toBe('PENDING');
      expect(booking.amountUsd).toBe(199.99);
      expect(booking.currency).toBe('USD');
      expect(booking.duffelOrderId).toBeNull();
      expect(booking.bookingReference).toBeNull();
      expect(booking.errorMessage).toBeNull();
    });

    it('encrypts and decrypts passenger data correctly', async () => {
      const booking = await svc.create({
        strategyId: 1,
        walletAddress: 'wallet123',
        offerId: 'off_001',
        passengers: [TEST_PASSENGER, TEST_PASSENGER_2],
        amountUsd: 399.98,
        currency: 'USD',
      });

      expect(booking.passengers).toHaveLength(2);
      expect(booking.passengers[0].givenName).toBe('Jane');
      expect(booking.passengers[0].familyName).toBe('Smith');
      expect(booking.passengers[0].email).toBe('jane@example.com');
      expect(booking.passengers[1].givenName).toBe('Bob');
      expect(booking.passengers[1].familyName).toBe('Jones');
    });

    it('stores encrypted data in DB — not plaintext', async () => {
      await svc.create({
        strategyId: 1,
        walletAddress: 'wallet123',
        offerId: 'off_001',
        passengers: [TEST_PASSENGER],
        amountUsd: 199.99,
        currency: 'USD',
      });

      const row = await conn.get<{ passenger_data_encrypted: string }>(
        'SELECT passenger_data_encrypted FROM bookings WHERE id = 1',
      );

      expect(row).toBeDefined();
      // Encrypted format: iv:ciphertext:authTag
      const parts = row!.passenger_data_encrypted.split(':');
      expect(parts).toHaveLength(3);
      // Must not contain plaintext passenger name
      expect(row!.passenger_data_encrypted).not.toContain('Jane');
      expect(row!.passenger_data_encrypted).not.toContain('Smith');
    });

    it('throws on empty wallet address', async () => {
      await expect(
        svc.create({
          strategyId: 1,
          walletAddress: '',
          offerId: 'off_001',
          passengers: [TEST_PASSENGER],
          amountUsd: 100,
          currency: 'USD',
        }),
      ).rejects.toThrow('Wallet address must be a non-empty string');
    });

    it('throws on empty offer ID', async () => {
      await expect(
        svc.create({
          strategyId: 1,
          walletAddress: 'wallet123',
          offerId: '',
          passengers: [TEST_PASSENGER],
          amountUsd: 100,
          currency: 'USD',
        }),
      ).rejects.toThrow('Offer ID must be a non-empty string');
    });

    it('throws on empty passengers array', async () => {
      await expect(
        svc.create({
          strategyId: 1,
          walletAddress: 'wallet123',
          offerId: 'off_001',
          passengers: [],
          amountUsd: 100,
          currency: 'USD',
        }),
      ).rejects.toThrow('At least one passenger is required');
    });

    it('throws on zero amount', async () => {
      await expect(
        svc.create({
          strategyId: 1,
          walletAddress: 'wallet123',
          offerId: 'off_001',
          passengers: [TEST_PASSENGER],
          amountUsd: 0,
          currency: 'USD',
        }),
      ).rejects.toThrow('Amount must be a positive number');
    });

    it('throws on negative amount', async () => {
      await expect(
        svc.create({
          strategyId: 1,
          walletAddress: 'wallet123',
          offerId: 'off_001',
          passengers: [TEST_PASSENGER],
          amountUsd: -50,
          currency: 'USD',
        }),
      ).rejects.toThrow('Amount must be a positive number');
    });
  });

  // ─── getById() ───────────────────────────────────────────────

  describe('getById()', () => {
    it('returns booking with fully decrypted passenger data', async () => {
      const created = await svc.create({
        strategyId: 1,
        walletAddress: 'wallet123',
        offerId: 'off_001',
        passengers: [TEST_PASSENGER],
        amountUsd: 199.99,
        currency: 'USD',
      });

      const found = await svc.getById(Number(created.id));

      expect(found).toBeDefined();
      expect(found!.passengers[0].givenName).toBe('Jane');
      expect(found!.passengers[0].email).toBe('jane@example.com');
      expect(found!.passengers[0].phoneNumber).toBe('+19876543210');
    });

    it('returns undefined for non-existent booking', async () => {
      const found = await svc.getById(999);
      expect(found).toBeUndefined();
    });
  });

  // ─── getByWallet() ──────────────────────────────────────────

  describe('getByWallet()', () => {
    it('returns bookings with names-only decryption', async () => {
      await svc.create({
        strategyId: 1,
        walletAddress: 'wallet123',
        offerId: 'off_001',
        passengers: [TEST_PASSENGER],
        amountUsd: 199.99,
        currency: 'USD',
      });

      const bookings = await svc.getByWallet('wallet123');

      expect(bookings).toHaveLength(1);
      // Names should be present
      expect(bookings[0].passengers[0].givenName).toBe('Jane');
      expect(bookings[0].passengers[0].familyName).toBe('Smith');
      // PII should be redacted
      expect(bookings[0].passengers[0].email).toBe('');
      expect(bookings[0].passengers[0].phoneNumber).toBe('');
      expect(bookings[0].passengers[0].bornOn).toBe('');
    });

    it('returns empty array for unknown wallet', async () => {
      const bookings = await svc.getByWallet('unknown_wallet');
      expect(bookings).toEqual([]);
    });

    it('returns multiple bookings in descending order', async () => {
      await svc.create({
        strategyId: 1,
        walletAddress: 'wallet123',
        offerId: 'off_001',
        passengers: [TEST_PASSENGER],
        amountUsd: 100,
        currency: 'USD',
      });
      await svc.create({
        strategyId: 1,
        walletAddress: 'wallet123',
        offerId: 'off_002',
        passengers: [TEST_PASSENGER_2],
        amountUsd: 200,
        currency: 'USD',
      });

      const bookings = await svc.getByWallet('wallet123');

      expect(bookings).toHaveLength(2);
      // Descending order by ID
      expect(bookings[0].offerId).toBe('off_002');
      expect(bookings[1].offerId).toBe('off_001');
    });
  });

  // ─── updateStatus() ──────────────────────────────────────────

  describe('updateStatus()', () => {
    it('transitions PENDING → CONFIRMED with duffelOrderId and bookingReference', async () => {
      const created = await svc.create({
        strategyId: 1,
        walletAddress: 'wallet123',
        offerId: 'off_001',
        passengers: [TEST_PASSENGER],
        amountUsd: 199.99,
        currency: 'USD',
      });

      const updated = await svc.updateStatus(Number(created.id), 'CONFIRMED', {
        duffelOrderId: 'ord_001',
        bookingReference: 'ABC123',
      });

      expect(updated.status).toBe('CONFIRMED');
      expect(updated.duffelOrderId).toBe('ord_001');
      expect(updated.bookingReference).toBe('ABC123');
    });

    it('transitions PENDING → FAILED with error message', async () => {
      const created = await svc.create({
        strategyId: 1,
        walletAddress: 'wallet123',
        offerId: 'off_001',
        passengers: [TEST_PASSENGER],
        amountUsd: 199.99,
        currency: 'USD',
      });

      const updated = await svc.updateStatus(Number(created.id), 'FAILED', {
        errorMessage: 'Offer expired',
      });

      expect(updated.status).toBe('FAILED');
      expect(updated.errorMessage).toBe('Offer expired');
    });

    it('rejects CONFIRMED → PENDING transition', async () => {
      const created = await svc.create({
        strategyId: 1,
        walletAddress: 'wallet123',
        offerId: 'off_001',
        passengers: [TEST_PASSENGER],
        amountUsd: 199.99,
        currency: 'USD',
      });

      await svc.updateStatus(Number(created.id), 'CONFIRMED', {
        duffelOrderId: 'ord_001',
        bookingReference: 'ABC123',
      });

      await expect(
        svc.updateStatus(Number(created.id), 'PENDING' as any),
      ).rejects.toThrow('Invalid status transition: CONFIRMED → PENDING');
    });

    it('rejects CONFIRMED → FAILED transition', async () => {
      const created = await svc.create({
        strategyId: 1,
        walletAddress: 'wallet123',
        offerId: 'off_001',
        passengers: [TEST_PASSENGER],
        amountUsd: 199.99,
        currency: 'USD',
      });

      await svc.updateStatus(Number(created.id), 'CONFIRMED', {
        duffelOrderId: 'ord_001',
        bookingReference: 'ABC123',
      });

      await expect(
        svc.updateStatus(Number(created.id), 'FAILED'),
      ).rejects.toThrow('Invalid status transition: CONFIRMED → FAILED');
    });

    it('rejects FAILED → CONFIRMED transition', async () => {
      const created = await svc.create({
        strategyId: 1,
        walletAddress: 'wallet123',
        offerId: 'off_001',
        passengers: [TEST_PASSENGER],
        amountUsd: 199.99,
        currency: 'USD',
      });

      await svc.updateStatus(Number(created.id), 'FAILED', {
        errorMessage: 'Offer expired',
      });

      await expect(
        svc.updateStatus(Number(created.id), 'CONFIRMED'),
      ).rejects.toThrow('Invalid status transition: FAILED → CONFIRMED');
    });

    it('throws on non-existent booking', async () => {
      await expect(svc.updateStatus(999, 'CONFIRMED')).rejects.toThrow('Booking not found: id=999');
    });
  });
});
