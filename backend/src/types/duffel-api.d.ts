// ─── @duffel/api Type Declarations ─────────────────────────────
// Local type stubs for the @duffel/api SDK. The SDK is a runtime
// dependency loaded dynamically or via optional peer; these stubs
// satisfy TypeScript's module resolution without requiring the
// full package in node_modules during build.

declare module '@duffel/api' {
  // ─── Passenger Gender ──────────────────────────────────────────
  export type DuffelPassengerGender = 'm' | 'f';
  export type DuffelPassengerTitle = 'mr' | 'mrs' | 'ms' | 'miss' | 'dr';

  // ─── Core Types ────────────────────────────────────────────────

  export interface CreateOrderPassenger {
    id: string;
    given_name: string;
    family_name: string;
    born_on: string;
    email: string;
    phone_number: string;
    gender: DuffelPassengerGender;
    type: 'adult' | 'child' | 'infant_without_seat';
    title: DuffelPassengerTitle;
  }

  export interface OfferRequestSlice {
    origin: string;
    destination: string;
    departure_date: string;
    arrival_time: string | null;
    departure_time: string | null;
  }

  export interface OfferRequestPassenger {
    type: 'adult' | 'child' | 'infant_without_seat';
  }

  export interface OfferRequest {
    id: string;
    offers?: unknown[];
    [key: string]: unknown;
  }

  export interface Order {
    id: string;
    booking_reference: string;
    total_amount: string;
    total_currency: string;
    created_at: string;
    [key: string]: unknown;
  }

  export interface DuffelResponse<T> {
    data: T;
  }

  export interface OfferRequestsAPI {
    create(params: {
      slices: OfferRequestSlice[];
      passengers: OfferRequestPassenger[];
      cabin_class?: string;
      return_offers?: boolean;
    }): Promise<DuffelResponse<OfferRequest>>;
  }

  export interface OrdersAPI {
    create(params: {
      type: 'instant' | 'hold';
      selected_offers: string[];
      passengers: CreateOrderPassenger[];
      payments: Array<{
        type: 'balance' | 'arc_bsp_cash';
        amount: string;
        currency: string;
      }>;
      metadata?: Record<string, string>;
    }): Promise<DuffelResponse<Order>>;
  }

  // ─── Main Client ───────────────────────────────────────────────

  export class Duffel {
    constructor(config: { token: string });
    offerRequests: OfferRequestsAPI;
    orders: OrdersAPI;
  }

  // ─── Error ─────────────────────────────────────────────────────

  export class DuffelError extends Error {
    meta?: {
      status?: number;
      request_id?: string;
    };
    errors?: Array<{
      type: string;
      title: string;
      message: string;
      code: string;
    }>;
    constructor(error: { meta?: { status?: number }; message?: string });
  }
}
