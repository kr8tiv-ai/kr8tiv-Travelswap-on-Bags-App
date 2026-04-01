import type { MigrationEntry } from '../Database.js';

import * as m001 from './001_create_strategies.js';
import * as m002 from './002_create_runs.js';
import * as m003 from './003_create_travel_balances.js';
import * as m004 from './004_create_gift_cards.js';
import * as m005 from './005_create_audit_log.js';
import * as m006 from './006_add_strategy_columns.js';
import * as m007 from './007_create_offer_requests.js';
import * as m008 from './008_create_bookings.js';
import * as m009 from './009_add_gift_card_payorder.js';
import * as m010 from './010_add_custom_allocations.js';
import * as m011 from './011_add_gift_card_provider.js';
import * as m012 from './012_create_travel_passes.js';

/** Ordered list of all database migrations. */
export const migrations: MigrationEntry[] = [
  m001,
  m002,
  m003,
  m004,
  m005,
  m006,
  m007,
  m008,
  m009,
  m010,
  m011,
  m012,
];
