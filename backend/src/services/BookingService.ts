// ─── BookingService ────────────────────────────────────────────
// CRUD layer for the bookings table. Follows the factory function
// pattern (K004) — createBookingService(conn, encryptionKey) returns
// the service interface. Encrypts passenger PII with AES-256-GCM
// via encryptCode/decryptCode (shared with GiftCardService).
// Status transitions: PENDING → CONFIRMED, PENDING → FAILED.

import type { DatabaseConnection } from './Database.js';
import type { Booking, BookingStatus, PassengerDetails } from '../types/index.js';
import { encryptCode, decryptCode, validateEncryptionKey } from '../utils/encryption.js';
import { logger } from '../logger.js';

// ─── DB Row Shape ──────────────────────────────────────────────

interface BookingRow {
  id: number;
  strategy_id: number;
  wallet_address: string;
  offer_id: string;
  duffel_order_id: string | null;
  booking_reference: string | null;
  passenger_data_encrypted: string;
  amount_usd: number;
  currency: string;
  status: BookingStatus;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

// ─── Valid Status Transitions ──────────────────────────────────

const VALID_TRANSITIONS: Record<BookingStatus, BookingStatus[]> = {
  PENDING: ['CONFIRMED', 'FAILED'],
  CONFIRMED: [],
  FAILED: [],
};

// ─── Service Interface ─────────────────────────────────────────

export interface BookingService {
  /** Create a new booking with encrypted passenger PII. */
  create(params: {
    strategyId: number;
    walletAddress: string;
    offerId: string;
    passengers: PassengerDetails[];
    amountUsd: number;
    currency: string;
  }): Promise<Booking>;

  /** Get a booking by ID with fully decrypted passenger data. */
  getById(bookingId: number): Promise<Booking | undefined>;

  /** Get all bookings for a wallet with decrypted passenger names only. */
  getByWallet(walletAddress: string): Promise<Booking[]>;

  /** Transition a booking's status. Only PENDING → CONFIRMED or PENDING → FAILED. */
  updateStatus(
    bookingId: number,
    newStatus: BookingStatus,
    updates?: { duffelOrderId?: string; bookingReference?: string; errorMessage?: string },
  ): Promise<Booking>;
}

// ─── Factory ───────────────────────────────────────────────────

export function createBookingService(conn: DatabaseConnection, encryptionKey: string): BookingService {
  const log = logger.child({ component: 'BookingService' });

  // Validate key at construction time — fail fast
  validateEncryptionKey(encryptionKey);

  /** Decrypt full passenger JSON from the encrypted column. */
  function decryptPassengers(encrypted: string): PassengerDetails[] {
    try {
      const json = decryptCode(encrypted, encryptionKey);
      return JSON.parse(json) as PassengerDetails[];
    } catch (err) {
      log.error({ error: (err as Error).message }, 'Failed to decrypt passenger data');
      throw new Error('Failed to decrypt passenger data');
    }
  }

  /** Decrypt only passenger names for list views (avoids exposing full PII). */
  function decryptPassengerNames(encrypted: string): PassengerDetails[] {
    const full = decryptPassengers(encrypted);
    return full.map((p) => ({
      givenName: p.givenName,
      familyName: p.familyName,
      bornOn: '',
      email: '',
      phoneNumber: '',
      gender: p.gender,
    }));
  }

  /** Convert a DB row to the Booking domain type with full passenger decryption. */
  function toBookingFull(row: BookingRow): Booking {
    return {
      id: String(row.id),
      strategyId: String(row.strategy_id),
      walletAddress: row.wallet_address,
      offerId: row.offer_id,
      duffelOrderId: row.duffel_order_id,
      bookingReference: row.booking_reference,
      passengers: decryptPassengers(row.passenger_data_encrypted),
      amountUsd: row.amount_usd,
      currency: row.currency,
      status: row.status,
      errorMessage: row.error_message,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  /** Convert a DB row to the Booking domain type with names-only decryption. */
  function toBookingList(row: BookingRow): Booking {
    return {
      id: String(row.id),
      strategyId: String(row.strategy_id),
      walletAddress: row.wallet_address,
      offerId: row.offer_id,
      duffelOrderId: row.duffel_order_id,
      bookingReference: row.booking_reference,
      passengers: decryptPassengerNames(row.passenger_data_encrypted),
      amountUsd: row.amount_usd,
      currency: row.currency,
      status: row.status,
      errorMessage: row.error_message,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  return {
    async create(params): Promise<Booking> {
      if (!params.walletAddress || params.walletAddress.trim().length === 0) {
        throw new Error('Wallet address must be a non-empty string');
      }
      if (!params.offerId || params.offerId.trim().length === 0) {
        throw new Error('Offer ID must be a non-empty string');
      }
      if (!params.passengers || params.passengers.length === 0) {
        throw new Error('At least one passenger is required');
      }
      if (!Number.isFinite(params.amountUsd) || params.amountUsd <= 0) {
        throw new Error(`Amount must be a positive number, got ${params.amountUsd}`);
      }

      // Encrypt full passenger JSON
      const passengerJson = JSON.stringify(params.passengers);
      const encrypted = encryptCode(passengerJson, encryptionKey);

      const result = await conn.run(
        `INSERT INTO bookings (strategy_id, wallet_address, offer_id, passenger_data_encrypted, amount_usd, currency, status)
         VALUES (?, ?, ?, ?, ?, ?, 'PENDING')`,
        params.strategyId,
        params.walletAddress,
        params.offerId,
        encrypted,
        params.amountUsd,
        params.currency,
      );

      // Retrieve via lastInsertRowid — portable across SQLite/PostgreSQL
      const row = await conn.get<BookingRow>(
        'SELECT * FROM bookings WHERE id = ?',
        result.lastInsertRowid,
      );

      if (!row) {
        throw new Error('Failed to retrieve booking after insert');
      }

      log.info(
        {
          bookingId: row.id,
          strategyId: params.strategyId,
          walletAddress: params.walletAddress,
          offerId: params.offerId,
          amountUsd: params.amountUsd,
        },
        'Booking created',
      );

      return toBookingFull(row);
    },

    async getById(bookingId: number): Promise<Booking | undefined> {
      const row = await conn.get<BookingRow>(
        'SELECT * FROM bookings WHERE id = ?',
        bookingId,
      );

      if (!row) return undefined;

      return toBookingFull(row);
    },

    async getByWallet(walletAddress: string): Promise<Booking[]> {
      const rows = await conn.all<BookingRow>(
        'SELECT * FROM bookings WHERE wallet_address = ? ORDER BY id DESC',
        walletAddress,
      );
      return rows.map(toBookingList);
    },

    async updateStatus(bookingId, newStatus, updates = {}): Promise<Booking> {
      const existing = await conn.get<BookingRow>(
        'SELECT * FROM bookings WHERE id = ?',
        bookingId,
      );

      if (!existing) {
        throw new Error(`Booking not found: id=${bookingId}`);
      }

      const allowed = VALID_TRANSITIONS[existing.status];
      if (!allowed || !allowed.includes(newStatus)) {
        throw new Error(
          `Invalid status transition: ${existing.status} → ${newStatus} (allowed: ${allowed?.join(', ') || 'none'})`,
        );
      }

      // Build dynamic update
      const setClauses: string[] = ["status = ?", "updated_at = datetime('now')"];
      const params: unknown[] = [newStatus];

      if (updates.duffelOrderId !== undefined) {
        setClauses.push('duffel_order_id = ?');
        params.push(updates.duffelOrderId);
      }
      if (updates.bookingReference !== undefined) {
        setClauses.push('booking_reference = ?');
        params.push(updates.bookingReference);
      }
      if (updates.errorMessage !== undefined) {
        setClauses.push('error_message = ?');
        params.push(updates.errorMessage);
      }

      params.push(bookingId);
      await conn.run(
        `UPDATE bookings SET ${setClauses.join(', ')} WHERE id = ?`,
        ...params,
      );

      const updated = await conn.get<BookingRow>(
        'SELECT * FROM bookings WHERE id = ?',
        bookingId,
      );

      if (!updated) {
        throw new Error(`Failed to retrieve booking after status update: id=${bookingId}`);
      }

      log.info(
        { bookingId, from: existing.status, to: newStatus },
        'Booking status updated',
      );

      return toBookingFull(updated);
    },
  };
}
