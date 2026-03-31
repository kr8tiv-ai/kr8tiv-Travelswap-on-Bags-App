// ─── TravelSwapClient ──────────────────────────────────────────
// Generates TravelSwap partner referral URLs. No HTTP calls —
// pure URL construction with ?ref= tracking parameter.

const BASE_URL = 'https://travelswap.xyz';

// ─── Service Interface ─────────────────────────────────────────

export interface TravelSwapClient {
  /** Generate a booking URL with referral tracking. */
  getBookingUrl(walletAddress: string): string;

  /** Generate a gift card purchase URL with denomination and referral tracking. */
  getGiftCardUrl(denominationUsd: number, walletAddress: string): string;
}

// ─── Factory ───────────────────────────────────────────────────

export function createTravelSwapClient(partnerRef: string = 'FLIGHTBRAIN'): TravelSwapClient {
  return {
    getBookingUrl(walletAddress: string): string {
      const params = new URLSearchParams({
        ref: partnerRef,
        wallet: walletAddress,
      });
      return `${BASE_URL}/book?${params.toString()}`;
    },

    getGiftCardUrl(denominationUsd: number, walletAddress: string): string {
      const params = new URLSearchParams({
        ref: partnerRef,
        denomination: String(denominationUsd),
        wallet: walletAddress,
      });
      return `${BASE_URL}/gift-card?${params.toString()}`;
    },
  };
}
