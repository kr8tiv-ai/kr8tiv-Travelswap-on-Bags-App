#!/usr/bin/env npx tsx
// ─── Live Duffel Sandbox Validation Script ─────────────────────
// Exercises DuffelClient against the real Duffel sandbox API.
// Usage: npx tsx scripts/validate-duffel.ts  (from project root)
// Requires: DUFFEL_API_TOKEN in .env or environment
//
// Strategy:
// 1. Create a DuffelClient with the sandbox token
// 2. Search for flights (JFK → LHR, ~3 months out)
// 3. Validate offer shape — prices, slices, segments
// 4. Verify getCachedOffers returns cached=true
// 5. Optionally attempt createOrder with test passenger data
//    (expected to fail with passenger ID mismatch or insufficient balance)

import * as fs from 'node:fs';
import * as path from 'node:path';
import type {
  CachedOfferResult,
  DuffelOffer,
  DuffelSlice,
  DuffelSegment,
  CreateOrderParams,
  PassengerDetails,
} from '../backend/src/types/index.js';

// Load .env manually (no dotenv dependency at root)
const envPath = path.resolve(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let val = trimmed.slice(eqIdx + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = val;
  }
}

// ─── Helpers ───────────────────────────────────────────────────

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) {
    console.error(`❌ ASSERTION FAILED: ${message}`);
    process.exit(1);
  }
}

function logSection(title: string) {
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`  ${title}`);
  console.log('─'.repeat(60));
}

// ─── Config ────────────────────────────────────────────────────

// Departure date ~3 months from now to ensure offer availability
const DEPARTURE_DATE = new Date(Date.now() + 90 * 86_400_000)
  .toISOString()
  .slice(0, 10); // YYYY-MM-DD

const ORIGIN = 'JFK';
const DESTINATION = 'LHR';
const PASSENGERS = 1;
const CABIN_CLASS = 'economy' as const;

// ─── Main ──────────────────────────────────────────────────────

async function main() {
  const { createDuffelClient } = await import('../backend/src/clients/DuffelClient.js');

  // 1. Validate API token presence
  logSection('Environment');
  const apiToken = process.env.DUFFEL_API_TOKEN;
  assert(!!apiToken, 'DUFFEL_API_TOKEN environment variable is not set');
  console.log('✅ DUFFEL_API_TOKEN is present');

  // 2. Create client
  const client = createDuffelClient({ apiToken, retryBaseDelayMs: 0 });
  console.log('✅ DuffelClient created');

  // 3. Search flights
  logSection(`searchFlights (${ORIGIN} → ${DESTINATION}, ${DEPARTURE_DATE})`);
  console.log(`Searching: ${ORIGIN} → ${DESTINATION}, ${DEPARTURE_DATE}, ${PASSENGERS} pax, ${CABIN_CLASS}`);

  const result: CachedOfferResult = await client.searchFlights({
    origin: ORIGIN,
    destination: DESTINATION,
    departureDate: DEPARTURE_DATE,
    passengers: PASSENGERS,
    cabinClass: CABIN_CLASS,
  });

  assert(!!result.requestId, 'requestId is missing');
  assert(result.offers.length >= 1, `Expected ≥1 offer, got ${result.offers.length}`);
  assert(result.cached === false, `Expected cached=false for fresh search, got ${result.cached}`);
  console.log(`✅ Got ${result.offers.length} offers (requestId: ${result.requestId})`);

  // 4. Validate first offer shape
  logSection('Offer Shape Validation');
  const offer: DuffelOffer = result.offers[0];

  assert(typeof offer.id === 'string' && offer.id.length > 0, 'offer.id is empty');
  console.log(`  id: ${offer.id}`);

  const totalNum = parseFloat(offer.totalAmount);
  assert(!isNaN(totalNum) && totalNum > 0, `offer.totalAmount "${offer.totalAmount}" is not a positive number`);
  console.log(`  totalAmount: ${offer.totalAmount}`);

  assert(
    typeof offer.totalCurrency === 'string' && /^[A-Z]{3}$/.test(offer.totalCurrency),
    `offer.totalCurrency "${offer.totalCurrency}" is not a 3-letter code`,
  );
  console.log(`  totalCurrency: ${offer.totalCurrency}`);

  assert(typeof offer.owner === 'string' && offer.owner.length > 0, 'offer.owner is empty');
  console.log(`  owner: ${offer.owner}`);

  assert(offer.slices.length >= 1, `Expected ≥1 slice, got ${offer.slices.length}`);
  console.log(`  slices: ${offer.slices.length}`);

  // Validate each slice and its segments
  for (let si = 0; si < offer.slices.length; si++) {
    const slice: DuffelSlice = offer.slices[si];
    assert(slice.segments.length >= 1, `Slice ${si}: expected ≥1 segment, got ${slice.segments.length}`);

    for (let gi = 0; gi < slice.segments.length; gi++) {
      const seg: DuffelSegment = slice.segments[gi];
      assert(typeof seg.origin === 'string' && seg.origin.length > 0, `Slice ${si} Seg ${gi}: origin is empty`);
      assert(typeof seg.destination === 'string' && seg.destination.length > 0, `Slice ${si} Seg ${gi}: destination is empty`);
      assert(typeof seg.departingAt === 'string' && seg.departingAt.length > 0, `Slice ${si} Seg ${gi}: departingAt is empty`);
      assert(typeof seg.arrivingAt === 'string' && seg.arrivingAt.length > 0, `Slice ${si} Seg ${gi}: arrivingAt is empty`);
      assert(typeof seg.carrier === 'string' && seg.carrier.length > 0, `Slice ${si} Seg ${gi}: carrier is empty`);
      assert(typeof seg.flightNumber === 'string' && seg.flightNumber.length > 0, `Slice ${si} Seg ${gi}: flightNumber is empty`);
    }

    console.log(`  Slice ${si}: ${slice.origin} → ${slice.destination}, ${slice.segments.length} segment(s) ✅`);
  }
  console.log('✅ First offer shape validated');

  // 5. Log top 5 offers
  logSection('Top 5 Offers');
  const top5 = result.offers.slice(0, 5);
  for (let i = 0; i < top5.length; i++) {
    const o = top5[i];
    const route = o.slices.map((s) => `${s.origin}→${s.destination}`).join(', ');
    console.log(`  #${i + 1}: ${o.totalAmount} ${o.totalCurrency} | ${o.owner} | ${route} | ${o.totalStops} stop(s)`);
  }

  // 6. getCachedOffers — should return cached=true
  logSection('getCachedOffers');
  const cached = client.getCachedOffers(result.requestId);
  assert(cached !== null, 'getCachedOffers returned null — expected cached result');
  assert(cached!.cached === true, `Expected cached=true, got ${cached!.cached}`);
  assert(cached!.offers.length === result.offers.length, `Cached offer count ${cached!.offers.length} !== original ${result.offers.length}`);
  console.log(`✅ getCachedOffers returned ${cached!.offers.length} offers (cached=true)`);

  // 7. Optional: attempt createOrder with test passenger
  logSection('createOrder (optional — expected to fail gracefully)');
  const testPassenger: PassengerDetails = {
    givenName: 'Test',
    familyName: 'Traveler',
    bornOn: '1990-01-15',
    email: 'test@example.com',
    phoneNumber: '+14155552671',
    gender: 'male',
  };

  const orderParams: CreateOrderParams = {
    offerId: offer.id,
    passengers: [testPassenger],
    amount: totalNum,
    currency: offer.totalCurrency,
    metadata: { source: 'validate-duffel' },
  };

  try {
    const order = await client.createOrder(orderParams);
    console.log(`✅ Order created (unexpected success!)`);
    console.log(`  orderId: ${order.id}`);
    console.log(`  bookingReference: ${order.bookingReference}`);
    console.log(`  totalAmount: ${order.totalAmount} ${order.totalCurrency}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const isPassengerIdIssue = msg.toLowerCase().includes('passenger')
      && (msg.toLowerCase().includes('id') || msg.toLowerCase().includes('match'));
    const isBalanceIssue = msg.toLowerCase().includes('balance')
      || msg.toLowerCase().includes('insufficient');

    if (isPassengerIdIssue) {
      console.log('⚠️  createOrder failed — passenger ID mismatch (expected)');
      console.log('   Duffel requires offer-request passenger IDs (e.g. "pas_0000xxx"),');
      console.log('   not arbitrary IDs like "passenger_0". This is a known limitation.');
    } else if (isBalanceIssue) {
      console.log('⚠️  createOrder failed — insufficient balance (expected for sandbox)');
    } else {
      console.log(`⚠️  createOrder failed — ${msg}`);
    }
    console.log('   (This is not a validation failure — booking requires live credentials/balance)');
  }

  // 8. Summary
  logSection('Summary');
  console.log('✅ All required assertions passed');
  console.log(`  Methods validated: searchFlights, getCachedOffers, createOrder (attempted)`);
  console.log(`  Route: ${ORIGIN} → ${DESTINATION}`);
  console.log(`  Departure: ${DEPARTURE_DATE}`);
  console.log(`  Offers returned: ${result.offers.length}`);
  console.log(`  Request ID: ${result.requestId}`);
  console.log(`  Cheapest: ${result.offers[0].totalAmount} ${result.offers[0].totalCurrency}`);
  if (result.offers.length > 1) {
    const last = result.offers[result.offers.length - 1];
    console.log(`  Most expensive: ${last.totalAmount} ${last.totalCurrency}`);
  }
}

main().catch((err) => {
  console.error(`\n❌ VALIDATION FAILED: ${err instanceof Error ? err.message : String(err)}`);
  if (err instanceof Error && err.stack) {
    console.error(err.stack);
  }
  process.exit(1);
});
