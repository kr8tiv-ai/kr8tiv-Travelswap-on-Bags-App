import { describe, it, expect } from 'vitest';
import { createTravelSwapClient } from '../TravelSwapClient.js';

const WALLET = 'WalletAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

describe('TravelSwapClient', () => {
  // ─── getBookingUrl() ─────────────────────────────────────────

  describe('getBookingUrl()', () => {
    it('generates booking URL with default FLIGHTBRAIN ref', () => {
      const client = createTravelSwapClient();
      const url = client.getBookingUrl(WALLET);

      expect(url).toContain('https://travelswap.xyz/book?');
      expect(url).toContain('ref=FLIGHTBRAIN');
      expect(url).toContain(`wallet=${WALLET}`);
    });

    it('uses custom partnerRef', () => {
      const client = createTravelSwapClient('CUSTOM_PARTNER');
      const url = client.getBookingUrl(WALLET);

      expect(url).toContain('ref=CUSTOM_PARTNER');
      expect(url).not.toContain('FLIGHTBRAIN');
    });

    it('includes wallet address in URL', () => {
      const client = createTravelSwapClient();
      const url = client.getBookingUrl(WALLET);

      const parsed = new URL(url);
      expect(parsed.searchParams.get('wallet')).toBe(WALLET);
    });
  });

  // ─── getGiftCardUrl() ────────────────────────────────────────

  describe('getGiftCardUrl()', () => {
    it('generates gift card URL with denomination and ref', () => {
      const client = createTravelSwapClient();
      const url = client.getGiftCardUrl(50, WALLET);

      expect(url).toContain('https://travelswap.xyz/gift-card?');
      expect(url).toContain('ref=FLIGHTBRAIN');
      expect(url).toContain('denomination=50');
      expect(url).toContain(`wallet=${WALLET}`);
    });

    it('handles different denominations', () => {
      const client = createTravelSwapClient();

      const url100 = client.getGiftCardUrl(100, WALLET);
      const url200 = client.getGiftCardUrl(200, WALLET);

      expect(url100).toContain('denomination=100');
      expect(url200).toContain('denomination=200');
    });

    it('uses custom partnerRef for gift card URLs', () => {
      const client = createTravelSwapClient('MY_REF');
      const url = client.getGiftCardUrl(50, WALLET);

      expect(url).toContain('ref=MY_REF');
    });

    it('URL-encodes special characters in wallet address', () => {
      const client = createTravelSwapClient();
      const specialWallet = 'wallet+special/chars=test';
      const url = client.getGiftCardUrl(50, specialWallet);

      // URLSearchParams encodes special chars
      const parsed = new URL(url);
      expect(parsed.searchParams.get('wallet')).toBe(specialWallet);
    });
  });

  // ─── Service interface ─────────────────────────────────────

  describe('service interface', () => {
    it('exposes exactly the expected methods', () => {
      const client = createTravelSwapClient();
      const methods = Object.keys(client).sort();
      expect(methods).toEqual(['getBookingUrl', 'getGiftCardUrl']);
    });
  });
});
